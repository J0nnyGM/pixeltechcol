// functions/inventory-audit-watcher.js
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

/**
 * 🔥 VIGILANTE DE INVENTARIO (Centinela de Auditoría)
 * Registra automáticamente si el stock cambió manualmente en edición,
 * por una Entrada de Inventario (compra), por una Venta (pedido) o por una Devolución.
 */
exports.watchInventoryChanges = onDocumentWritten("products/{productId}", async (event) => {
    if (!event.data) return null;

    const productId = event.params.productId;
    const beforeData = event.data.before.exists ? event.data.before.data() : null;
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    const db = admin.firestore();

    // 1. Caso: Producto Eliminado
    if (!afterData) {
        if (beforeData) {
            await db.collection("inventory_audit_logs").add({
                productId: productId,
                productName: beforeData.name || 'Producto Eliminado',
                sku: beforeData.sku || '',
                category: beforeData.category || '',
                brand: beforeData.brand || '',
                image: beforeData.mainImage || beforeData.image || (beforeData.images ? beforeData.images[0] : ''),
                beforeStock: beforeData.stock || 0,
                afterStock: 0,
                deltaStock: -(beforeData.stock || 0),
                changeType: "ELIMINACION_PRODUCTO",
                changeDetails: `Producto eliminado del catálogo (Stock final anterior: ${beforeData.stock || 0})`,
                variantChanges: [],
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                createdAtISO: new Date().toISOString()
            });
        }
        return null;
    }

    // 2. Caso: Creación de Producto Nuevo
    if (!beforeData) {
        await db.collection("inventory_audit_logs").add({
            productId: productId,
            productName: afterData.name || 'Nuevo Producto',
            sku: afterData.sku || '',
            category: afterData.category || '',
            brand: afterData.brand || '',
            image: afterData.mainImage || afterData.image || (afterData.images ? afterData.images[0] : ''),
            beforeStock: 0,
            afterStock: afterData.stock || 0,
            deltaStock: afterData.stock || 0,
            changeType: "CREACION_PRODUCTO",
            changeDetails: `Producto registrado en el sistema con stock inicial de ${afterData.stock || 0} ud(s)`,
            variantChanges: [],
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAtISO: new Date().toISOString()
        });
        return null;
    }

    // 3. Comparar Stock Global
    const beforeStock = typeof beforeData.stock === 'number' ? beforeData.stock : 0;
    const afterStock = typeof afterData.stock === 'number' ? afterData.stock : 0;
    const deltaStock = afterStock - beforeStock;

    // 4. Comparar Combinaciones / Variantes (Color, Capacidad)
    const beforeCombos = Array.isArray(beforeData.combinations) ? beforeData.combinations : [];
    const afterCombos = Array.isArray(afterData.combinations) ? afterData.combinations : [];

    const variantChanges = [];
    const comboMapBefore = {};
    beforeCombos.forEach(c => {
        const key = `${c.color || ''}_${c.capacity || ''}`;
        comboMapBefore[key] = c;
    });

    afterCombos.forEach(ac => {
        const key = `${ac.color || ''}_${ac.capacity || ''}`;
        const bc = comboMapBefore[key];
        const oldVal = bc && typeof bc.stock === 'number' ? bc.stock : (bc && typeof bc.quantity === 'number' ? bc.quantity : 0);
        const newVal = typeof ac.stock === 'number' ? ac.stock : (typeof ac.quantity === 'number' ? ac.quantity : 0);
        
        if (oldVal !== newVal) {
            variantChanges.push({
                color: ac.color || '',
                capacity: ac.capacity || '',
                before: oldVal,
                after: newVal,
                delta: newVal - oldVal
            });
        }
    });

    // Si NO hubo ningún cambio en stock global ni en variantes, ignorar (fue edición de precio, imagen o texto)
    if (deltaStock === 0 && variantChanges.length === 0) {
        return null;
    }

    // 5. Determinar Causa / Origen del Cambio
    let changeType = "AJUSTE_MANUAL";
    let changeDetails = "";
    let relatedReference = "";

    // A) Si el objeto actualizado trae una etiqueta explícita de origen
    if (afterData.lastStockChangeReason) {
        changeType = afterData.lastStockChangeReason;
        changeDetails = afterData.lastStockChangeDetails || "";
    } else {
        const nowMs = Date.now();
        const ninetySecsAgo = new Date(nowMs - 90000);

        try {
            // B) Buscar si se registró una Entrada de Inventario (compra) en los últimos 90 segundos
            const purchasesSnap = await db.collection("purchases")
                .where("createdAt", ">=", ninetySecsAgo)
                .get();

            let foundPurchase = false;
            purchasesSnap.forEach(pDoc => {
                const pData = pDoc.data();
                if (Array.isArray(pData.items)) {
                    const hasItem = pData.items.some(item => item.productId === productId || item.id === productId);
                    if (hasItem) {
                        foundPurchase = true;
                        relatedReference = pDoc.id;
                    }
                }
            });

            if (foundPurchase) {
                changeType = "ENTRADA_COMPRA";
                changeDetails = `Reabastecimiento mediante Entrada de Inventario / Compra (Ref: ${relatedReference})`;
            } else {
                // C) Buscar si se creó/modificó un Pedido (Venta o Cancelación) en los últimos 90 segundos
                const ordersSnap = await db.collection("orders")
                    .where("updatedAt", ">=", ninetySecsAgo)
                    .get();

                let foundOrder = null;
                ordersSnap.forEach(oDoc => {
                    const oData = oDoc.data();
                    if (Array.isArray(oData.items)) {
                        const hasItem = oData.items.some(item => item.id === productId || item.productId === productId);
                        if (hasItem) {
                            foundOrder = { id: oDoc.id, ...oData };
                        }
                    }
                });

                if (foundOrder) {
                    if (['CANCELADO', 'RECHAZADO'].includes(foundOrder.status) && deltaStock > 0) {
                        changeType = "DEVOLUCION_CANCELACION";
                        changeDetails = `Devolución de stock por anulación/cancelación del pedido #${foundOrder.internalOrderNumber || foundOrder.id}`;
                        relatedReference = foundOrder.id;
                    } else if (deltaStock < 0) {
                        changeType = "VENTA_PEDIDO";
                        changeDetails = `Descuento por venta realizada en el pedido #${foundOrder.internalOrderNumber || foundOrder.id}`;
                        relatedReference = foundOrder.id;
                    }
                }
            }
        } catch (err) {
            console.warn("[InventoryWatcher] Error buscando evento origen:", err);
        }
    }

    // Formatear detalles en texto descriptivo para el administrador
    if (!changeDetails) {
        if (changeType === "AJUSTE_MANUAL") {
            const variantText = variantChanges.length > 0 
                ? ` (Variantes: ${variantChanges.map(v => `${v.color || ''} ${v.capacity || ''}`.trim() + `: ${v.before} ➔ ${v.after}`).join(', ')})`
                : '';
            changeDetails = `Modificación manual directa en edición de producto (${beforeStock} ➔ ${afterStock})${variantText}`;
        } else if (changeType === "ENTRADA_COMPRA") {
            changeDetails = `Entrada de inventario realizada (${deltaStock > 0 ? '+' : ''}${deltaStock} ud(s))`;
        } else if (changeType === "VENTA_PEDIDO") {
            changeDetails = `Salida por venta de producto (${deltaStock} ud(s))`;
        } else if (changeType === "DEVOLUCION_CANCELACION") {
            changeDetails = `Retorno de stock por pedido cancelado (+${deltaStock} ud(s))`;
        }
    }

    // 6. Guardar el Registro de Auditoría en Firestore
    try {
        await db.collection("inventory_audit_logs").add({
            productId: productId,
            productName: afterData.name || beforeData.name || 'Producto Sin Nombre',
            sku: afterData.sku || beforeData.sku || '',
            category: afterData.category || beforeData.category || '',
            brand: afterData.brand || beforeData.brand || '',
            image: afterData.mainImage || afterData.image || (afterData.images ? afterData.images[0] : ''),
            beforeStock: beforeStock,
            afterStock: afterStock,
            deltaStock: deltaStock,
            changeType: changeType, // "ENTRADA_COMPRA", "VENTA_PEDIDO", "DEVOLUCION_CANCELACION", "AJUSTE_MANUAL", "CREACION_PRODUCTO"
            changeDetails: changeDetails,
            variantChanges: variantChanges,
            relatedReference: relatedReference,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAtISO: new Date().toISOString()
        });

        console.log(`👁️ [Vigilante Inventario] Registrado cambio en ${productId} (${changeType}): ${deltaStock > 0 ? '+' : ''}${deltaStock}`);
    } catch (auditErr) {
        console.error("Error guardando registro de auditoría de inventario:", auditErr);
    }

    return null;
});
