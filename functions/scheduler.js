const admin = require("firebase-admin");
const db = admin.firestore();

const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");

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

    console.log("⚙️ Iniciando procesador de transferencias automáticas...");

    try {
        // 1. Buscar transferencias pendientes cuya fecha ya llegó
        const snapshot = await db.collection('scheduled_transfers')
            .where('status', '==', 'PENDING')
            .where('scheduledDate', '<=', now)
            .get();

        if (snapshot.empty) {
            console.log("✅ No hay transferencias pendientes para hoy.");
            return;
        }

        console.log(`🔄 Procesando ${snapshot.size} transferencias...`);

        const batch = db.batch();
        let operationsCount = 0;

        // Como vamos a leer y escribir saldos de cuentas, necesitamos transacciones
        // Pero Firestore tiene límite de escrituras en batch. 
        // Para simplificar y evitar bloqueos masivos, procesamos una por una con runTransaction.
        // (Nota: Si tienes miles de ventas diarias, esto se debe optimizar).

        const promises = snapshot.docs.map(async (docSnap) => {
            const transfer = docSnap.data();
            const transferId = docSnap.id;

            try {
                await db.runTransaction(async (t) => {
                    // Leer cuentas
                    const sourceRef = db.collection('accounts').doc(transfer.sourceAccountId);
                    const targetRef = db.collection('accounts').doc(transfer.targetAccountId);
                    
                    const sourceDoc = await t.get(sourceRef);
                    const targetDoc = await t.get(targetRef);

                    if (!sourceDoc.exists || !targetDoc.exists) {
                        throw new Error("Alguna de las cuentas no existe");
                    }

                    // Mover dinero
                    const amount = Number(transfer.amount);
                    const newSourceBalance = (Number(sourceDoc.data().balance) || 0) - amount;
                    const newTargetBalance = (Number(targetDoc.data().balance) || 0) + amount;

                    // Actualizar Cuentas
                    t.update(sourceRef, { balance: newSourceBalance });
                    t.update(targetRef, { balance: newTargetBalance });

                    // Marcar transferencia como COMPLETADA
                    t.update(db.collection('scheduled_transfers').doc(transferId), {
                        status: 'COMPLETED',
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Crear registros en Historial (Expenses) para que se vea en Treasury
                    const outRef = db.collection('expenses').doc();
                    t.set(outRef, {
                        description: transfer.description || "Transferencia Automática",
                        amount: amount,
                        category: "Transferencia Saliente (Auto)",
                        paymentMethod: sourceDoc.data().name, // Sale de ADDI
                        date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    const inRef = db.collection('expenses').doc();
                    t.set(inRef, {
                        description: transfer.description || "Transferencia Automática",
                        amount: amount,
                        category: "Transferencia Entrante (Auto)",
                        paymentMethod: targetDoc.data().name, // Entra a Bancolombia
                        date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                });
                return { success: true, id: transferId };

            } catch (err) {
                console.error(`❌ Error procesando transferencia ${transferId}:`, err);
                // Marcar como fallida para no reintentar infinitamente sin corrección
                await db.collection('scheduled_transfers').doc(transferId).update({
                    status: 'FAILED',
                    error: err.message
                });
                return { success: false, id: transferId };
            }
        });

        await Promise.all(promises);
        console.log("🏁 Procesamiento de transferencias finalizado.");

    } catch (error) {
        console.error("❌ Error General Scheduler:", error);
    }
});

exports.cleanupOldOrders = async (event) => {
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
};

/**
 * CANCELAR ÓRDENES ABANDONADAS (CADA 30 MINUTOS)
 * Busca órdenes 'PENDIENTE_PAGO' creadas hace más de 4 horas y las cancela.
 */
exports.cancelAbandonedPayments = onSchedule({
    schedule: "every 30 minutes", // Optimizado para ahorrar costos en Cloud
    timeZone: "America/Bogota"
}, async (event) => {
    const db = admin.firestore();
    
    // Calculamos el tiempo límite: Ahora menos 4 horas
    const timeout = new Date();
    timeout.setHours(timeout.getHours() - 4); // <-- CAMBIO CLAVE (4 Horas)
    const timeoutTimestamp = admin.firestore.Timestamp.fromDate(timeout);

    console.log("⏰ Buscando órdenes abandonadas anteriores a:", timeout.toISOString());

    try {
        // Buscamos órdenes PENDIENTE_PAGO de MercadoPago, ADDI o SC viejas
        const snapshot = await db.collection('orders')
            .where('status', '==', 'PENDIENTE_PAGO')
            .where('createdAt', '<=', timeoutTimestamp)
            .get();

        if (snapshot.empty) {
            console.log("✅ No hay órdenes abandonadas (mayores a 4 horas) para cancelar.");
            return;
        }

        console.log(`⚠️ Encontradas ${snapshot.size} órdenes abandonadas (más de 4 horas).`);

        const batch = db.batch();
        let count = 0;

        snapshot.docs.forEach((doc) => {
            const orderData = doc.data();
            
            // Solo cancelamos si NO es contraentrega y aseguramos que no se haya pagado
            if (orderData.paymentStatus !== 'PAID') {
                batch.update(doc.ref, {
                    status: 'CANCELADO',
                    statusDetail: 'expired_by_system',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    notes: (orderData.notes || "") + " [Sistema: Cancelado por inactividad de pago mayor a 4h]"
                });
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
            console.log(`🗑️ Se cancelaron automáticamente ${count} órdenes.`);
        }

    } catch (error) {
        console.error("❌ Error en cancelAbandonedPayments:", error);
    }
});

/**
 * NUEVO: VERIFICAR Y DESACTIVAR PROMOCIONES VENCIDAS
 * Se ejecuta cada hora para asegurar que los precios vuelvan a la normalidad.
 */
exports.checkExpiredPromotions = onSchedule({
    schedule: "every 60 minutes", // Revisar cada hora
    timeZone: "America/Bogota"
}, async (event) => {
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    console.log("⏳ Verificando promociones vencidas...");

    try {
        // 1. Buscar productos que tengan fecha de fin MENOR o IGUAL a ahora
        // y que realmente tengan un precio original guardado (indicador de oferta activa)
        const snapshot = await db.collection('products')
            .where('promoEndsAt', '<=', now)
            .get();

        if (snapshot.empty) {
            console.log("✅ No hay promociones vencidas por desactivar.");
            return;
        }

        const batch = db.batch();
        let count = 0;

        snapshot.docs.forEach((doc) => {
            const p = doc.data();

            // Validación de seguridad: Solo restaurar si existe un precio original válido
            if (p.originalPrice && p.originalPrice > 0) {
                batch.update(doc.ref, {
                    price: p.originalPrice, // Restaurar el precio anterior
                    originalPrice: 0,       // Limpiar el campo de precio original
                    promoEndsAt: null       // Eliminar la fecha de vencimiento
                });
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
            console.log(`🏷️ Se desactivaron ${count} ofertas vencidas y se restauraron sus precios.`);
        }

    } catch (error) {
        console.error("❌ Error verificando promociones:", error);
    }
});