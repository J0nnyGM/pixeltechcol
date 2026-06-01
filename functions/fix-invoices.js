const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Esta función se ejecuta visitando una URL en tu navegador
exports.runFixInvoices = functions.https.onRequest(async (req, res) => {
    const db = admin.firestore();
    let updatedCount = 0;
    let skippedCount = 0;

    try {
        console.log("Iniciando corrección de estados de facturación en órdenes canceladas/rechazadas...");
        
        // 1. Traer órdenes que requieran factura
        const ordersSnap = await db.collection("orders")
            .where("requiresInvoice", "==", true)
            .get();
        
        let batch = db.batch();
        let batchCount = 0;

        for (const orderDoc of ordersSnap.docs) {
            const data = orderDoc.data();
            const orderId = orderDoc.id;

            // 2. Si el pedido está CANCELADO o RECHAZADO
            const isCancelledOrRejected = ['CANCELADO', 'RECHAZADO'].includes(data.status);
            
            // 3. Si el estado de facturación NO es COMPLETED, CANCELLED o CANCELADO
            const needsUpdate = data.billingStatus !== 'COMPLETED' && 
                                data.billingStatus !== 'CANCELLED' && 
                                data.billingStatus !== 'CANCELADO';

            if (isCancelledOrRejected && needsUpdate) {
                batch.update(orderDoc.ref, {
                    billingStatus: 'CANCELLED',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp() // Dispara sincronización en tiempo real en frontend
                });

                updatedCount++;
                batchCount++;

                // Firebase permite un máximo de 500 escrituras por lote
                if (batchCount >= 450) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            } else {
                skippedCount++;
            }
        }

        // Ejecutar escrituras pendientes
        if (batchCount > 0) {
            await batch.commit();
        }

        res.status(200).send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Corrección de Facturación</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; background-color: #f8fafc; color: #1e293b; }
                    .card { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; }
                    h1 { color: #0f172a; font-size: 24px; font-weight: 800; margin-bottom: 20px; text-transform: uppercase; letter-spacing: -0.5px; }
                    p { margin: 10px 0; font-size: 14px; }
                    .badge-success { color: #15803d; background-color: #dcfce7; padding: 4px 8px; border-radius: 6px; font-weight: bold; }
                    .badge-info { color: #1d4ed8; background-color: #dbeafe; padding: 4px 8px; border-radius: 6px; font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>✅ Corrección de Facturación Finalizada</h1>
                    <p><b>Órdenes corregidas a 'CANCELLED':</b> <span class="badge-success">${updatedCount}</span></p>
                    <p><b>Órdenes omitidas (ya facturadas, activas o ya canceladas):</b> <span class="badge-info">${skippedCount}</span></p>
                    <p>El Delta Sync del frontend actualizará inmediatamente el panel administrativo.</p>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error("Error corrigiendo estados de facturación:", error);
        res.status(500).send("❌ Ocurrió un error al procesar la corrección: " + error.message);
    }
});
