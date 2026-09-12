/**
 * SCRIPT DE CORRECCIÓN: LIBERACIÓN DE SERIALES HUÉRFANOS / DEVUELTOS
 * 
 * ¿Qué hace este script?
 * 1. Lee todos los seriales registrados en la colección 'product_serials'.
 * 2. Identifica aquellos con estado 'DISPATCHED' o que tengan 'orderId' asociado.
 * 3. Cruza cada serial contra su orden correspondiente en 'orders':
 *    - Si la orden no existe (fue eliminada).
 *    - Si la orden está en estado 'DEVUELTO', 'CANCELADO' o 'RECHAZADO'.
 *    - Si el ítem específico fue marcado como devuelto (returnedQty >= quantity o está en returnedSns).
 * 4. Muestra un reporte detallado en la consola del navegador con console.table.
 * 5. Pide confirmación al usuario antes de modificar la base de datos.
 * 6. Actualiza en lotes (writeBatch) los seriales a 'AVAILABLE', desvinculándolos de la orden.
 * 
 * Modo de uso:
 * 1. Abre el navegador e inicia sesión como Administrador (en /admin/product-serials.html o /admin/orders.html).
 * 2. Abre la consola de desarrollador (F12 -> Pestaña "Console").
 * 3. Pega este código completo y presiona Enter.
 */

(async function corregirSerialesDevueltos() {
    console.log("%c🔍 Iniciando auditoría de seriales...", "color: #00AEC7; font-weight: bold; font-size: 14px;");

    // Verificar disponibilidad de Firebase en el contexto del navegador
    const firestoreModule = await import('/js/firebase-init.js');
    const { db, collection, getDocs, writeBatch, serverTimestamp } = firestoreModule;

    if (!db) {
        console.error("❌ No se encontró la instancia de la base de datos 'db'. Ejecuta este script desde /admin/product-serials.html o /admin/orders.html.");
        return;
    }

    try {
        console.log("⏳ Descargando seriales y órdenes desde Firestore...");
        const [serialsSnap, ordersSnap] = await Promise.all([
            getDocs(collection(db, "product_serials")),
            getDocs(collection(db, "orders"))
        ]);

        console.log(`📦 Se encontraron ${serialsSnap.size} seriales totales y ${ordersSnap.size} órdenes.`);

        const ordersMap = new Map();
        ordersSnap.forEach(d => ordersMap.set(d.id, { id: d.id, ...d.data() }));

        const serialesALiberar = [];

        serialsSnap.forEach(docSnap => {
            const s = docSnap.data();

            // Evaluar solo seriales despachados o asociados a una orden
            if (s.status === 'DISPATCHED' || s.orderId) {
                const order = ordersMap.get(s.orderId);

                // Caso 1: La orden ya no existe (fue borrada de la base de datos)
                if (!order) {
                    serialesALiberar.push({
                        idDoc: docSnap.id,
                        docRef: docSnap.ref,
                        serialNumber: s.serialNumber,
                        producto: s.productName || 'Desconocido',
                        ordenId: s.orderId || 'N/A',
                        numOrden: s.orderInternalNumber || 'S/N',
                        motivo: 'Orden no existe (eliminada)'
                    });
                    return;
                }

                // Caso 2: La orden está en estado CANCELADO, DEVUELTO o RECHAZADO
                if (['CANCELADO', 'DEVUELTO', 'RECHAZADO'].includes(order.status)) {
                    serialesALiberar.push({
                        idDoc: docSnap.id,
                        docRef: docSnap.ref,
                        serialNumber: s.serialNumber,
                        producto: s.productName || 'Desconocido',
                        ordenId: order.id,
                        numOrden: order.orderNumber || order.internalOrderNumber || order.id.slice(0,6).toUpperCase(),
                        motivo: `Orden en estado '${order.status}'`
                    });
                    return;
                }

                // Caso 3: Devolución parcial o ítems devueltos dentro de la orden
                const items = order.items || [];
                const item = items.find(i => i.id === s.productId || (i.name && s.productName && i.name.toLowerCase() === s.productName.toLowerCase()));

                if (item) {
                    // Si el serial está registrado en el array de devueltos
                    if (Array.isArray(item.returnedSns) && item.returnedSns.includes(s.serialNumber)) {
                        serialesALiberar.push({
                            idDoc: docSnap.id,
                            docRef: docSnap.ref,
                            serialNumber: s.serialNumber,
                            producto: s.productName || item.name || 'Desconocido',
                            ordenId: order.id,
                            numOrden: order.orderNumber || order.internalOrderNumber || order.id.slice(0,6).toUpperCase(),
                            motivo: 'Registrado explícitamente como devuelto (returnedSns)'
                        });
                        return;
                    }

                    // Si toda la cantidad de ese ítem fue devuelta (ej. 2 de 2)
                    if (item.returnedQty && item.quantity && item.returnedQty >= item.quantity) {
                        serialesALiberar.push({
                            idDoc: docSnap.id,
                            docRef: docSnap.ref,
                            serialNumber: s.serialNumber,
                            producto: s.productName || item.name || 'Desconocido',
                            ordenId: order.id,
                            numOrden: order.orderNumber || order.internalOrderNumber || order.id.slice(0,6).toUpperCase(),
                            motivo: `Ítem devuelto completamente (${item.returnedQty}/${item.quantity})`
                        });
                        return;
                    }
                }
            }
        });

        if (serialesALiberar.length === 0) {
            console.log("%c✅ Todo está perfecto: No hay seriales bloqueados en órdenes canceladas o devueltas.", "color: #10B981; font-weight: bold; font-size: 13px;");
            alert("✅ Todo en orden: No se encontraron seriales bloqueados pertenecientes a órdenes canceladas o devueltas.");
            return;
        }

        console.log(`%c⚠️ Se encontraron ${serialesALiberar.length} seriales bloqueados que deben liberarse:`, "color: #F59E0B; font-weight: bold; font-size: 13px;");
        console.table(serialesALiberar.map(s => ({
            Serial: s.serialNumber,
            Producto: s.producto,
            Orden: s.numOrden,
            Motivo: s.motivo
        })));

        const confirmar = confirm(`⚠️ Se encontraron ${serialesALiberar.length} seriales bloqueados en órdenes devueltas o canceladas.\n\n¿Deseas corregirlos ahora mismo?\n(Pasarán a estado DISPONIBLE en inventario)`);
        if (!confirmar) {
            console.log("Operación cancelada por el usuario. No se realizaron cambios.");
            return;
        }

        console.log("⏳ Aplicando correcciones en Firestore...");
        const batchSize = 400;
        let procesados = 0;

        for (let i = 0; i < serialesALiberar.length; i += batchSize) {
            const chunk = serialesALiberar.slice(i, i + batchSize);
            const batch = writeBatch(db);

            chunk.forEach(item => {
                batch.update(item.docRef, {
                    status: 'AVAILABLE',
                    orderId: null,
                    orderInternalNumber: null,
                    clientName: null,
                    clientPhone: null,
                    dispatchedAt: null,
                    returnedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            });

            await batch.commit();
            procesados += chunk.length;
            console.log(`Progreso: ${procesados}/${serialesALiberar.length} seriales liberados...`);
        }

        console.log("%c🎉 ¡Proceso completado exitosamente!", "color: #10B981; font-weight: bold; font-size: 14px;");
        alert(`🎉 Éxito:\nSe liberaron correctamente ${serialesALiberar.length} seriales en la base de datos. Ahora están marcados como 'DISPONIBLE'.`);

        // Si estamos en la página de control de seriales, refrescar vista
        if (typeof window.loadGlobalSerialStats === 'function') {
            await window.loadGlobalSerialStats();
        }
        if (window.currentSelectedProduct && typeof window.selectProduct === 'function') {
            await window.selectProduct(window.currentSelectedProduct, true);
        }

    } catch (error) {
        console.error("🚨 Error ejecutando el script de corrección:", error);
        alert("❌ Error: " + (error.message || error));
    }
})();
