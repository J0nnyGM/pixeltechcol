// functions/mercadolibre3.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Leemos las credenciales de la TIENDA 3
const ML_APP_ID = process.env.ML_APP_ID_3;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET_3;

// Función auxiliar para hacer peticiones a la API de MercadoLibre
async function fetchML(endpoint, token) {
    const response = await fetch(`https://api.mercadolibre.com${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Error en API ML3: ${response.statusText}`);
    return await response.json();
}

/**
 * BUSCADOR INTELIGENTE DE EAN/SKU
 */
async function findProductByEAN(db, eanToFind) {
    const ean = String(eanToFind).trim().toUpperCase();
    
    const simpleQuery = await db.collection('products').where('sku', '==', ean).limit(1).get();
    if (!simpleQuery.empty) {
        return { docId: simpleQuery.docs[0].id, isVariant: false };
    }

    const variantsQuery = await db.collection('products').where('hasVariants', '==', true).get();
    for (const doc of variantsQuery.docs) {
        const pData = doc.data();
        if (pData.combinations) {
            const variantIndex = pData.combinations.findIndex(c => String(c.sku).trim().toUpperCase() === ean);
            if (variantIndex >= 0) {
                return { 
                    docId: doc.id, 
                    isVariant: true, 
                    variantIndex: variantIndex,
                    color: pData.combinations[variantIndex].color,
                    capacity: pData.combinations[variantIndex].capacity
                };
            }
        }
    }
    return null;
}

// ============================================================================
// 1. WEBHOOK DE COMPRAS DE MERCADOLIBRE (TIENDA 3)
// ============================================================================
exports.webhook = async (req, res) => {
    const db = admin.firestore();

    try {
        const topic = req.body.topic || req.query.topic;
        const resource = req.body.resource; 
        
        res.status(200).send("OK");

        if (topic !== 'orders_v2' && topic !== 'orders') return;
        if (!resource) return;

        console.log(`📦 Nueva orden de MercadoLibre (TIENDA 3) detectada: ${resource}`);

        // --- LEER EL TOKEN VIGENTE DESDE FIRESTORE (Config de Tienda 3) ---
        const mlConfigDoc = await db.collection('config').doc('mercadolibre_store3').get();
        if (!mlConfigDoc.exists) throw new Error("Falta configuración de ML3 en DB");
        const ML_TOKEN = mlConfigDoc.data().accessToken;

        const orderData = await fetchML(resource, ML_TOKEN);
        // Cambiamos el prefijo para la tienda 3
        const orderId = `ML3-${orderData.id}`;

        const orderCheck = await db.collection('orders').doc(orderId).get();
        if (orderCheck.exists) {
            const existingOrder = orderCheck.data();
            
            // Si el pedido ya está CANCELADO en nuestra base de datos, no hacemos nada
            if (existingOrder.status === 'CANCELADO') return;
            
            // Si viene cancelado de MercadoLibre, procesamos la cancelación y devolución de stock
            if (orderData.status === 'cancelled') {
                console.log(`⚠️ Pedido ${orderId} fue CANCELADO en MercadoLibre. Iniciando reversión...`);
                
                await db.runTransaction(async (t) => {
                    // 1. Devolver el stock a los productos e items correspondientes
                    for (const item of existingOrder.items || []) {
                        const foundProduct = await findProductByEAN(db, item.sku);
                        if (foundProduct) {
                            const pRef = db.collection('products').doc(foundProduct.docId);
                            const pDoc = await t.get(pRef);
                            if (pDoc.exists) {
                                const pData = pDoc.data();
                                let newStock = (pData.stock || 0) + item.quantity;
                                let updatePayload = { 
                                    stock: newStock,
                                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                                    lastStockChangeReason: 'DEVOLUCION_CANCELACION',
                                    lastStockChangeDetails: `Devolución por cancelación MercadoLibre #${orderData.id}`
                                };
                                
                                if (foundProduct.isVariant && pData.combinations) {
                                    let newCombos = [...pData.combinations];
                                    if (newCombos[foundProduct.variantIndex]) {
                                        newCombos[foundProduct.variantIndex].stock = (newCombos[foundProduct.variantIndex].stock || 0) + item.quantity;
                                    }
                                    updatePayload.combinations = newCombos;
                                }
                                t.update(pRef, updatePayload);
                            }
                        }
                    }
                    
                    // 2. Descontar saldo de la cuenta de tesorería (si se sumó previamente)
                    if (existingOrder.paymentAccountId) {
                        const accRef = db.collection('accounts').doc(existingOrder.paymentAccountId);
                        const accDoc = await t.get(accRef);
                        if (accDoc.exists) {
                            t.update(accRef, { balance: Math.max(0, (Number(accDoc.data().balance) || 0) - Number(existingOrder.total)) });
                        }
                    }
                    
                    // 3. Crear registro de egreso por anulación/cancelación
                    const accName = 'MercadoLibre 3';
                    const expenseRef = db.collection('expenses').doc();
                    t.set(expenseRef, {
                        amount: Number(existingOrder.total),
                        category: "Anulación Ventas Online",
                        description: `Cancelación MercadoLibre 3 #${orderData.id}`,
                        paymentMethod: accName, type: 'EXPENSE', orderId: orderId,
                        supplierName: existingOrder.userName || "Cliente MercadoLibre", date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    // 4. Cambiar estado de la orden a CANCELADO en nuestra DB
                    t.update(db.collection('orders').doc(orderId), {
                        status: 'CANCELADO',
                        isStockDeducted: false,
                        paymentStatus: 'REFUNDED',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                });
                console.log(`✅ Pedido ${orderId} revertido y cancelado con éxito.`);
            }
            return;
        }

        // --- DATOS DE ENVÍO Y GUÍA ---
        let shippingData = { address: "Acordar con el vendedor", city: "", guideNumber: "", carrier: "" };
        if (orderData.shipping && orderData.shipping.id) {
            shippingData.shipmentId = String(orderData.shipping.id);
            try {
                const shipment = await fetchML(`/shipments/${orderData.shipping.id}`, ML_TOKEN);
                const receiver = shipment.receiver_address;
                shippingData = {
                    shipmentId: String(orderData.shipping.id),
                    address: receiver ? `${receiver.street_name} ${receiver.street_number}, ${receiver.neighborhood?.name || ''}` : '',
                    city: receiver ? `${receiver.city?.name}, ${receiver.state?.name}` : '',
                    guideNumber: shipment.tracking_number || "Pendiente",
                    carrier: shipment.tracking_method || "MercadoEnvíos",
                    department: receiver?.state?.name || ""
                };
            } catch (err) {
                console.log("No se pudo obtener el envío de ML3 detallado.");
            }
        }

        // --- CREAR O ACTUALIZAR CLIENTE ---
        const buyer = orderData.buyer;
        const buyerDoc = String(buyer.billing_info?.doc_number || buyer.id);
        const buyerPhone = buyer.phone?.number ? `${buyer.phone.area_code || ''} ${buyer.phone.number}`.trim() : "";
        const buyerName = `${buyer.first_name} ${buyer.last_name}`.trim();

        let userId = `ML3-${buyer.id}`; 
        
        if (buyerDoc) {
            const userQ = await db.collection('users').where('document', '==', buyerDoc).limit(1).get();
            if (!userQ.empty) {
                userId = userQ.docs[0].id;
            } else {
                const newUserRef = await db.collection('users').add({
                    name: buyerName, document: buyerDoc, phone: buyerPhone, email: buyer.email || "",
                    source: 'MERCADOLIBRE_3', role: 'client', address: shippingData.address, city: shippingData.city,
                    dept: shippingData.department, createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                userId = newUserRef.id;
            }
        }

        // --- ARMAR LOS ITEMS ---
        let dbItems = [];
        let itemsToDeduct = [];
        
        for (const item of orderData.order_items) {
            const mlEAN = item.item.seller_sku; 
            const qty = item.quantity;
            
            const foundProduct = await findProductByEAN(db, mlEAN);

            if (foundProduct) {
                itemsToDeduct.push({ ...foundProduct, qty });
            }

            dbItems.push({
                id: foundProduct ? foundProduct.docId : `ML3-UNKNOWN-${mlEAN}`,
                name: item.item.title,
                price: item.unit_price,
                quantity: qty,
                color: foundProduct ? foundProduct.color : "",
                capacity: foundProduct ? foundProduct.capacity : "",
                sku: mlEAN
            });
        }

        // --- TRANSACCIÓN SEGURA: GUARDAR ORDEN, COBRO Y STOCK ---
        await db.runTransaction(async (t) => {
            const isMLCancelled = orderData.status === 'cancelled';
            let accId = null, accName = 'MercadoLibre 3';

            if (!isMLCancelled) {
                const accQ = await t.get(db.collection('accounts').where('name', '==', accName).limit(1));
                if (!accQ.empty) {
                    const accDoc = accQ.docs[0];
                    accId = accDoc.id;
                    t.update(accDoc.ref, { balance: (Number(accDoc.data().balance) || 0) + Number(orderData.total_amount) });
                }
            }

            if (!isMLCancelled) {
                for (const p of itemsToDeduct) {
                    const pRef = db.collection('products').doc(p.docId);
                    const pDoc = await t.get(pRef);
                    if (pDoc.exists) {
                        const pData = pDoc.data();
                        let newStock = Math.max(0, (pData.stock || 0) - p.qty);
                        let updatePayload = { stock: newStock };

                        if (p.isVariant && pData.combinations) {
                            let newCombos = [...pData.combinations];
                            if (newCombos[p.variantIndex]) {
                                newCombos[p.variantIndex].stock = Math.max(0, newCombos[p.variantIndex].stock - p.qty);
                            }
                            updatePayload.combinations = newCombos;
                        }
                        t.update(pRef, updatePayload);
                    }
                }
            }

            if (accId && !isMLCancelled) {
                const incomeRef = db.collection('expenses').doc();
                t.set(incomeRef, {
                    amount: Number(orderData.total_amount),
                    category: "Ingreso Ventas Online",
                    description: `Venta MercadoLibre 3 #${orderData.id}`,
                    paymentMethod: accName, type: 'INCOME', orderId: orderId,
                    supplierName: buyerName, date: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            const orderRef = db.collection('orders').doc(orderId);
            t.set(orderRef, {
                source: 'MERCADOLIBRE_3', createdAt: admin.firestore.FieldValue.serverTimestamp(),
                userId: userId, userName: buyerName, phone: buyerPhone, clientDoc: buyerDoc,
                shippingData: shippingData, shippingCarrier: shippingData.carrier, shippingTracking: shippingData.guideNumber,
                items: dbItems, subtotal: orderData.total_amount, shippingCost: 0, total: orderData.total_amount,
                status: isMLCancelled ? 'CANCELADO' : (shippingData.guideNumber !== 'Pendiente' ? 'DESPACHADO' : 'ALISTADO'),
                paymentMethod: 'MERCADOLIBRE_3', 
                paymentStatus: isMLCancelled ? 'REFUNDED' : 'PAID', 
                amountPaid: isMLCancelled ? 0 : orderData.total_amount,
                isStockDeducted: !isMLCancelled, 
                paymentAccountId: accId
            });
        });

    } catch (error) {
        console.error("❌ Error en Webhook de MercadoLibre 3:", error);
    }
};

// ============================================================================
// 2. CRON JOB: AUTO-RENOVACIÓN DE TOKEN (TIENDA 3)
// ============================================================================
exports.renewTokenTask = async () => {
    const db = admin.firestore();
    const docRef = db.collection('config').doc('mercadolibre_store3');
    
    try {
        const docSnap = await docRef.get();
        if (!docSnap.exists) return;

        const data = docSnap.data();
        const currentRefreshToken = data.refreshToken;
        if (!currentRefreshToken) return;

        console.log("🔄 Solicitando nuevo token a MercadoLibre 3...");

        const response = await fetch("https://api.mercadolibre.com/oauth/token", {
            method: "POST",
            headers: {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: ML_APP_ID,
                client_secret: ML_CLIENT_SECRET,
                refresh_token: currentRefreshToken
            })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(`Fallo al renovar ML3: ${JSON.stringify(result)}`);

        await docRef.update({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log("✅ Token de MercadoLibre 3 renovado con éxito.");

    } catch (error) {
        console.error("❌ Error Crítico renovando token de ML3:", error);
    }
};