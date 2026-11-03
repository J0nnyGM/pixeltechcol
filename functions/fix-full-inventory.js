const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.runFixFullInventory = functions.https.onRequest(async (req, res) => {
    const db = admin.firestore();
    const execute = req.query.execute === 'true';
    const sinceParam = req.query.since || '2026-10-25T00:00:00.000Z';

    // Inventario inicial físico reportado por el usuario
    const userInitialInventory = {
        'LCzPcm45H7jIGoEeewEX': { name: 'Xiaomi Monitor 2K A27Qi 2026', sku: '6941948709140', initialStock: 9 },
        'K7j1ShIdSpWT5nMaaaRd': { name: 'Báscula Xiaomi Body Composition Scale S400', sku: '6941812751985', initialStock: 26 },
        'qBjfPsoPEOdmZ1m6KxC0': { name: 'Xiaomi Monitor A27i 2026', sku: '6941948708341', initialStock: 3 },
        'OiHjpN4WKFXIg40ZxvPl': { name: 'Destornillador Eléctrico De Precisión Xiaomi', sku: '6934177756474', initialStock: 18 },
        'HaHgKJgOIb6E9Ng2eRR2': { name: 'Pantalla Xiaomi Monitor A24i 2026 23.8"', sku: '6941948708372', initialStock: 159 },
        '0MJKp6TuYUDc0Iy7Yp12': { name: 'Cámara DJI Osmo Pocket 4 - Creator Combo', sku: '6937224133082', initialStock: 12 }
    };

    const targetProductIds = Object.keys(userInitialInventory);

    try {
        const sinceDate = new Date(sinceParam);

        // 1. Consultar el estado actual de los 6 productos en Firestore
        const productsMap = new Map();
        for (const pId of targetProductIds) {
            const snap = await db.collection('products').doc(pId).get();
            if (snap.exists) {
                productsMap.set(pId, { id: snap.id, ...snap.data() });
            }
        }

        // 2. Consultar TODAS las órdenes registradas desde sinceDate (cualquier canal)
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', sinceDate)
            .get();

        const fullSalesByProduct = {};
        const otherSalesByProduct = {};
        targetProductIds.forEach(id => {
            fullSalesByProduct[id] = { count: 0, orders: [] };
            otherSalesByProduct[id] = { count: 0, orders: [] };
        });

        ordersSnap.docs.forEach(docSnap => {
            const ord = docSnap.data();
            const orderId = docSnap.id;

            if (ord.status === 'CANCELADO') return;
            // Solo considerar órdenes donde el stock fue descontado
            if (ord.isStockDeducted === false) return;

            const isFull = Boolean(
                ord.isFull || ord.isMlFull ||
                ord.shippingType === 'FULL' ||
                ord.logisticType === 'fulfillment' ||
                ord.shippingData?.logistic_type === 'fulfillment' ||
                ord.shipping?.logistic_type === 'fulfillment'
            );

            const items = Array.isArray(ord.items) ? ord.items : [];
            items.forEach(it => {
                const pId = it.id || it.docId || it.productId;
                if (!targetProductIds.includes(pId)) return;

                const pData = productsMap.get(pId);
                const auditDate = pData?.lastInventoryAudit 
                    ? (pData.lastInventoryAudit.toDate ? pData.lastInventoryAudit.toDate() : new Date(pData.lastInventoryAudit)) 
                    : sinceDate;

                let ordDate = ord.createdAt ? (ord.createdAt.toDate ? ord.createdAt.toDate() : new Date(ord.createdAt)) : null;
                // Si la orden se creó antes de la toma de inventario físico, el conteo inicial ya la incluía
                if (ordDate && ordDate < auditDate) return;

                const qty = Number(it.quantity) || Number(it.qty) || 1;
                const channel = isFull ? 'FULL' : (ord.source || ord.channel || 'OTRO');

                const ordSummary = {
                    orderId: orderId,
                    internalNumber: ord.internalOrderNumber || 'S/N',
                    channel: channel,
                    qty: qty,
                    status: ord.status,
                    date: ordDate ? ordDate.toISOString() : null
                };

                if (isFull) {
                    fullSalesByProduct[pId].count += qty;
                    fullSalesByProduct[pId].orders.push(ordSummary);
                } else {
                    otherSalesByProduct[pId].count += qty;
                    otherSalesByProduct[pId].orders.push(ordSummary);
                }
            });
        });

        // 3. Calcular la calibración exacta
        const calibrationReport = [];

        for (const pId of targetProductIds) {
            const info = userInitialInventory[pId];
            const pData = productsMap.get(pId);
            if (!pData) continue;

            const initialStock = info.initialStock;
            const fullSold = fullSalesByProduct[pId].count;
            const otherSold = otherSalesByProduct[pId].count;

            // El stock físico real en bodega debe ser: Inventario Inicial - Ventas reales de bodega
            const targetBodegaStock = Math.max(0, initialStock - otherSold);

            const currentDbStock = Number(pData.stock) || 0;
            const currentDbBodega = Number(pData.branchStock?.bodega) !== undefined 
                ? (Number(pData.branchStock?.bodega) || 0) 
                : currentDbStock;

            const auditDate = pData.lastInventoryAudit 
                ? (pData.lastInventoryAudit.toDate ? pData.lastInventoryAudit.toDate().toISOString() : pData.lastInventoryAudit)
                : null;
            const updateDate = pData.updatedAt
                ? (pData.updatedAt.toDate ? pData.updatedAt.toDate().toISOString() : pData.updatedAt)
                : null;

            calibrationReport.push({
                productId: pId,
                name: info.name,
                sku: info.sku,
                lastInventoryAudit: auditDate,
                updatedAt: updateDate,
                initialInventoryConfirmed: initialStock,
                salesByFullIgnoredForBodega: fullSold,
                salesByOtherChannelsDeductedFromBodega: otherSold,
                targetBodegaStockCalculated: targetBodegaStock,
                currentDbStock: currentDbStock,
                currentDbBodegaStock: currentDbBodega,
                adjustmentDelta: targetBodegaStock - currentDbBodega,
                otherChannelOrdersList: otherSalesByProduct[pId].orders,
                fullOrdersList: fullSalesByProduct[pId].orders.map(o => o.orderId)
            });
        }

        if (!execute) {
            return res.status(200).json({
                mode: 'DRY_RUN (Simulacion - Ningun cambio aplicado)',
                instruction: 'Para aplicar este ajuste definitivo a Bodega, anade ?execute=true a la URL',
                sinceDateConsidered: sinceDate.toISOString(),
                summary: calibrationReport.map(r => ({
                    producto: r.name,
                    sku: r.sku,
                    fechaAuditoriaInventario: r.lastInventoryAudit,
                    inventarioInicial: r.initialInventoryConfirmed,
                    ventasOtrosCanales: r.salesByOtherChannelsDeductedFromBodega,
                    ventasFullDescontadasErroneamente: r.salesByFullIgnoredForBodega,
                    stockActualEnBaseDeDatos: r.currentDbBodegaStock,
                    stockNuevoCorregidoEnBodega: r.targetBodegaStockCalculated,
                    ajusteDelta: r.adjustmentDelta >= 0 ? `+${r.adjustmentDelta}` : `${r.adjustmentDelta}`
                })),
                details: calibrationReport
            });
        }

        // MODO EJECUCION: Aplicar los stocks exactos en Firestore
        const now = admin.firestore.FieldValue.serverTimestamp();
        const results = [];

        for (const item of calibrationReport) {
            const pRef = db.collection('products').doc(item.productId);
            const pSnap = await pRef.get();
            if (!pSnap.exists) continue;

            const pData = pSnap.data();
            let newCombinations = Array.isArray(pData.combinations) ? JSON.parse(JSON.stringify(pData.combinations)) : [];
            let rootBranchStock = pData.branchStock ? { ...pData.branchStock } : {};

            // Actualizar sede bodega al valor exacto calculado
            rootBranchStock.bodega = item.targetBodegaStockCalculated;

            if (newCombinations.length > 0) {
                newCombinations.forEach(c => {
                    if (!c.branchStock) c.branchStock = {};
                    c.branchStock.bodega = item.targetBodegaStockCalculated;
                    c.stock = Object.values(c.branchStock).reduce((s, v) => s + (Number(v) || 0), 0);
                });
            }

            // El stock global es la suma de las sedes (bodega + full si existiera)
            let newGlobalStock = Object.values(rootBranchStock).reduce((s, v) => s + (Number(v) || 0), 0);
            if (newCombinations.length > 0) {
                newGlobalStock = newCombinations.reduce((s, c) => s + (Number(c.stock) || 0), 0);
            }

            const updatePayload = {
                stock: newGlobalStock,
                branchStock: rootBranchStock,
                combinations: newCombinations,
                lastStockChangeReason: 'AJUSTE_AUDITORIA',
                lastStockChangeDetails: `Calibracion fisica de inventario post-Full: Bodega fijada en ${item.targetBodegaStockCalculated} uds (Inicial: ${item.initialInventoryConfirmed} - Ventas Bodega: ${item.salesByOtherChannelsDeductedFromBodega})`,
                updatedAt: now
            };

            await pRef.update(updatePayload);

            // Registro en log de auditoría
            try {
                await db.collection("inventory_audit_logs").add({
                    productId: item.productId,
                    productName: item.name,
                    sku: item.sku,
                    type: 'FULL_INVENTORY_CALIBRATION',
                    beforeStock: item.currentDbBodegaStock,
                    afterStock: item.targetBodegaStockCalculated,
                    deltaStock: item.adjustmentDelta,
                    initialInventory: item.initialInventoryConfirmed,
                    otherSalesDeducted: item.salesByOtherChannelsDeductedFromBodega,
                    fullSalesReversed: item.salesByFullIgnoredForBodega,
                    changeDetails: `Ajuste calibrado de inventario en bodega: ${item.currentDbBodegaStock} -> ${item.targetBodegaStockCalculated} uds`,
                    timestamp: now,
                    adminEmail: 'system@pixeltechcol.com'
                });
            } catch (aErr) {
                console.warn("Error guardando auditoria:", aErr.message);
            }

            results.push({
                productId: item.productId,
                name: item.name,
                sku: item.sku,
                stockAnterior: item.currentDbBodegaStock,
                nuevoStockBodega: item.targetBodegaStockCalculated,
                status: 'CORREGIDO'
            });
        }

        return res.status(200).json({
            success: true,
            mode: 'EXECUTION (Calibracion de inventario aplicada con exito)',
            totalProductsUpdated: results.length,
            results: results
        });

    } catch (err) {
        console.error("Error en runFixFullInventory:", err);
        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});
