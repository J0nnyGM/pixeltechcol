const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { initProductWorkingState, applyStockDeltaToState } = require("./inventory-helper");

exports.createCODOrder = async (data, context) => {
    const db = admin.firestore();
    const auth = admin.auth();

    // --- 1. AUTENTICACION ---
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
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion.');
    }

    // --- 2. DATOS ---
    const rawItems = data.items || (data.data && data.data.items);
    const shippingCost = Number(data.shippingCost || (data.data && data.data.shippingCost) || 0);
    const extraData = data.extraData || (data.data && data.data.extraData) || {};
    
    const paymentMethod = data.paymentMethod || (data.data && data.data.paymentMethod) || 'CONTRAENTREGA';

    if (!rawItems || !rawItems.length) throw new functions.https.HttpsError('invalid-argument', 'Carrito vacio.');

    try {
        // IDs generados fuera de la transaccion para usarlos en escrituras
        const newOrderRef = db.collection('orders').doc();
        // Enlazamos la remision al ID exacto de la orden
        const remissionRef = db.collection('remissions').doc(newOrderRef.id);
        
        let orderDataToSave = {};
        let remissionDataToSave = {};

        // --- 3. TRANSACCION ATOMICA ---
        await db.runTransaction(async (t) => {
            const workingProducts = new Map();
            const dbItems = [];
            let subtotal = 0;
            let hasExcludedProduct = false;

            // --- FASE 1: LECTURAS UNICAS POR PRODUCTO ---
            for (const item of rawItems) {
                const qty = parseInt(item.quantity, 10);
                if (!Number.isFinite(qty) || qty <= 0) {
                    throw new Error(`Cantidad invalida para producto ${item.id}.`);
                }
                if (!workingProducts.has(item.id)) {
                    const pRef = db.collection('products').doc(item.id);
                    const pDoc = await t.get(pRef);
                    if (!pDoc.exists) throw new Error(`Producto ${item.id} no existe.`);
                    const pData = pDoc.data();
                    workingProducts.set(item.id, {
                        ref: pRef,
                        pData,
                        state: initProductWorkingState(pData)
                    });
                }
            }

            // --- FASE 1B: CALCULOS Y DESCUENTO ESTRICTO EN BODEGA ---
            for (const item of rawItems) {
                const entry = workingProducts.get(item.id);
                const pData = entry.pData;
                const price = Number(pData.price) || 0;
                const qty = parseInt(item.quantity, 10);

                if (pData.excludeFromFreeShipping === true) hasExcludedProduct = true;

                applyStockDeltaToState(entry.state, {
                    delta: -qty,
                    branch: 'bodega',
                    color: item.color || '',
                    capacity: item.capacity || '',
                    strict: true
                });

                subtotal += price * qty;
                dbItems.push({
                    id: item.id, name: pData.name, price: price, quantity: qty,
                    color: item.color || "", capacity: item.capacity || "", mainImage: pData.mainImage || ""
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

            // --- FASE 2: ESCRITURAS (exactamente UN update por producto unico) ---
            for (const [, entry] of workingProducts) {
                if (!entry.state.modified) continue;
                t.update(entry.ref, {
                    stock: entry.state.stock,
                    combinations: entry.state.combinations,
                    branchStock: entry.state.branchStock,
                    lastStockChangeReason: 'VENTA_PEDIDO',
                    lastStockChangeDetails: `Venta web contraentrega pedido #${newOrderRef.id.slice(0, 8)}`,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
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