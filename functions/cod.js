const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.createCODOrder = async (data, context) => {
    const db = admin.firestore();
    const auth = admin.auth();

    // --- 1. AUTENTICACIÓN ---
    let uid, email;
    const userToken = data.userToken || (data.data && data.data.userToken);

    try {
        if (context.auth) {
            uid = context.auth.uid;
            email = context.auth.token.email;
        } else if (userToken) {
            const decodedToken = await auth.verifyIdToken(userToken);
            uid = decodedToken.uid;
            email = decodedToken.email;
        } else {
            throw new Error("Sin credenciales.");
        }
    } catch (error) {
        console.error("Auth Error COD:", error);
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    // --- 2. DATOS ---
    const rawItems = data.items || (data.data && data.data.items);
    const shippingCost = Number(data.shippingCost || (data.data && data.data.shippingCost) || 0);
    const extraData = data.extraData || (data.data && data.data.extraData) || {};
    
    //  AQUÍ CAPTURAMOS EL MÉTODO ENVIADO DESDE EL CHECKOUT.JS 
    const paymentMethod = data.paymentMethod || (data.data && data.data.paymentMethod) || 'CONTRAENTREGA';

    if (!rawItems || !rawItems.length) throw new functions.https.HttpsError('invalid-argument', 'Carrito vacío.');

    try {
        // IDs generados fuera de la transacción para usarlos en escrituras
        const newOrderRef = db.collection('orders').doc();
        // Enlazamos la remisión al ID exacto de la orden
        const remissionRef = db.collection('remissions').doc(newOrderRef.id);
        
        let orderDataToSave = {};
        let remissionDataToSave = {};

        // --- 3. TRANSACCIÓN ATÓMICA ---
        await db.runTransaction(async (t) => {
            const pendingUpdates = []; // Array para guardar las actualizaciones pendientes
            const dbItems = [];
            let subtotal = 0;
            let hasExcludedProduct = false;

            // --- FASE 1: LECTURAS Y CÁLCULOS (Solo .get()) ---
            for (const item of rawItems) {
                const pRef = db.collection('products').doc(item.id);
                const pDoc = await t.get(pRef); 
                
                if (!pDoc.exists) throw new Error(`Producto ${item.id} no existe.`);
                
                const pData = pDoc.data();
                const price = Number(pData.price) || 0;
                const qty = parseInt(item.quantity) || 1;
                
                if (pData.excludeFromFreeShipping === true) hasExcludedProduct = true;

                // Cálculo de Stock
                let newStock = (Number(pData.stock) || 0) - qty;
                if (newStock < 0) throw new Error(`Sin stock: ${pData.name}`);
                
                let newCombinations = Array.isArray(pData.combinations) ? JSON.parse(JSON.stringify(pData.combinations)) : [];
                let rootBranchStock = pData.branchStock ? { ...pData.branchStock } : null;

                if (newCombinations.length > 0) {
                    let idx = -1;
                    if (item.color || item.capacity) {
                        const normColor = String(item.color || '').trim().toLowerCase();
                        const normCap = String(item.capacity || '').trim().toLowerCase();
                        idx = newCombinations.findIndex(c => 
                            (String(c.color || '').trim().toLowerCase() === normColor || (!c.color && !item.color)) &&
                            (String(c.capacity || '').trim().toLowerCase() === normCap || (!c.capacity && !item.capacity))
                        );
                    }
                    if (idx < 0 && newCombinations.length === 1) idx = 0;

                    if (idx >= 0) {
                        if ((Number(newCombinations[idx].stock) || 0) < qty) throw new Error(`Sin stock variante: ${pData.name}`);
                        newCombinations[idx].stock = Math.max(0, (Number(newCombinations[idx].stock) || 0) - qty);

                        if (newCombinations[idx].branchStock) {
                            let curBodega = newCombinations[idx].branchStock['bodega'] !== undefined
                                ? (Number(newCombinations[idx].branchStock['bodega']) || 0)
                                : Math.max(0, (Number(newCombinations[idx].stock) || 0) + qty - Object.entries(newCombinations[idx].branchStock).filter(([k]) => k !== 'bodega').reduce((s, [, v]) => s + (Number(v) || 0), 0));
                            newCombinations[idx].branchStock['bodega'] = Math.max(0, curBodega - qty);
                        }
                    }

                    newStock = newCombinations.reduce((sum, c) => sum + (Number(c.stock) || 0), 0);

                    if (newCombinations.some(c => c.branchStock)) {
                        rootBranchStock = {};
                        newCombinations.forEach(c => {
                            if (c.branchStock) {
                                Object.keys(c.branchStock).forEach(bId => {
                                    rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (Number(c.branchStock[bId]) || 0);
                                });
                            }
                        });
                    }
                } else if (rootBranchStock) {
                    let curBodega = rootBranchStock['bodega'] !== undefined
                        ? (Number(rootBranchStock['bodega']) || 0)
                        : Math.max(0, (Number(pData.stock) || 0) - Object.entries(rootBranchStock).filter(([k]) => k !== 'bodega').reduce((s, [, v]) => s + (Number(v) || 0), 0));
                    rootBranchStock['bodega'] = Math.max(0, curBodega - qty);
                }

                // Guardar la actualización para la Fase 2 (NO EJECUTAR AÚN)
                const stockUpdatePayload = { 
                    stock: newStock, 
                    combinations: newCombinations,
                    lastStockChangeReason: 'VENTA_PEDIDO',
                    lastStockChangeDetails: `Venta web contraentrega pedido #${newOrderRef.id.slice(0, 8)}`,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };
                if (rootBranchStock) stockUpdatePayload.branchStock = rootBranchStock;

                pendingUpdates.push({
                    ref: pRef,
                    data: stockUpdatePayload
                });

                subtotal += price * qty;
                
                dbItems.push({
                    id: item.id, name: pData.name, price: price, quantity: qty,
                    color: item.color||"", capacity: item.capacity||"", mainImage: pData.mainImage||""
                });
            }

            const incomingShippingType = data.shippingType || (data.extraData && data.extraData.shippingType) || 'ESTANDAR';
            const isFleteAlCobro = hasExcludedProduct || incomingShippingType === 'FLETE_AL_COBRO';

            let validatedShippingCost = isFleteAlCobro ? 0 : shippingCost;
            let finalShippingType = isFleteAlCobro ? 'FLETE_AL_COBRO' : (validatedShippingCost === 0 ? 'GRATIS' : 'ESTANDAR');
            
            const shippingData = extraData.shippingData || {};
            shippingData.shippingType = finalShippingType;

            // Preparar datos finales de la orden
            const total = subtotal + validatedShippingCost;
            
            orderDataToSave = {
                source: 'TIENDA_WEB', 
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                userId: uid, userEmail: email, userName: extraData.userName || "Cliente",
                phone: extraData.phone || shippingData.phone || "", clientDoc: extraData.clientDoc || "",
                shippingData, 
                shippingType: finalShippingType,
                billingData: extraData.billingData || null, 
                requiresInvoice: extraData.needsInvoice || false,
                items: dbItems, subtotal, shippingCost: validatedShippingCost, total,
                status: 'PENDIENTE', paymentStatus: 'PENDING', 
                paymentMethod: paymentMethod, 
                isStockDeducted: true,
                buyerInfo: { name: extraData.userName, email, phone: extraData.phone }
            };

            remissionDataToSave = {
                orderId: newOrderRef.id, source: 'TIENDA_WEB',
                clientName: orderDataToSave.userName, clientPhone: orderDataToSave.phone, clientDoc: orderDataToSave.clientDoc,
                clientAddress: `${shippingData.address}, ${shippingData.city}`,
                items: dbItems, total, status: 'PENDIENTE_ALISTAMIENTO', type: 'VENTA_WEB',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // --- FASE 2: ESCRITURAS (Solo .update() y .set()) ---
            // 1. Actualizar Stocks
            for (const update of pendingUpdates) {
                t.update(update.ref, update.data);
            }

            // 2. Crear Orden
            t.set(newOrderRef, orderDataToSave);

            // 3. Crear Remisión
            t.set(remissionRef, remissionDataToSave);
        });

        return { orderId: newOrderRef.id };

    } catch (error) {
        console.error("[COD Error] Error procesando pedido contraentrega:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
};