const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.fixMLOrderLink = functions.https.onRequest(async (req, res) => {
    const db = admin.firestore();
    const orderId = req.query.orderId || 'ML-2000019242046124';
    const productId = req.query.productId || 'gtTKSxBxbjOXbxuAaueR';

    try {
        const orderRef = db.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (!orderSnap.exists) {
            return res.status(404).json({ error: `Orden ${orderId} no encontrada` });
        }

        const productRef = db.collection('products').doc(productId);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
            return res.status(404).json({ error: `Producto ${productId} no encontrado` });
        }

        const orderData = orderSnap.data();
        const productData = productSnap.data();

        const items = orderData.items || [];
        if (items.length === 0) {
            return res.status(400).json({ error: `La orden ${orderId} no tiene items` });
        }

        const combos = Array.isArray(productData.combinations) ? productData.combinations : [];
        const combo = combos.find(c => String(c.color || '').trim().toUpperCase() === 'NEGRO') || combos[0] || null;

        const targetSku = (combo && combo.sku) ? String(combo.sku) : (productData.sku ? String(productData.sku) : "");
        const targetColor = (combo && combo.color) ? String(combo.color) : "NEGRO";
        const targetCapacity = (combo && combo.capacity) ? String(combo.capacity) : "";
        const targetImage = productData.mainImage || productData.image || items[0].image || "";

        items[0] = {
            ...items[0],
            id: productData.id || productId,
            name: productData.name || items[0].name,
            originalTitle: items[0].originalTitle || items[0].name || items[0].title || "",
            sku: targetSku,
            color: targetColor,
            capacity: targetCapacity,
            image: targetImage,
            mainImage: targetImage,
            thumbnail: targetImage,
            isLinkedToCatalog: true,
            stockDeducted: true,
            linkedAt: new Date().toISOString(),
            linkedBy: 'system-fix',
            linkedBranch: 'bodega'
        };

        await orderRef.update({
            items: items,
            isStockDeducted: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({
            success: true,
            message: `Orden ${orderId} enlazada exitosamente a ${productData.name}`,
            product: {
                id: productId,
                name: productData.name,
                stock: productData.stock,
                variant: combo ? `${combo.color} - SKU: ${combo.sku}` : 'Sin variante'
            },
            updatedItems: items
        });
    } catch (err) {
        console.error("Error en fixMLOrderLink:", err);
        return res.status(500).json({ error: err.message });
    }
});
