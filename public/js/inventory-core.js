import { db, doc, runTransaction } from "./firebase-init.js";

/**
 * Ajusta el stock de un producto de forma segura (Atómica)
 * @param {string} productId - ID del producto
 * @param {number} quantityChange - Cantidad a sumar (positivo) o restar (negativo)
 */
export async function adjustStock(productId, quantityChange) {
    const productRef = doc(db, "products", productId);

    try {
        await runTransaction(db, async (transaction) => {
            const productSnap = await transaction.get(productRef);
            if (!productSnap.exists()) throw "El producto no existe";

            const newStock = (productSnap.data().stock || 0) + quantityChange;

            if (newStock < 0) throw `Stock insuficiente para ${productSnap.data().name}`;

            transaction.update(productRef, { stock: newStock });
        });
        console.log(`Stock actualizado para ${productId}: ${quantityChange}`);
    } catch (e) {
        console.error("Error en transacción de stock:", e);
        throw e;
    }
}