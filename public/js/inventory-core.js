import { db, doc, runTransaction } from "./firebase-init.js";

function normalizeBranchMap(branchStock, fallbackTotal = 0) {
    const safeTotal = Math.max(0, Math.round(Number(fallbackTotal) || 0));
    if (!branchStock || typeof branchStock !== 'object') {
        return { bodega: safeTotal, full: 0 };
    }
    const res = {};
    for (const [k, v] of Object.entries(branchStock)) {
        res[k] = Math.max(0, Math.round(Number(v) || 0));
    }
    if (res.bodega === undefined) res.bodega = 0;
    if (res.full === undefined) res.full = 0;
    if (Object.values(res).reduce((a, b) => a + b, 0) === 0 && safeTotal > 0) {
        res.bodega = safeTotal;
    }
    return res;
}

function sumBranches(branchMap) {
    return Object.values(branchMap || {}).reduce((acc, v) => acc + Math.max(0, Math.round(Number(v) || 0)), 0);
}

/**
 * Ajusta el stock de un producto de forma segura (Atomica).
 * Soporta productos simples y productos con Matriz de Variantes, garantizando
 * siempre la invariante: stock === suma(combinations) === suma(branchStock).
 * @param {string} productId - ID del producto
 * @param {number} quantityChange - Cantidad a sumar (positivo) o restar (negativo)
 * @param {string|null} variantColor - (Opcional) Color especifico
 * @param {string|null} variantCapacity - (Opcional) Capacidad especifica
 */
export async function adjustStock(productId, quantityChange, variantColor = null, variantCapacity = null, changeReason = null, changeDetails = null, targetBranch = 'bodega') {
    const productRef = doc(db, "products", productId);
    const branchKey = targetBranch || 'bodega';
    const delta = Math.round(Number(quantityChange) || 0);
    if (delta === 0) return;

    try {
        await runTransaction(db, async (transaction) => {
            const productSnap = await transaction.get(productRef);
            if (!productSnap.exists()) throw `El producto ${productId} no existe`;

            const pData = productSnap.data();
            let newCombinations = Array.isArray(pData.combinations) ? JSON.parse(JSON.stringify(pData.combinations)) : [];
            let rootBranchStock = {};
            let newStock = 0;

            // --- CASO 1: PRODUCTO CON MATRIZ DE VARIANTES ---
            if (newCombinations.length > 0) {
                // Normalizar branchStock en TODAS las combinaciones para no perder variantes hermanas
                newCombinations.forEach(c => {
                    c.branchStock = normalizeBranchMap(c.branchStock, c.stock);
                    c.stock = sumBranches(c.branchStock);
                });

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

                if (comboIndex < 0) {
                    throw `No se encontro la variante (${variantColor || ''} ${variantCapacity || ''}) en ${pData.name}`;
                }

                const combo = newCombinations[comboIndex];
                const curBranchVal = Number(combo.branchStock[branchKey]) || 0;
                const nextBranchVal = curBranchVal + delta;

                if (delta < 0 && nextBranchVal < 0) {
                    throw `Stock insuficiente en ${branchKey} para la variante ${pData.name} (${combo.color || ''} ${combo.capacity || ''}). Disponible: ${curBranchVal}, solicitado: ${Math.abs(delta)}.`;
                }

                combo.branchStock[branchKey] = Math.max(0, nextBranchVal);
                combo.stock = sumBranches(combo.branchStock);

                // Recalcular rootBranchStock y stock global desde TODAS las combinaciones
                rootBranchStock = { bodega: 0, full: 0 };
                newCombinations.forEach(c => {
                    Object.keys(c.branchStock).forEach(bId => {
                        rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (Number(c.branchStock[bId]) || 0);
                    });
                });
                newStock = sumBranches(rootBranchStock);
            } else {
                // --- CASO 2: PRODUCTO SIMPLE ---
                rootBranchStock = normalizeBranchMap(pData.branchStock, pData.stock);
                const curBranchVal = Number(rootBranchStock[branchKey]) || 0;
                const nextBranchVal = curBranchVal + delta;

                if (delta < 0 && nextBranchVal < 0) {
                    throw `Stock insuficiente en ${branchKey} para ${pData.name}. Disponible: ${curBranchVal}, solicitado: ${Math.abs(delta)}.`;
                }

                rootBranchStock[branchKey] = Math.max(0, nextBranchVal);
                newStock = sumBranches(rootBranchStock);
            }

            const updatePayload = {
                stock: newStock,
                combinations: newCombinations,
                branchStock: rootBranchStock,
                updatedAt: new Date()
            };

            if (changeReason) {
                updatePayload.lastStockChangeReason = changeReason;
            }
            if (changeDetails) {
                updatePayload.lastStockChangeDetails = changeDetails;
            }

            transaction.update(productRef, updatePayload);
        });

        console.log(`[Inventario] Stock actualizado: ${productId} | Var: ${variantColor}/${variantCapacity} | Sucursal: ${branchKey} | Delta: ${delta} | Motivo: ${changeReason || 'General'}`);

    } catch (e) {
        console.error("[Inventario Error] Error critico en ajuste de inventario:", e);
        throw e;
    }
}