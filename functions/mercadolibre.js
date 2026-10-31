// functions/mercadolibre.js
const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

async function getMLConfig(db, storeDocName = 'mercadolibre') {
    let appId, clientSecret, redirectUri;

    const isStore2 = (storeDocName === 'mercadolibre_store2' || storeDocName === '2' || storeDocName === 2);
    const isStore3 = (storeDocName === 'mercadolibre_store3' || storeDocName === '3' || storeDocName === 3);

    if (isStore2) {
        appId = process.env.ML_APP_ID_2;
        clientSecret = process.env.ML_CLIENT_SECRET_2;
        redirectUri = process.env.ML_REDIRECT_URI_2;
    } else if (isStore3) {
        appId = process.env.ML_APP_ID_3;
        clientSecret = process.env.ML_CLIENT_SECRET_3;
        redirectUri = process.env.ML_REDIRECT_URI_3;
    } else {
        appId = process.env.ML_APP_ID;
        clientSecret = process.env.ML_CLIENT_SECRET;
        redirectUri = process.env.ML_REDIRECT_URI;
    }

    try {
        // 1. Verificar si están guardados directamente en el documento de la tienda (config/mercadolibre_store2, etc.)
        const storeSnap = await db.collection('config').doc(storeDocName).get();
        if (storeSnap.exists) {
            const sData = storeSnap.data();
            if (sData.appId || sData.ML_APP_ID) appId = sData.appId || sData.ML_APP_ID;
            if (sData.clientSecret || sData.ML_CLIENT_SECRET) clientSecret = sData.clientSecret || sData.ML_CLIENT_SECRET;
            if (sData.redirectUri || sData.ML_REDIRECT_URI) redirectUri = sData.redirectUri || sData.ML_REDIRECT_URI;
        }

        // 2. Verificar config/developer
        const devConfigDoc = await db.collection('config').doc('developer').get();
        if (devConfigDoc.exists) {
            const devData = devConfigDoc.data();
            if (isStore2) {
                if (devData.ML_APP_ID_2) appId = devData.ML_APP_ID_2;
                if (devData.ML_CLIENT_SECRET_2) clientSecret = devData.ML_CLIENT_SECRET_2;
                if (devData.ML_REDIRECT_URI_2) redirectUri = devData.ML_REDIRECT_URI_2;
            } else if (isStore3) {
                if (devData.ML_APP_ID_3) appId = devData.ML_APP_ID_3;
                if (devData.ML_CLIENT_SECRET_3) clientSecret = devData.ML_CLIENT_SECRET_3;
                if (devData.ML_REDIRECT_URI_3) redirectUri = devData.ML_REDIRECT_URI_3;
            } else {
                if (devData.ML_APP_ID) appId = devData.ML_APP_ID;
                if (devData.ML_CLIENT_SECRET) clientSecret = devData.ML_CLIENT_SECRET;
                if (devData.ML_REDIRECT_URI) redirectUri = devData.ML_REDIRECT_URI;
            }
        }
    } catch (err) {
        console.error(`Error reading ML config for ${storeDocName} from Firestore:`, err);
    }
    return { appId, clientSecret, redirectUri };
}

async function getMLToken(db, storeDocName = 'mercadolibre') {
    try {
        const docRef = db.collection('config').doc(storeDocName);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            const data = docSnap.data();
            if (data && (data.accessToken || data.access_token)) return data.accessToken || data.access_token;
        }
    } catch (e) {
        console.error(`Error obteniendo token para ${storeDocName}:`, e);
    }
    return null;
}

/**
 * RENOVACIÓN AUTOMÁTICA DE TOKEN DE MERCADOLIBRE VENCIDO
 */
async function refreshMLAccessToken(db, storeDocName = 'mercadolibre') {
    const mlConfig = await getMLConfig(db, storeDocName);
    const docRef = db.collection('config').doc(storeDocName);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new Error(`Falta configuración de ${storeDocName} en DB`);
    const data = docSnap.data();
    let refreshToken = data.refreshToken || data.refresh_token;

    if (!refreshToken) {
        const devDoc = await db.collection('config').doc('developer').get();
        if (devDoc.exists) {
            const devData = devDoc.data();
            if (storeDocName === 'mercadolibre_store2') refreshToken = devData.ML_REFRESH_TOKEN_2 || devData.refreshToken_2;
            else if (storeDocName === 'mercadolibre_store3') refreshToken = devData.ML_REFRESH_TOKEN_3 || devData.refreshToken_3;
            else refreshToken = devData.ML_REFRESH_TOKEN || devData.refreshToken;
        }
    }

    if (!refreshToken) throw new Error(`No hay refreshToken guardado para ${storeDocName}`);

    console.log(` Renovando token de acceso vencido para ${storeDocName}...`);

    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: mlConfig.appId,
            client_secret: mlConfig.clientSecret,
            refresh_token: refreshToken
        })
    });

    const tokenData = await res.json();
    if (res.ok && tokenData.access_token) {
        console.log(` Token de ${storeDocName} renovado exitosamente.`);
        const tokenPayload = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || refreshToken,
            userId: tokenData.user_id || data.userId || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await docRef.set(tokenPayload, { merge: true });
        
        if (storeDocName === 'mercadolibre') {
            await db.collection('config').doc('developer').set({
                ML_ACCESS_TOKEN: tokenData.access_token,
                ML_REFRESH_TOKEN: tokenData.refresh_token || refreshToken,
                ML_USER_ID: tokenData.user_id || null
            }, { merge: true });
        } else if (storeDocName === 'mercadolibre_store2') {
            await db.collection('config').doc('developer').set({
                ML_ACCESS_TOKEN_2: tokenData.access_token,
                ML_REFRESH_TOKEN_2: tokenData.refresh_token || refreshToken,
                ML_USER_ID_2: tokenData.user_id || null
            }, { merge: true });
        } else if (storeDocName === 'mercadolibre_store3') {
            await db.collection('config').doc('developer').set({
                ML_ACCESS_TOKEN_3: tokenData.access_token,
                ML_REFRESH_TOKEN_3: tokenData.refresh_token || refreshToken,
                ML_USER_ID_3: tokenData.user_id || null
            }, { merge: true });
        }
        return tokenData.access_token;
    } else {
        console.error(` Error al renovar token de ${storeDocName}:`, tokenData);
        throw new Error(`Error renovando token ML (${storeDocName}): ${JSON.stringify(tokenData)}`);
    }
}

// Función auxiliar para hacer peticiones a la API de MercadoLibre con auto-renovación si vence el token (401)
// Función auxiliar para hacer peticiones a la API de MercadoLibre con auto-renovación si vence el token (401)
async function fetchML(endpoint, token, db = null, storeDocName = 'mercadolibre') {
    const cleanEndpoint = String(endpoint || '').trim().startsWith('/') ? String(endpoint).trim() : `/${String(endpoint || '').trim()}`;
    try {
        const response = await fetch(`https://api.mercadolibre.com${cleanEndpoint}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if ((response.status === 401 || response.statusText === 'Unauthorized') && db) {
            console.log(`[ML] Token 401 Unauthorized detectado en ${cleanEndpoint}. Renovando token automaticamente...`);
            const newToken = await refreshMLAccessToken(db, storeDocName);
            const retryRes = await fetch(`https://api.mercadolibre.com${cleanEndpoint}`, {
                headers: { Authorization: `Bearer ${newToken}` }
            });
            if (!retryRes.ok) throw new Error(`Error en API ML (Reintento): ${retryRes.statusText} (${retryRes.status})`);
            return await retryRes.json();
        }

        if (!response.ok) {
            let errorDetails = response.statusText;
            try {
                const errJson = await response.json();
                if (errJson && (errJson.message || errJson.error)) {
                    errorDetails = errJson.message || errJson.error;
                }
            } catch (_) {}
            throw new Error(`Error en API ML: ${response.statusText} (${response.status}) - ${errorDetails}`);
        }
        return await response.json();
    } catch (err) {
        if (err.message && err.message.includes('Unauthorized') && db) {
            console.log(`[ML] Capturado error Unauthorized en catch. Intentando renovar token...`);
            const newToken = await refreshMLAccessToken(db, storeDocName);
            const retryRes = await fetch(`https://api.mercadolibre.com${cleanEndpoint}`, {
                headers: { Authorization: `Bearer ${newToken}` }
            });
            if (!retryRes.ok) throw new Error(`Error en API ML (Reintento): ${retryRes.statusText} (${retryRes.status})`);
            return await retryRes.json();
        }
        throw err;
    }
}

/**
 * BUSCADOR INTELIGENTE DE PRODUCTOS EN EL CATÁLOGO
 */
const normalizeCode = (val) => val ? String(val).trim().toUpperCase().replace(/[\s\-_]/g, '') : '';
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";

async function findProductInStore(db, item) {
    if (!item || !item.item) return null;

    const candidateCodes = [
        item.item.seller_sku,
        item.item.seller_custom_field,
        item.item.id,
        item.item.variation_id
    ].filter(Boolean).map(c => String(c).trim());

    if (Array.isArray(item.item.attributes)) {
        for (const attr of item.item.attributes) {
            const id = (attr.id || attr.name || '').toUpperCase();
            if (id.includes('EAN') || id.includes('GTIN') || id.includes('SKU') || id.includes('BARCODE') || id.includes('SELLER_SKU')) {
                if (attr.value_name) candidateCodes.push(String(attr.value_name).trim());
            }
        }
    }

    const normCandidateCodes = candidateCodes.map(c => normalizeCode(c)).filter(Boolean);
    const itemTitle = normalizeText(item.item.title || '');

    // Extraer atributos de variante (color / capacidad / SKU) si existen
    let varColor = '';
    let varCapacity = '';
    if (Array.isArray(item.item.variation_attributes)) {
        for (const va of item.item.variation_attributes) {
            const id = (va.id || va.name || '').toUpperCase();
            if (id.includes('EAN') || id.includes('GTIN') || id.includes('SKU') || id.includes('BARCODE') || id.includes('SELLER_SKU')) {
                if (va.value_name) candidateCodes.push(String(va.value_name).trim());
            }
            const name = (va.name || '').toLowerCase();
            if (name.includes('color')) varColor = normalizeText(va.value_name || '');
            if (name.includes('capacidad') || name.includes('tamaño') || name.includes('almacenamiento') || name.includes('memoria')) {
                varCapacity = normalizeText(va.value_name || '');
            }
        }
    }

    // 1. Consulta rápida por códigos directos en Firestore
    for (const rawCode of candidateCodes) {
        const upperCode = rawCode.toUpperCase();
        for (const field of ['sku', 'ean', 'barcode', 'ref', 'code', 'mlItemId']) {
            const q = await db.collection('products').where(field, '==', upperCode).limit(1).get();
            if (!q.empty) {
                const pDoc = q.docs[0];
                const pData = pDoc.data();
                const img = pData.mainImage || pData.image || (Array.isArray(pData.images) && pData.images[0]) || "";

                if (Array.isArray(pData.combinations) && pData.combinations.length > 0) {
                    let matchedVarIdx = -1;
                    for (let cIdx = 0; cIdx < pData.combinations.length; cIdx++) {
                        const comb = pData.combinations[cIdx];
                        const combCodes = [comb.sku, comb.ean, comb.barcode, comb.ref, comb.code, comb.mlVariationId].filter(Boolean).map(normalizeCode);
                        if (normCandidateCodes.some(nc => combCodes.includes(nc))) {
                            matchedVarIdx = cIdx;
                            break;
                        }
                    }
                    if (matchedVarIdx < 0 && (varColor || varCapacity)) {
                        for (let cIdx = 0; cIdx < pData.combinations.length; cIdx++) {
                            const comb = pData.combinations[cIdx];
                            const cColor = normalizeText(comb.color || '');
                            const cCap = normalizeText(comb.capacity || '');
                            if ((!varColor || cColor === varColor) && (!varCapacity || cCap === varCapacity)) {
                                matchedVarIdx = cIdx;
                                break;
                            }
                        }
                    }
                    if (matchedVarIdx < 0 && pData.combinations.length === 1) {
                        matchedVarIdx = 0;
                    }

                    if (matchedVarIdx >= 0) {
                        const comb = pData.combinations[matchedVarIdx];
                        return {
                            docId: pDoc.id,
                            isVariant: true,
                            variantIndex: matchedVarIdx,
                            name: pData.name || pData.title || item.item.title,
                            sku: comb.sku || pData.sku || rawCode,
                            color: comb.color || "",
                            capacity: comb.capacity || "",
                            image: comb.image || img,
                            productData: pData
                        };
                    }
                }

                return { 
                    docId: pDoc.id, 
                    isVariant: false, 
                    name: pData.name || pData.title || item.item.title,
                    sku: pData.sku || rawCode,
                    image: img, 
                    productData: pData 
                };
            }
        }
    }

    // 2. Traer todos los productos para escaneo profundo de combinaciones y normalización
    const allProdsSnap = await db.collection('products').get();
    let nameMatchFallback = null;

    for (const doc of allProdsSnap.docs) {
        const pData = doc.data();
        const pId = doc.id;
        const pImg = pData.mainImage || pData.image || (Array.isArray(pData.images) && pData.images[0]) || "";
        const pName = pData.name || pData.title || '';
        const pNameNorm = normalizeText(pName);

        // A. Revisar combinaciones / variantes
        if (Array.isArray(pData.combinations) && pData.combinations.length > 0) {
            for (let idx = 0; idx < pData.combinations.length; idx++) {
                const comb = pData.combinations[idx];
                const combCodes = [comb.sku, comb.ean, comb.barcode, comb.ref, comb.code, comb.mlVariationId].filter(Boolean).map(normalizeCode);
                
                // Coincidencia por código de variante
                if (normCandidateCodes.some(nc => combCodes.includes(nc))) {
                    const cImg = comb.image || pImg;
                    return {
                        docId: pId,
                        isVariant: true,
                        variantIndex: idx,
                        name: pName,
                        sku: comb.sku || pData.sku || '',
                        color: comb.color || "",
                        capacity: comb.capacity || "",
                        image: cImg,
                        productData: pData
                    };
                }

                // Coincidencia por color/capacidad si el nombre del producto coincide
                if (itemTitle && pNameNorm && (itemTitle.includes(pNameNorm) || pNameNorm.includes(itemTitle))) {
                    const cColorNorm = normalizeText(comb.color || '');
                    const cCapNorm = normalizeText(comb.capacity || '');
                    const colorMatches = varColor ? (cColorNorm === varColor) : (!cColorNorm || itemTitle.includes(cColorNorm));
                    const capMatches = varCapacity ? (cCapNorm === varCapacity) : (!cCapNorm || itemTitle.includes(cCapNorm));
                    if (colorMatches && capMatches) {
                        const cImg = comb.image || pImg;
                        return {
                            docId: pId,
                            isVariant: true,
                            variantIndex: idx,
                            name: pName,
                            sku: comb.sku || pData.sku || '',
                            color: comb.color || "",
                            capacity: comb.capacity || "",
                            image: cImg,
                            productData: pData
                        };
                    }
                }
            }
        }

        // B. Revisar códigos del producto raíz normalizados
        const rootCodes = [pData.sku, pData.ean, pData.barcode, pData.ref, pData.code, pData.mlItemId].filter(Boolean).map(normalizeCode);
        if (normCandidateCodes.some(nc => rootCodes.includes(nc))) {
            return { 
                docId: pId, 
                isVariant: false, 
                name: pName, 
                sku: pData.sku || '', 
                image: pImg, 
                productData: pData 
            };
        }

        // C. Fallback por coincidencia de nombre
        if (itemTitle && pNameNorm) {
            if (itemTitle === pNameNorm) {
                return { 
                    docId: pId, 
                    isVariant: false, 
                    name: pName, 
                    sku: pData.sku || '', 
                    image: pImg, 
                    productData: pData 
                };
            }
            const itemHasPack = itemTitle.includes('pack') || itemTitle.includes('kit') || itemTitle.includes('unidades');
            const prodHasPack = pNameNorm.includes('pack') || pNameNorm.includes('kit') || pNameNorm.includes('unidades');
            if (itemHasPack === prodHasPack && (itemTitle.includes(pNameNorm) || pNameNorm.includes(itemTitle))) {
                if (!nameMatchFallback) {
                    nameMatchFallback = { 
                        docId: pId, 
                        isVariant: false, 
                        name: pName, 
                        sku: pData.sku || '', 
                        image: pImg, 
                        productData: pData 
                    };
                }
            }
        }
    }

    if (nameMatchFallback) {
        return nameMatchFallback;
    }

    return null;
}

async function findProductByEAN(db, eanToFind) {
    return findProductInStore(db, { item: { seller_sku: eanToFind } });
}

/**
 * OBTENER COSTO DE ENVÍO VENDEDOR DESDE API SHIPMENTS DE MERCADOLIBRE
 */
async function getMLShipmentCost(shippingId, token, db = null, storeDocName = 'mercadolibre') {
    if (!shippingId || !token) return 0;
    try {
        // 1. Prioridad: Consultar el endpoint oficial de desglose de costos (/shipments/{id}/costs)
        try {
            const costsData = await fetchML(`/shipments/${shippingId}/costs`, token, db, storeDocName);
            if (costsData) {
                if (Array.isArray(costsData.senders) && costsData.senders.length > 0) {
                    const sender = costsData.senders[0];
                    if (typeof sender.cost === 'number') {
                        console.log(` [${storeDocName}] Costo oficial Vendedor ML desde /costs (${shippingId}): $${sender.cost}`);
                        return Math.max(0, Math.round(sender.cost));
                    }
                }
                if (costsData.receiver && typeof costsData.receiver.cost === 'number' && costsData.receiver.cost > 0 && (!costsData.senders || costsData.senders.length === 0)) {
                    console.log(` [${storeDocName}] Envío asumido totalmente por el comprador (${shippingId}): Costo Vendedor = $0`);
                    return 0;
                }
            }
        } catch (costsErr) {
            // Continuar con fallback detallado si /costs no está disponible
        }

        // 2. Fallback a la información general del envío (/shipments/{id})
        const sData = await fetchML(`/shipments/${shippingId}`, token, db, storeDocName);
        if (sData) {
            if (sData.logistic_type === 'self_service') {
                console.log(` Envío Flex detectado (${shippingId}): Costo Vendedor ML = $0`);
                return 0;
            }

            // Si el envío no es gratuito para el comprador y fue pagado por él
            if (sData.shipping_option) {
                const isFreeForBuyer = sData.shipping_option.free_shipping || false;
                if (!isFreeForBuyer && (!sData.cost_components || sData.cost_components.length === 0)) {
                    console.log(` Envío a cargo del comprador (${shippingId}): Costo Vendedor ML = $0`);
                    return 0;
                }
            }

            let cost = 0;
            if (sData.shipping_option) {
                if (typeof sData.shipping_option.list_cost === 'number' && sData.shipping_option.list_cost > 0) {
                    cost = sData.shipping_option.list_cost;
                } else if (typeof sData.shipping_option.base_cost === 'number' && sData.shipping_option.base_cost > 0) {
                    cost = sData.shipping_option.base_cost;
                } else if (typeof sData.shipping_option.cost === 'number' && sData.shipping_option.cost > 0) {
                    cost = sData.shipping_option.cost;
                }
            }
            if (!cost && typeof sData.list_cost === 'number' && sData.list_cost > 0) cost = sData.list_cost;
            if (!cost && typeof sData.base_cost === 'number' && sData.base_cost > 0) cost = sData.base_cost;
            if (!cost && sData.snapshot && typeof sData.snapshot.cost === 'number' && sData.snapshot.cost > 0) cost = sData.snapshot.cost;
            if (!cost && typeof sData.cost === 'number' && sData.cost > 0) cost = sData.cost;

            console.log(` Costo de Envío Vendedor ML (${shippingId}): $${cost}`);
            return Number(cost) || 0;
        }
    } catch (err) {
        console.error("Error obteniendo shipment cost de ML:", err);
    }
    return 0;
}

function extractMLShippingBonus(orderData, rawShipment = null) {
    let mlShippingBonus = 0;

    if (Array.isArray(orderData.payments)) {
        for (const p of orderData.payments) {
            if (p.status === 'approved') {
                if (typeof p.shipping_cost === 'number' && p.shipping_cost < 0) {
                    mlShippingBonus += Math.abs(Math.round(p.shipping_cost));
                }
                if (Array.isArray(p.fee_details)) {
                    for (const fd of p.fee_details) {
                        const feeType = (fd.fee_type || fd.type || '').toLowerCase();
                        if (feeType.includes('bonus') || feeType.includes('bonific') || feeType.includes('subsidy') || feeType.includes('rebate')) {
                            mlShippingBonus += Math.abs(Math.round(Number(fd.amount) || 0));
                        }
                    }
                }
            }
        }
    }

    if (orderData.shipping && typeof orderData.shipping.shipping_bonus === 'number' && orderData.shipping.shipping_bonus > 0) {
        if (orderData.shipping.shipping_bonus > mlShippingBonus) {
            mlShippingBonus = Math.round(orderData.shipping.shipping_bonus);
        }
    }

    if (rawShipment && rawShipment.logistic_type === 'self_service') {
        let flexBonus = 0;
        if (typeof rawShipment.shipping_bonus === 'number' && rawShipment.shipping_bonus > 0) {
            flexBonus = rawShipment.shipping_bonus;
        } else if (typeof rawShipment.base_cost === 'number' && rawShipment.shipping_option?.list_cost) {
            flexBonus = Math.max(0, rawShipment.base_cost - rawShipment.shipping_option.list_cost);
        } else if (typeof rawShipment.base_cost === 'number' && rawShipment.base_cost > 0) {
            flexBonus = rawShipment.base_cost;
        }
        if (flexBonus > mlShippingBonus) {
            mlShippingBonus = Math.round(flexBonus);
        }
    }

    return Math.round(mlShippingBonus);
}

/**
 * EXTRAER IMPUESTOS Y RETENCIONES REALES DE LA ORDEN DE MERCADOLIBRE
 */
function getMLTaxesAmount(orderData) {
    let totalTaxes = 0;

    if (orderData.taxes) {
        if (typeof orderData.taxes.amount === 'number' && orderData.taxes.amount > 0) {
            totalTaxes += orderData.taxes.amount;
        } else if (Array.isArray(orderData.taxes)) {
            for (const t of orderData.taxes) {
                totalTaxes += Number(t.amount || t.value || t.tax_amount) || 0;
            }
        }
    }

    if (!totalTaxes && typeof orderData.taxes_amount === 'number' && orderData.taxes_amount > 0) {
        totalTaxes = orderData.taxes_amount;
    }
    if (!totalTaxes && typeof orderData.withholding_taxes === 'number' && orderData.withholding_taxes > 0) {
        totalTaxes = orderData.withholding_taxes;
    }

    if (Array.isArray(orderData.payments)) {
        let paymentTaxes = 0;
        for (const p of orderData.payments) {
            if (p.status === 'approved') {
                const pType = (p.payment_type || '').toLowerCase();
                const paidAmt = Number(p.total_paid_amount) || Number(p.transaction_amount) || Number(orderData.total_amount) || 0;

                let reportedTax = 0;
                if (typeof p.taxes_amount === 'number' && p.taxes_amount > 0) {
                    reportedTax = p.taxes_amount;
                } else if (Array.isArray(p.taxes)) {
                    for (const pt of p.taxes) {
                        reportedTax += Number(pt.amount || pt.value || pt.tax_amount) || 0;
                    }
                }
                if (Array.isArray(p.fee_details)) {
                    for (const fd of p.fee_details) {
                        const feeType = (fd.fee_type || fd.type || '').toLowerCase();
                        if (feeType.includes('tax') || feeType.includes('retencion') || feeType.includes('withholding') || feeType.includes('ica') || feeType.includes('fuente')) {
                            reportedTax += Number(fd.amount) || 0;
                        }
                    }
                }

                if ((pType === 'debit_card' || pType === 'credit_card') && paidAmt > 0) {
                    const calculatedTax = Math.round(paidAmt * 0.01913975279);
                    paymentTaxes += Math.max(reportedTax, calculatedTax);
                } else {
                    paymentTaxes += reportedTax;
                }
            }
        }
        if (paymentTaxes > totalTaxes) {
            totalTaxes = paymentTaxes;
        }
    }

    return Math.round(totalTaxes);
}

function getMLFeeAmount(orderData) {
    let itemsFee = 0;
    if (Array.isArray(orderData.order_items)) {
        for (const item of orderData.order_items) {
            let itemFee = Number(item.sale_fee) || Number(item.fee_amount) || 0;

            if (itemFee === 0 && item.unit_price) {
                const qty = Number(item.quantity) || 1;
                const itemTotal = (Number(item.unit_price) || 0) * qty;
                const listingType = String(item.listing_type_id || item.item?.listing_type_id || '').toLowerCase();

                let rate = 0;
                if (listingType.includes('pro') || listingType.includes('premium')) {
                    rate = 0.165; // Premium 16.5% en Colombia
                } else if (listingType.includes('gold') || listingType.includes('special') || listingType.includes('clasica')) {
                    rate = 0.12; // Clásica 12% en Colombia
                } else if (itemTotal > 0) {
                    rate = 0.12;
                }

                if (rate > 0) {
                    itemFee = Math.round(itemTotal * rate);
                    if (Number(item.unit_price) < 90000) {
                        itemFee += (2800 * qty);
                    }
                }
            }

            if (itemFee > 0) itemsFee += itemFee;
        }
    }

    let paymentsFee = 0;
    const payments = Array.isArray(orderData.payments) ? orderData.payments : (orderData.id ? [orderData] : []);
    for (const p of payments) {
        if (p.status === 'approved' || !p.status) {
            let paymentFee = Number(p.marketplace_fee) || 0;

            if (Array.isArray(p.fee_details)) {
                for (const fd of p.fee_details) {
                    const feeType = (fd.fee_type || fd.type || '').toLowerCase();
                    if (
                        feeType.includes('mercadolibre') || 
                        feeType.includes('marketplace') || 
                        feeType.includes('fee') || 
                        feeType.includes('comision') || 
                        feeType.includes('cargo') || 
                        feeType.includes('sale')
                    ) {
                        if (
                            !feeType.includes('tax') && 
                            !feeType.includes('retencion') && 
                            !feeType.includes('withholding') && 
                            !feeType.includes('bonus') && 
                            !feeType.includes('bonific') && 
                            !feeType.includes('subsidy') && 
                            !feeType.includes('rebate')
                        ) {
                            paymentFee += Number(fd.amount) || 0;
                        }
                    }
                }
            }

            if (Array.isArray(p.charges_details)) {
                for (const cd of p.charges_details) {
                    const name = (cd.name || cd.type || '').toLowerCase();
                    if (name.includes('fee') || name.includes('mercadolibre') || name.includes('comision') || name.includes('cargo')) {
                        if (!name.includes('tax') && !name.includes('retencion') && !name.includes('withholding')) {
                            const amt = Number(cd.amounts?.original) || Number(cd.amount) || 0;
                            paymentFee += amt;
                        }
                    }
                }
            }

            if (paymentFee > paymentsFee) paymentsFee = paymentFee;
        }
    }

    return Math.round(Math.max(itemsFee, paymentsFee));
}

/**
 * Detectar si una orden o envio fue cancelado en MercadoLibre o si el comprador solicito cancelacion
 */
function isOrderCancelled(orderData, rawShipment) {
    if (!orderData) return false;

    // 1. Estado oficial de la orden
    if (orderData.status === 'cancelled') return true;

    // 2. Detalle de cancelacion presente (solicitud de comprador o ML)
    if (orderData.cancel_detail && (orderData.cancel_detail.requested_by || orderData.cancel_detail.code || orderData.cancel_detail.date)) {
        return true;
    }

    // 3. Etiquetas de cancelacion o reclamo
    if (Array.isArray(orderData.tags)) {
        if (orderData.tags.includes('cancelled') || 
            orderData.tags.includes('cancellation_requested') || 
            orderData.tags.includes('cancellation_requested_by_buyer')) {
            return true;
        }
    }

    // 4. Estado del envio cancelado en Mercado Envios
    if (rawShipment) {
        if (rawShipment.status === 'cancelled' || rawShipment.substatus === 'cancelled') return true;
        if (rawShipment.status_history?.date_cancelled != null) return true;
    }

    // 5. Peticion de cambio / devolucion / cancelacion en order_request
    if (orderData.order_request && (orderData.order_request.change?.status === 'requested' || orderData.order_request.return?.status === 'requested')) {
        return true;
    }

    return false;
}

/**
 * EXTRAER INFORMACIÓN COMPLETA Y CONFIABLE DEL COMPRADOR Y ENVÍO USANDO LA ESTRUCTURA OFICIAL ML
 */
function extractMLBuyerInfo(orderData, shipment, billingInfo = null) {
    const buyer = orderData.buyer || {};

    const destination = shipment?.destination || {};
    const destAddress = destination?.shipping_address || shipment?.receiver_address || {};
    const billing = billingInfo?.billing_info || orderData.billing_info || orderData.billing || {};

    // 1. NOMBRE COMPLETO DEL DESTINATARIO
    let name = "";
    if (billing.name && billing.name.trim().length > 0) {
        name = billing.name.trim();
    } else if (billing.legal_name && billing.legal_name.trim().length > 0) {
        name = billing.legal_name.trim();
    } else if (destination.receiver_name && destination.receiver_name.trim().length > 0) {
        name = destination.receiver_name.trim();
    } else if (shipment?.receiver_address?.receiver_name) {
        name = shipment.receiver_address.receiver_name.trim();
    } else if (buyer.first_name || buyer.last_name) {
        name = `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim();
    }
    if (!name && buyer.nickname) {
        name = buyer.nickname.trim();
    }
    if (!name) {
        name = `Cliente MercadoLibre (${buyer.id || 'S/N'})`;
    }

    // 2. TELÉFONO DE CONTACTO
    let phone = "";
    if (destination.receiver_phone && String(destination.receiver_phone).trim().length > 0) {
        phone = String(destination.receiver_phone).trim();
    } else if (destAddress.phone && String(destAddress.phone).trim().length > 0) {
        phone = String(destAddress.phone).trim();
    } else if (buyer.phone?.number) {
        phone = `${buyer.phone.area_code || ''} ${buyer.phone.number}`.trim();
    }

    // 3. DOCUMENTO (CÉDULA / NIT / PASAPORTE)
    let doc = "";
    const buyerIdent = billing.doc_number || 
                       billing.identification?.number || 
                       buyer.identification?.number || 
                       orderData.buyer?.identification?.number || 
                       buyer.billing_info?.doc_number || 
                       orderData.billing?.doc_number;
    
    if (buyerIdent && String(buyerIdent).trim().length > 0) {
        doc = String(buyerIdent).trim();
    } else if (destination.receiver_id && String(destination.receiver_id).trim().length > 0 && String(destination.receiver_id) !== String(buyer.id)) {
        doc = String(destination.receiver_id).trim();
    } else if (buyer.id) {
        doc = String(buyer.id);
    }

    let cleanPhoneDigits = phone.replace(/\D/g, '');
    let cleanDocDigits = doc.replace(/\D/g, '');
    if (cleanDocDigits && cleanPhoneDigits && cleanDocDigits === cleanPhoneDigits) {
        doc = buyerIdent ? String(buyerIdent).trim() : String(buyer.id || '');
    }

    // 4. EMAIL
    let email = buyer.email || "";

    // 5. DIRECCIÓN DE ENVÍO Y UBICACIÓN
    let address = "Acordar con el vendedor";
    if (destAddress.address_line && destAddress.address_line.trim().length > 0) {
        address = destAddress.address_line.trim();
        if (destAddress.comment) address += `, ${destAddress.comment.trim()}`;
        if (destAddress.neighborhood?.name) address += `, ${destAddress.neighborhood.name.trim()}`;
    } else if (destAddress.street_name) {
        let parts = [destAddress.street_name, destAddress.street_number, destAddress.comment, destAddress.neighborhood?.name].filter(Boolean);
        address = parts.join(', ');
    }

    // 6. CIUDAD Y DEPARTAMENTO
    let city = destAddress.city?.name || "";
    let department = destAddress.state?.name || "";

    return {
        name,
        doc,
        phone,
        email,
        address,
        city,
        department,
        guideNumber: shipment?.tracking_number || "Pendiente",
        carrier: shipment?.tracking_method || "MercadoEnvíos"
    };
}

/**
 * BUSCAR Y ENLAZAR CÉDULA REAL DEL CLIENTE SI MERCADOLIBRE NO LA TRAJO
 */
async function enrichBuyerDocumentFromUsers(db, buyerInfo, rawBuyerId, storeTitle = 'MercadoLibre', orderId = '') {
    if (!buyerInfo) return;
    const currentDoc = (buyerInfo.doc || '').trim();
    const isPlaceholder = !currentDoc || currentDoc === String(rawBuyerId || '').trim();

    if (isPlaceholder) {
        if (buyerInfo.phone) {
            const cleanP = buyerInfo.phone.replace(/\D/g, '');
            if (cleanP.length >= 7) {
                try {
                    const uQuery = await db.collection('users').where('phone', '==', cleanP).limit(1).get();
                    if (!uQuery.empty && uQuery.docs[0].data().document) {
                        const foundDoc = String(uQuery.docs[0].data().document).trim();
                        if (foundDoc) {
                            buyerInfo.doc = foundDoc;
                            console.log(` [${storeTitle}] Cédula real recuperada por teléfono para ${orderId}: ${foundDoc}`);
                            return;
                        }
                    }
                } catch (uqErr) {}
            }
        }
        if (buyerInfo.email && !buyerInfo.email.includes('@mail.mercadolibre.com')) {
            try {
                const uQuery = await db.collection('users').where('email', '==', buyerInfo.email.trim().toLowerCase()).limit(1).get();
                if (!uQuery.empty && uQuery.docs[0].data().document) {
                    const foundDoc = String(uQuery.docs[0].data().document).trim();
                    if (foundDoc) {
                        buyerInfo.doc = foundDoc;
                        console.log(` [${storeTitle}] Cédula real recuperada por email para ${orderId}: ${foundDoc}`);
                    }
                }
            } catch (ueErr) {}
        }
    }
}

// ============================================================================
// 1. FACTORY DE WEBHOOK DE MERCADOLIBRE (TIENDAS 1, 2 Y 3)
// ============================================================================
function createWebhookHandler({
    storeDocName = 'mercadolibre',
    storeNumber = 1,
    orderPrefix = 'ML-',
    source = 'MERCADOLIBRE',
    paymentMethod = 'MERCADOLIBRE',
    storeTitle = 'MercadoLibre'
} = {}) {
    return async (req, res) => {
        const db = admin.firestore();

        try {
            // --- AUTO-VINCULACIÓN OAUTH POR CÓDIGO DE AUTORIZACIÓN (?code=...) ---
            const authCode = req.query.code;
            if (authCode) {
                console.log(` Código de autorización ${storeTitle} recibido:`, authCode);
                const mlConfig = await getMLConfig(db, storeDocName);
                const rawHost = req.get('host') || '';
                const protocol = rawHost.includes('localhost') ? 'http' : 'https';

                let cleanPath = (req.path || '').replace(/\/+$/, '');
                let redirectUri = req.query.redirect_uri || mlConfig.redirectUri || `${protocol}://${rawHost}${cleanPath}`;

                console.log(` Usando redirect_uri para canje de token (${storeTitle}): ${redirectUri}`);

                const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
                    method: "POST",
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        grant_type: "authorization_code",
                        client_id: mlConfig.appId,
                        client_secret: mlConfig.clientSecret,
                        code: authCode,
                        redirect_uri: redirectUri
                    })
                });

                const tokenData = await tokenRes.json();
                if (tokenRes.ok && tokenData.access_token) {
                    const tokenPayload = {
                        accessToken: tokenData.access_token,
                        refreshToken: tokenData.refresh_token,
                        userId: tokenData.user_id,
                        storeNumber: storeNumber,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    };

                    await db.collection('config').doc(storeDocName).set(tokenPayload, { merge: true });

                    const devUpdates = {};
                    if (storeNumber === 2) {
                        devUpdates.ML_ACCESS_TOKEN_2 = tokenData.access_token;
                        devUpdates.ML_REFRESH_TOKEN_2 = tokenData.refresh_token;
                        devUpdates.ML_USER_ID_2 = tokenData.user_id;
                    } else if (storeNumber === 3) {
                        devUpdates.ML_ACCESS_TOKEN_3 = tokenData.access_token;
                        devUpdates.ML_REFRESH_TOKEN_3 = tokenData.refresh_token;
                        devUpdates.ML_USER_ID_3 = tokenData.user_id;
                    } else {
                        devUpdates.ML_ACCESS_TOKEN = tokenData.access_token;
                        devUpdates.ML_REFRESH_TOKEN = tokenData.refresh_token;
                        devUpdates.ML_USER_ID = tokenData.user_id;
                    }
                    await db.collection('config').doc('developer').set(devUpdates, { merge: true });

                    return res.status(200).send(`
                        <div style="font-family:sans-serif; text-align:center; padding:60px 20px; background:#f9fafb; min-height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                            <div style="background:white; padding:40px; border-radius:24px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); max-width:480px; border:1px solid #e5e7eb;">
                                <div style="font-size:48px; margin-bottom:16px;"></div>
                                <h1 style="color:#10B981; margin:0 0 12px 0; font-size:24px; font-weight:800;">¡${storeTitle} Vinculado Exitosamente!</h1>
                                <p style="color:#4b5563; font-size:14px; line-height:1.6; margin-bottom:24px;">La aplicación ha guardado los tokens de acceso y la sincronización de inventario por SKU y pedidos en tiempo real para <strong>${storeTitle}</strong> está activa.</p>
                                <span style="background:#ecfdf5; color:#047857; padding:8px 16px; border-radius:12px; font-weight:700; font-size:12px; display:inline-block;">ID Usuario ML: ${tokenData.user_id}</span>
                            </div>
                        </div>
                    `);
                } else {
                    console.error(`[ML] Error al canjear codigo ${storeTitle}:`, tokenData);
                    return res.status(400).send(`Error al canjear codigo de ${storeTitle}: ${JSON.stringify(tokenData)}`);
                }
            }

            const topic = req.body.topic || req.query.topic;
            let rawResource = req.body.resource || req.query.resource; 
            
            const validTopics = ['orders_v2', 'orders', 'packs', 'shipments', 'claims'];
            if (topic && !validTopics.includes(topic)) return res.status(200).send("OK: Ignored topic");
            if (!rawResource) return res.status(200).send("OK: Missing resource");

            let resource = String(rawResource).trim();
            if (/^\d+$/.test(resource)) {
                if (topic === 'packs') resource = `/packs/${resource}`;
                else if (topic === 'shipments') resource = `/shipments/${resource}`;
                else if (topic === 'claims') resource = `/claims/${resource}`;
                else resource = `/orders/${resource}`;
            } else if (!resource.startsWith('/')) {
                resource = `/${resource}`;
            }

            console.log(`[ML] Notificacion de ${storeTitle} recibida: topic=${topic || 'none'}, resource=${resource}`);

            const mlConfigDoc = await db.collection('config').doc(storeDocName).get();
            if (!mlConfigDoc.exists) throw new Error(`Falta configuracion de ${storeDocName} en DB`);
            const ML_TOKEN = mlConfigDoc.data().accessToken || mlConfigDoc.data().access_token;

            let orderData = null;
            let actualResource = resource;
            let preloadedShipment = null;

            if (actualResource.startsWith('/shipments/')) {
                console.log(`[ML] Notificacion de envio recibida (${actualResource}). Consultando detalles del envio para obtener orden asociada...`);
                try {
                    preloadedShipment = await fetchML(actualResource, ML_TOKEN, db, storeDocName);
                    let targetOrderId = preloadedShipment.order_id || (Array.isArray(preloadedShipment.orders) && preloadedShipment.orders[0]?.id);
                    let targetPackId = preloadedShipment.pack_id;
                    if (!targetOrderId && Array.isArray(preloadedShipment.shipping_items) && preloadedShipment.shipping_items[0]?.order_id) {
                        targetOrderId = preloadedShipment.shipping_items[0].order_id;
                    }

                    if (targetPackId) {
                        actualResource = `/packs/${targetPackId}`;
                        orderData = await fetchML(actualResource, ML_TOKEN, db, storeDocName);
                    } else if (targetOrderId) {
                        actualResource = `/orders/${targetOrderId}`;
                        orderData = await fetchML(actualResource, ML_TOKEN, db, storeDocName);
                    } else {
                        console.warn(`[ML] Envio ${actualResource} no contiene order_id ni pack_id.`);
                        return res.status(200).send("OK: Shipment has no linked order");
                    }
                } catch (sErr) {
                    console.error(`[ML] Error resolviendo orden desde envio ${actualResource}:`, sErr);
                    throw sErr;
                }
            } else if (actualResource.startsWith('/claims/')) {
                console.log(`[ML] Notificacion de reclamo/cancelacion recibida (${actualResource}). Consultando detalles del reclamo...`);
                try {
                    const claimData = await fetchML(actualResource, ML_TOKEN, db, storeDocName);
                    const targetOrderId = claimData.resource_id || claimData.order_id;
                    if (targetOrderId) {
                        actualResource = `/orders/${targetOrderId}`;
                        orderData = await fetchML(actualResource, ML_TOKEN, db, storeDocName);
                    } else {
                        console.warn(`[ML] Reclamo ${actualResource} no contiene resource_id ni order_id.`);
                        return res.status(200).send("OK: Claim has no linked order");
                    }
                } catch (cErr) {
                    console.error(`[ML] Error resolviendo orden desde reclamo ${actualResource}:`, cErr);
                    throw cErr;
                }
            } else {
                try {
                    orderData = await fetchML(actualResource, ML_TOKEN, db, storeDocName);
                } catch (fetchErr) {
                    if (actualResource.startsWith('/orders/') && String(fetchErr.message || '').includes('Not Found')) {
                        const fallbackPackResource = actualResource.replace('/orders/', '/packs/');
                        console.log(`[ML] Recurso ${actualResource} no encontrado en /orders/. Probando fallback como paquete: ${fallbackPackResource}`);
                        try {
                            orderData = await fetchML(fallbackPackResource, ML_TOKEN, db, storeDocName);
                            actualResource = fallbackPackResource;
                        } catch (packErr) {
                            throw fetchErr;
                        }
                    } else {
                        throw fetchErr;
                    }
                }
            }

            const processSingleMLOrder = async (orderData, currentResource, responseObj = null, initialShipment = null) => {
                const sendOk = (msg) => {
                    if (responseObj && !responseObj.headersSent) {
                        return responseObj.status(200).send(msg);
                    }
                    return msg;
                };

                const rawOrderId = String(orderData.id);
                const orderId = `${orderPrefix}${rawOrderId}`;

                console.log(`[ML] RAW ML ORDER JSON (${orderId}):`, JSON.stringify(orderData));

                let rawShipment = initialShipment;
                if (!rawShipment && orderData.shipping && orderData.shipping.id) {
                    try {
                        rawShipment = await fetchML(`/shipments/${orderData.shipping.id}`, ML_TOKEN, db, storeDocName);
                        console.log(` RAW ML SHIPMENT JSON (${orderId}):`, JSON.stringify(rawShipment));
                    } catch (e) {
                        console.error(`Error obteniendo shipment para ${orderId}:`, e);
                    }
                }

                try {
                    await db.collection('ml_debug_logs').doc(orderId).set({
                        orderId: orderId,
                        store: storeNumber,
                        storeDocName: storeDocName,
                        orderData: orderData,
                        rawShipment: rawShipment,
                        receivedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                } catch (dbgErr) {
                    console.error("Error al guardar log de depuracion en ml_debug_logs:", dbgErr);
                }

                const orderCheck = await db.collection('orders').doc(orderId).get();
                if (orderCheck.exists) {
                    const existingOrder = orderCheck.data();
                    const isCancelled = isOrderCancelled(orderData, rawShipment);

                    if (isCancelled && existingOrder.status !== 'CANCELADO') {
                        if (existingOrder.cancellationConfirmed) {
                            return sendOk("OK: Cancellation already confirmed");
                        }
                        if (existingOrder.status === 'CANCELACION_PENDIENTE' && existingOrder.cancellationPendingConfirm) {
                            return sendOk("OK: Already marked for cancellation confirmation");
                        }
                        console.log(`[ML] Orden de ${storeTitle} ${orderId} fue cancelada en MercadoLibre. Marcando CANCELACION_PENDIENTE para confirmar retencion en bodega (estado previo: ${existingOrder.status || 'PENDIENTE'}).`);
                        
                        const cancelReason = orderData.cancel_detail?.requested_by 
                            ? `Cancelado por ${orderData.cancel_detail.requested_by} en MercadoLibre (${orderData.cancel_detail.description || orderData.cancel_detail.code || 'Solicitud de comprador'})` 
                            : (rawShipment?.status === 'cancelled' 
                                ? 'Envio cancelado en MercadoLibre' 
                                : 'Cancelado por el comprador o plataforma en MercadoLibre');

                        await db.collection('orders').doc(orderId).update({
                            status: 'CANCELACION_PENDIENTE',
                            cancellationPendingConfirm: true,
                            mlCancelled: true,
                            mlStatus: orderData.status || 'cancelled',
                            shippingStatus: rawShipment?.status || existingOrder.shippingStatus || 'cancelled',
                            cancellationRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
                            cancellationReason: cancelReason,
                            cancellationPreviousStatus: existingOrder.status || 'PENDIENTE',
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });

                        return sendOk("OK: Marked for cancellation confirmation");
                    }

                const isFullOrder = Boolean(
                    (rawShipment && rawShipment.logistic_type === 'fulfillment') ||
                    (orderData.shipping && orderData.shipping.logistic_type === 'fulfillment') ||
                    (Array.isArray(orderData.tags) && orderData.tags.includes('fulfillment'))
                );
                const orderIsFull = isFullOrder || Boolean(existingOrder.isFull || existingOrder.isMlFull || existingOrder.logisticType === 'fulfillment');

                let billingInfo = null;
                try {
                    billingInfo = await fetchML(`/orders/${orderData.id}/billing_info`, ML_TOKEN, db, storeDocName);
                } catch (bErr) {}

                const buyerInfo = extractMLBuyerInfo(orderData, rawShipment, billingInfo);
                await enrichBuyerDocumentFromUsers(db, buyerInfo, orderData.buyer?.id, storeTitle, orderId);

                let grossTotal = Math.round(Number(orderData.total_amount) || 0);
                if (grossTotal === 0 && Array.isArray(orderData.order_items)) {
                    for (const item of orderData.order_items) {
                        grossTotal += Math.round((Number(item.unit_price) || 0) * (Number(item.quantity) || 1));
                    }
                }

                let sellerShippingCost = 0;
                if (orderData.shipping && orderData.shipping.id) {
                    sellerShippingCost = await getMLShipmentCost(orderData.shipping.id, ML_TOKEN, db, storeDocName);
                } else if (orderData.shipping && Number(orderData.shipping.cost) > 0) {
                    sellerShippingCost = Math.round(Number(orderData.shipping.cost));
                }

                let mlShippingBonus = extractMLShippingBonus(orderData, rawShipment);
                let mlTaxes = Math.round(getMLTaxesAmount(orderData));
                let mlFee = Math.round(getMLFeeAmount(orderData));

                if (Array.isArray(orderData.payments)) {
                    for (const p of orderData.payments) {
                        if (p.status === 'approved' && p.id) {
                            try {
                                let deepPayment = null;
                                try {
                                    deepPayment = await fetchML(`/collections/${p.id}`, ML_TOKEN, db, storeDocName);
                                } catch (cErr) {
                                    try {
                                        deepPayment = await fetchML(`/v1/payments/${p.id}`, ML_TOKEN, db, storeDocName);
                                    } catch (vErr) {}
                                }
                                if (deepPayment) {
                                    const deepTax = Math.round(getMLTaxesAmount(deepPayment));
                                    if (deepTax > mlTaxes) mlTaxes = deepTax;
                                    const deepFee = Math.round(getMLFeeAmount(deepPayment));
                                    if (deepFee > mlFee) mlFee = deepFee;
                                }
                            } catch (pErr) {}
                        }
                    }
                }

                let netAmount = Math.max(0, Math.round(grossTotal - mlFee - sellerShippingCost - mlTaxes + mlShippingBonus));
                let totalDeductions = Math.max(0, grossTotal - netAmount);

                const oldGross = Number(existingOrder.grossTotal) || Number(existingOrder.total) || 0;
                const oldFee = Number(existingOrder.mlFee) || 0;
                const oldShipping = Number(existingOrder.mlShipping) || 0;
                const oldTaxes = Number(existingOrder.mlTaxes) || 0;
                const oldBonus = Number(existingOrder.mlShippingBonus) || 0;
                const oldNet = Number(existingOrder.netAmount) || Number(existingOrder.total) || 0;

                const hasFinancialDiff = (
                    oldGross !== grossTotal ||
                    oldFee !== mlFee ||
                    oldShipping !== sellerShippingCost ||
                    oldTaxes !== mlTaxes ||
                    oldBonus !== mlShippingBonus ||
                    oldNet !== netAmount
                );

                const hasDocDiff = (buyerInfo.doc && existingOrder.clientDoc !== buyerInfo.doc);
                const hasTrackingDiff = (rawShipment?.tracking_number && existingOrder.trackingNumber !== rawShipment.tracking_number);
                const hasShippingStatusDiff = (rawShipment?.status && existingOrder.shippingStatus !== rawShipment.status);
                const hasFullDiff = orderIsFull && (!existingOrder.isFull || !existingOrder.isMlFull);

                if (hasFinancialDiff || hasDocDiff || hasTrackingDiff || hasShippingStatusDiff || hasFullDiff) {
                    const netDiff = netAmount - oldNet;
                    const priceRatio = grossTotal > 0 ? (netAmount / grossTotal) : 1;

                    let updates = {
                        grossTotal: Math.round(grossTotal),
                        mlFee: Math.round(mlFee),
                        mlShipping: Math.round(sellerShippingCost),
                        mlTaxes: Math.round(mlTaxes),
                        mlShippingBonus: Math.round(mlShippingBonus),
                        netAmount: netAmount,
                        total: netAmount,
                        subtotal: netAmount,
                        amountPaid: netAmount,
                        totalDeductions: totalDeductions,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    };

                    if (orderIsFull) {
                        updates.isFull = true;
                        updates.isMlFull = true;
                        updates.logisticType = 'fulfillment';
                        updates.shippingType = 'FULL';

                        if (rawShipment?.status === 'delivered' && existingOrder.status !== 'ENTREGADO' && existingOrder.status !== 'CANCELADO') {
                            updates.status = 'ENTREGADO';
                            updates.statusDetail = 'ENTREGADO_FULFILLMENT';
                        } else if ((rawShipment?.status === 'shipped' || rawShipment?.status === 'in_transit') && existingOrder.status !== 'DESPACHADO' && existingOrder.status !== 'ENTREGADO' && existingOrder.status !== 'CANCELADO') {
                            updates.status = 'DESPACHADO';
                            updates.statusDetail = 'DESPACHADO_FULFILLMENT';
                        } else if (existingOrder.status === 'PENDIENTE') {
                            updates.status = 'ALISTADO';
                            updates.statusDetail = 'FULFILLMENT_ML';
                        }
                    }

                    if (Array.isArray(existingOrder.items)) {
                        updates.items = existingOrder.items.map(it => {
                            let originalPrice = Number(it.grossPrice);
                            if (!originalPrice || originalPrice <= 0 || (existingOrder.items.length === 1 && originalPrice !== grossTotal)) {
                                originalPrice = (existingOrder.items.length === 1 && grossTotal > 0) ? grossTotal : (Number(it.price) || 0);
                            }
                            const itemNet = (existingOrder.items.length === 1 && netAmount > 0) ? Math.round(netAmount / (Number(it.quantity) || 1)) : Math.round(originalPrice * priceRatio);
                            return {
                                ...it,
                                grossPrice: originalPrice,
                                price: itemNet
                            };
                        });
                    }

                    if (buyerInfo) {
                        if (buyerInfo.doc) updates.clientDoc = buyerInfo.doc;
                        if (buyerInfo.name) updates.clientName = buyerInfo.name;
                        updates.buyerInfo = buyerInfo;
                    }

                    if (rawShipment) {
                        if (rawShipment.tracking_number) updates.trackingNumber = rawShipment.tracking_number;
                        if (rawShipment.status) updates.shippingStatus = rawShipment.status;
                    }

                    await db.collection('orders').doc(orderId).update(updates);

                    const incRef = db.collection('expenses').doc(`INC-${orderId}`);
                    const incSnap = await incRef.get();
                    if (incSnap.exists) {
                        await incRef.update({
                            amount: netAmount,
                            grossAmount: Math.round(grossTotal),
                            deductions: totalDeductions,
                            description: `VENTA ${storeTitle.toUpperCase()} #${orderId}` + (totalDeductions > 0 ? ` (NETO: $${netAmount.toLocaleString('es-CO')})` : ""),
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }

                    if (netDiff !== 0) {
                        const accountCandidates = [
                            paymentMethod,
                            `MercadoLibre ${storeNumber}`,
                            `Mercado Libre ${storeNumber}`,
                            `MercadoLibre Tienda ${storeNumber}`,
                            `Cuenta MercadoLibre ${storeNumber}`,
                            'MercadoLibre',
                            'Mercado Libre',
                            'Cuenta MercadoLibre'
                        ];
                        const accSnap = await db.collection('accounts').where('name', 'in', accountCandidates).limit(1).get();
                        if (!accSnap.empty) {
                            const accDoc = accSnap.docs[0];
                            const curBal = Number(accDoc.data().balance) || 0;
                            await accDoc.ref.update({ balance: curBal + netDiff });
                        }
                    }

                    console.log(`[ML] Orden ${orderId} (${storeTitle}) actualizada automaticamente con nuevos datos de ML (Neto: $${oldNet} -> $${netAmount}, Comision: $${mlFee}).`);
                    return sendOk(`OK: Orden ${orderId} actualizada con nueva informacion.`);
                }

                console.log(`[ML] La orden ${orderId} (${storeTitle}) ya existe en la base de datos y esta al dia.`);
                return sendOk(`OK: La orden ${orderId} ya existe en el sistema y esta al dia.`);
            }

            const packMembershipCheck = await db.collection('orders').where('packOrderIds', 'array-contains', String(orderData.id)).limit(1).get();
            if (!packMembershipCheck.empty) {
                console.log(`[ML] La orden ML #${orderData.id} ya fue consolidada en el paquete ${packMembershipCheck.docs[0].id}.`);
                return sendOk(`OK: La orden ML #${orderData.id} ya fue consolidada previamente.`);
            }

            if (!rawShipment && orderData.shipping && orderData.shipping.id) {
                try {
                    rawShipment = await fetchML(`/shipments/${orderData.shipping.id}`, ML_TOKEN, db, storeDocName);
                } catch (err) {
                    console.log("No se pudo obtener el envio de ML detallado.");
                }
            }

            const isFullOrder = Boolean(
                (rawShipment && rawShipment.logistic_type === 'fulfillment') ||
                (orderData.shipping && orderData.shipping.logistic_type === 'fulfillment') ||
                (Array.isArray(orderData.tags) && orderData.tags.includes('fulfillment'))
            );

            let billingInfo = null;
            try {
                billingInfo = await fetchML(`/orders/${orderData.id}/billing_info`, ML_TOKEN, db, storeDocName);
                console.log(` RAW ML BILLING INFO (${orderId}):`, JSON.stringify(billingInfo));
            } catch (bErr) {
                console.log(`Info: No se pudo consultar billing_info de la orden ${orderData.id}:`, bErr.message);
            }

            const buyerInfo = extractMLBuyerInfo(orderData, rawShipment, billingInfo);
            await enrichBuyerDocumentFromUsers(db, buyerInfo, orderData.buyer?.id, storeTitle, orderId);

            const userDocId = buyerInfo.doc ? `DOC-${buyerInfo.doc}` : `${orderPrefix}${orderData.buyer?.id || 'CLIENTE'}`;
            const userRef = db.collection('users').doc(userDocId);
            let userId = userDocId;

            const existingUserSnap = await userRef.get();
            if (existingUserSnap.exists) {
                const existingUser = existingUserSnap.data();
                let userUpdates = {};
                if (!existingUser.document && buyerInfo.doc) userUpdates.document = buyerInfo.doc;
                if (!existingUser.phone && buyerInfo.phone) userUpdates.phone = buyerInfo.phone;
                if (!existingUser.address && buyerInfo.address) userUpdates.address = buyerInfo.address;
                if (!existingUser.city && buyerInfo.city) userUpdates.city = buyerInfo.city;
                if (!existingUser.dept && buyerInfo.department) userUpdates.dept = buyerInfo.department;
                if (!existingUser.email && buyerInfo.email) userUpdates.email = buyerInfo.email;
                if (Object.keys(userUpdates).length > 0) {
                    await userRef.update(userUpdates);
                }
            } else {
                await userRef.set({
                    name: buyerInfo.name,
                    document: buyerInfo.doc || "",
                    phone: buyerInfo.phone || "",
                    email: buyerInfo.email || "",
                    source: source,
                    role: 'client',
                    address: buyerInfo.address || "",
                    city: buyerInfo.city || "",
                    dept: buyerInfo.department || "",
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }

            let grossTotal = Math.round(Number(orderData.total_amount) || 0);
            if (grossTotal === 0 && Array.isArray(orderData.order_items)) {
                for (const item of orderData.order_items) {
                    grossTotal += Math.round((Number(item.unit_price) || 0) * (Number(item.quantity) || 1));
                }
            }

            let sellerShippingCost = 0;
            if (orderData.shipping && orderData.shipping.id) {
                sellerShippingCost = await getMLShipmentCost(orderData.shipping.id, ML_TOKEN, db, storeDocName);
            } else if (orderData.shipping && Number(orderData.shipping.cost) > 0) {
                sellerShippingCost = Math.round(Number(orderData.shipping.cost));
            }

            let mlShippingBonus = extractMLShippingBonus(orderData, rawShipment);
            let mlTaxes = Math.round(getMLTaxesAmount(orderData));
            let mlFee = Math.round(getMLFeeAmount(orderData));

            if (Array.isArray(orderData.payments)) {
                for (const p of orderData.payments) {
                    if (p.status === 'approved' && p.id) {
                        try {
                            let deepPayment = null;
                            try {
                                deepPayment = await fetchML(`/collections/${p.id}`, ML_TOKEN, db, storeDocName);
                            } catch (cErr) {
                                try {
                                    deepPayment = await fetchML(`/v1/payments/${p.id}`, ML_TOKEN, db, storeDocName);
                                } catch (vErr) {}
                            }
                            if (deepPayment) {
                                console.log(` DEEP PAYMENT JSON (${p.id}):`, JSON.stringify(deepPayment));
                                const deepTax = Math.round(getMLTaxesAmount(deepPayment));
                                if (deepTax > mlTaxes) mlTaxes = deepTax;
                                
                                const deepFee = Math.round(getMLFeeAmount(deepPayment));
                                if (deepFee > mlFee) mlFee = deepFee;
                            }
                        } catch (pErr) {
                            console.log(`Info: No se pudo consultar detalles extendidos del pago ${p.id}:`, pErr.message);
                        }
                    }
                }
            }

            let netAmount = Math.max(0, Math.round(grossTotal - mlFee - sellerShippingCost - mlTaxes + mlShippingBonus));
            let totalDeductions = Math.max(0, grossTotal - netAmount);
            const priceRatio = grossTotal > 0 ? (netAmount / grossTotal) : 1;

            let dbItems = [];
            let itemsToDeduct = [];
            const orderItemsList = Array.isArray(orderData.order_items) ? orderData.order_items : [];
            
            for (const item of orderItemsList) {
                const mlEAN = item.item ? item.item.seller_sku : null; 
                const qty = Number(item.quantity) || 1;
                
                const foundProduct = await findProductInStore(db, item);

                if (foundProduct) {
                    itemsToDeduct.push({ ...foundProduct, qty });
                }

                let grossItemPrice = Number(item.unit_price) || 0;
                let netItemPrice = Math.round(grossItemPrice * priceRatio);
                let itemImage = (foundProduct && foundProduct.image) ? foundProduct.image : (item.item?.thumbnail || item.item?.picture_url || "");
                let itemSku = (foundProduct && foundProduct.sku) ? foundProduct.sku : (mlEAN ? String(mlEAN) : "");

                const dbItemObj = {
                    id: foundProduct ? foundProduct.docId : `${orderPrefix}UNKNOWN-${mlEAN || item.item?.id || 'NO_SKU'}`,
                    name: (foundProduct && foundProduct.name) ? foundProduct.name : (item.item?.title || `Producto ${storeTitle}`),
                    price: netItemPrice,
                    quantity: qty,
                    color: (foundProduct && foundProduct.color) ? String(foundProduct.color) : "",
                    capacity: (foundProduct && foundProduct.capacity) ? String(foundProduct.capacity) : "",
                    sku: itemSku,
                    image: itemImage,
                    mainImage: itemImage,
                    thumbnail: itemImage,
                    isLinkedToCatalog: Boolean(foundProduct),
                    originalTitle: item.item?.title || '',
                    mlItemId: item.item?.id ? String(item.item.id) : '',
                    mlVariationId: item.item?.variation_id ? String(item.item.variation_id) : ''
                };

                if (isFullOrder) {
                    dbItemObj.isFull = true;
                    dbItemObj.sns = Array(qty).fill('SIN-SERIAL');
                }

                dbItems.push(dbItemObj);
            }

            let existingPackDocSnap = null;
            if (orderData.pack_id) {
                const packQ = await db.collection('orders').where('pack_id', '==', String(orderData.pack_id)).limit(1).get();
                if (!packQ.empty && packQ.docs[0].id !== orderId) {
                    existingPackDocSnap = packQ.docs[0];
                }
            }
            if (!existingPackDocSnap && orderData.shipping && orderData.shipping.id) {
                const shipQ = await db.collection('orders').where('shippingId', '==', String(orderData.shipping.id)).limit(1).get();
                if (!shipQ.empty && shipQ.docs[0].id !== orderId) {
                    existingPackDocSnap = shipQ.docs[0];
                }
            }

            const rawShipmentId = orderData.shipping && orderData.shipping.id ? String(orderData.shipping.id) : "";

            await db.runTransaction(async (t) => {
                const orderRef = db.collection('orders').doc(orderId);
                const currentOrderDoc = await t.get(orderRef);

                if (currentOrderDoc.exists) {
                    const cod = currentOrderDoc.data();
                    if (cod.isStockDeducted === true && cod.status !== 'CANCELADO') {
                        console.log(` Orden ${orderId} ya procesada concurrentemente. Evitando descuento duplicado.`);
                        return;
                    }
                }

                let freshPackDoc = null;
                if (existingPackDocSnap) {
                    freshPackDoc = await t.get(existingPackDocSnap.ref);
                    if (freshPackDoc.exists) {
                        const fpd = freshPackDoc.data();
                        if (Array.isArray(fpd.packOrderIds) && fpd.packOrderIds.includes(String(orderData.id))) {
                            console.log(` Orden ML #${orderData.id} ya existe en paquete ${existingPackDocSnap.id}. Evitando duplicación.`);
                            return;
                        }
                    }
                }

                const accountCandidates = [
                    paymentMethod,
                    `MercadoLibre ${storeNumber}`,
                    `Mercado Libre ${storeNumber}`,
                    `MercadoLibre Tienda ${storeNumber}`,
                    `Cuenta MercadoLibre ${storeNumber}`,
                    'MercadoLibre',
                    'Mercado Libre',
                    'Cuenta MercadoLibre'
                ];
                const accQ = await t.get(db.collection('accounts').where('name', 'in', accountCandidates).limit(1));
                let accDoc = null, accId = null, accName = paymentMethod;
                if (!accQ.empty) {
                    accDoc = accQ.docs[0];
                    accId = accDoc.id;
                    accName = accDoc.data().name || paymentMethod;
                }

                const pDocsMap = new Map();
                for (const p of itemsToDeduct) {
                    if (!pDocsMap.has(p.docId)) {
                        const pRef = db.collection('products').doc(p.docId);
                        const pDoc = await t.get(pRef);
                        if (pDoc.exists) {
                            pDocsMap.set(p.docId, pDoc);
                        }
                    }
                }

                const shouldDeductStock = orderData.status !== 'cancelled';

                if (shouldDeductStock) {
                    if (accDoc) {
                        t.update(accDoc.ref, { balance: (Number(accDoc.data().balance) || 0) + netAmount });
                    }

                    for (const p of itemsToDeduct) {
                        const pDoc = pDocsMap.get(p.docId);
                        if (pDoc) {
                            const pData = pDoc.data();
                            const qty = Number(p.qty) || 1;

                            let rootBranchStock = { ...(pData.branchStock || {}) };
                            let newCombinations = Array.isArray(pData.combinations) ? JSON.parse(JSON.stringify(pData.combinations)) : [];

                            if (p.isVariant && newCombinations.length > 0 && newCombinations[p.variantIndex]) {
                                let combo = newCombinations[p.variantIndex];
                                if (!combo.branchStock) combo.branchStock = {};

                                const branchToDeduct = (isFullOrder && combo.branchStock['full'] !== undefined && Number(combo.branchStock['full']) > 0) ? 'full' : 'bodega';

                                let currentBranchStock = combo.branchStock[branchToDeduct] !== undefined
                                    ? (Number(combo.branchStock[branchToDeduct]) || 0)
                                    : Math.max(0, (Number(combo.stock) || 0) - Object.entries(combo.branchStock).filter(([k]) => k !== branchToDeduct).reduce((s, [, v]) => s + (Number(v) || 0), 0));

                                combo.branchStock[branchToDeduct] = Math.max(0, currentBranchStock - qty);
                                combo.stock = Object.values(combo.branchStock).reduce((s, v) => s + (Number(v) || 0), 0);

                                rootBranchStock = {};
                                newCombinations.forEach(c => {
                                    if (c.branchStock) {
                                        Object.keys(c.branchStock).forEach(bId => {
                                            rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (Number(c.branchStock[bId]) || 0);
                                        });
                                    }
                                });
                            } else if (newCombinations.length > 0) {
                                let bestComboIdx = 0;
                                let maxComboStock = -1;
                                for (let cI = 0; cI < newCombinations.length; cI++) {
                                    const cFullStk = isFullOrder ? (Number(newCombinations[cI].branchStock?.['full']) || 0) : 0;
                                    const cStk = Number(newCombinations[cI].stock) || 0;
                                    const score = cFullStk > 0 ? (cFullStk + 100000) : cStk;
                                    if (score > maxComboStock) {
                                        maxComboStock = score;
                                        bestComboIdx = cI;
                                    }
                                }

                                let combo = newCombinations[bestComboIdx];
                                if (!combo.branchStock) combo.branchStock = {};

                                const branchToDeduct = (isFullOrder && combo.branchStock['full'] !== undefined && Number(combo.branchStock['full']) > 0) ? 'full' : 'bodega';

                                let currentBranchStock = combo.branchStock[branchToDeduct] !== undefined
                                    ? (Number(combo.branchStock[branchToDeduct]) || 0)
                                    : Math.max(0, (Number(combo.stock) || 0) - Object.entries(combo.branchStock).filter(([k]) => k !== branchToDeduct).reduce((s, [, v]) => s + (Number(v) || 0), 0));

                                combo.branchStock[branchToDeduct] = Math.max(0, currentBranchStock - qty);
                                combo.stock = Object.values(combo.branchStock).reduce((s, v) => s + (Number(v) || 0), 0);

                                rootBranchStock = {};
                                newCombinations.forEach(c => {
                                    if (c.branchStock) {
                                        Object.keys(c.branchStock).forEach(bId => {
                                            rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (Number(c.branchStock[bId]) || 0);
                                        });
                                    }
                                });
                            } else {
                                const branchToDeduct = (isFullOrder && rootBranchStock['full'] !== undefined && Number(rootBranchStock['full']) > 0) ? 'full' : 'bodega';

                                let currentBranchStock = rootBranchStock[branchToDeduct] !== undefined
                                    ? (Number(rootBranchStock[branchToDeduct]) || 0)
                                    : Math.max(0, (Number(pData.stock) || 0) - Object.entries(rootBranchStock).filter(([k]) => k !== branchToDeduct).reduce((s, [, v]) => s + (Number(v) || 0), 0));

                                rootBranchStock[branchToDeduct] = Math.max(0, currentBranchStock - qty);
                            }

                            let calculatedGlobalStock = Object.values(rootBranchStock).reduce((s, v) => s + (Number(v) || 0), 0);
                            if (newCombinations.length > 0) {
                                calculatedGlobalStock = newCombinations.reduce((s, c) => s + (Number(c.stock) || 0), 0);
                            }

                            t.update(pDoc.ref, {
                                stock: calculatedGlobalStock,
                                branchStock: rootBranchStock,
                                combinations: newCombinations,
                                lastStockChangeReason: 'VENTA_PEDIDO',
                                lastStockChangeDetails: isFullOrder 
                                    ? `Venta Mercado Envios Full ${storeTitle} pedido #${orderId}`
                                    : `Venta ${storeTitle} pedido #${orderId}`,
                                updatedAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                        }
                    }
                }

                if (existingPackDocSnap) {
                    const epData = freshPackDoc ? freshPackDoc.data() : existingPackDocSnap.data();
                    const combinedItems = [...(epData.items || []), ...dbItems];
                    const combinedGross = (Number(epData.grossTotal) || Number(epData.total) || 0) + grossTotal;
                    const combinedFee = (Number(epData.mlFee) || 0) + mlFee;
                    const combinedTaxes = (Number(epData.mlTaxes) || 0) + mlTaxes;
                    const combinedShipping = Math.max(Number(epData.mlShipping) || 0, sellerShippingCost);
                    const combinedBonus = (Number(epData.mlShippingBonus) || 0) + mlShippingBonus;
                    const combinedNetAmount = Math.max(0, combinedGross - combinedFee - combinedShipping + combinedBonus - combinedTaxes);
                    const combinedDeductions = Math.max(0, combinedGross - combinedNetAmount);

                    t.update(existingPackDocSnap.ref, {
                        items: combinedItems,
                        grossTotal: combinedGross,
                        mlFee: combinedFee,
                        mlTaxes: combinedTaxes,
                        mlShipping: combinedShipping,
                        mlShippingBonus: combinedBonus,
                        netAmount: combinedNetAmount,
                        total: combinedNetAmount,
                        subtotal: combinedNetAmount,
                        amountPaid: combinedNetAmount,
                        totalDeductions: combinedDeductions,
                        isStockDeducted: shouldDeductStock,
                        isFull: Boolean(isFullOrder || epData.isFull || epData.isMlFull),
                        isMlFull: Boolean(isFullOrder || epData.isFull || epData.isMlFull),
                        logisticType: isFullOrder ? 'fulfillment' : (epData.logisticType || 'default'),
                        shippingType: isFullOrder ? 'FULL' : (epData.shippingType || 'STANDARD'),
                        pack_id: orderData.pack_id ? String(orderData.pack_id) : (epData.pack_id || ""),
                        packOrderIds: admin.firestore.FieldValue.arrayUnion(String(orderData.id)),
                        mlValidationCount: 1,
                        mlNeedsSecondValidation: true,
                        mlInitialValidatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        mlSecondValidationScheduledAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
                        mlValidationStatus: 'PENDING_SECOND_VALIDATION',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    if (accId) {
                        const incRef = db.collection('expenses').doc(`INC-${existingPackDocSnap.id}`);
                        t.set(incRef, {
                            amount: combinedNetAmount,
                            grossAmount: combinedGross,
                            deductions: combinedDeductions,
                            description: `VENTA ${storeTitle.toUpperCase()} #${existingPackDocSnap.id} (PAQUETE CONSOLIDADO ${combinedItems.length} ITEMS)`,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }
                } else {
                    if (accId) {
                        const incomeRef = db.collection('expenses').doc(`INC-${orderId}`);
                        t.set(incomeRef, {
                            amount: netAmount,
                            grossAmount: grossTotal,
                            deductions: totalDeductions,
                            category: "Ingreso Ventas Online",
                            description: `VENTA ${storeTitle.toUpperCase()} #${orderData.id}` + (totalDeductions > 0 ? ` (NETO: $${netAmount.toLocaleString('es-CO')})` : ""),
                            paymentMethod: accName, type: 'INCOME', orderId: orderId,
                            supplierName: buyerInfo.name, date: admin.firestore.FieldValue.serverTimestamp(),
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }

                    const isNewOrderCancelled = isOrderCancelled(orderData, rawShipment);
                    const orderInitialStatus = isNewOrderCancelled
                        ? 'CANCELACION_PENDIENTE'
                        : (isFullOrder
                            ? (rawShipment?.status === 'delivered'
                                ? 'ENTREGADO'
                                : (rawShipment?.status === 'shipped' || rawShipment?.status === 'in_transit' ? 'DESPACHADO' : 'ALISTADO'))
                            : 'PENDIENTE');

                    const orderStatusDetail = isNewOrderCancelled
                        ? 'CANCELADO_ML_PENDIENTE_CONFIRMAR'
                        : (isFullOrder
                            ? (rawShipment?.status === 'delivered'
                                ? 'ENTREGADO_FULFILLMENT'
                                : (rawShipment?.status === 'shipped' || rawShipment?.status === 'in_transit' ? 'DESPACHADO_FULFILLMENT' : 'FULFILLMENT_ML'))
                            : 'PENDIENTE_ALISTAMIENTO');

                    const orderRef = db.collection('orders').doc(orderId);
                    t.set(orderRef, {
                        source: source,
                        channel: 'MERCADOLIBRE',
                        origin: 'MERCADOLIBRE',
                        salesChannel: 'MERCADOLIBRE',
                        orderType: 'MERCADOLIBRE',
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        userId: userId,
                        userName: buyerInfo.name,
                        buyerInfo: {
                            name: buyerInfo.name,
                            document: buyerInfo.doc,
                            phone: buyerInfo.phone,
                            email: buyerInfo.email,
                            address: buyerInfo.address,
                            city: buyerInfo.city,
                            department: buyerInfo.department
                        },
                        phone: buyerInfo.phone,
                        clientDoc: buyerInfo.doc,
                        address: buyerInfo.address,
                        city: buyerInfo.city,
                        department: buyerInfo.department,
                        shippingData: {
                            name: buyerInfo.name,
                            clientDoc: buyerInfo.doc,
                            phone: buyerInfo.phone,
                            address: buyerInfo.address,
                            city: buyerInfo.city,
                            department: buyerInfo.department,
                            guideNumber: buyerInfo.guideNumber,
                            carrier: buyerInfo.carrier,
                            shipmentId: rawShipmentId
                        },
                        shippingCarrier: buyerInfo.carrier,
                        shippingTracking: buyerInfo.guideNumber,
                        shippingId: rawShipmentId,
                        pack_id: orderData.pack_id ? String(orderData.pack_id) : "",
                        mlStore: storeNumber,
                        mlOrderId: rawOrderId,
                        items: dbItems,
                        subtotal: netAmount,
                        shippingCost: 0,
                        total: netAmount,
                        amountPaid: netAmount,
                        grossTotal: grossTotal,
                        netAmount: netAmount,
                        mlFee: mlFee,
                        mlShipping: sellerShippingCost,
                        mlShippingBonus: mlShippingBonus,
                        mlTaxes: mlTaxes,
                        status: orderInitialStatus,
                        statusDetail: orderStatusDetail,
                        isFull: isFullOrder,
                        isMlFull: isFullOrder,
                        logisticType: isFullOrder ? 'fulfillment' : (rawShipment?.logistic_type || orderData.shipping?.logistic_type || 'default'),
                        shippingType: isFullOrder ? 'FULL' : (rawShipment?.logistic_type === 'self_service' ? 'FLEX' : 'STANDARD'),
                        cancellationPendingConfirm: isNewOrderCancelled ? true : false,
                        mlCancelled: isNewOrderCancelled ? true : false,
                        cancellationReason: isNewOrderCancelled 
                            ? (orderData.cancel_detail?.requested_by 
                                ? `Cancelado por ${orderData.cancel_detail.requested_by} en MercadoLibre (${orderData.cancel_detail.description || orderData.cancel_detail.code || 'Solicitud de comprador'})` 
                                : (rawShipment?.status === 'cancelled' ? 'Envio cancelado en MercadoLibre' : 'Cancelado por el comprador o plataforma en MercadoLibre')) 
                            : null,
                        cancellationPreviousStatus: 'PENDIENTE',
                        paymentMethod: paymentMethod,
                        paymentStatus: isNewOrderCancelled ? 'REFUNDED' : 'PAID',
                        isStockDeducted: shouldDeductStock,
                        paymentAccountId: accId,
                        mlValidationCount: 1,
                        mlNeedsSecondValidation: true,
                        mlInitialValidatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        mlSecondValidationScheduledAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
                        mlValidationStatus: 'PENDING_SECOND_VALIDATION'
                    });
                }
            });

            // Registrar orden en la cola de validacion secundaria a los 5 minutos
            try {
                await db.collection('ml_pending_revalidations').doc(orderId).set({
                    orderId: orderId,
                    rawOrderId: rawOrderId,
                    storeNumber: storeNumber,
                    storeDocName: storeDocName,
                    scheduledAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
                    status: 'PENDING',
                    attempts: 0,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            } catch (qErr) {
                console.error(`[ML] Error registrando revalidacion secundaria para ${orderId}:`, qErr);
            }

            console.log(`[ML] Orden ${orderId} (${storeTitle}) procesada y guardada correctamente.`);
            return sendOk(`OK: Orden ${orderId} procesada con exito.`);
        };

        const isPack = actualResource.startsWith('/packs/') || 
                       (Array.isArray(orderData.orders) && (!orderData.order_items || orderData.order_items.length === 0));

        if (isPack && Array.isArray(orderData.orders) && orderData.orders.length > 0) {
            console.log(`[ML] Paquete de ordenes detectado (${orderData.id}). Procesando ${orderData.orders.length} sub-orden(es)...`);
            const processedResults = [];
            for (const subItem of orderData.orders) {
                const subOrderId = subItem.id;
                if (!subOrderId) continue;
                try {
                    const subOrderData = await fetchML(`/orders/${subOrderId}`, ML_TOKEN, db, storeDocName);
                    await processSingleMLOrder(subOrderData, `/orders/${subOrderId}`, null, preloadedShipment);
                    processedResults.push(subOrderId);
                } catch (subErr) {
                    console.error(`[ML] Error procesando sub-orden ${subOrderId} de paquete ${orderData.id}:`, subErr);
                }
            }
            return res.status(200).send(`OK: Paquete ${orderData.id} procesado con ${processedResults.length} orden(es): ${processedResults.join(', ')}`);
        }

        // Orden individual
        return await processSingleMLOrder(orderData, actualResource, res, preloadedShipment);

    } catch (error) {
        console.error(`[ML] Error en Webhook de ${storeTitle}:`, error);
        return res.status(500).send(`Error procesando webhook: ${error.message}`);
    }
};
}

// ============================================================================
// 2. HELPER DE AUTO-RENOVACIÓN DE TOKEN EN VIVO
// ============================================================================
async function autoRenewToken(db, configDocName = 'mercadolibre') {
    try {
        const docRef = db.collection('config').doc(configDocName);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return null;

        const data = docSnap.data();
        let currentRefreshToken = data.refreshToken || data.refresh_token;

        if (!currentRefreshToken) {
            const devDoc = await db.collection('config').doc('developer').get();
            if (devDoc.exists) {
                const dData = devDoc.data();
                if (configDocName === 'mercadolibre_store2') {
                    currentRefreshToken = dData.ML_REFRESH_TOKEN_2 || dData.refreshToken_2;
                } else if (configDocName === 'mercadolibre_store3') {
                    currentRefreshToken = dData.ML_REFRESH_TOKEN_3 || dData.refreshToken_3;
                } else {
                    currentRefreshToken = dData.refreshToken || dData.ML_REFRESH_TOKEN;
                }
            }
        }

        if (!currentRefreshToken) return null;

        const mlConfig = await getMLConfig(db, configDocName);
        const response = await fetch("https://api.mercadolibre.com/oauth/token", {
            method: "POST",
            headers: {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: mlConfig.appId,
                client_secret: mlConfig.clientSecret,
                refresh_token: currentRefreshToken
            })
        });

        const result = await response.json();
        if (response.ok && result.access_token) {
            await docRef.set({
                accessToken: result.access_token,
                refreshToken: result.refresh_token,
                userId: result.user_id || data.userId || null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(` Token renovado exitosamente para ${configDocName}`);
            return result.access_token;
        }
    } catch (err) {
        console.error(`Error auto-renovando token de ML para ${configDocName}:`, err);
    }
    return null;
}

// ============================================================================
// 3. FACTORY DE TAREA PROGRAMADA: AUTO-RENOVACIÓN DE TOKEN (CRON JOB)
// ============================================================================
function createRenewTokenTask({
    storeDocName = 'mercadolibre',
    storeNumber = 1,
    storeTitle = 'MercadoLibre'
} = {}) {
    return async () => {
        const db = admin.firestore();
        const docRef = db.collection('config').doc(storeDocName);
        const mlConfig = await getMLConfig(db, storeDocName);
        
        try {
            const docSnap = await docRef.get();
            if (!docSnap.exists) {
                console.error(` Error: No existe el documento config/${storeDocName} en Firestore.`);
                return;
            }

            const data = docSnap.data();
            let currentRefreshToken = data.refreshToken || data.refresh_token;

            if (!currentRefreshToken) {
                const devDoc = await db.collection('config').doc('developer').get();
                if (devDoc.exists) {
                    const dData = devDoc.data();
                    if (storeNumber === 2) currentRefreshToken = dData.ML_REFRESH_TOKEN_2 || dData.refreshToken_2;
                    else if (storeNumber === 3) currentRefreshToken = dData.ML_REFRESH_TOKEN_3 || dData.refreshToken_3;
                    else currentRefreshToken = dData.ML_REFRESH_TOKEN || dData.refreshToken;
                }
            }

            if (!currentRefreshToken) {
                console.error(` Error: No hay refreshToken para ${storeTitle} en la base de datos.`);
                return;
            }

            console.log(` Solicitando nuevo token a ${storeTitle}...`);

            const response = await fetch("https://api.mercadolibre.com/oauth/token", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "content-type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: mlConfig.appId,
                    client_secret: mlConfig.clientSecret,
                    refresh_token: currentRefreshToken
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(`Fallo al renovar ${storeTitle}: ${JSON.stringify(result)}`);
            }

            await docRef.set({
                accessToken: result.access_token,
                refreshToken: result.refresh_token,
                userId: result.user_id || data.userId || null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            if (storeNumber === 2) {
                await db.collection('config').doc('developer').set({
                    ML_ACCESS_TOKEN_2: result.access_token,
                    ML_REFRESH_TOKEN_2: result.refresh_token
                }, { merge: true });
            } else if (storeNumber === 3) {
                await db.collection('config').doc('developer').set({
                    ML_ACCESS_TOKEN_3: result.access_token,
                    ML_REFRESH_TOKEN_3: result.refresh_token
                }, { merge: true });
            } else {
                await db.collection('config').doc('developer').set({
                    ML_ACCESS_TOKEN: result.access_token,
                    ML_REFRESH_TOKEN: result.refresh_token
                }, { merge: true });
            }

            console.log(` Token de ${storeTitle} renovado y guardado con éxito.`);

        } catch (error) {
            console.error(` Error Crítico renovando token de ${storeTitle}:`, error);
        }
    };
}

exports.createWebhookHandler = createWebhookHandler;
exports.createRenewTokenTask = createRenewTokenTask;

// Handlers para Tienda 1 (MercadoLibre Principal)
exports.webhook = createWebhookHandler({
    storeDocName: 'mercadolibre',
    storeNumber: 1,
    orderPrefix: 'ML-',
    source: 'MERCADOLIBRE',
    paymentMethod: 'MERCADOLIBRE',
    storeTitle: 'MercadoLibre'
});

exports.renewTokenTask = createRenewTokenTask({
    storeDocName: 'mercadolibre',
    storeNumber: 1,
    storeTitle: 'MercadoLibre'
});

// ============================================================================
// 4. OBTENER RÓTULO DE DESPACHO EN PDF (Soporta shipmentId y orderId)
// ============================================================================
exports.getLabel = async (req, res) => {
    const db = admin.firestore();
    
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }

    try {
        const orderId = req.query.orderId || req.query.order_id;
        let shipmentId = req.query.shipmentId || req.query.shipment_id;
        let store = req.query.store || "1";

        if (!shipmentId && orderId) {
            const orderSnap = await db.collection('orders').doc(orderId).get();
            if (orderSnap.exists) {
                const oData = orderSnap.data();
                shipmentId = oData.shippingId || oData.shippingData?.shipmentId;
                if (oData.mlStore) store = String(oData.mlStore);
                else if (orderId.startsWith('ML2-') || oData.source === 'MERCADOLIBRE_STORE2' || oData.source === 'MERCADOLIBRE_2') store = "2";
                else if (orderId.startsWith('ML3-') || oData.source === 'MERCADOLIBRE_STORE3' || oData.source === 'MERCADOLIBRE_3') store = "3";
            }
        }

        if (!shipmentId) {
            return res.status(400).send("Error: Falta el shipmentId o el orderId correspondiente.");
        }

        let configDocName = "mercadolibre";
        if (store === "2") configDocName = "mercadolibre_store2";
        else if (store === "3") configDocName = "mercadolibre_store3";

        const mlConfigDoc = await db.collection('config').doc(configDocName).get();
        let ML_TOKEN = (mlConfigDoc.exists && mlConfigDoc.data()) ? (mlConfigDoc.data().accessToken || mlConfigDoc.data().access_token) : null;
        let refreshToken = (mlConfigDoc.exists && mlConfigDoc.data()) ? (mlConfigDoc.data().refreshToken || mlConfigDoc.data().refresh_token) : null;

        const devDoc = await db.collection('config').doc('developer').get();
        const dData = devDoc.exists ? devDoc.data() : {};

        if (!ML_TOKEN) {
            if (store === "2") {
                ML_TOKEN = dData.ML_ACCESS_TOKEN_2 || dData.accessToken_2 || null;
            } else if (store === "3") {
                ML_TOKEN = dData.ML_ACCESS_TOKEN_3 || dData.accessToken_3 || null;
            } else {
                ML_TOKEN = dData.accessToken || dData.ML_ACCESS_TOKEN || null;
            }
        }

        if (!refreshToken) {
            if (store === "2") {
                refreshToken = dData.ML_REFRESH_TOKEN_2 || dData.refreshToken_2 || null;
            } else if (store === "3") {
                refreshToken = dData.ML_REFRESH_TOKEN_3 || dData.refreshToken_3 || null;
            } else {
                refreshToken = dData.refreshToken || dData.ML_REFRESH_TOKEN || null;
            }
        }

        if (!ML_TOKEN && refreshToken) {
            console.log(` Intentando auto-renovar token en vivo para tienda ${store}...`);
            ML_TOKEN = await autoRenewToken(db, configDocName);
        }

        if (!ML_TOKEN) {
            return res.status(500).send(`Error: Falta el token de acceso para la tienda ${store}. Por favor abre la URL de autorización de MercadoLibre para vinculación.`);
        }

        console.log(` Descargando etiqueta ML para envío: ${shipmentId} (Tienda ${store})`);

        const mlUrl = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${shipmentId}&savePdf=Y`;
        let mlResponse = await fetch(mlUrl, {
            headers: {
                "Authorization": `Bearer ${ML_TOKEN}`
            }
        });

        if (mlResponse.status === 401 && refreshToken) {
            console.log(` Token expirado (401), intentando renovar token en vivo para tienda ${store}...`);
            const newToken = await autoRenewToken(db, configDocName);
            if (newToken) {
                mlResponse = await fetch(mlUrl, {
                    headers: { "Authorization": `Bearer ${newToken}` }
                });
            }
        }

        if (!mlResponse.ok) {
            const errText = await mlResponse.text();
            console.error(" Error de MercadoLibre al descargar etiqueta:", errText);
            return res.status(mlResponse.status).send(`Error de MercadoLibre: ${mlResponse.statusText}`);
        }

        const arrayBuffer = await mlResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="rotulo_ml_${shipmentId}.pdf"`);
        return res.status(200).send(buffer);

    } catch (error) {
        console.error(" Error en getLabel:", error);
        return res.status(500).send("Error interno del servidor al obtener el rótulo.");
    }
};

// ============================================================================
// 5. ACTUALIZACIÓN DE STOCK EN MERCADOLIBRE POR SKU
// ============================================================================
async function updateMLStockBySKU(db, storeDocName, sku, newStock) {
    if (!sku) return { success: false, reason: "Sin SKU" };
    const cleanSKU = String(sku).trim();
    if (!cleanSKU || cleanSKU.toUpperCase() === "UNDEFINED" || cleanSKU.toUpperCase() === "NULL") return { success: false, reason: "SKU inválido" };

    try {
        const storeDoc = await db.collection('config').doc(storeDocName).get();
        if (!storeDoc.exists) return { success: false, reason: `Config ${storeDocName} no existe` };

        const storeData = storeDoc.data();
        let currentToken = storeData.accessToken;
        let sellerId = storeData.userId || storeData.user_id;

        if (!currentToken) return { success: false, reason: `Sin token en ${storeDocName}` };

        if (!sellerId) {
            try {
                const me = await fetchML("/users/me", currentToken, db, storeDocName);
                sellerId = me.id;
                await db.collection('config').doc(storeDocName).update({ userId: me.id });
            } catch (e) {
                console.error(`Error obteniendo user_id en ${storeDocName}:`, e);
                return { success: false, reason: "No se pudo resolver seller_id" };
            }
        }

        const searchUrl = `/users/${sellerId}/items/search?seller_sku=${encodeURIComponent(cleanSKU)}`;
        const searchRes = await fetchML(searchUrl, currentToken, db, storeDocName);
        const itemIds = searchRes.results || [];

        if (itemIds.length === 0) {
            return { success: true, updatedCount: 0, note: "SKU no encontrado en publicaciones de ML" };
        }

        let updatedCount = 0;
        const qty = Math.max(0, parseInt(newStock) || 0);

        for (const itemId of itemIds) {
            try {
                const item = await fetchML(`/items/${itemId}`, currentToken, db, storeDocName);

                if (item.variations && item.variations.length > 0) {
                    const matchingVars = item.variations.filter(v => {
                        if (v.seller_custom_field && String(v.seller_custom_field).trim().toUpperCase() === cleanSKU.toUpperCase()) return true;
                        if (v.seller_sku && String(v.seller_sku).trim().toUpperCase() === cleanSKU.toUpperCase()) return true;
                        if (v.attributes && Array.isArray(v.attributes)) {
                            return v.attributes.some(attr => attr.id === 'SELLER_SKU' && String(attr.value_name).trim().toUpperCase() === cleanSKU.toUpperCase());
                        }
                        return false;
                    });

                    for (const v of matchingVars) {
                        if (v.available_quantity !== qty) {
                            let putRes = await fetch(`https://api.mercadolibre.com/items/${itemId}/variations/${v.id}`, {
                                method: 'PUT',
                                headers: {
                                    'Authorization': `Bearer ${currentToken}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ available_quantity: qty })
                            });

                            if (putRes.status === 401) {
                                try {
                                    currentToken = await refreshMLAccessToken(db, storeDocName);
                                    putRes = await fetch(`https://api.mercadolibre.com/items/${itemId}/variations/${v.id}`, {
                                        method: 'PUT',
                                        headers: {
                                            'Authorization': `Bearer ${currentToken}`,
                                            'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({ available_quantity: qty })
                                    });
                                } catch (rErr) {}
                            }

                            if (putRes.ok) {
                                updatedCount++;
                                console.log(` [${storeDocName}] Stock actualizado a ${qty} en item ${itemId} var ${v.id} (SKU: ${cleanSKU})`);
                            } else {
                                const errBody = await putRes.text();
                                console.error(` [${storeDocName}] Error actualizando variación ML ${itemId}/${v.id}:`, errBody);
                            }
                        }
                    }
                } else {
                    if (item.available_quantity !== qty) {
                        let putRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${currentToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ available_quantity: qty })
                        });

                        if (putRes.status === 401) {
                            try {
                                currentToken = await refreshMLAccessToken(db, storeDocName);
                                putRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
                                    method: 'PUT',
                                    headers: {
                                        'Authorization': `Bearer ${currentToken}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ available_quantity: qty })
                                });
                            } catch (rErr) {}
                        }

                        if (putRes.ok) {
                            updatedCount++;
                            console.log(` [${storeDocName}] Stock actualizado a ${qty} en item ${itemId} (SKU: ${cleanSKU})`);
                        } else {
                            const errBody = await putRes.text();
                            console.error(` [${storeDocName}] Error actualizando item simple ML ${itemId}:`, errBody);
                        }
                    }
                }
            } catch (itemErr) {
                console.error(`Error procesando item ${itemId} en ${storeDocName}:`, itemErr);
            }
        }

        return { success: true, updatedCount };
    } catch (err) {
        console.error(`Error en updateMLStockBySKU (${storeDocName}, ${cleanSKU}):`, err);
        return { success: false, reason: err.message };
    }
}

async function syncProductStockToML(db, beforeData, afterData) {
    if (!afterData) return;

    const stores = ['mercadolibre', 'mercadolibre_store2', 'mercadolibre_store3'];
    const skusToSync = [];

    if (afterData.hasVariants && afterData.combinations) {
        const oldCombos = (beforeData && beforeData.combinations) ? beforeData.combinations : [];
        afterData.combinations.forEach((c) => {
            if (c.sku) {
                const newStock = parseInt(c.stock) || 0;
                const oldCombo = oldCombos.find(oc => (oc.sku === c.sku) || (oc.color === c.color && oc.capacity === c.capacity));
                const oldStock = oldCombo ? (parseInt(oldCombo.stock) || 0) : null;

                if (oldStock === null || oldStock !== newStock) {
                    skusToSync.push({ sku: c.sku, stock: newStock });
                }
            }
        });
    } else if (afterData.sku) {
        const newStock = parseInt(afterData.stock) || 0;
        const oldStock = beforeData ? (parseInt(beforeData.stock) || 0) : null;
        if (oldStock === null || oldStock !== newStock) {
            skusToSync.push({ sku: afterData.sku, stock: newStock });
        }
    }

    for (const item of skusToSync) {
        for (const storeDoc of stores) {
            try {
                await updateMLStockBySKU(db, storeDoc, item.sku, item.stock);
            } catch (err) {
                console.error(`Error sync automático ML ${storeDoc} para SKU ${item.sku}:`, err);
            }
        }
    }
}

exports.refreshMLAccessToken = refreshMLAccessToken;
exports.updateMLStockBySKU = updateMLStockBySKU;
exports.syncProductStockToML = syncProductStockToML;

exports.syncAllStockToML = functions.https.onCall(async (data, context) => {
    const db = admin.firestore();
    const stores = ['mercadolibre', 'mercadolibre_store2', 'mercadolibre_store3'];
    
    try {
        const productsSnap = await db.collection('products').get();
        let totalSKUs = 0;
        let totalUpdated = 0;

        for (const docSnap of productsSnap.docs) {
            const p = docSnap.data();
            const skusToSync = [];

            if (p.hasVariants && p.combinations) {
                p.combinations.forEach(c => {
                    if (c.sku) skusToSync.push({ sku: c.sku, stock: parseInt(c.stock) || 0 });
                });
            } else if (p.sku) {
                skusToSync.push({ sku: p.sku, stock: parseInt(p.stock) || 0 });
            }

            for (const item of skusToSync) {
                totalSKUs++;
                for (const storeDoc of stores) {
                    const res = await updateMLStockBySKU(db, storeDoc, item.sku, item.stock);
                    if (res && res.updatedCount) totalUpdated += res.updatedCount;
                }
            }
        }

        return { success: true, totalSKUs, totalUpdated };
    } catch (err) {
        console.error("Error en syncAllStockToML:", err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});

/**
 * VALIDADOR Y SINCRONIZADOR CENTRAL DE ÓRDENES DE MERCADOLIBRE
 * (Soporta validación inicial 1/2, segunda validación 2/2 a los 5 minutos y recalculo bajo demanda)
 */
async function syncAndValidateMLOrder(orderId, db, isSecondValidation = false, manualValues = null) {
    if (!orderId) throw new Error("Falta orderId para validar");
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) throw new Error(`Orden ${orderId} no encontrada`);
    const ord = { id: snap.id, ...snap.data() };

    const currentOrderId = ord.id;
    const storeDoc = (ord.source === 'MERCADOLIBRE_STORE2' || ord.source === 'MERCADOLIBRE_2' || ord.mlStore === 2 || String(currentOrderId).startsWith('ML2-')) 
        ? 'mercadolibre_store2' 
        : ((ord.source === 'MERCADOLIBRE_STORE3' || ord.source === 'MERCADOLIBRE_3' || ord.mlStore === 3 || String(currentOrderId).startsWith('ML3-')) 
            ? 'mercadolibre_store3' 
            : 'mercadolibre');
    const storeLabel = (storeDoc === 'mercadolibre_store2') ? 'MERCADOLIBRE TIENDA 2' : ((storeDoc === 'mercadolibre_store3') ? 'MERCADOLIBRE TIENDA 3' : 'MERCADOLIBRE');

    let buyerInfo = null;
    let gross = Number(ord.grossTotal) || Number(ord.total) || 0;
    let fee = Number(ord.mlFee) || 0;
    let shipping = Number(ord.mlShipping) || 0;
    let taxes = Number(ord.mlTaxes) || 0;
    let bonus = Number(ord.mlShippingBonus) || 0;
    let rawShipment = null;
    let isCancelledInML = false;
    let cancelDetail = null;
    let mlOrderData = null;

    if (manualValues && manualValues.grossTotal !== undefined) {
        gross = Number(manualValues.grossTotal) || gross;
        fee = Number(manualValues.mlFee) || 0;
        shipping = Number(manualValues.mlShipping) || 0;
        taxes = Number(manualValues.mlTaxes) || 0;
        bonus = Number(manualValues.mlShippingBonus) || 0;
    } else {
        const token = await getMLToken(db, storeDoc);
        if (token) {
            try {
                const rawMLId = ord.mlOrderId || ord.id.replace(/^ML3?-/, '').replace(/^ML2?-/, '');
                try {
                    mlOrderData = await fetchML(`/orders/${rawMLId}`, token, db, storeDoc);
                } catch (fetchErr) {
                    if (String(fetchErr.message || '').includes('Not Found')) {
                        try {
                            const packData = await fetchML(`/packs/${rawMLId}`, token, db, storeDoc);
                            if (packData && Array.isArray(packData.orders) && packData.orders.length > 0) {
                                const subId = packData.orders[0].id;
                                mlOrderData = await fetchML(`/orders/${subId}`, token, db, storeDoc);
                            } else {
                                mlOrderData = packData;
                            }
                        } catch (packErr) {
                            throw fetchErr;
                        }
                    } else {
                        throw fetchErr;
                    }
                }
                if (mlOrderData) {
                    if (mlOrderData.status === 'cancelled') {
                        isCancelledInML = true;
                        cancelDetail = mlOrderData.cancel_detail;
                    }
                    gross = Number(mlOrderData.total_amount) || gross;
                    fee = getMLFeeAmount(mlOrderData);
                    taxes = getMLTaxesAmount(mlOrderData);

                    if (mlOrderData.shipping && mlOrderData.shipping.id) {
                        shipping = await getMLShipmentCost(mlOrderData.shipping.id, token, db, storeDoc);
                    }

                    if (Array.isArray(mlOrderData.payments)) {
                        for (const p of mlOrderData.payments) {
                            if (p.status === 'approved' && p.id) {
                                try {
                                    const deepPayment = await fetchML(`/v1/payments/${p.id}`, token, db, storeDoc);
                                    if (deepPayment) {
                                        const deepTax = getMLTaxesAmount(deepPayment);
                                        if (deepTax > taxes) taxes = deepTax;
                                        const deepFee = getMLFeeAmount(deepPayment);
                                        if (deepFee > fee) fee = deepFee;
                                    }
                                } catch (dpErr) {}
                            }
                        }
                    }

                    let billingInfo = null;
                    try {
                        billingInfo = await fetchML(`/orders/${rawMLId}/billing_info`, token, db, storeDoc);
                    } catch (bErr) {}

                    if (mlOrderData.shipping && mlOrderData.shipping.id) {
                        try {
                            rawShipment = await fetchML(`/shipments/${mlOrderData.shipping.id}`, token, db, storeDoc);
                        } catch (sErr) {}
                    }

                    bonus = extractMLShippingBonus(mlOrderData, rawShipment);
                    isCancelledInML = isOrderCancelled(mlOrderData, rawShipment);
                    if (mlOrderData.cancel_detail) cancelDetail = mlOrderData.cancel_detail;

                    const extractedBuyer = extractMLBuyerInfo(mlOrderData, rawShipment, billingInfo);
                    if (extractedBuyer) {
                        await enrichBuyerDocumentFromUsers(db, extractedBuyer, mlOrderData.buyer?.id, storeLabel, currentOrderId);
                        if (extractedBuyer.doc) buyerInfo = extractedBuyer;
                    }
                }
            } catch (mlErr) {
                console.warn(`No se pudo consultar API ML para orden ${currentOrderId}:`, mlErr.message);
            }
        }
    }

    const netAmount = Math.max(0, Math.round(gross - fee - shipping + bonus - taxes));
    const totalDeductions = Math.max(0, Math.round(gross - netAmount));
    const oldNet = Math.round(Number(ord.netAmount) || Number(ord.total) || 0);
    const netDiff = netAmount - oldNet;

    const priceRatio = gross > 0 ? (netAmount / gross) : 1;
    const updatedItems = (ord.items || []).map(item => {
        let originalPrice = Number(item.grossPrice);
        if (!originalPrice || originalPrice <= 0 || ((ord.items || []).length === 1 && originalPrice !== gross)) {
            originalPrice = ((ord.items || []).length === 1 && gross > 0) ? gross : (Number(item.price) || 0);
        }
        const itemNet = ((ord.items || []).length === 1 && netAmount > 0) ? Math.round(netAmount / (Number(item.quantity) || 1)) : Math.round(originalPrice * priceRatio);
        return {
            ...item,
            grossPrice: originalPrice,
            price: itemNet
        };
    });

    let orderUpdates = {
        grossTotal: Math.round(gross),
        mlFee: Math.round(fee),
        mlShipping: Math.round(shipping),
        mlTaxes: Math.round(taxes),
        mlShippingBonus: Math.round(bonus),
        netAmount: netAmount,
        total: netAmount,
        subtotal: netAmount,
        amountPaid: netAmount,
        totalDeductions: totalDeductions,
        items: updatedItems,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (isSecondValidation) {
        orderUpdates.mlValidationCount = 2;
        orderUpdates.mlNeedsSecondValidation = false;
        orderUpdates.mlValidationStatus = 'FULLY_VALIDATED';
        orderUpdates.mlSecondValidatedAt = admin.firestore.FieldValue.serverTimestamp();
        orderUpdates.mlValidationDiff = netDiff;
    }

    if (isCancelledInML && ord.status !== 'CANCELADO' && !ord.cancellationConfirmed) {
        orderUpdates.cancellationPendingConfirm = true;
        orderUpdates.mlCancelled = true;
        orderUpdates.mlStatus = mlOrderData?.status || 'cancelled';
        orderUpdates.cancellationRequestedAt = admin.firestore.FieldValue.serverTimestamp();
        orderUpdates.cancellationReason = cancelDetail?.requested_by 
            ? `Cancelado por ${cancelDetail.requested_by} en MercadoLibre (${cancelDetail.description || cancelDetail.code || 'Solicitud de comprador'})` 
            : (rawShipment?.status === 'cancelled' ? 'Envio cancelado en MercadoLibre' : 'Cancelado por el comprador o plataforma en MercadoLibre');
        orderUpdates.cancellationPreviousStatus = ord.status || 'PENDIENTE';
        orderUpdates.status = 'CANCELACION_PENDIENTE';
    }

    if (buyerInfo) {
        if (buyerInfo.doc) orderUpdates.clientDoc = buyerInfo.doc;
        if (buyerInfo.name) orderUpdates.clientName = buyerInfo.name;
        orderUpdates.buyerInfo = buyerInfo;
    }

    if (rawShipment) {
        if (rawShipment.tracking_number) orderUpdates.shippingTracking = rawShipment.tracking_number;
        if (rawShipment.status) orderUpdates.shippingStatus = rawShipment.status;
    }

    const isFullOrder = Boolean(
        ord.isFull || ord.isMlFull || ord.logisticType === 'fulfillment' ||
        (rawShipment && rawShipment.logistic_type === 'fulfillment') ||
        (mlOrderData?.shipping && mlOrderData.shipping.logistic_type === 'fulfillment') ||
        (Array.isArray(mlOrderData?.tags) && mlOrderData.tags.includes('fulfillment'))
    );

    if (isFullOrder && !isCancelledInML) {
        orderUpdates.isFull = true;
        orderUpdates.isMlFull = true;
        orderUpdates.logisticType = 'fulfillment';
        orderUpdates.shippingType = 'FULL';

        if (rawShipment?.status === 'delivered' && ord.status !== 'ENTREGADO' && ord.status !== 'CANCELADO') {
            orderUpdates.status = 'ENTREGADO';
            orderUpdates.statusDetail = 'ENTREGADO_FULFILLMENT';
        } else if ((rawShipment?.status === 'shipped' || rawShipment?.status === 'in_transit') && ord.status !== 'DESPACHADO' && ord.status !== 'ENTREGADO' && ord.status !== 'CANCELADO') {
            orderUpdates.status = 'DESPACHADO';
            orderUpdates.statusDetail = 'DESPACHADO_FULFILLMENT';
        } else if (ord.status === 'PENDIENTE') {
            orderUpdates.status = 'ALISTADO';
            orderUpdates.statusDetail = 'FULFILLMENT_ML';
        }
    }

    await db.collection('orders').doc(currentOrderId).update(orderUpdates);

    // Actualizar documento de ingreso INC-
    const incRef = db.collection('expenses').doc(`INC-${currentOrderId}`);
    const incSnap = await incRef.get();
    if (incSnap.exists) {
        await incRef.update({
            amount: netAmount,
            grossAmount: Math.round(gross),
            deductions: totalDeductions,
            description: `VENTA ${storeLabel} #${currentOrderId}` + (totalDeductions > 0 ? ` (NETO: $${netAmount.toLocaleString('es-CO')})` : ""),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // Ajustar diferencia contable en accounts
    if (netDiff !== 0) {
        const accName = ord.paymentMethod || (storeDoc === 'mercadolibre_store2' ? 'MercadoLibre 2' : ((storeDoc === 'mercadolibre_store3' ? 'MercadoLibre 3' : 'MercadoLibre')));
        const accountCandidates = [
            accName,
            ord.paymentMethod,
            storeDoc === 'mercadolibre_store2' ? 'MercadoLibre 2' : (storeDoc === 'mercadolibre_store3' ? 'MercadoLibre 3' : 'MercadoLibre'),
            'MercadoLibre',
            'Mercado Libre'
        ].filter(Boolean);
        const accSnap = await db.collection('accounts').where('name', 'in', accountCandidates).limit(1).get();
        if (!accSnap.empty) {
            const accDoc = accSnap.docs[0];
            const curBal = Number(accDoc.data().balance) || 0;
            await accDoc.ref.update({
                balance: curBal + netDiff
            });
        }
    }

    return {
        orderId: currentOrderId,
        grossTotal: Math.round(gross),
        mlFee: Math.round(fee),
        mlShipping: Math.round(shipping),
        mlTaxes: Math.round(taxes),
        mlShippingBonus: Math.round(bonus),
        netAmount: netAmount,
        netDiff: netDiff,
        isSecondValidation,
        clientDoc: buyerInfo?.doc || ord.clientDoc,
        clientName: buyerInfo?.name || ord.clientName
    };
}

/**
 * TAREA PROGRAMADA: REVALIDACIÓN AUTOMÁTICA DE MERCADOLIBRE TRAS 5 MINUTOS (CADA 2 MINUTOS)
 */
exports.revalidatePendingMLOrders = onSchedule({
    schedule: "every 2 minutes",
    timeZone: "America/Bogota"
}, async (event) => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    try {
        const pendingSnap = await db.collection('ml_pending_revalidations')
            .where('status', '==', 'PENDING')
            .limit(50)
            .get();

        const nowMillis = Date.now();
        const dueDocs = pendingSnap.empty ? [] : pendingSnap.docs.filter(docSnap => {
            const item = docSnap.data();
            const sched = item.scheduledAt 
                ? (typeof item.scheduledAt.toMillis === 'function' ? item.scheduledAt.toMillis() : (Number(item.scheduledAt.seconds || 0) * 1000))
                : 0;
            return sched <= nowMillis;
        });

        if (dueDocs.length > 0) {
            console.log(`[ML] Revalidando ${dueDocs.length} ordenes de MercadoLibre pendientes tras 5 minutos...`);

            for (const docSnap of dueDocs) {
                const item = docSnap.data();
                try {
                    const res = await syncAndValidateMLOrder(item.orderId, db, true);
                    console.log(`[ML] Segunda validacion (5 min) exitosa para ${item.orderId}. Dif: $${res.netDiff}`);
                    await docSnap.ref.update({
                        status: 'COMPLETED',
                        completedAt: admin.firestore.FieldValue.serverTimestamp(),
                        netDiff: res.netDiff || 0
                    });
                } catch (err) {
                    console.error(`[ML] Error en segunda validacion para ${item.orderId}:`, err);
                    const currentAttempts = Number(item.attempts) || 0;
                    if (currentAttempts >= 5) {
                        await docSnap.ref.update({
                            status: 'FAILED',
                            error: err.message,
                            failedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    } else {
                        await docSnap.ref.update({
                            attempts: currentAttempts + 1,
                            lastError: err.message,
                            scheduledAt: admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 60 * 1000)
                        });
                    }
                }
            }
        }

        // Barrido directo en orders: Buscar ordenes que aun tengan mlNeedsSecondValidation: true creadas hace mas de 3 minutos
        try {
            const orphanOrdersSnap = await db.collection('orders')
                .where('mlNeedsSecondValidation', '==', true)
                .limit(20)
                .get();

            if (!orphanOrdersSnap.empty) {
                for (const oDoc of orphanOrdersSnap.docs) {
                    const oData = oDoc.data();
                    const createdAtMs = oData.createdAt?.toMillis 
                        ? oData.createdAt.toMillis() 
                        : (Number(oData.createdAt?.seconds || 0) * 1000);

                    if (Date.now() - createdAtMs >= 3 * 60 * 1000) {
                        try {
                            const res = await syncAndValidateMLOrder(oDoc.id, db, true);
                            console.log(`[ML] Revalidacion por barrido directo completada para orden ${oDoc.id}. Dif: $${res.netDiff}`);
                        } catch (orphErr) {
                            console.warn(`[ML] Error en barrido directo para orden ${oDoc.id}:`, orphErr.message);
                        }
                    }
                }
            }
        } catch (sweepErr) {
            console.error("[ML] Error en barrido directo de ordenes pendientes:", sweepErr.message);
        }
    } catch (e) {
        console.error("[ML] Error en revalidatePendingMLOrders:", e);
    }
});

exports.syncAndValidateMLOrder = syncAndValidateMLOrder;

exports.recalcMLOrderFinances = functions.https.onCall(async (data, context) => {
    const db = admin.firestore();
    const orderId = data && data.orderId;
    const manualValues = data && data.manualValues;

    try {
        let ordersToProcess = [];
        if (orderId) {
            const snap = await db.collection('orders').doc(orderId).get();
            if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Orden no encontrada');
            ordersToProcess.push({ id: snap.id, ...snap.data() });
        } else {
            const snap = await db.collection('orders').where('source', 'in', ['MERCADOLIBRE', 'MERCADOLIBRE_STORE2', 'MERCADOLIBRE_2', 'MERCADOLIBRE_STORE3', 'MERCADOLIBRE_3']).get();
            snap.forEach(d => {
                const od = d.data();
                if (!od.mlFee || od.mlFee === 0 || od.mlNeedsSecondValidation) {
                    ordersToProcess.push({ id: d.id, ...od });
                }
            });
        }

        let updatedOrders = [];

        for (const ord of ordersToProcess) {
            try {
                const res = await syncAndValidateMLOrder(ord.id, db, true, manualValues);
                updatedOrders.push(res);
            } catch (itemErr) {
                console.warn(`Error al recalcular orden ${ord.id}:`, itemErr.message);
            }
        }

        return { success: true, processedCount: updatedOrders.length, updatedOrders };
    } catch (err) {
        console.error("Error en recalcMLOrderFinances:", err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});