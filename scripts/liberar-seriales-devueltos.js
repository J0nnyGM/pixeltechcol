/**
 * SCRIPT DE CORRECCIÓN: LIBERACIÓN Y DEPURACIÓN DE SERIALES DEVUELTOS / REGULARIZADOS
 * 
 * ¿Qué hace este script?
 * 1. Lee todos los seriales registrados en la colección 'product_serials'.
 * 2. Identifica aquellos asociados a órdenes canceladas, devueltas, rechazadas o eliminadas.
 * 3. También detecta seriales regularizados huérfanos que quedaron en 'AVAILABLE'.
 * 4. Aplica la regla de negocio:
 *    - Si el serial proviene de una COMPRA LEGÍTIMA: lo LIBERA a 'AVAILABLE'.
 *    - Si el serial fue REGULARIZADO en alistamiento: lo ELIMINA de la base de datos
 *      (para evitar que quede bloqueando o asignado al producto equivocado).
 * 5. Muestra un reporte detallado en la consola del navegador con console.table.
 * 6. Pide confirmación al usuario antes de modificar la base de datos.
 * 7. Ejecuta los cambios en lotes seguros (writeBatch).
 * 
 * Modo de uso:
 * 1. Abre el navegador e inicia sesión como Administrador (en /admin/product-serials.html o /admin/orders.html).
 * 2. Abre la consola de desarrollador (F12 -> Pestaña "Console").
 * 3. Pega este código completo y presiona Enter.
 */

(async function corregirSerialesDevueltosYRegularizados() {
    console.log("%c🔍 Iniciando auditoría y depuración de seriales...", "color: #00AEC7; font-weight: bold; font-size: 14px;");

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

        const serialesAProcesar = [];

        serialsSnap.forEach(docSnap => {
            const s = docSnap.data();
            const isRegularized = (s.source && s.source.toUpperCase().includes('REGULARIZADO')) ||
                                  (s.supplierName && s.supplierName.toLowerCase().includes('regularizado'));

            // Caso 1: Serial despachado o asociado a una orden
            if (s.status === 'DISPATCHED' || s.orderId) {
                const order = ordersMap.get(s.orderId);

                // Subcaso 1.1: La orden ya no existe (fue borrada de la base de datos)
                if (!order) {
                    serialesAProcesar.push({
                        idDoc: docSnap.id,
                        docRef: docSnap.ref,
                        serialNumber: s.serialNumber,
                        producto: s.productName || 'Desconocido',
                        tipo: isRegularized ? 'Regularizado' : 'Compra Legítima',
                        action: isRegularized ? 'ELIMINAR' : 'LIBERAR',
                        isRegularized,
                        ordenId: s.orderId || 'N/A',
                        numOrden: s.orderInternalNumber || 'S/N',
                        motivo: 'Orden no existe (eliminada)'
                    });
                    return;
                }

                // Subcaso 1.2: La orden está en estado CANCELADO, DEVUELTO o RECHAZADO
                if (['CANCELADO', 'DEVUELTO', 'RECHAZADO'].includes(order.status)) {
                    serialesAProcesar.push({
                        idDoc: docSnap.id,
                        docRef: docSnap.ref,
                        serialNumber: s.serialNumber,
                        producto: s.productName || 'Desconocido',
                        tipo: isRegularized ? 'Regularizado' : 'Compra Legítima',
                        action: isRegularized ? 'ELIMINAR' : 'LIBERAR',
                        isRegularized,
                        ordenId: order.id,
                        numOrden: order.orderNumber || order.internalOrderNumber || order.id.slice(0,6).toUpperCase(),
                        motivo: `Orden en estado '${order.status}'`
                    });
                    return;
                }

                // Subcaso 1.3: Devolución parcial o ítems devueltos dentro de la orden
                const items = order.items || [];
                const item = items.find(i => i.id === s.productId || (i.name && s.productName && i.name.toLowerCase() === s.productName.toLowerCase()));

                if (item) {
                    // Si el serial está registrado en el array de devueltos
                    if (Array.isArray(item.returnedSns) && item.returnedSns.includes(s.serialNumber)) {
                        serialesAProcesar.push({
                            idDoc: docSnap.id,
                            docRef: docSnap.ref,
                            serialNumber: s.serialNumber,
                            producto: s.productName || item.name || 'Desconocido',
                            tipo: isRegularized ? 'Regularizado' : 'Compra Legítima',
                            action: isRegularized ? 'ELIMINAR' : 'LIBERAR',
                            isRegularized,
                            ordenId: order.id,
                            numOrden: order.orderNumber || order.internalOrderNumber || order.id.slice(0,6).toUpperCase(),
                            motivo: 'Registrado explícitamente como devuelto (returnedSns)'
                        });
                        return;
                    }

                    // Si toda la cantidad de ese ítem fue devuelta (ej. 2 de 2)
                    if (item.returnedQty && item.quantity && item.returnedQty >= item.quantity) {
                        serialesAProcesar.push({
                            idDoc: docSnap.id,
                            docRef: docSnap.ref,
                            serialNumber: s.serialNumber,
                            producto: s.productName || item.name || 'Desconocido',
                            tipo: isRegularized ? 'Regularizado' : 'Compra Legítima',
                            action: isRegularized ? 'ELIMINAR' : 'LIBERAR',
                            isRegularized,
                            ordenId: order.id,
                            numOrden: order.orderNumber || order.internalOrderNumber || order.id.slice(0,6).toUpperCase(),
                            motivo: `Ítem devuelto completamente (${item.returnedQty}/${item.quantity})`
                        });
                        return;
                    }
                }
            }

            // Caso 2: Serial regularizado huérfano que quedó en AVAILABLE sin compra previa
            if (s.status === 'AVAILABLE' && isRegularized && !s.purchaseId) {
                serialesAProcesar.push({
                    idDoc: docSnap.id,
                    docRef: docSnap.ref,
                    serialNumber: s.serialNumber,
                    producto: s.productName || 'Desconocido',
                    tipo: 'Regularizado',
                    action: 'ELIMINAR',
                    isRegularized: true,
                    ordenId: 'N/A',
                    numOrden: 'N/A',
                    motivo: `Serial regularizado disponible sin compra (origen: ${s.source || s.supplierName})`
                });
                return;
            }
        });

        if (serialesAProcesar.length === 0) {
            console.log("%c✅ Todo está perfecto: No hay seriales bloqueados ni regularizados huérfanos.", "color: #10B981; font-weight: bold; font-size: 13px;");
            alert("✅ Todo en orden: No se encontraron seriales bloqueados ni regularizados huérfanos.");
            return;
        }

        const aLiberar = serialesAProcesar.filter(s => s.action === 'LIBERAR');
        const aEliminar = serialesAProcesar.filter(s => s.action === 'ELIMINAR');

        console.log(`%c⚠️ Se encontraron ${serialesAProcesar.length} seriales a procesar:`, "color: #F59E0B; font-weight: bold; font-size: 14px;");
        console.log(`• ${aLiberar.length} seriales legítimos a LIBERAR a 'DISPONIBLE'`);
        console.log(`• ${aEliminar.length} seriales regularizados a ELIMINAR`);

        console.table(serialesAProcesar.map(s => ({
            Accion: s.action === 'ELIMINAR' ? '🗑️ ELIMINAR' : '🔄 LIBERAR',
            Serial: s.serialNumber,
            Producto: s.producto,
            Tipo: s.tipo,
            Orden: s.numOrden,
            Motivo: s.motivo
        })));

        const confirmMsg = `⚠️ AUDITORÍA DE SERIALES DEVUELTOS / CANCELADOS:\n\n` +
            `Se encontraron ${serialesAProcesar.length} seriales:\n` +
            `• ${aLiberar.length} seriales legítimos de compras pasarán a estado 'DISPONIBLE'.\n` +
            `• ${aEliminar.length} seriales REGULARIZADOS serán ELIMINADOS (para evitar errores con el producto real).\n\n` +
            `¿Deseas aplicar estos cambios ahora mismo en la base de datos?`;

        const confirmar = confirm(confirmMsg);
        if (!confirmar) {
            console.log("Operación cancelada por el usuario. No se realizaron cambios.");
            return;
        }

        console.log("⏳ Aplicando correcciones en Firestore...");
        const batchSize = 400;
        let procesados = 0;

        for (let i = 0; i < serialesAProcesar.length; i += batchSize) {
            const chunk = serialesAProcesar.slice(i, i + batchSize);
            const batch = writeBatch(db);

            chunk.forEach(item => {
                if (item.action === 'ELIMINAR') {
                    batch.delete(item.docRef);
                } else {
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
                }
            });

            await batch.commit();
            procesados += chunk.length;
            console.log(`Progreso: ${procesados}/${serialesAProcesar.length} seriales procesados...`);
        }

        console.log("%c🎉 ¡Proceso completado exitosamente!", "color: #10B981; font-weight: bold; font-size: 14px;");
        alert(`🎉 Éxito:\nSe procesaron ${serialesAProcesar.length} seriales correctamente:\n\n- ${aLiberar.length} liberados a 'DISPONIBLE'.\n- ${aEliminar.length} regularizados eliminados.`);

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
