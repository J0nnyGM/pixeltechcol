const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// 1. CORRECCIÓN: Con "www" y SIN barra al final (Para evitar dobles barras //)
const DOMAIN = "https://www.pixeltechcol.com"; 

// Función para limpiar caracteres que rompen el XML (Amperpersands en las URLs)
const escapeXml = (unsafe) => {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
};

// 2. CORRECCIÓN: Cambiamos de generateSitemap a sitemap para que coincida con tu firebase.json
exports.sitemap = onRequest({ timeoutSeconds: 60, cors: true }, async (req, res) => {
    try {
        // Obtenemos productos activos
        const productsSnap = await admin.firestore()
            .collection('products')
            .where('status', '==', 'active')
            .get();

        const categoriesSnap = await admin.firestore().collection('categories').get();

        let urls = '';

        // 3. CORRECCIÓN: Actualizamos catalog.html a catalogo.html
        const staticPages = [
            { path: '/', priority: '1.0', freq: 'daily' },
            { path: '/shop/catalogo.html', priority: '0.9', freq: 'daily' },
            { path: '/shop/search.html', priority: '0.8', freq: 'weekly' }
        ];

        staticPages.forEach(page => {
            urls += `
            <url>
                <loc>${DOMAIN}${page.path}</loc>
                <changefreq>${page.freq}</changefreq>
                <priority>${page.priority}</priority>
            </url>`;
        });

        // 2. Categorías
        categoriesSnap.forEach(doc => {
            const data = doc.data();
            if (data.name) {
                // Encodeamos la URL para espacios y tildes, y escapamos el XML
                const catParam = encodeURIComponent(data.name);
                const loc = escapeXml(`${DOMAIN}/shop/search.html?category=${catParam}`);
                urls += `
            <url>
                <loc>${loc}</loc>
                <changefreq>weekly</changefreq>
                <priority>0.8</priority>
            </url>`;
            }
        });

        // 3. Productos
        productsSnap.forEach(doc => {
            const data = doc.data();
            
            // INTELIGENCIA DE FECHAS:
            let lastModDate = new Date();
            if (data.updatedAt) {
                lastModDate = data.updatedAt.toDate();
            } else if (data.createdAt) {
                lastModDate = data.createdAt.toDate();
            }

            const loc = escapeXml(`${DOMAIN}/shop/product.html?id=${doc.id}`);

            urls += `
            <url>
                <loc>${loc}</loc>
                <lastmod>${lastModDate.toISOString()}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.9</priority>
            </url>`;
        });

        const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`.trim(); 

        res.set('Content-Type', 'application/xml; charset=utf-8'); 
        // Cache-Control: Le decimos a Google y al CDN que guarden esto 1 hora
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=7200');
        
        res.status(200).send(sitemapXml);

    } catch (error) {
        console.error("Sitemap Error:", error);
        res.status(500).send("Error generating sitemap");
    }
});