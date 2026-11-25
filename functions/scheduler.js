const admin = require("firebase-admin");
const db = admin.firestore();

const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initProductWorkingState, applyStockDeltaToState } = require("./inventory-helper");

/**
 * TAREA PROGRAMADA: EJECUTAR TRANSFERENCIAS AUTOMÁTICAS
 * Se ejecuta todos los días a las 00:05 AM (Hora Colombia)
 */
exports.processScheduledTransfers = onSchedule({
    schedule: "5 0 * * *", 
    timeZone: "America/Bogota"
}, async (event) => {
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    console.log(" Iniciando procesador de transferencias automáticas...");

    try {
        const snapshot = await db.collection('scheduled_transfers')
            .where('status', '==', 'PENDING')
            .where('scheduledDate', '<=', now)
            .get();

        if (snapshot.empty) {
            console.log(" No hay transferencias pendientes para hoy.");
            return;
        }

        console.log(` Procesando ${snapshot.size} transferencias...`);

        const promises = snapshot.docs.map(async (docSnap) => {
            const transfer = docSnap.data();
            const transferId = docSnap.id;

            try {
                await db.runTransaction(async (t) => {
                    const sourceRef = db.collection('accounts').doc(transfer.sourceAccountId);
                    const targetRef = db.collection('accounts').doc(transfer.targetAccountId);
                    
                    const sourceDoc = await t.get(sourceRef);
                    const targetDoc = await t.get(targetRef);

                    if (!sourceDoc.exists || !targetDoc.exists) {
                        throw new Error("Alguna de las cuentas no existe");
                    }

                    const amount = Number(transfer.amount);
                    const newSourceBalance = (Number(sourceDoc.data().balance) || 0) - amount;
                    const newTargetBalance = (Number(targetDoc.data().balance) || 0) + amount;

                    t.update(sourceRef, { balance: newSourceBalance });
                    t.update(targetRef, { balance: newTargetBalance });

                    t.update(db.collection('scheduled_transfers').doc(transferId), {
                        status: 'COMPLETED',
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    const outRef = db.collection('expenses').doc();
                    t.set(outRef, {
                        description: transfer.description || "Transferencia Automática",
                        amount: amount,
                        category: "Transferencia Saliente (Auto)",
                        paymentMethod: sourceDoc.data().name, 
                        date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    const inRef = db.collection('expenses').doc();
                    t.set(inRef, {
                        description: transfer.description || "Transferencia Automática",
                        amount: amount,
                        category: "Transferencia Entrante (Auto)",
                        paymentMethod: targetDoc.data().name, 
                        date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                });
                return { success: true, id: transferId };

            } catch (err) {
                console.error(` Error procesando transferencia ${transferId}:`, err);
                await db.collection('scheduled_transfers').doc(transferId).update({
                    status: 'FAILED',
                    error: err.message
                });
                return { success: false, id: transferId };
            }
        });

        await Promise.all(promises);
        console.log(" Procesamiento de transferencias finalizado.");

    } catch (error) {
        console.error(" Error General Scheduler:", error);
    }
});

/**
 * LIMPIEZA DE ÓRDENES ANTIGUAS
 * Función desactivada a petición del usuario. Los pedidos cancelados ya NO se borran.
 */
exports.cleanupOldOrders = async (event) => {
    console.log(" Limpieza de órdenes desactivada. Los pedidos cancelados se mantendrán en el historial.");
    return;
};

/**
 * CANCELAR ÓRDENES ABANDONADAS (CADA 30 MINUTOS)
 * - Pasarelas online (PENDIENTE_PAGO): Cancela a las 4 horas.
 * - Transferencia Manual (PENDIENTE): Cancela a las 36 horas.
 */
exports.cancelAbandonedPayments = onSchedule({
    schedule: "every 30 minutes", 
    timeZone: "America/Bogota"
}, async (event) => {
    const db = admin.firestore();
    
    // Tiempo límite para pasarelas online (4 horas)
    const timeout4Hours = new Date();
    timeout4Hours.setHours(timeout4Hours.getHours() - 4);
    const timeoutTimestamp4h = admin.firestore.Timestamp.fromDate(timeout4Hours);

    // Tiempo límite para Transferencia Manual (36 horas)
    const timeout36Hours = new Date();
    timeout36Hours.setHours(timeout36Hours.getHours() - 36);
    const timeoutTimestamp36h = admin.firestore.Timestamp.fromDate(timeout36Hours);

    console.log("[Scheduler] Revisando ordenes abandonadas en 2 fases...");

    try {
        let countCanceledOnline = 0;
        let countCanceledManual = 0;

        // --- FASE 1: Ordenes Online (4 Horas) en transaccion individual para evitar pisar pagos recien aprobados ---
        const onlineSnapshot = await db.collection('orders')
            .where('status', '==', 'PENDIENTE_PAGO')
            .where('createdAt', '<=', timeoutTimestamp4h)
            .get();

        for (const docSnap of onlineSnapshot.docs) {
            try {
                let didCancel = false;
                await db.runTransaction(async (t) => {
                    const freshSnap = await t.get(docSnap.ref);
                    if (!freshSnap.exists) return;
                    const freshData = freshSnap.data();
                    if (freshData.status !== 'PENDIENTE_PAGO' || freshData.paymentStatus === 'PAID' || freshData.isStockDeducted === true) {
                        return;
                    }

                    const updateObj = {
                        status: 'CANCELADO',
                        statusDetail: 'expired_by_system',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        notes: (freshData.notes || "") + " [Sistema: Cancelado por inactividad de pago online mayor a 4h]"
                    };
                    if (freshData.requiresInvoice) {
                        updateObj.billingStatus = 'CANCELLED';
                    }
                    t.update(docSnap.ref, updateObj);
                    didCancel = true;
                });
                if (didCancel) countCanceledOnline++;
            } catch (err) {
                console.error(`[Scheduler] Error cancelando orden online ${docSnap.id}:`, err);
            }
        }

        // --- FASE 2: Ordenes Manuales (36 Horas) ---
        const manualSnapshot = await db.collection('orders')
            .where('status', '==', 'PENDIENTE')
            .where('createdAt', '<=', timeoutTimestamp36h)
            .get();

        const manualDocsToProcess = [];
        manualSnapshot.docs.forEach((doc) => {
            const orderData = doc.data();
            if (orderData.paymentStatus === 'PAID') return;
            if (orderData.paymentMethod === 'COD' || orderData.paymentMethod === 'CONTRAENTREGA') return;
            if (orderData.paymentMethod === 'MANUAL' && orderData.source === 'TIENDA_WEB') {
                manualDocsToProcess.push({ ref: doc.ref, data: orderData });
            }
        });

        for (const docObj of manualDocsToProcess) {
            const orderRef = docObj.ref;
            const orderId = orderRef.id;
            const remissionRef = db.collection('remissions').doc(orderId);

            try {
                let didCancelManual = false;
                await db.runTransaction(async (t) => {
                    // FASE A: TODAS LAS LECTURAS ANTES DE CUALQUIER ESCRITURA
                    const freshOrderSnap = await t.get(orderRef);
                    if (!freshOrderSnap.exists) return;
                    const freshOrderData = freshOrderSnap.data();

                    // Revalidar estado y pago DENTRO de la transaccion
                    if (freshOrderData.status !== 'PENDIENTE' || freshOrderData.paymentStatus === 'PAID') return;

                    const remSnap = await t.get(remissionRef);

                    const workingProducts = new Map();
                    if (freshOrderData.isStockDeducted === true && Array.isArray(freshOrderData.items)) {
                        for (const item of freshOrderData.items) {
                            if (!item.id) continue;
                            if (!workingProducts.has(item.id)) {
                                const pRef = db.collection('products').doc(item.id);
                                const pDoc = await t.get(pRef);
                                if (pDoc.exists) {
                                    workingProducts.set(item.id, {
                                        ref: pRef,
                                        state: initProductWorkingState(pDoc.data()),
                                        totalDelta: 0
                                    });
                                }
                            }
                        }

                        for (const item of freshOrderData.items) {
                            const entry = workingProducts.get(item.id);
                            if (!entry) continue;
                            const qty = Math.max(0, (Number(item.quantity) || 0) - (Number(item.returnedQty) || 0));
                            if (qty <= 0) continue;

                            const resDelta = applyStockDeltaToState(entry.state, {
                                delta: qty,
                                branch: 'bodega',
                                color: item.color || '',
                                capacity: item.capacity || '',
                                fallbackBestVariant: true
                            });
                            entry.totalDelta += resDelta.appliedDelta;
                        }
                    }

                    // FASE B: TODAS LAS ESCRITURAS (exactamente UN update por producto unico)
                    for (const [, entry] of workingProducts) {
                        if (entry.totalDelta === 0) continue;
                        t.update(entry.ref, {
                            stock: entry.state.stock,
                            combinations: entry.state.combinations,
                            branchStock: entry.state.branchStock,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            lastStockChangeReason: 'DEVOLUCION_CANCELACION',
                            lastStockChangeDetails: `Devolucion por cancelacion automatica del pedido #${orderId.slice(0, 8)}`
                        });
                    }

                    if (remSnap.exists && remSnap.data().status !== 'ANULADA') {
                        t.update(remissionRef, {
                            status: 'ANULADA',
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }

                    const updateObj = {
                        status: 'CANCELADO',
                        isStockDeducted: false,
                        statusDetail: 'expired_by_system',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        notes: (freshOrderData.notes || "") + " [Sistema: Cancelado y stock devuelto por inactividad de pago manual mayor a 36h]"
                    };
                    if (freshOrderData.requiresInvoice) {
                        updateObj.billingStatus = 'CANCELLED';
                    }

                    t.update(orderRef, updateObj);
                    didCancelManual = true;
                });
                if (didCancelManual) countCanceledManual++;
            } catch (err) {
                console.error(`[Scheduler] Error al expirar y devolver stock de la orden manual ${orderId}:`, err);
            }
        }

        const totalCanceled = countCanceledOnline + countCanceledManual;
        if (totalCanceled > 0) {
            console.log(`[Scheduler] Revisiones completadas. Total ordenes canceladas por inactividad: ${totalCanceled} (Online: ${countCanceledOnline}, Manual: ${countCanceledManual}).`);
        } else {
            console.log(`[Scheduler] Revisiones completadas. No hubo ordenes vencidas para cancelar en este ciclo.`);
        }

    } catch (error) {
        console.error("[Scheduler] Error en cancelAbandonedPayments:", error);
    }
});

/**
 * VERIFICAR Y DESACTIVAR PROMOCIONES VENCIDAS
 * Se ejecuta cada hora para asegurar que los precios vuelvan a la normalidad.
 */
exports.checkExpiredPromotions = onSchedule({
    schedule: "every 60 minutes", 
    timeZone: "America/Bogota"
}, async (event) => {
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    console.log("⏳ Verificando promociones vencidas...");

    try {
        const snapshot = await db.collection('products')
            .where('promoEndsAt', '<=', now)
            .get();

        if (snapshot.empty) {
            console.log(" No hay promociones vencidas por desactivar.");
            return;
        }

        const batch = db.batch();
        let count = 0;

        snapshot.docs.forEach((doc) => {
            const p = doc.data();

            if (p.originalPrice && p.originalPrice > 0) {
                batch.update(doc.ref, {
                    price: p.originalPrice, 
                    originalPrice: 0,       
                    promoEndsAt: null       
                });
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
            console.log(` Se desactivaron ${count} ofertas vencidas y se restauraron sus precios.`);
        }

    } catch (error) {
        console.error(" Error verificando promociones:", error);
    }
});