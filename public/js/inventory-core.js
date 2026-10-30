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
            let newStock = (Number(pData.stock) || 0) + quantityChange;
            let newCombinations = Array.isArray(pData.combinations) ? JSON.parse(JSON.stringify(pData.combinations)) : [];
            let rootBranchStock = pData.branchStock ? { ...pData.branchStock } : null;

            // --- CASO 1: PRODUCTO CON MATRIZ DE VARIANTES ---
            if (newCombinations.length > 0) {
                let comboIndex = -1;

                if (variantColor || variantCapacity) {
                    const normColor = String(variantColor || '').trim().toLowerCase();
                    const normCap = String(variantCapacity || '').trim().toLowerCase();
                    comboIndex = newCombinations.findIndex(c => 
                        (String(c.color || '').trim().toLowerCase() === normColor || (!c.color && !variantColor)) &&
                        (String(c.capacity || '').trim().toLowerCase() === normCap || (!c.capacity && !variantCapacity))
                    );
                }

                if (comboIndex < 0 && newCombinations.length === 1) {
                    comboIndex = 0;
                }

                if (comboIndex >= 0) {
                    const combo = newCombinations[comboIndex];
                    const currentVariantStock = Number(combo.stock) || 0;
                    const newVariantStock = currentVariantStock + quantityChange;

                    if (newVariantStock < 0) {
                        throw `Stock insuficiente para la variante: ${pData.name} (${variantColor || ''} ${variantCapacity || ''})`;
                    }

                    combo.stock = newVariantStock;

                    if (combo.branchStock) {
                        let curBodega = combo.branchStock['bodega'] !== undefined
                            ? (Number(combo.branchStock['bodega']) || 0)
                            : Math.max(0, currentVariantStock - Object.entries(combo.branchStock).filter(([k]) => k !== 'bodega').reduce((s, [, v]) => s + (Number(v) || 0), 0));
                        combo.branchStock['bodega'] = Math.max(0, curBodega + quantityChange);
                    }

                    newStock = newCombinations.reduce((sum, item) => sum + (Number(item.stock) || 0), 0);
                } else {
                    if (quantityChange < 0 && newStock < 0) {
                        throw `Stock global insuficiente para ${pData.name}`;
                    }
                }

                if (newCombinations.some(c => c.branchStock)) {
                    rootBranchStock = {};
                    newCombinations.forEach(c => {
                        if (c.branchStock) {
                            Object.keys(c.branchStock).forEach(bId => {
                                rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (Number(c.branchStock[bId]) || 0);
                            });
                        }
                    });
                }
            } else {
                if (newStock < 0) {
                    throw `Stock global insuficiente para ${pData.name}`;
                }
            }

            if (rootBranchStock && (!newCombinations || !newCombinations.some(c => c.branchStock))) {
                let curBodega = rootBranchStock['bodega'] !== undefined
                    ? (Number(rootBranchStock['bodega']) || 0)
                    : Math.max(0, (Number(pData.stock) || 0) - Object.entries(rootBranchStock).filter(([k]) => k !== 'bodega').reduce((s, [, v]) => s + (Number(v) || 0), 0));
                rootBranchStock['bodega'] = Math.max(0, curBodega + quantityChange);
            }

            const updatePayload = { 
                stock: newStock,
                combinations: newCombinations,
                updatedAt: new Date()
            };

            if (rootBranchStock) {
                updatePayload.branchStock = rootBranchStock;
            }
            if (changeReason) {
                updatePayload.lastStockChangeReason = changeReason;
            }
            if (changeDetails) {
                updatePayload.lastStockChangeDetails = changeDetails;
            }

            transaction.update(productRef, updatePayload);
        });

        console.log(`[Inventario] Stock actualizado: ${productId} | Var: ${variantColor}/${variantCapacity} | Delta: ${quantityChange} | Motivo: ${changeReason || 'General'}`);

    } catch (e) {
        console.error("[Inventario Error] Error critico en ajuste de inventario:", e);
        throw e;
    }
}