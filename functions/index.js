// Carga las variables de entorno del archivo .env localmente
require('dotenv').config();

const functions = require("firebase-functions");
// IMPORTANTE: Importamos el scheduler de la versión 2
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

admin.initializeApp();
const db = admin.firestore();

// --- 1. CONFIGURACIÓN SEGURA ---
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;

// Validación segura: Si no hay token, no iniciamos el cliente para evitar crash
if (!MP_TOKEN) {
    console.warn("⚠️ ADVERTENCIA: No se encontró MP_ACCESS_TOKEN. Las funciones de pago fallarán.");
}

const client = MP_TOKEN ? new MercadoPagoConfig({ accessToken: MP_TOKEN }) : null;

// ⚠️ URL DE TU FUNCIÓN
const WEBHOOK_URL = "https://mercadopagowebhook-muiondpggq-uc.a.run.app";


/**
 * FUNCIÓN 1: CREAR PREFERENCIA
 */
exports.createMercadoPagoPreference = functions.https.onCall(async (data, context) => {
    console.log("🚀 Iniciando Checkout Online...");

    // Validación de Token de Pago (Evita crash si no está configurado)
    if (!client) {
        throw new functions.https.HttpsError('internal', 'El servidor no tiene configurada la pasarela de pagos.');
    }

    const userToken = data.userToken || (data.data && data.data.userToken);
    let uid, email;

    try {
        if (userToken) {
            const decodedToken = await admin.auth().verifyIdToken(userToken);
            uid = decodedToken.uid;
            email = decodedToken.email;
        } else if (context.auth) {
            uid = context.auth.uid;
            email = context.auth.token.email;
        } else {
            throw new Error("No se detectó token de sesión.");
        }
    } catch (error) {
        console.error("❌ Error de Auth:", error.message);
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión para comprar.');
    }

    const rawItems = data.items || (data.data && data.data.items);
    const shippingCost = Number(data.shippingCost || (data.data && data.data.shippingCost) || 0);
    const buyerInfo = data.buyerInfo || (data.data && data.data.buyerInfo);
    const extraData = data.extraData || (data.data && data.data.extraData) || {};

    if (!rawItems || !rawItems.length) {
        throw new functions.https.HttpsError('invalid-argument', 'El carrito está vacío.');
    }

    try {
        let mpItems = []; 
        let dbItems = []; 
        let subtotal = 0;
        
        for (const item of rawItems) {
            const productDoc = await db.collection('products').doc(item.id).get();
            if (!productDoc.exists) continue;

            const productData = productDoc.data();
            const realPrice = Number(productData.price) || 0; 
            const quantity = parseInt(item.quantity) || 1;
            
            subtotal += realPrice * quantity;

            dbItems.push({
                id: item.id,
                name: productData.name, 
                price: realPrice,       
                quantity: quantity,
                color: item.color || "",       
                capacity: item.capacity || "", 
                mainImage: productData.mainImage || productData.image || "",
            });

            mpItems.push({
                id: item.id,
                title: productData.name,
                description: `${productData.name} ${item.color || ''} ${item.capacity || ''}`,
                quantity: quantity,
                unit_price: realPrice,
                currency_id: 'COP',
                picture_url: productData.mainImage || ''
            });
        }

        const totalAmount = subtotal + shippingCost;

        if (shippingCost > 0) {
            mpItems.push({
                id: 'shipping',
                title: 'Costo de Envío',
                quantity: 1,
                unit_price: shippingCost,
                currency_id: 'COP'
            });
        }

        const newOrderRef = db.collection('orders').doc();
        const orderId = newOrderRef.id;

        await newOrderRef.set({
            source: extraData.source || 'TIENDA_WEB',
            userId: uid,
            userEmail: email,
            userName: extraData.userName || buyerInfo.name,
            clientDoc: extraData.clientDoc || "",
            shippingData: extraData.shippingData || { address: buyerInfo.address },
            billingData: extraData.billingData || null,
            needsInvoice: extraData.needsInvoice || false,
            items: dbItems,
            subtotal: subtotal,
            shippingCost: shippingCost,
            total: totalAmount,
            status: 'PENDIENTE_PAGO',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            paymentMethod: 'MERCADOPAGO',
            isStockDeducted: false
        });
        
        console.log(`💾 Orden creada: ${orderId}`);

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
                    success: "https://pixeltechcol.web.app/shop/success.html", 
                    failure: "https://pixeltechcol.web.app/shop/success.html", 
                    pending: "https://pixeltechcol.web.app/shop/success.html"
                },
                auto_return: "approved",
                statement_descriptor: "PIXELTECH",
                external_reference: orderId, 
                notification_url: WEBHOOK_URL 
            }
        });

        return { preferenceId: result.id, initPoint: result.init_point };

    } catch (error) {
        console.error("❌ Error Backend:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});


/**
 * FUNCIÓN 2: WEBHOOK
 * Maneja Aprobaciones (descuenta stock + INGRESA DINERO A TESORERÍA) y Rechazos.
 */
exports.mercadoPagoWebhook = functions.https.onRequest(async (req, res) => {
    try {
        if (!client) return res.status(500).send("Servidor no configurado");

        const topic = req.query.topic || req.body?.topic;
        if (topic === 'merchant_order') return res.status(200).send("OK");

        let paymentId = req.query.id || req.query['data.id'] || req.body?.data?.id || req.body?.id;
        if (!paymentId) return res.status(200).send("OK (Sin ID)");

        const payment = new Payment(client);
        let paymentData;
        
        try {
            paymentData = await payment.get({ id: paymentId });
        } catch (mpError) {
            console.warn(`⚠️ Error MP: ${mpError.message}`);
            return res.status(200).send("OK");
        }
        
        const status = paymentData.status; 
        const orderId = paymentData.external_reference;

        console.log(`🔎 Pago: ${paymentId} | Estado: ${status} | Orden: ${orderId}`);

        if (!orderId) return res.status(200).send("OK");

        const orderRef = db.collection('orders').doc(orderId);

        // --- CASO A: PAGO APROBADO ---
        if (status === 'approved') {
            await db.runTransaction(async (t) => {
                const orderDoc = await t.get(orderRef);
                if (!orderDoc.exists) return;

                const orderData = orderDoc.data();
                if (orderData.status === 'PAGADO') return; 

                // 1. INVENTARIO (Leer Stocks)
                const productReads = [];
                if (!orderData.isStockDeducted) {
                    for (const item of orderData.items) {
                        const pRef = db.collection('products').doc(item.id);
                        const pDoc = await t.get(pRef);
                        if (pDoc.exists) {
                            productReads.push({
                                ref: pRef,
                                currentStock: Number(pDoc.data().stock) || 0,
                                quantityToDeduct: Number(item.quantity) || 1
                            });
                        }
                    }
                }

                // 2. TESORERÍA (NUEVO: Buscar cuenta online y sumar saldo)
                // Buscamos la cuenta marcada como 'isDefaultOnline'
                const accountQuery = await t.get(db.collection('accounts').where('isDefaultOnline', '==', true).limit(1));
                let paymentAccountId = null;
                let paymentMethodName = 'MercadoPago';

                if (!accountQuery.empty) {
                    const accDoc = accountQuery.docs[0];
                    const accRef = accDoc.ref;
                    const currentBalance = Number(accDoc.data().balance) || 0;
                    const incomeAmount = Number(orderData.total) || 0;

                    // A. Actualizar Saldo de la Cuenta
                    t.update(accRef, { 
                        balance: currentBalance + incomeAmount 
                    });

                    // B. Crear Registro en Historial (Expenses/Ingresos)
                    const incomeRef = db.collection('expenses').doc();
                    t.set(incomeRef, {
                        amount: incomeAmount,
                        category: "Ingreso Ventas", // Categoría estándar para pintar verde
                        description: `Venta Web #${orderId.slice(0, 8)}`,
                        paymentMethod: accDoc.data().name,
                        date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        supplierName: orderData.userName || "Cliente Web",
                        orderId: orderId // Vinculamos para referencia
                    });

                    paymentAccountId = accDoc.id;
                    paymentMethodName = accDoc.data().name;
                    console.log(`💰 Ingreso registrado en: ${paymentMethodName}`);
                } else {
                    console.warn("⚠️ No hay cuenta de tesorería vinculada a Web. El saldo no se sumó.");
                }

                // 3. ACTUALIZACIONES (Writes)
                
                // Actualizar Stocks
                for (const p of productReads) {
                    let newStock = p.currentStock - p.quantityToDeduct;
                    t.update(p.ref, { stock: newStock < 0 ? 0 : newStock });
                }

                // Crear Remisión Logística
                const remRef = db.collection('remissions').doc();
                t.set(remRef, {
                    orderId: orderId,
                    source: 'WEBHOOK_MP',
                    items: orderData.items, 
                    buyerInfo: orderData.buyerInfo || {},
                    shippingData: orderData.shippingData || {},
                    clientDoc: orderData.clientDoc || "",
                    status: 'PENDIENTE_ALISTAMIENTO',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    type: 'VENTA_WEB'
                });

                // Actualizar Orden a PAGADO con datos de tesorería
                t.update(orderRef, {
                    status: 'PAGADO',
                    paymentId: paymentId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    isStockDeducted: true,
                    paymentStatus: 'PAID', // Estandarizar con venta manual
                    paymentAccountId: paymentAccountId, // Guardamos dónde entró la plata
                    paymentMethodName: paymentMethodName
                });
            });
            console.log("✅ ORDEN PAGADA Y CONTABILIZADA");
        } 
        
        // --- CASO B: PAGO RECHAZADO ---
        else if (status === 'rejected' || status === 'cancelled') {
            await orderRef.update({
                status: 'RECHAZADO',
                paymentId: paymentId,
                statusDetail: paymentData.status_detail || 'rejected_by_bank',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log("❌ ORDEN RECHAZADA");
        }

        res.status(200).send("OK");

    } catch (error) {
        console.error("❌ Error Webhook:", error);
        res.status(500).send("Error"); 
    }
});

/**
 * FUNCIÓN 3: LIMPIEZA AUTOMÁTICA (SINTAXIS GEN 2)
 * Se ejecuta automáticamente cada 24 horas.
 */
exports.cleanupOldOrders = onSchedule("every 24 hours", async (event) => {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    console.log("🧹 Iniciando limpieza de órdenes antiguas anteriores a:", sevenDaysAgo);

    try {
        const snapshot = await db.collection('orders')
            .where('createdAt', '<', sevenDaysAgo)
            .where('status', 'in', ['PENDIENTE_PAGO', 'RECHAZADO', 'CANCELADO'])
            .get();

        if (snapshot.empty) {
            console.log('✅ No hay órdenes antiguas para borrar.');
            return;
        }

        const batch = db.batch();
        let count = 0;

        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
            count++;
        });

        await batch.commit();
        console.log(`🗑️ Se eliminaron ${count} órdenes basura de forma segura.`);
        return;

    } catch (error) {
        console.error("❌ Error en limpieza automática:", error);
        return;
    }
});