/**
 * PixelTech - Motor de Búsqueda Inteligente con Aproximación Matemática
 * Implementa:
 * - Normalización de texto en español (remoción de tildes, diacríticos y caracteres especiales).
 * - Algoritmo de Damerau-Levenshtein para calcular distancia de edición y tolerancia a errores ortográficos.
 * - Diccionario de sinónimos tecnológicos (Colombia / LATAM).
 * - Lematización de plurales y variaciones morfológicas.
 * - Ponderación multi-campo (Nombre > Marca > Tags > Categoría > Subcategoría > Descripción).
 * - Puntuación de relevancia vectorial (Scoring) y clasificación en Coincidencias Exactas y Resultados Similares.
 */

export const TECH_SYNONYMS = {
    // Relojes
    'reloj': ['smartwatch', 'watch', 'smartband', 'band', 'manilla'],
    'relojes': ['smartwatch', 'watch', 'smartband', 'band', 'manillas'],
    'smartwatch': ['reloj', 'watch', 'relojes'],
    'smartwatches': ['reloj', 'watch', 'relojes'],
    'smartband': ['reloj', 'band', 'manilla'],
    'band': ['reloj', 'smartwatch', 'manilla'],
    'watch': ['reloj', 'smartwatch'],

    // Audio
    'audifono': ['audifonos', 'auricular', 'auriculares', 'earbuds', 'headset', 'headphones', 'diadema', 'manoslibres', 'in ear', 'airpods'],
    'audifonos': ['audifono', 'auricular', 'auriculares', 'earbuds', 'headset', 'headphones', 'diadema', 'manoslibres', 'in ear', 'airpods'],
    'auricular': ['audifono', 'audifonos', 'auriculares', 'earbuds', 'headset'],
    'auriculares': ['audifono', 'audifonos', 'auricular', 'earbuds', 'headset'],
    'diadema': ['audifonos', 'auriculares', 'headset', 'gamer'],
    'diademas': ['audifonos', 'auriculares', 'headset'],
    'earbuds': ['audifonos', 'auriculares'],
    'headphones': ['audifonos', 'auriculares', 'diadema'],
    'headset': ['audifonos', 'auriculares', 'diadema'],
    'airpods': ['audifonos', 'auriculares', 'apple'],

    // Celulares
    'celular': ['telefono', 'movil', 'smartphone', 'iphone', 'dispositivo'],
    'celulares': ['telefono', 'telefonos', 'moviles', 'smartphones', 'iphones'],
    'telefono': ['celular', 'smartphone', 'movil'],
    'telefonos': ['celulares', 'smartphones', 'moviles'],
    'smartphone': ['celular', 'telefono', 'movil'],
    'smartphones': ['celulares', 'telefonos', 'moviles'],
    'movil': ['celular', 'telefono', 'smartphone'],
    'moviles': ['celulares', 'telefonos', 'smartphones'],
    'iphone': ['celular', 'apple', 'telefono'],
    'iphones': ['celulares', 'apple', 'telefonos'],

    // Parlantes y Sonido
    'parlante': ['altavoz', 'speaker', 'bafle', 'corneta', 'sonido'],
    'parlantes': ['altavoces', 'speakers', 'bafles', 'cornetas'],
    'altavoz': ['parlante', 'speaker', 'bafle'],
    'altavoces': ['parlantes', 'speakers', 'bafles'],
    'speaker': ['parlante', 'altavoz', 'bafle'],
    'speakers': ['parlantes', 'altavoces', 'bafles'],
    'bafle': ['parlante', 'altavoz'],
    'bafles': ['parlantes', 'altavoces'],

    // Carga y Energía
    'cargador': ['adaptador', 'cubo', 'power', 'charger', 'carga'],
    'cargadores': ['adaptadores', 'cubos', 'chargers', 'cargador'],
    'adaptador': ['cargador', 'cubo', 'power', 'hub'],
    'adaptadores': ['cargadores', 'cubos', 'hubs'],
    'cubo': ['cargador', 'adaptador'],
    'cubos': ['cargadores', 'adaptadores'],
    'powerbank': ['bateria', 'portatil', 'bateria externa'],
    'bateria': ['powerbank', 'pila'],

    // Conectividad y Redes
    'router': ['mesh', 'repetidor', 'wifi', 'red', 'rompemuros', 'extensor'],
    'routers': ['mesh', 'repetidores', 'wifi', 'red'],
    'mesh': ['router', 'wifi', 'deco', 'red'],
    'repetidor': ['extensor', 'amplificador', 'router', 'wifi'],
    'repetidores': ['extensores', 'routers', 'wifi'],
    'extensor': ['repetidor', 'router', 'wifi'],
    'wifi': ['mesh', 'router', 'red', 'inalambrico'],

    // Cables y Accesorios
    'cable': ['cables', 'cordon', 'conector'],
    'cables': ['cable', 'cordones', 'conectores'],
    'funda': ['case', 'estuche', 'cover', 'protector'],
    'fundas': ['cases', 'estuches', 'covers', 'protectores'],
    'estuche': ['case', 'funda', 'cover'],
    'estuches': ['cases', 'fundas', 'covers'],
    'case': ['funda', 'estuche', 'cover'],
    'cases': ['fundas', 'estuches'],
    'cover': ['funda', 'estuche', 'case'],
    'vidrio': ['protector', 'mica', 'cristal'],
    'mica': ['vidrio', 'protector'],
    'protector': ['vidrio', 'mica', 'funda', 'case'],
    'protectores': ['vidrios', 'fundas', 'cases'],

    // Almacenamiento y Cómputo
    'disco': ['ssd', 'almacenamiento', 'hdd', 'unidad'],
    'discos': ['ssd', 'almacenamiento', 'hdd'],
    'ssd': ['disco', 'almacenamiento', 'solido'],
    'memoria': ['ram', 'almacenamiento', 'microsd', 'sd'],
    'memorias': ['ram', 'almacenamiento', 'microsd', 'sd'],
    'teclado': ['keyboard'],
    'teclados': ['keyboards'],
    'mouse': ['raton'],
    'raton': ['mouse'],
    'ratones': ['mouse'],

    // Conexión inalámbrica
    'inalambrico': ['bluetooth', 'wireless', 'sin cable'],
    'inalambricos': ['bluetooth', 'wireless', 'sin cable'],
    'bluetooth': ['inalambrico', 'wireless'],
    'wireless': ['inalambrico', 'bluetooth'],

    // Marcas habituales y apodos
    'tplink': ['tp-link', 'tp link'],
    'xiaomi': ['redmi', 'poco'],
    'redmi': ['xiaomi'],
    'poco': ['xiaomi'],
    'samsung': ['galaxy'],
    'apple': ['iphone', 'mac', 'ipad', 'airpods']
};

/**
 * Normaliza un texto removiendo acentos, caracteres especiales y espacios redundantes
 */
export function normalizeText(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Distancia de Damerau-Levenshtein:
 * Mide el número mínimo de operaciones (inserción, eliminación, sustitución
 * y transposición de caracteres adyacentes) para transformar una cadena en otra.
 */
export function damerauLevenshtein(a, b) {
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;

    const matrix = [];
    for (let i = 0; i <= al; i++) matrix[i] = [i];
    for (let j = 0; j <= bl; j++) matrix[0][j] = j;

    for (let i = 1; i <= al; i++) {
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // Eliminación
                matrix[i][j - 1] + 1,      // Inserción
                matrix[i - 1][j - 1] + cost // Sustitución
            );
            // Transposición de caracteres adyacentes (ej: "iphoen" -> "iphone")
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
            }
        }
    }
    return matrix[al][bl];
}

/**
 * Lematizador básico de plurales y flexiones en español
 */
export function stemSpanishWord(word) {
    if (word.length <= 3) return word;
    if (word.endsWith('ces') && word.length > 4) return word.slice(0, -3) + 'z';
    if (word.endsWith('es') && word.length > 4) {
        const root = word.slice(0, -2);
        if (/[lrndz]$/.test(root)) return root;
        return word.slice(0, -1);
    }
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
        return word.slice(0, -1);
    }
    return word;
}

/**
 * Calcula la similitud matemática entre una palabra buscada (qToken) y una del producto (tToken).
 * Retorna un valor entre 0.0 y 1.0.
 */
export function calculateWordSimilarity(qToken, tToken) {
    if (!qToken || !tToken) return 0;
    if (qToken === tToken) return 1.0;

    // 1. Coincidencia por raíz morfológica (singular / plural)
    const qStem = stemSpanishWord(qToken);
    const tStem = stemSpanishWord(tToken);
    if (qStem === tStem) return 1.0;

    // 2. Coincidencia por sinónimo tecnológico
    const syns = TECH_SYNONYMS[qToken] || [];
    if (syns.includes(tToken) || syns.some(s => stemSpanishWord(s) === tStem)) {
        return 0.95;
    }

    // 3. Coincidencia por prefijo (si la palabra buscada tiene al menos 3 letras)
    if (tToken.startsWith(qToken) && qToken.length >= 3) {
        return 0.85 + 0.15 * (qToken.length / tToken.length);
    }
    if (tStem.startsWith(qStem) && qStem.length >= 3) {
        return 0.85 + 0.15 * (qStem.length / tStem.length);
    }

    // 4. Tolerancia ortográfica mediante Damerau-Levenshtein
    // Términos muy cortos (ej: x55, usb, pro, max) no deben aplicar fuzzy para evitar falsos positivos
    if (qToken.length <= 3) {
        return 0;
    }

    const maxLen = Math.max(qToken.length, tToken.length);
    const dist = damerauLevenshtein(qToken, tToken);

    // Permitir 1 error en palabras de 4 o más caracteres (ej: "ipone" vs "iphone")
    if (dist === 1 && maxLen >= 4) {
        return 1.0 - (dist / maxLen);
    }
    // Permitir 2 errores en palabras largas de 6 o más caracteres (ej: "bluetot" vs "bluetooth")
    if (dist === 2 && maxLen >= 6) {
        return 1.0 - (dist / maxLen);
    }

    return 0;
}

/**
 * Pre-computa índices de búsqueda en un objeto de producto para acelerar consultas posteriores.
 */
export function indexProduct(p) {
    if (p._searchIndexed) return p;
    p._normName = normalizeText(p.name || '');
    p._normBrand = normalizeText(p.brand || '');
    p._normCat = normalizeText((p.category || '') + ' ' + (p.subcategory || ''));
    p._normTags = Array.isArray(p.tags) ? p.tags.map(normalizeText).join(' ') : normalizeText(p.tags || '');
    p._normDesc = normalizeText(p.description || '');

    p._nameTokens = p._normName.split(' ').filter(Boolean);
    p._brandTokens = p._normBrand.split(' ').filter(Boolean);
    p._catTokens = p._normCat.split(' ').filter(Boolean);
    p._tagTokens = p._normTags.split(' ').filter(Boolean);
    p._descTokens = p._normDesc.split(' ').filter(Boolean);

    p._searchIndexed = true;
    return p;
}

/**
 * Evalúa matemáticamente la relevancia de un producto respecto a un query de búsqueda.
 * Retorna un puntaje numérico (score) y metadatos de coincidencia.
 */
export function scoreProduct(product, queryStr) {
    const rawQuery = normalizeText(queryStr);
    if (!rawQuery) return { score: 0, isExactMatch: false, coverage: 0 };

    const qTokens = rawQuery.split(' ').filter(Boolean);
    if (!qTokens.length) return { score: 0, isExactMatch: false, coverage: 0 };

    // Indexar si aún no fue indexado
    const p = product._searchIndexed ? product : indexProduct(product);

    let score = 0;
    let exactPhrase = false;

    // Bonificación por coincidencia de frase exacta en el título
    if (p._normName === rawQuery) {
        score += 150;
        exactPhrase = true;
    } else if (p._normName.startsWith(rawQuery)) {
        score += 110;
        exactPhrase = true;
    } else if (p._normName.includes(rawQuery)) {
        score += 85;
        exactPhrase = true;
    }

    let matchedTokens = 0;
    let exactMatches = 0;

    for (const q of qTokens) {
        let bestTokenScore = 0;
        let isExact = false;

        // 1. Título del producto (peso 40)
        for (const t of p._nameTokens) {
            const sim = calculateWordSimilarity(q, t);
            if (sim > 0) {
                const s = sim * 40;
                if (s > bestTokenScore) {
                    bestTokenScore = s;
                    if (sim >= 0.99) isExact = true;
                }
            }
        }

        // 2. Marca (peso 30)
        for (const t of p._brandTokens) {
            const sim = calculateWordSimilarity(q, t);
            if (sim > 0) {
                const s = sim * 30;
                if (s > bestTokenScore) {
                    bestTokenScore = s;
                    if (sim >= 0.99) isExact = true;
                }
            }
        }

        // 3. Etiquetas / Tags (peso 25)
        for (const t of p._tagTokens) {
            const sim = calculateWordSimilarity(q, t);
            if (sim > 0) {
                const s = sim * 25;
                if (s > bestTokenScore) {
                    bestTokenScore = s;
                    if (sim >= 0.99) isExact = true;
                }
            }
        }

        // 4. Categoría y Subcategoría (peso 20)
        for (const t of p._catTokens) {
            const sim = calculateWordSimilarity(q, t);
            if (sim > 0) {
                const s = sim * 20;
                if (s > bestTokenScore) {
                    bestTokenScore = s;
                    if (sim >= 0.99) isExact = true;
                }
            }
        }

        // 5. Descripción (peso 10)
        for (const t of p._descTokens) {
            const sim = calculateWordSimilarity(q, t);
            if (sim > 0) {
                const s = sim * 10;
                if (s > bestTokenScore) {
                    bestTokenScore = s;
                    if (sim >= 0.99) isExact = true;
                }
            }
        }

        if (bestTokenScore >= 6) {
            matchedTokens++;
            score += bestTokenScore;
            if (isExact) exactMatches++;
        }
    }

    // Cobertura de palabras clave
    const coverage = matchedTokens / qTokens.length;
    if (coverage === 1.0) {
        score *= 1.4; // Bonificación de 40% si todas las palabras de la consulta fueron encontradas
    } else {
        score *= (coverage * 0.7); // Penalización si solo coinciden algunas palabras
        if (qTokens.length >= 3 && matchedTokens < 2) {
            score *= 0.2; // Fuerte filtro para evitar ruido si el usuario buscó 3+ términos y solo coincidió 1
        }
    }

    // Bonificación menor para productos disponibles en stock
    if ((p.stock || 0) > 0) score += 5;

    const finalScore = Math.round(score * 10) / 10;
    const isExactMatch = exactPhrase || (exactMatches === qTokens.length && coverage === 1.0);

    return {
        score: finalScore,
        coverage,
        exactMatches,
        matchedTokens,
        totalTokens: qTokens.length,
        isExactMatch
    };
}

/**
 * Ejecuta la búsqueda sobre una lista de productos y clasifica los resultados.
 */
export function searchCatalog(products, queryStr, options = {}) {
    const {
        minScore = 12,
        limit = null,
        statusFilter = 'active'
    } = options;

    if (!queryStr || !queryStr.trim()) {
        return {
            results: products,
            exactMatches: products,
            similarMatches: [],
            hasExact: true,
            totalFound: products.length
        };
    }

    const scoredList = [];
    const exactList = [];
    const similarList = [];

    for (let i = 0; i < products.length; i++) {
        const p = products[i];
        if (statusFilter && p.status !== statusFilter) continue;

        const meta = scoreProduct(p, queryStr);
        if (meta.score >= minScore) {
            p._searchScore = meta.score;
            p._searchMeta = meta;

            scoredList.push({ product: p, meta });
            if (meta.isExactMatch || meta.score >= 45) {
                exactList.push(p);
            } else {
                similarList.push(p);
            }
        }
    }

    // Ordenar de mayor a menor relevancia matemática
    scoredList.sort((a, b) => b.meta.score - a.meta.score);

    let finalProducts = scoredList.map(item => item.product);
    if (limit && limit > 0) {
        finalProducts = finalProducts.slice(0, limit);
    }

    return {
        results: finalProducts,
        exactMatches: exactList,
        similarMatches: similarList,
        hasExact: exactList.length > 0,
        totalFound: finalProducts.length
    };
}
