import { db, doc, runTransaction } from "./firebase-init.js";

/**
 * Ajusta el stock de un producto de forma segura (Atómica).
 * Soporta productos simples y productos con Matriz de Variantes.
 * * @param {string} productId - ID del producto
 * @param {number} quantityChange - Cantidad a sumar (positivo) o restar (negativo)
 * @param {string|null} variantColor - (Opcional) Color específico
 * @param {string|null} variantCapacity - (Opcional) Capacidad específica
 */
export async function adjustStock(productId, quantityChange, variantColor = null, variantCapacity = null, changeReason = null, changeDetails = null) {
    const productRef = doc(db, "products", productId);

    try {
        await runTransaction(db, async (transaction) => {
            const productSnap = await transaction.get(productRef);
            if (!productSnap.exists()) throw `El producto ${productId} no existe`;

            const pData = productSnap.data();
            let newStock = (pData.stock || 0) + quantityChange;
            let newCombinations = pData.combinations || [];

            // --- CASO 1: PRODUCTO CON MATRIZ DE VARIANTES ---
            if (pData.combinations && pData.combinations.length > 0) {
                // Buscamos la combinación exacta (Ej: Negro - 128GB)
                const comboIndex = pData.combinations.findIndex(c => 
                    (c.color === variantColor || (!c.color && !variantColor)) &&
                    (c.capacity === variantCapacity || (!c.capacity && !variantCapacity))
                );

                if (comboIndex >= 0) {
                    const currentVariantStock = pData.combinations[comboIndex].stock || 0;
                    const newVariantStock = currentVariantStock + quantityChange;

                    if (newVariantStock < 0) {
                        throw `Stock insuficiente para la variante: ${pData.name} (${variantColor || ''} ${variantCapacity || ''})`;
                    }

                    // Actualizamos la variante específica
                    pData.combinations[comboIndex].stock = newVariantStock;

                    // Recalculamos el stock global sumando todas las variantes para mantener consistencia
                    newStock = pData.combinations.reduce((sum, item) => sum + item.stock, 0);
                } else {
                    // Si el producto tiene variantes pero no encontramos la combinación (caso raro de migración)
                    // Solo validamos el global
                    console.warn(`Variante no encontrada en ${pData.name}, afectando solo global.`);
                }
            }

            // --- CASO 2: PRODUCTO SIMPLE O VALIDACIÓN FINAL ---
            if (newStock < 0) {
                throw `Stock global insuficiente para ${pData.name}`;
            }

            const updatePayload = { 
                stock: newStock,
                combinations: newCombinations,
                updatedAt: new Date()
            };

            if (changeReason) {
                updatePayload.lastStockChangeReason = changeReason;
            }
            if (changeDetails) {
                updatePayload.lastStockChangeDetails = changeDetails;
            }

            // Guardamos los cambios
            transaction.update(productRef, updatePayload);
        });

        console.log(`✅ Stock actualizado: ${productId} | Var: ${variantColor}/${variantCapacity} | Delta: ${quantityChange} | Motivo: ${changeReason || 'General'}`);

    } catch (e) {
        console.error("❌ Error crítico en inventario:", e);
        throw e; // Relanzar para que checkout.js sepa que falló
    }
}