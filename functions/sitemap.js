const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// ⚠️ IMPORTANTE: Cuando tengas tu dominio real, cámbialo aquí.
// Ejemplo: "https://www.pixeltech.com.co"
const DOMAIN = "https://pixeltechcol.web.app"; 

// Función para limpiar caracteres que rompen el XML
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

exports.generateSitemap = onRequest({ timeoutSeconds: 60, cors: true }, async (req, res) => {
    try {
        // Obtenemos productos activos
        const productsSnap = await admin.firestore()
            .collection('products')
            .where('status', '==', 'active')
            // Opcional: limitar si tienes miles (.limit(1000))
            .get();

        const categoriesSnap = await admin.firestore().collection('categories').get();

        let urls = '';

        // 1. Páginas Estáticas
        const staticPages = [
            { path: '/', priority: '1.0', freq: 'daily' },
            { path: '/shop/catalog.html', priority: '0.9', freq: 'daily' },
            // Agregamos search genérico
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
                // Encodeamos la URL para espacios y tildes
                const catParam = encodeURIComponent(data.name);
                urls += `
                <url>
                    <loc>${DOMAIN}/shop/search.html?category=${catParam}</loc>
                    <changefreq>weekly</changefreq>
                    <priority>0.8</priority>
                </url>`;
            }
        });

        // 3. Productos
        productsSnap.forEach(doc => {
            const data = doc.data();
            
            // INTELIGENCIA DE FECHAS:
            // Usamos updatedAt si existe, sino createdAt, sino la fecha actual.
            let lastModDate = new Date();
            if (data.updatedAt) {
                lastModDate = data.updatedAt.toDate();
            } else if (data.createdAt) {
                lastModDate = data.createdAt.toDate();
            }

            urls += `
            <url>
                <loc>${DOMAIN}/shop/product.html?id=${doc.id}</loc>
                <lastmod>${lastModDate.toISOString()}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.9</priority>
            </url>`;
        });

        const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            ${urls}
        </urlset>`;

        res.set('Content-Type', 'application/xml');
        // Cache-Control: Le decimos a Google y al CDN que guarden esto 1 hora
        // para no quemar lecturas de Firestore en cada petición repetida.
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=7200');
        
        res.status(200).send(sitemapXml);

    } catch (error) {
        console.error("Sitemap Error:", error);
        res.status(500).send("Error generating sitemap");
    }
});