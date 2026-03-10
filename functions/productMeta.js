const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.renderProductMeta = async (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).send("Falta el ID del producto");

    try {
        const docSnap = await admin.firestore().collection('products').doc(id).get();
        
        if (!docSnap.exists) {
            return res.status(404).send("Producto no encontrado");
        }

        const p = docSnap.data();
        
        // Preparar la información limpia
        const title = `${p.name} | PixelTech Colombia`;
        // Limpiamos etiquetas HTML de la descripción
        const cleanDesc = p.description ? p.description.replace(/<[^>]*>?/gm, '').substring(0, 150) + "..." : `Compra ${p.name} al mejor precio. Envíos a toda Colombia.`;
        const image = p.mainImage || (p.images && p.images.length > 0 ? p.images[0] : "https://pixeltechcol.com/img/logo.png");
        
        const priceFormatted = (p.price || 0).toLocaleString('es-CO');
        const finalTitle = `$${priceFormatted} - ${p.name}`; // El precio saldrá en el título de WhatsApp
        
        const productUrl = `https://pixeltechcol.com/shop/product.html?id=${id}`;

        // Generar HTML con Meta Tags (Open Graph)
        const html = `<!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>${finalTitle}</title>
            <meta name="description" content="${cleanDesc}">
            
            <meta property="og:type" content="product">
            <meta property="og:url" content="${productUrl}">
            <meta property="og:title" content="${finalTitle}">
            <meta property="og:description" content="${cleanDesc}">
            <meta property="og:image" content="${image}">
            <meta property="og:site_name" content="PixelTech Col">
            
            <meta name="twitter:card" content="summary_large_image">
            <meta name="twitter:title" content="${finalTitle}">
            <meta name="twitter:description" content="${cleanDesc}">
            <meta name="twitter:image" content="${image}">
            
            <script>window.location.href = "${productUrl}";</script>
        </head>
        <body>
            <p>Redirigiendo al producto...</p>
        </body>
        </html>`;

        // Cacheamos la respuesta por 24 horas para que sea súper rápido
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        res.status(200).send(html);

    } catch (error) {
        console.error("Error generando meta tags:", error);
        res.status(500).send("Error interno");
    }
};