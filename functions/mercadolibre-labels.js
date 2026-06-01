// functions/mercadolibre-labels.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.getLabel = async (req, res) => {
    // Configurar cabeceras CORS
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }

    const { orderId } = req.query;

    if (!orderId) {
        res.status(400).send("Falta el parámetro obligario 'orderId'.");
        return;
    }

    try {
        const db = admin.firestore();
        const orderSnap = await db.collection('orders').doc(orderId).get();

        if (!orderSnap.exists) {
            res.status(404).send(`El pedido con ID "${orderId}" no existe en la base de datos.`);
            return;
        }

        const orderData = orderSnap.data();
        const shippingData = orderData.shippingData || {};
        const shipmentId = shippingData.shipmentId;

        if (!shipmentId) {
            res.status(400).send("El pedido especificado no tiene un 'shipmentId' asociado en sus datos de envío.");
            return;
        }

        // Determinar tienda a partir de la estructura del ID del pedido
        let configDocName = 'mercadolibre'; // Tienda 1 por defecto (ML-)
        if (orderId.startsWith('ML2-')) {
            configDocName = 'mercadolibre_store2'; // Tienda 2 (ML2-)
        } else if (orderId.startsWith('ML3-')) {
            configDocName = 'mercadolibre_store3'; // Tienda 3 (ML3-)
        }

        console.log(`[ML Label] Procesando rótulo para pedido: ${orderId}, Shipment ID: ${shipmentId}, Config: config/${configDocName}`);

        // Leer credenciales/token activo de Firestore
        const mlConfigDoc = await db.collection('config').doc(configDocName).get();
        if (!mlConfigDoc.exists) {
            res.status(500).send(`No se encontró la configuración "config/${configDocName}" en Firestore para esta tienda.`);
            return;
        }

        const accessToken = mlConfigDoc.data().accessToken;
        if (!accessToken) {
            res.status(500).send("La tienda seleccionada no posee un token de acceso ('accessToken') activo.");
            return;
        }

        // Petición a la API oficial de MercadoLibre para obtener el PDF binario
        const mlUrl = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${shipmentId}&savePdf=Y`;
        console.log(`[ML Label] Solicitando archivo PDF a MercadoLibre: GET ${mlUrl}`);

        const response = await fetch(mlUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[ML Label] Error devuelto por API de MercadoLibre: Código ${response.status}. Detalle: ${errText}`);
            res.status(response.status).send(`Error devuelto por la API de MercadoLibre: ${response.statusText}`);
            return;
        }

        // Leer el PDF binario
        const pdfArrayBuffer = await response.arrayBuffer();
        const pdfBuffer = Buffer.from(pdfArrayBuffer);

        console.log(`[ML Label] Transmitiendo PDF del rótulo con éxito. Tamaño: ${pdfBuffer.length} bytes.`);

        // Establecer las cabeceras HTTP de respuesta para PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="rotulo-${orderId}.pdf"`);
        res.status(200).send(pdfBuffer);

    } catch (error) {
        console.error("[ML Label] Error crítico en la descarga del rótulo:", error);
        res.status(500).send(`Error interno del servidor al procesar el rótulo: ${error.message}`);
    }
};
