const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.runFixOrderSequence = functions.https.onRequest(async (req, res) => {
    const db = admin.firestore();
    const execute = req.query.execute === 'true';
    const startFrom = parseInt(req.query.startFrom || '3487', 10);

    try {
        // 1. Obtener el estado actual del contador maestro
        const counterRef = db.collection('config').doc('order_counter_master');
        const counterSnap = await counterRef.get();
        const currentMasterNumber = counterSnap.exists ? (counterSnap.data().lastOrderNumber || 0) : 0;

        // 2. Consultar pedidos con internalOrderNumber >= (startFrom - 2) para tener contexto
        const ordersQuery = await db.collection('orders')
            .where('internalOrderNumber', '>=', startFrom - 2)
            .orderBy('internalOrderNumber', 'asc')
            .get();

        const allOrders = ordersQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                internalOrderNumber: data.internalOrderNumber || null,
                userName: data.userName || (data.buyerInfo && data.buyerInfo.name) || 'S/N',
                status: data.status || 'S/N',
                source: data.source || 'S/N',
                total: data.total || 0,
                createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null
            };
        });

        // 3. Separar los pedidos de anclaje (<= startFrom) y los pedidos a renumerar (> startFrom)
        const anchorOrders = allOrders.filter(o => o.internalOrderNumber <= startFrom);
        const candidateOrders = allOrders.filter(o => o.internalOrderNumber > startFrom);

        // Ordenamos los candidatos estrictamente por internalOrderNumber actual y luego por createdAt
        candidateOrders.sort((a, b) => {
            if (a.internalOrderNumber !== b.internalOrderNumber) {
                return a.internalOrderNumber - b.internalOrderNumber;
            }
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateA - dateB;
        });

        // 4. Calcular el nuevo consecutivo para cada pedido candidato
        let nextSeq = startFrom + 1;
        const renumberPlan = [];

        for (const ord of candidateOrders) {
            renumberPlan.push({
                orderId: ord.id,
                currentNumber: ord.internalOrderNumber,
                newNumber: nextSeq,
                userName: ord.userName,
                status: ord.status,
                source: ord.source,
                createdAt: ord.createdAt
            });
            nextSeq++;
        }

        const newMasterNumber = nextSeq - 1;

        // Si es solo simulacion (dry-run)
        if (!execute) {
            return res.status(200).json({
                mode: 'DRY_RUN (Simulacion - Ningun cambio aplicado)',
                instruction: 'Para aplicar los cambios definitivamente, anade ?execute=true a la URL',
                masterCounter: {
                    current: currentMasterNumber,
                    projectedNew: newMasterNumber
                },
                anchorOrders,
                candidateOrdersCount: candidateOrders.length,
                renumberPlan
            });
        }

        // 5. MODO EJECUCION: Aplicar cambios en batch
        let batch = db.batch();
        let writeCount = 0;
        const executedChanges = [];

        for (const item of renumberPlan) {
            // A. Actualizar orden
            const ordRef = db.collection('orders').doc(item.orderId);
            batch.update(ordRef, {
                internalOrderNumber: item.newNumber,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            writeCount++;

            // B. Actualizar remision si existe
            const remRef = db.collection('remissions').doc(item.orderId);
            const remSnap = await remRef.get();
            if (remSnap.exists) {
                batch.update(remRef, {
                    internalOrderNumber: item.newNumber,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                writeCount++;
            }

            // C. Actualizar seriales de productos asignados a esta orden si existen
            const serialsQuery = await db.collection('product_serials')
                .where('orderId', '==', item.orderId)
                .get();

            for (const sDoc of serialsQuery.docs) {
                batch.update(sDoc.ref, {
                    orderInternalNumber: item.newNumber,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                writeCount++;
            }

            executedChanges.push({
                orderId: item.orderId,
                userName: item.userName,
                oldNumber: item.currentNumber,
                newNumber: item.newNumber
            });

            if (writeCount >= 400) {
                await batch.commit();
                batch = db.batch();
                writeCount = 0;
            }
        }

        // D. Actualizar contador maestro al nuevo maximo
        batch.set(counterRef, {
            lastOrderNumber: newMasterNumber,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        writeCount++;

        if (writeCount > 0) {
            await batch.commit();
        }

        return res.status(200).json({
            success: true,
            mode: 'EXECUTION (Cambios aplicados exitosamente)',
            masterCounterUpdated: {
                previous: currentMasterNumber,
                now: newMasterNumber
            },
            totalOrdersRenumbered: executedChanges.length,
            executedChanges
        });

    } catch (error) {
        console.error("Error en runFixOrderSequence:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
