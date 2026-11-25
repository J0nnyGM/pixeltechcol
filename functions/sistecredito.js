const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require('cors')({ origin: true });
const { initProductWorkingState, applyStockDeltaToState } = require("./inventory-helper");

// ==========================================
// CONFIGURACIÓN DINÁMICA SISTECRÉDITO
// ==========================================
const IS_SC_SANDBOX = false; 
const SC_BASE_URL = "https://api.credinet.co/pay";
const SC_ORIGEN = IS_SC_SANDBOX ? "Staging" : "Production";
const SC_WEBHOOK_URL = "https://sistecreditowebhook-muiondpggq-uc.a.run.app";

async function getSistecreditoConfig(db) {
    let apiKey = process.env.SC_API_KEY;
    let appKey = process.env.SC_APP_KEY;
    let appToken = process.env.SC_APP_TOKEN;

    try {
        if (!db) db = admin.firestore();
        const devDoc = await db.collection('config').doc('developer').get();
        if (devDoc.exists) {
            const data = devDoc.data();
            if (data.SC_API_KEY && data.SC_API_KEY.trim()) apiKey = data.SC_API_KEY.trim();
            if (data.SC_APP_KEY && data.SC_APP_KEY.trim()) appKey = data.SC_APP_KEY.trim();
            if (data.SC_APP_TOKEN && data.SC_APP_TOKEN.trim()) appToken = data.SC_APP_TOKEN.trim();
        }
    } catch (e) {
        console.error("Error al obtener credenciales de Sistecrédito de Firestore:", e.message);
    }

    return { apiKey, appKey, appToken };
}

// ==========================================
// 1. CREAR CHECKOUT SISTECRÉDITO
// ==========================================
exports.createSistecreditoCheckout = async (data, context) => {
    const db = admin.firestore();
    const auth = admin.auth();

    console.log(` Iniciando Checkout Sistecrédito (${SC_ORIGEN})...`);

    // 1. Validar Usuario
    const userToken = data.userToken || (data.data && data.data.userToken);
    let uid, email;
    try {
        if (userToken) {
            const decoded = await auth.verifyIdToken(userToken);
            uid = decoded.uid; email = decoded.email;
        } else if (context.auth) {
            uid = context.auth.uid; email = context.auth.token.email;
        } else {
            throw new Error("User auth failed");
        }
    } catch (e) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    }

    // 2. Procesar Datos de Entrada
    const rawItems = data.items || (data.data && data.data.items);
    const shippingCost = Number(data.shippingCost || (data.data && data.data.shippingCost) || 0);
    const extraData = data.extraData || (data.data && data.data.extraData) || {};
    const buyerInfo = data.buyerInfo || (data.data && data.data.buyerInfo) || {};

    if (!rawItems || !rawItems.length) throw new functions.https.HttpsError('invalid-argument', 'Cart empty');

    let dbItems = [];
    let subtotal = 0;
    const removeAccents = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

    let hasExcludedProduct = false;

    for (const item of rawItems) {
        const pDoc = await db.collection('products').doc(item.id).get();
        if (!pDoc.exists) continue;
        const pData = pDoc.data();
        const price = Number(pData.price) || 0;
        const qty = parseInt(item.quantity) || 1;
        
        if (pData.excludeFromFreeShipping === true) hasExcludedProduct = true;

        subtotal += price * qty;

        dbItems.push({
            id: item.id, name: pData.name, price: price, quantity: qty,
            color: item.color || "", capacity: item.capacity || "",
            mainImage: pData.mainImage || pData.image || "https://pixeltechcol.com/img/logo.webp"
        });
    }

    const shippingData = extraData.shippingData || { 
        address: buyerInfo.address, 
        city: buyerInfo.city,
        department: buyerInfo.department || ""
    };

    const incomingShippingType = data.shippingType || (data.extraData && data.extraData.shippingType) || 'ESTANDAR';
    const isFleteAlCobro = hasExcludedProduct || incomingShippingType === 'FLETE_AL_COBRO';

    let validatedShippingCost = isFleteAlCobro ? 0 : shippingCost;
    let finalShippingType = isFleteAlCobro ? 'FLETE_AL_COBRO' : (validatedShippingCost === 0 ? 'GRATIS' : 'ESTANDAR');
    shippingData.shippingType = finalShippingType;

    const totalAmount = subtotal + validatedShippingCost;
    
    const clientDoc = String(extraData.clientDoc || buyerInfo.document || "");
    const clientName = extraData.userName || buyerInfo.name || "Cliente";
    let clientPhone = String(extraData.phone || buyerInfo.phone || "");

    // 3. Guardar Orden en Firebase
    const newOrderRef = db.collection('orders').doc();
    const firebaseOrderId = newOrderRef.id;

    await newOrderRef.set({
        source: 'TIENDA_WEB', createdAt: admin.firestore.FieldValue.serverTimestamp(),
        userId: uid, userEmail: email, userName: clientName, phone: clientPhone, clientDoc: clientDoc,
        shippingData: shippingData, 
        shippingType: finalShippingType,
        billingData: extraData.billingData || null, 
        requiresInvoice: extraData.needsInvoice || false,
        items: dbItems, subtotal: subtotal, shippingCost: validatedShippingCost, total: totalAmount,
        status: 'PENDIENTE_PAGO', paymentMethod: 'SISTECREDITO', paymentStatus: 'PENDING', isStockDeducted: false, buyerInfo: buyerInfo
    });

    // 4. Preparar Payload SISTECRÉDITO
    const cleanDoc = String(clientDoc).replace(/\D/g, '');
    const fullNameParts = String(clientName).trim().split(" ");
    const firstName = fullNameParts[0];
    const lastName = fullNameParts.slice(1).join(" ") || "Apellido";

    let rawPhone = String(clientPhone).replace(/\D/g, '');
    let cellNumber = rawPhone.startsWith('57') ? rawPhone.substring(2) : rawPhone;
    if (!cellNumber) cellNumber = "3000000000"; 

    //  ESTA ES LA CORRECCIÓN CLAVE:
    let cleanCity = removeAccents(shippingData.city || "Bogota").trim();
    if (cleanCity.toLowerCase().includes("bogota")) {
        cleanCity = "Bogota"; // Forzamos a que sea solo "Bogota" sin D.C.
    }
    // Eliminamos cualquier otro caracter raro
    cleanCity = cleanCity.replace(/[^a-zA-Z0-9\s]/g, '').trim();

    const payload = {
        invoice: firebaseOrderId, 
        description: `Compra en PixelTech - Orden ${firebaseOrderId.slice(0,8)}`, 
        paymentMethod: {
            paymentMethodId: 2, 
            bankCode: 1, 
            userType: 0 
        },
        currency: "COP", 
        value: Math.round(totalAmount), 
        tax: 0, 
        taxBase: 0, 
        sandbox: { isActive: IS_SC_SANDBOX, status: "Approved" }, 
        urlResponse: `https://pixeltechcol.com/shop/success.html?order=${firebaseOrderId}`, 
        urlConfirmation: SC_WEBHOOK_URL, 
        methodConfirmation: "POST", 
        client: {
            docType: "CC", 
            document: cleanDoc || "11111111", 
            name: removeAccents(firstName).substring(0, 50), 
            lastName: removeAccents(lastName).substring(0, 50), 
            email: String(email).trim().toLowerCase(), 
            indCountry: "57", 
            phone: cellNumber, 
            country: "CO", 
            city: cleanCity.substring(0, 50), 
            address: removeAccents(String(shippingData.address || "Direccion")).substring(0, 100), 
            ipAddress: "192.168.1.1" 
        }
    };

    try {
        const scConfig = await getSistecreditoConfig(db);
        if (!scConfig.apiKey || !scConfig.appKey || !scConfig.appToken) {
            throw new Error("Credenciales de Sistecrédito no configuradas.");
        }

        console.log(" Enviando a Sistecrédito...", JSON.stringify(payload));
        const response = await axios.post(`${SC_BASE_URL}/create`, payload, { 
            headers: {
                'SCLocation': '0,0', 
                'SCOrigen': SC_ORIGEN, 
                'country': 'CO', 
                'Ocp-Apim-Subscription-Key': scConfig.apiKey, 
                'ApplicationKey': scConfig.appKey, 
                'ApplicationToken': scConfig.appToken, 
                'Content-Type': 'application/json'
            }
        });

        const redirectUrl = response.data?.data?.paymentMethodResponse?.paymentRedirectUrl; 
        if (!redirectUrl) throw new Error("Sistecrédito no devolvió URL de pago.");

        return { initPoint: redirectUrl };

    } catch (error) {
        console.error(" Error Sistecrédito:", error.response?.data || error.message);
        throw new functions.https.HttpsError('internal', "Error iniciando pago con Sistecrédito.");
    }
};

// ==========================================
// 2. WEBHOOK DE SISTECRÉDITO (BLINDADO Y SEGURO)
// ==========================================
exports.webhook = async (req, res) => {
    return cors(req, res, async () => {
        const db = admin.firestore();
        try {
            const body = req.body;
            console.log(" Webhook Sistecrédito:", JSON.stringify(body));

            const txData = body.data || body; 
            
            //  CORRECCIÓN CRÍTICA: Extraer soportando Mayúsculas y Minúsculas
            const orderId = txData.Invoice || txData.invoice; 
            const rawStatus = txData.TransactionStatus || txData.transactionStatus || ""; 
            const status = rawStatus.toUpperCase(); // Estandarizamos a MAYÚSCULAS
            const paymentId = txData._id || txData.id || 'SISTECREDITO';

            if (!orderId) {
                console.error(" Faltan datos: Invoice ID");
                return res.status(400).send("Missing Invoice ID");
            }

            const orderRef = db.collection('orders').doc(orderId);
            const remRef = db.collection('remissions').doc(orderId);

            // Evaluamos en mayúsculas, igual que en ADDI
            if (status === 'APPROVED') { 
                await db.runTransaction(async (t) => {
                    
                    // ==========================================
                    // FASE 1: SOLO LECTURAS (t.get)
                    // ==========================================
                    const docSnap = await t.get(orderRef);
                    if (!docSnap.exists) return;
                    const oData = docSnap.data();
                    
                    if (oData.paymentStatus === 'PAID' || oData.status === 'PAGADO' || oData.status === 'CANCELADO' || oData.status === 'RECHAZADO') {
                        console.log(`Webhook duplicado o estado cerrado ignorado. Orden ${orderId} (${oData.status}).`);
                        return;
                    }

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

                    const accQ = await t.get(db.collection('accounts').where('gatewayLink', '==', 'SISTECREDITO').limit(1));
                    let accDoc = (!accQ.empty) ? accQ.docs[0] : null;
                    if (!accDoc) {
                        const defQ = await t.get(db.collection('accounts').where('isDefaultOnline', '==', true).limit(1));
                        if (!defQ.empty) accDoc = defQ.docs[0];
                    }

                    // LEEMOS LA REMISION
                    const remSnap = await t.get(remRef); 

                    // ==========================================
                    // FASE 2: SOLO ESCRITURAS (t.set, t.update)
                    // ==========================================
                    let accId = null, accName = 'SISTECREDITO';
                    if (accDoc) {
                        accId = accDoc.id;
                        accName = accDoc.data().name;
                        t.update(accDoc.ref, { balance: (Number(accDoc.data().balance) || 0) + (Number(oData.total) || 0) });

                        const incRef = db.collection('expenses').doc();
                        t.set(incRef, {
                            amount: Number(oData.total),
                            category: "Ingreso Ventas Online",
                            description: `Venta Sistecredito #${orderId.slice(0, 8)}`,
                            paymentMethod: accName,
                            date: admin.firestore.FieldValue.serverTimestamp(),
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            type: 'INCOME', orderId: orderId, supplierName: oData.userName
                        });
                    }

                    for (const [, entry] of workingProducts) {
                        if (entry.totalDelta === 0) continue;
                        t.update(entry.ref, {
                            stock: entry.state.stock,
                            combinations: entry.state.combinations,
                            branchStock: entry.state.branchStock,
                            lastStockChangeReason: 'VENTA_PEDIDO',
                            lastStockChangeDetails: `Venta web Sistecredito pedido #${orderId.slice(0, 8)}`,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }

                    if (!remSnap.exists) {
                        t.set(remRef, {
                            orderId, source: 'WEBHOOK_SISTECREDITO', items: oData.items,
                            clientName: oData.userName, clientPhone: oData.phone, clientDoc: oData.clientDoc,
                            clientAddress: `${oData.shippingData?.address}, ${oData.shippingData?.city}`,
                            total: oData.total, status: 'PENDIENTE_ALISTAMIENTO', type: 'VENTA_WEB',
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }

                    t.update(orderRef, {
                        status: 'PAGADO', 
                        paymentStatus: 'PAID', 
                        paymentId: paymentId,
                        paymentAccountId: accId,
                        paymentMethodName: accName,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(), 
                        isStockDeducted: Boolean(oData.isStockDeducted || totalActualDeducted > 0)
                    });
                });
                console.log(`[Sistecredito] Orden ${orderId} procesada correctamente.`);

            // Evaluamos rechazos tambien en mayusculas (transaccional para evitar race con APPROVED)
            } else if (status === 'REJECTED' || status === 'CANCELLED' || status === 'FAILED') { 
                await db.runTransaction(async (t) => {
                    const docCheck = await t.get(orderRef);
                    if (!docCheck.exists) return;
                    const orderData = docCheck.data();
                    if (orderData.paymentStatus === 'PAID' || orderData.status === 'PAGADO') return;
                    const updateObj = { 
                        status: 'RECHAZADO', 
                        statusDetail: rawStatus,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    };
                    if (orderData.requiresInvoice) {
                        updateObj.billingStatus = 'CANCELLED';
                    }
                    t.update(orderRef, updateObj);
                });
                console.log(`[Sistecredito] Orden ${orderId} Rechazada/Cancelada.`);
            }
            res.status(200).send("OK");
        } catch (e) {
            console.error(" Webhook SC Error:", e);
            res.status(500).send("Error");
        }
    });
};