const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { syncAndValidateMLOrder } = require("./mercadolibre");

exports.runFixFlexOrders = functions.https.onRequest(async (req, res) => {
    const db = admin.firestore();
    const execute = req.query.execute === 'true';
    const specificOrderId = req.query.orderId || null;

    try {
        let ordersToProcess = [];

        if (specificOrderId) {
            let docSnap = await db.collection('orders').doc(specificOrderId).get();
            if (!docSnap.exists) {
                const num = Number(specificOrderId);
                const qNum = isNaN(num) ? specificOrderId : num;
                const snap = await db.collection('orders').where('internalOrderNumber', '==', qNum).limit(1).get();
                if (!snap.empty) docSnap = snap.docs[0];
            }
            if (!docSnap || !docSnap.exists) {
                return res.status(404).json({ error: `Orden ${specificOrderId} no encontrada` });
            }
            ordersToProcess.push({ id: docSnap.id, ...docSnap.data() });
        } else {
            // Consultar órdenes de MercadoLibre
            const mlSources = ['MERCADOLIBRE', 'MERCADOLIBRE_STORE2', 'MERCADOLIBRE_2', 'MERCADOLIBRE_STORE3', 'MERCADOLIBRE_3'];
            const ordersSnap = await db.collection('orders')
                .where('source', 'in', mlSources)
                .get();

            ordersSnap.docs.forEach(docSnap => {
                const data = docSnap.data();
                ordersToProcess.push({ id: docSnap.id, ...data });
            });
        }

        // Filtrar las órdenes que son FLEX y tienen el error de mlShipping > 0
        const flexOrdersWithShippingError = [];

        for (const ord of ordersToProcess) {
            const isFlex = Boolean(
                ord.logisticType === 'self_service' ||
                ord.shippingType === 'FLEX' ||
                (Number(ord.mlShippingBonus) > 0) ||
                ord.shippingCarrier === 'DESPACHOBOGOTA' ||
                ord.shippingData?.carrier === 'DESPACHOBOGOTA' ||
                ord.trackingNumber === 'urban' ||
                ord.shippingMethod === 'self_service'
            );

            const mlShipping = Number(ord.mlShipping) || 0;

            if (isFlex && mlShipping > 0) {
                const gross = Number(ord.grossTotal) || Number(ord.total) || 0;
                const fee = Number(ord.mlFee) || 0;
                const taxes = Number(ord.mlTaxes) || 0;
                const bonus = Number(ord.mlShippingBonus) || 0;
                const oldNet = Number(ord.netAmount) || Number(ord.total) || 0;
                const correctedNet = Math.max(0, Math.round(gross - fee + bonus - taxes));
                const recoveredAmount = correctedNet - oldNet;

                flexOrdersWithShippingError.push({
                    orderId: ord.id,
                    internalOrderNumber: ord.internalOrderNumber || 'S/N',
                    userName: ord.userName || (ord.buyerInfo && ord.buyerInfo.name) || 'S/N',
                    status: ord.status,
                    grossTotal: gross,
                    mlFee: fee,
                    currentMlShippingDeducted: mlShipping,
                    mlShippingBonus: bonus,
                    currentNet: oldNet,
                    projectedNewNet: correctedNet,
                    recoveredAmount: recoveredAmount
                });
            }
        }

        if (!execute) {
            return res.status(200).json({
                mode: 'DRY_RUN (Simulacion - Ningun cambio aplicado)',
                instruction: 'Para aplicar la correccion definitiva a las ordenes afectadas, anade ?execute=true a la URL',
                totalFlexOrdersFoundWithError: flexOrdersWithShippingError.length,
                totalMoneyRecoveredEstimate: flexOrdersWithShippingError.reduce((sum, o) => sum + o.recoveredAmount, 0),
                affectedOrders: flexOrdersWithShippingError
            });
        }

        // MODO EJECUCION: Recalcular y corregir cada orden mediante syncAndValidateMLOrder
        const results = [];
        let totalRecovered = 0;

        for (const item of flexOrdersWithShippingError) {
            try {
                const recalcResult = await syncAndValidateMLOrder(item.orderId, db, true);
                results.push({
                    orderId: item.orderId,
                    internalOrderNumber: item.internalOrderNumber,
                    userName: item.userName,
                    previousNet: item.currentNet,
                    correctedNet: recalcResult.netAmount,
                    recoveredDiff: recalcResult.netDiff,
                    status: 'CORREGIDO'
                });
                totalRecovered += (recalcResult.netDiff || 0);
            } catch (err) {
                results.push({
                    orderId: item.orderId,
                    internalOrderNumber: item.internalOrderNumber,
                    error: err.message,
                    status: 'ERROR'
                });
            }
        }

        return res.status(200).json({
            success: true,
            mode: 'EXECUTION (Correcciones aplicadas exitosamente)',
            totalCorrectedOrders: results.filter(r => r.status === 'CORREGIDO').length,
            totalMoneyRecovered: totalRecovered,
            results: results
        });

    } catch (error) {
        console.error("Error en runFixFlexOrders:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
