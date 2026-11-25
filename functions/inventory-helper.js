// functions/inventory-helper.js
// Modulo centralizado para garantizar invariantes de stock:
// 1. Toda combinacion tiene branchStock { bodega, full } y c.stock === suma(c.branchStock).
// 2. El producto raiz siempre cumple root.branchStock === suma(combos.branchStock) y root.stock === suma(root.branchStock).
// 3. Permite acumular multiples deltas sobre el mismo producto dentro de una sola transaccion sin sobrescrituras.

const normalizeText = (str) =>
    str ? String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";

/**
 * Normaliza un mapa branchStock asegurando enteros >= 0 y llaves minimas bodega/full.
 */
function normalizeBranchMap(branchStock, fallbackTotal = 0) {
    const safeTotal = Math.max(0, Math.round(Number(fallbackTotal) || 0));
    if (!branchStock || typeof branchStock !== 'object') {
        return { bodega: safeTotal, full: 0 };
    }
    const result = {};
    for (const [k, v] of Object.entries(branchStock)) {
        result[k] = Math.max(0, Math.round(Number(v) || 0));
    }
    if (result.bodega === undefined) result.bodega = 0;
    if (result.full === undefined) result.full = 0;
    return result;
}

function sumBranchMap(branchMap) {
    if (!branchMap || typeof branchMap !== 'object') return 0;
    return Object.values(branchMap).reduce((acc, v) => acc + Math.max(0, Math.round(Number(v) || 0)), 0);
}

/**
 * Prepara una copia mutable y normalizada del estado de inventario de un producto.
 */
function initProductWorkingState(pData) {
    const hasCombos = Array.isArray(pData.combinations) && pData.combinations.length > 0;
    const combinations = hasCombos ? JSON.parse(JSON.stringify(pData.combinations)) : [];

    if (hasCombos) {
        const rootBranch = {};
        for (const c of combinations) {
            const cStock = Math.max(0, Math.round(Number(c.stock) || 0));
            const bMap = normalizeBranchMap(c.branchStock, cStock);
            const bSum = sumBranchMap(bMap);
            // Si la combinacion tenia branchStock desfasado respecto a c.stock (por ejemplo falta bodega o full),
            // preservamos las sucursales existentes cuando su suma > 0 o ajustamos bodega si todo es 0 y cStock > 0.
            if (bSum === 0 && cStock > 0) {
                bMap.bodega = cStock;
            }
            c.branchStock = bMap;
            c.stock = sumBranchMap(bMap);

            for (const [bKey, bVal] of Object.entries(bMap)) {
                rootBranch[bKey] = (rootBranch[bKey] || 0) + bVal;
            }
        }
        if (rootBranch.bodega === undefined) rootBranch.bodega = 0;
        if (rootBranch.full === undefined) rootBranch.full = 0;

        return {
            hasCombos: true,
            combinations,
            branchStock: rootBranch,
            stock: sumBranchMap(rootBranch),
            modified: false
        };
    }

    const rootStock = Math.max(0, Math.round(Number(pData.stock) || 0));
    const rootBranch = normalizeBranchMap(pData.branchStock, rootStock);
    if (sumBranchMap(rootBranch) === 0 && rootStock > 0) {
        rootBranch.bodega = rootStock;
    }

    return {
        hasCombos: false,
        combinations: [],
        branchStock: rootBranch,
        stock: sumBranchMap(rootBranch),
        modified: false
    };
}

/**
 * Busca el indice de combinacion coincidente en el estado mutable del producto.
 */
function findCombinationIndex(combinations, { variantIndex = -1, color = '', capacity = '' } = {}) {
    if (!Array.isArray(combinations) || combinations.length === 0) return -1;
    if (typeof variantIndex === 'number' && variantIndex >= 0 && variantIndex < combinations.length) {
        return variantIndex;
    }

    const targetColor = normalizeText(color);
    const targetCap = normalizeText(capacity);

    if (targetColor || targetCap) {
        const exactIdx = combinations.findIndex(c => {
            const cColor = normalizeText(c.color);
            const cCap = normalizeText(c.capacity);
            return (!targetColor || cColor === targetColor) && (!targetCap || cCap === targetCap);
        });
        if (exactIdx >= 0) return exactIdx;

        // Fallback parcial si solo coincidio color o capacidad
        const looseIdx = combinations.findIndex(c => {
            const cColor = normalizeText(c.color);
            const cCap = normalizeText(c.capacity);
            return (targetColor && cColor === targetColor) || (targetCap && cCap === targetCap);
        });
        if (looseIdx >= 0) return looseIdx;
    }

    if (combinations.length === 1) return 0;
    return -1;
}

/**
 * Aplica un delta (negativo para descontar, positivo para restaurar) sobre una sucursal especifica
 * en el estado mutable del producto. Mantiene invariantes estrictas.
 *
 * @param {object} state - Estado retornado por initProductWorkingState
 * @param {object} opts
 * @param {number} opts.delta - Cantidad a sumar (positivo) o restar (negativo)
 * @param {string} opts.branch - Sucursal objetivo ('bodega' o 'full')
 * @param {number} [opts.variantIndex] - Indice conocido de combinacion
 * @param {string} [opts.color] - Color de variante
 * @param {string} [opts.capacity] - Capacidad de variante
 * @param {boolean} [opts.strict] - Si true, lanza error si la sucursal no tiene suficiente stock
 * @param {boolean} [opts.fallbackBestVariant] - Si true y no hay match en variantes, usa la variante con mayor stock en esa sucursal
 * @returns {{ appliedDelta: number, matchedVariantIndex: number }}
 */
function applyStockDeltaToState(state, {
    delta,
    branch = 'bodega',
    variantIndex = -1,
    color = '',
    capacity = '',
    strict = false,
    fallbackBestVariant = false
} = {}) {
    const numDelta = Math.round(Number(delta) || 0);
    if (numDelta === 0) return { appliedDelta: 0, matchedVariantIndex: -1 };
    const targetBranch = String(branch || 'bodega').trim() || 'bodega';

    if (state.hasCombos) {
        let idx = findCombinationIndex(state.combinations, { variantIndex, color, capacity });

        if (idx < 0 && fallbackBestVariant && state.combinations.length > 0) {
            let bestIdx = 0;
            let bestScore = -1;
            for (let i = 0; i < state.combinations.length; i++) {
                const c = state.combinations[i];
                const bStk = Number(c.branchStock?.[targetBranch]) || 0;
                const totalStk = Number(c.stock) || 0;
                const score = bStk > 0 ? (bStk + 100000) : totalStk;
                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = i;
                }
            }
            idx = bestIdx;
        }

        if (idx < 0) {
            if (strict) {
                throw new Error(`No se encontro la variante solicitada (${color || ''} ${capacity || ''}).`);
            }
            return { appliedDelta: 0, matchedVariantIndex: -1 };
        }

        const combo = state.combinations[idx];
        const curBranchVal = Number(combo.branchStock[targetBranch]) || 0;
        const proposedVal = curBranchVal + numDelta;

        if (strict && proposedVal < 0) {
            throw new Error(`Stock insuficiente en ${targetBranch} para variante ${combo.color || ''} ${combo.capacity || ''} (disponible: ${curBranchVal}, solicitado: ${Math.abs(numDelta)}).`);
        }

        const nextBranchVal = Math.max(0, proposedVal);
        const actualDelta = nextBranchVal - curBranchVal;

        combo.branchStock[targetBranch] = nextBranchVal;
        combo.stock = sumBranchMap(combo.branchStock);

        // Recalcular rootBranchStock y root.stock desde TODAS las combinaciones
        const newRootBranch = { bodega: 0, full: 0 };
        for (const c of state.combinations) {
            for (const [bKey, bVal] of Object.entries(c.branchStock)) {
                newRootBranch[bKey] = (newRootBranch[bKey] || 0) + (Number(bVal) || 0);
            }
        }
        state.branchStock = newRootBranch;
        state.stock = sumBranchMap(newRootBranch);
        state.modified = true;

        return { appliedDelta: actualDelta, matchedVariantIndex: idx };
    }

    // Producto simple
    const curBranchVal = Number(state.branchStock[targetBranch]) || 0;
    const proposedVal = curBranchVal + numDelta;

    if (strict && proposedVal < 0) {
        throw new Error(`Stock insuficiente en ${targetBranch} (disponible: ${curBranchVal}, solicitado: ${Math.abs(numDelta)}).`);
    }

    const nextBranchVal = Math.max(0, proposedVal);
    const actualDelta = nextBranchVal - curBranchVal;

    state.branchStock[targetBranch] = nextBranchVal;
    state.stock = sumBranchMap(state.branchStock);
    state.modified = true;

    return { appliedDelta: actualDelta, matchedVariantIndex: -1 };
}

/**
 * Obtiene el stock disponible en bodega (excluyendo Mercado Envios Full) para sincronizar a ML seller_warehouse o web.
 */
function getBodegaStockForItem(pData, combination = null) {
    if (combination) {
        if (combination.branchStock && combination.branchStock.bodega !== undefined) {
            return Math.max(0, Math.round(Number(combination.branchStock.bodega) || 0));
        }
        const total = Math.max(0, Math.round(Number(combination.stock) || 0));
        const full = Math.max(0, Math.round(Number(combination.branchStock?.full) || 0));
        return Math.max(0, total - full);
    }
    if (pData.branchStock && pData.branchStock.bodega !== undefined) {
        return Math.max(0, Math.round(Number(pData.branchStock.bodega) || 0));
    }
    const total = Math.max(0, Math.round(Number(pData.stock) || 0));
    const full = Math.max(0, Math.round(Number(pData.branchStock?.full) || 0));
    return Math.max(0, total - full);
}

module.exports = {
    normalizeText,
    normalizeBranchMap,
    sumBranchMap,
    initProductWorkingState,
    findCombinationIndex,
    applyStockDeltaToState,
    getBodegaStockForItem
};
