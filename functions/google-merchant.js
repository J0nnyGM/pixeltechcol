// functions/google-merchant.js
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// ⚠️ CONFIGURACIÓN: Cambia esto por tu dominio real (sin slash al final)
// Ejemplo: "https://pixeltech.com.co"
const DOMAIN = "https://pixeltechcol.web.app/"; 

// Función auxiliar para escapar caracteres prohibidos en XML
function escapeXml(unsafe) {
    if (!unsafe) return "";
    return unsafe.toString().replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

exports.generateProductFeed = onRequest({ timeoutSeconds: 60, cors: true }, async (req, res) => {
    try {
        console.log("Generando feed de Google Merchant Center...");

        // 1. Obtener productos activos de Firestore
        const productsSnap = await admin.firestore()
            .collection('products')
            .where('status', '==', 'active') // Asegúrate que tus productos tengan este campo
            .get();

        let xmlItems = '';

        productsSnap.forEach(doc => {
            const p = doc.data();
            
            // Validaciones mínimas: Si no tiene nombre o precio, saltar
            if (!p.name || !p.price) return;

            // Mapeo de datos (Ajusta los nombres de campos según tu BD)
            const id = escapeXml(doc.id);
            const title = escapeXml(p.name);
            
            // Google prefiere descripciones largas sin HTML. Limpiamos tags básicos.
            let rawDesc = p.description || p.name;
            rawDesc = rawDesc.replace(/<[^>]*>?/gm, ''); 
            const description = escapeXml(rawDesc.substring(0, 5000)); // Límite 5000 caracteres

            const link = `${DOMAIN}/shop/product.html?id=${id}`;
            const imageLink = escapeXml(p.mainImage || p.image || '');
            
            // Formato de precio: "150000 COP"
            const price = `${p.price} COP`;
            
            // Disponibilidad: in_stock | out_of_stock
            const availability = (p.stock && parseInt(p.stock) > 0) ? 'in_stock' : 'out_of_stock';
            
            const brand = escapeXml(p.brand || 'PixelTech');
            const condition = 'new'; // Asumimos nuevo, puedes hacerlo dinámico si vendes usados

            // Construcción del item XML
            xmlItems += `
            <item>
                <g:id>${id}</g:id>
                <g:title>${title}</g:title>
                <g:description>${description}</g:description>
                <g:link>${link}</g:link>
                <g:image_link>${imageLink}</g:image_link>
                <g:condition>${condition}</g:condition>
                <g:availability>${availability}</g:availability>
                <g:price>${price}</g:price>
                <g:brand>${brand}</g:brand>
                <g:identifier_exists>no</g:identifier_exists> 
            </item>`;
            // Nota: identifier_exists=no se usa si no tienes códigos de barras (GTIN/EAN).
            // Si tienes EAN, pon <g:gtin>${p.ean}</g:gtin> y identifier_exists=yes
        });

        // 2. Envolver en estructura RSS 2.0 compatible con Google
        const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
        <channel>
            <title>PixelTech Products</title>
            <link>${DOMAIN}</link>
            <description>Feed de productos de PixelTech Elite Store</description>
            ${xmlItems}
        </channel>
        </rss>`;

        // 3. Responder con XML
        res.set('Content-Type', 'application/xml');
        res.status(200).send(feedXml);

    } catch (error) {
        console.error("Error generando feed:", error);
        res.status(500).send("Error generando el feed.");
    }
});