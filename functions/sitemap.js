const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const DOMAIN = "https://pixeltechcol.web.app/"; // ⚠️ CAMBIA ESTO

exports.generateSitemap = onRequest({ timeoutSeconds: 60, cors: true }, async (req, res) => {
    try {
        const productsSnap = await admin.firestore().collection('products').where('status', '==', 'active').get();
        const categoriesSnap = await admin.firestore().collection('categories').get();

        let urls = '';

        // 1. Páginas Estáticas (Prioridad Alta)
        const staticPages = ['/', '/shop/catalog.html', '/categories.html'];
        staticPages.forEach(page => {
            urls += `
            <url>
                <loc>${DOMAIN}${page}</loc>
                <changefreq>daily</changefreq>
                <priority>1.0</priority>
            </url>`;
        });

        // 2. Categorías (Prioridad Media)
        categoriesSnap.forEach(doc => {
            const catName = encodeURIComponent(doc.data().name);
            urls += `
            <url>
                <loc>${DOMAIN}/shop/search.html?category=${catName}</loc>
                <changefreq>weekly</changefreq>
                <priority>0.8</priority>
            </url>`;
        });

        // 3. Productos (Prioridad Alta)
        productsSnap.forEach(doc => {
            urls += `
            <url>
                <loc>${DOMAIN}/shop/product.html?id=${doc.id}</loc>
                <lastmod>${new Date().toISOString()}</lastmod>
                <changefreq>daily</changefreq>
                <priority>0.9</priority>
            </url>`;
        });

        const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            ${urls}
        </urlset>`;

        res.set('Content-Type', 'application/xml');
        res.status(200).send(sitemapXml);

    } catch (error) {
        console.error("Sitemap Error:", error);
        res.status(500).end();
    }
});