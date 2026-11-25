const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { initProductWorkingState, applyStockDeltaToState } = require("./inventory-helper");

// --- CONFIGURACIÓN DINÁMICA CON FALLBACK A .ENV ---
async function getMPClient(db) {
    let token = process.env.MP_ACCESS_TOKEN;
    try {
        if (!db) db = admin.firestore();
        const devDoc = await db.collection('config').doc('developer').get();
        if (devDoc.exists) {
            const data = devDoc.data();
            if (data.MP_ACCESS_TOKEN && data.MP_ACCESS_TOKEN.trim()) {
                token = data.MP_ACCESS_TOKEN.trim();
            }
        }
    } catch (e) {
        console.error("Error al obtener token de MP de Firestore:", e.message);
    }
    return token ? new MercadoPagoConfig({ accessToken: token }) : null;
}

// CAMBIA ESTO POR TU URL REAL DE FIREBASE FUNCTIONS
const WEBHOOK_URL = "https://us-central1-pixeltechcol.cloudfunctions.net/mercadoPagoWebhook"; 

/**
 * 1. CREAR PREFERENCIA (CHECKOUT)
 * - Crea la orden en Firebase como PENDIENTE_PAGO.
 * - Genera el link de MercadoPago con expiración de 30 minutos.
 */
exports.createPreference = async (data, context) => {
    // Inicialización Lazy
    const db = admin.firestore();
    const auth = admin.auth();

    console.log(" Iniciando Checkout MP...");

    const client = await getMPClient(db);
    if (!client) throw new functions.https.HttpsError('internal', 'Pasarela Mercado Pago no configurada.');

    // --- 1. AUTENTICACIÓN ---
    const userToken = data.userToken || (data.data && data.data.userToken);
    let uid, email;

    try {
        if (userToken) {
            const decodedToken = await auth.verifyIdToken(userToken);
            uid = decodedToken.uid;
            email = decodedToken.email;
        } else if (context.auth) {
            uid = context.auth.uid;
            email = context.auth.token.email;
        } else {
            throw new Error("Sin credenciales.");
        }
    } catch (error) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión para comprar.');
    }

    // --- 2. VALIDAR DATOS ---
    const rawItems = data.items || (data.data && data.data.items);
    const shippingCost = Number(data.shippingCost || (data.data && data.data.shippingCost) || 0);
    const buyerInfo = data.buyerInfo || (data.data && data.data.buyerInfo) || {};
    const extraData = data.extraData || (data.data && data.data.extraData) || {};

    if (!rawItems || !rawItems.length) throw new functions.https.HttpsError('invalid-argument', 'El carrito está vacío.');

    try {
        let mpItems = []; 
        let dbItems = []; 
        let subtotal = 0;
        let hasExcludedProduct = false;
        
        // Validar precios reales en DB para seguridad
        for (const item of rawItems) {
            const pDoc = await db.collection('products').doc(item.id).get();
            if (!pDoc.exists) continue;
            
            const pData = pDoc.data();
            const realPrice = Number(pData.price) || 0;
            const quantity = parseInt(item.quantity) || 1;
            
            if (pData.excludeFromFreeShipping === true) hasExcludedProduct = true;

            subtotal += realPrice * quantity;

            // Item para base de datos
            dbItems.push({
                id: item.id,
                name: pData.name, 
                price: realPrice,       
                quantity: quantity,
                color: item.color || "",       
                capacity: item.capacity || "", 
                mainImage: pData.mainImage || pData.image || ""
            });

            // Item para MercadoPago
            mpItems.push({
                id: item.id,
                title: pData.name,
                description: `${pData.name} ${item.color || ''} ${item.capacity || ''}`.trim(),
                quantity: quantity,
                unit_price: realPrice,
                currency_id: 'COP',
                picture_url: pData.mainImage || ''
            });
        }

        const incomingShippingType = data.shippingType || (data.extraData && data.extraData.shippingType) || 'ESTANDAR';
        const isFleteAlCobro = hasExcludedProduct || incomingShippingType === 'FLETE_AL_COBRO';
        
        let validatedShippingCost = isFleteAlCobro ? 0 : shippingCost;
        let finalShippingType = isFleteAlCobro ? 'FLETE_AL_COBRO' : (validatedShippingCost === 0 ? 'GRATIS' : 'ESTANDAR');

        if (validatedShippingCost > 0) {
            mpItems.push({
                id: 'envio', title: 'Costo de Envío', quantity: 1, unit_price: validatedShippingCost, currency_id: 'COP'
            });
        }

        const totalAmount = subtotal + validatedShippingCost;
        
        // --- 3. CREAR ORDEN EN FIREBASE ---
        const newOrderRef = db.collection('orders').doc();
        const shippingData = extraData.shippingData || { address: buyerInfo.address };
        shippingData.shippingType = finalShippingType;

        await newOrderRef.set({
            source: 'TIENDA_WEB',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            userId: uid,
            userEmail: email,
            userName: extraData.userName || buyerInfo.name,
            phone: extraData.phone || buyerInfo.phone || "",
            clientDoc: extraData.clientDoc || "",
            
            shippingData: shippingData,
            shippingType: finalShippingType,
            billingData: extraData.billingData || null,
            requiresInvoice: extraData.needsInvoice || false,
            
            items: dbItems,
            subtotal: subtotal,
            shippingCost: validatedShippingCost,
            total: totalAmount,
            
            status: 'PENDIENTE_PAGO',
            paymentMethod: 'MERCADOPAGO',
            paymentStatus: 'PENDING',
            isStockDeducted: false, // Se descuenta al pagar
            
            buyerInfo: buyerInfo 
        });

        // --- 4. CONFIGURAR EXPIRACIÓN (30 MINUTOS) ---
        const expirationDate = new Date();
        expirationDate.setMinutes(expirationDate.getMinutes() + 30);

        // --- 5. CREAR PREFERENCIA MP ---
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: mpItems,
                payer: {
                    name: buyerInfo.name,
                    email: email,
                    phone: { area_code: "57", number: buyerInfo.phone },
                    address: { street_name: buyerInfo.address, zip_code: buyerInfo.postal }
                },
                back_urls: {
                    success: "https://pixeltechcol.com/shop/success.html", 
                    failure: "https://pixeltechcol.com/shop/success.html", 
                    pending: "https://pixeltechcol.com/shop/success.html"
                },
                auto_return: "approved",
                statement_descriptor: "PIXELTECH",
                external_reference: newOrderRef.id,
                notification_url: WEBHOOK_URL,
                date_of_expiration: expirationDate.toISOString() // EXPIRACIÓN AUTOMÁTICA
            }
        });

        return { preferenceId: result.id, initPoint: result.init_point };

    } catch (error) {
        console.error(" Error MP Create:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
};

/**
 * 2. WEBHOOK (CONFIRMACIÓN DE PAGO)
 * - Recibe notificación de MP.
 * - Verifica estado real.
 * - Descuenta stock.
 * - Suma saldo a Tesorería.
 */
exports.webhook = async (req, res) => {
    const db = admin.firestore();
    
    try {
        const client = await getMPClient(db);
        if (!client) return res.status(500).send("No config");

        const paymentId = req.query.id || req.query['data.id'] || req.body?.data?.id || req.body?.id;
        const topic = req.query.topic || req.body?.topic;

        // Ignoramos notificaciones de orden comercial, solo nos importan los pagos
        if (topic === 'merchant_order') return res.status(200).send("OK");
        if (!paymentId) return res.status(200).send("OK");

        // Consultar estado real a la API de MP
        const payment = new Payment(client);
        let paymentData;
        try {
            paymentData = await payment.get({ id: paymentId });
        } catch (e) { 
            console.warn("Error leyendo pago MP:", e.message);
            return res.status(200).send("OK"); 
        }
        
        const status = paymentData.status; 
        const orderId = paymentData.external_reference;

        if (!orderId) return res.status(200).send("OK");
        
        const orderRef = db.collection('orders').doc(orderId);
        const remRef = db.collection('remissions').doc(orderId);

        // --- A. PAGO APROBADO ---
        if (status === 'approved') {
            await db.runTransaction(async (t) => {
                
                // ==========================================
                // FASE 1: LECTURAS (t.get)
                // ==========================================
                const docSnap = await t.get(orderRef);
                if (!docSnap.exists) return;
                const oData = docSnap.data();
                if (oData.status === 'PAGADO' || oData.paymentStatus === 'PAID' || oData.status === 'CANCELADO' || oData.status === 'RECHAZADO') return;

                // Leer Inventario (una sola lectura por producto unico)
                const workingProducts = new Map();
                let totalActualDeducted = 0;
                if (!oData.isStockDeducted && Array.isArray(oData.items)) {
                    for (const i of oData.items) {
                        if (!i.id) continue;
                        if (!workingProducts.has(i.id)) {
                            const pRef = db.collection('products').doc(i.id);
                            const pDoc = await t.get(pRef);
                            if (pDoc.exists) {
                                workingProducts.set(i.id, {
                                    ref: pRef,
                                    state: initProductWorkingState(pDoc.data()),
                                    totalDelta: 0
                                });
                            }
                        }
                    }

                    for (const i of oData.items) {
                        const entry = workingProducts.get(i.id);
                        if (!entry) continue;
                        const qty = Math.max(1, parseInt(i.quantity, 10) || 1);
                        const resDelta = applyStockDeltaToState(entry.state, {
                            delta: -qty,
                            branch: 'bodega',
                            color: i.color || '',
                            capacity: i.capacity || '',
                            fallbackBestVariant: true
                        });
                        if (resDelta.appliedDelta < 0) {
                            entry.totalDelta += resDelta.appliedDelta;
                            totalActualDeducted += Math.abs(resDelta.appliedDelta);
                        }
                    }
                }

                // Leer Tesoreria
                const accQ = await t.get(db.collection('accounts').where('gatewayLink', '==', 'MERCADOPAGO').limit(1));
                let accDoc = null;
                if(!accQ.empty) {
                    accDoc = accQ.docs[0];
                } else {
                    const nameQ = await t.get(db.collection('accounts').where('name', '==', 'MercadoPago').limit(1));
                    if(!nameQ.empty) accDoc = nameQ.docs[0];
                    else {
                        const defQ = await t.get(db.collection('accounts').where('isDefaultOnline', '==', true).limit(1));
                        if(!defQ.empty) accDoc = defQ.docs[0];
                    }
                }

                // Leer Remision (BLINDAJE AGREGADO)
                const remSnap = await t.get(remRef);

                // ==========================================
                // FASE 2: ESCRITURAS (t.set, t.update)
                // ==========================================
                let accId = null, accName = 'MercadoPago';
                if(accDoc) {
                    t.update(accDoc.ref, { balance: (Number(accDoc.data().balance)||0) + (Number(oData.total)||0) });
                    
                    const incRef = db.collection('expenses').doc();
                    t.set(incRef, {
                        amount: Number(oData.total), 
                        category: "Ingreso Ventas Online",
                        description: `Venta MP #${orderId.slice(0,8)}`, 
                        paymentMethod: accDoc.data().name,
                        date: admin.firestore.FieldValue.serverTimestamp(), 
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        type: 'INCOME', 
                        orderId: orderId, 
                        supplierName: oData.userName
                    });
                    accId = accDoc.id; 
                    accName = accDoc.data().name;
                }

                for (const [, entry] of workingProducts) {
                    if (entry.totalDelta === 0) continue;
                    t.update(entry.ref, {
                        stock: entry.state.stock,
                        combinations: entry.state.combinations,
                        branchStock: entry.state.branchStock,
                        lastStockChangeReason: 'VENTA_PEDIDO',
                        lastStockChangeDetails: `Venta web MercadoPago pedido #${orderId.slice(0, 8)}`,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
                
                // Escribir Remision blindada
                if (!remSnap.exists) {
                    t.set(remRef, {
                        orderId, source: 'WEBHOOK_MP', items: oData.items,
                        clientName: oData.userName, clientPhone: oData.phone, clientDoc: oData.clientDoc,
                        clientAddress: `${oData.shippingData?.address}, ${oData.shippingData?.city}`,
                        total: oData.total, status: 'PENDIENTE_ALISTAMIENTO', type: 'VENTA_WEB',
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                t.update(orderRef, {
                    status: 'PAGADO', 
                    paymentStatus: 'PAID', 
                    paymentId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    isStockDeducted: Boolean(oData.isStockDeducted || totalActualDeducted > 0), 
                    paymentAccountId: accId, 
                    paymentMethodName: accName
                });
            });
            console.log("[MercadoPago] Order Approved:", orderId);
        } 
        
        // --- B. PAGO RECHAZADO / CANCELADO (Transaccional para evitar race con approved) ---
        else if (status === 'rejected' || status === 'cancelled') {
            await db.runTransaction(async (t) => {
                const docCheck = await t.get(orderRef);
                if (!docCheck.exists) return;
                const orderData = docCheck.data();
                if (orderData.paymentStatus === 'PAID' || orderData.status === 'PAGADO') return;
                const updateObj = {
                    status: 'RECHAZADO', 
                    paymentId, 
                    statusDetail: paymentData.status_detail,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };
                if (orderData.requiresInvoice) {
                    updateObj.billingStatus = 'CANCELLED';
                }
                t.update(orderRef, updateObj);
            });
            console.log("[MercadoPago] Order Rejected:", orderId);
        }
        
        res.status(200).send("OK");

    } catch (e) {
        console.error(" MP Webhook Error:", e);
        res.status(500).send("Err");
    }
};