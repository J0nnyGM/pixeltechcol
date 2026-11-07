// public/js/test-inventory-audit.js
import { db, collection, query, where, orderBy, limit, startAfter, onSnapshot, getDocs, deleteDoc, doc, addDoc, serverTimestamp } from './firebase-init.js';
import { AdminStore } from './admin-store.js';

let auditLogs = [];
let allProducts = [];
let selectedProduct = null;
let currentProdPage = 1;
const PRODS_PER_PAGE = 12;

// Paginación de logs generales
let generalLastDoc = null;
let generalHasMore = true;
let generalIsLoading = false;

// Paginación de logs del producto individual (lotes de 200 bajo solicitud)
const PROD_LOGS_PER_PAGE = 200;
let productLogsState = {
    productId: null,
    allLoadedLogs: [],
    lastDocSnapshot: null,
    hasMoreInFirestore: true,
    currentPage: 1,
    isLoading: false
};

document.addEventListener('DOMContentLoaded', () => {
    initAuditListener();
    initGeneralPaginationEvents();
    initProductsListener();
    initTabsNav();
    initFilterEvents();
    initModalEvents();
});

// ==========================================================================
// 1. ESCUCHAR AUDITORÍA DE INVENTARIO EN TIEMPO REAL
// ==========================================================================
function initAuditListener() {
    const tableBody = document.getElementById('audit-logs-table-body');
    const logsRef = collection(db, "inventory_audit_logs");
    const q = query(logsRef, orderBy("timestamp", "desc"), limit(200));

    onSnapshot(q, (snapshot) => {
        const freshLogs = [];
        snapshot.forEach(docSnap => {
            freshLogs.push({ id: docSnap.id, ...docSnap.data() });
        });

        if (snapshot.docs.length > 0) {
            generalLastDoc = snapshot.docs[snapshot.docs.length - 1];
            generalHasMore = snapshot.docs.length >= 200;
        }

        auditLogs = freshLogs;

        updateStatCards(auditLogs);
        renderAuditLogs();
        updateGeneralLogsInfo();

        // Si el modal de un producto está abierto, sincronizar nuevos logs recibidos
        if (selectedProduct && productLogsState.productId === selectedProduct.id) {
            const freshMatching = auditLogs.filter(l => l.productId === selectedProduct.id);
            let hasNew = false;
            freshMatching.forEach(m => {
                if (!productLogsState.allLoadedLogs.some(existing => existing.id === m.id)) {
                    productLogsState.allLoadedLogs.unshift(m);
                    hasNew = true;
                }
            });
            if (hasNew) {
                renderProductTimeline();
                updateProductBreakdown();
                updateProductPaginationUI();
            }
        }
    }, (error) => {
        console.error("Error escuchando logs de auditoría:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-red-400 font-bold">Error cargando el vigilante de inventario. Verifica las reglas de Firestore.</td></tr>`;
        }
    });
}

function initGeneralPaginationEvents() {
    const btn = document.getElementById('btn-load-more-general');
    if (btn) {
        btn.addEventListener('click', loadMoreGeneralLogs);
    }
}

async function loadMoreGeneralLogs() {
    if (generalIsLoading || !generalHasMore || !generalLastDoc) return;
    generalIsLoading = true;
    const btn = document.getElementById('btn-load-more-general');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...';
    }

    try {
        const logsRef = collection(db, "inventory_audit_logs");
        const q = query(logsRef, orderBy("timestamp", "desc"), startAfter(generalLastDoc), limit(200));
        const snap = await getDocs(q);
        if (!snap.empty) {
            snap.forEach(d => {
                if (!auditLogs.some(existing => existing.id === d.id)) {
                    auditLogs.push({ id: d.id, ...d.data() });
                }
            });
            generalLastDoc = snap.docs[snap.docs.length - 1];
            generalHasMore = snap.docs.length >= 200;
            renderAuditLogs();
            updateStatCards(auditLogs);
        } else {
            generalHasMore = false;
        }
        updateGeneralLogsInfo();
    } catch (err) {
        console.error("Error cargando más logs generales:", err);
    } finally {
        generalIsLoading = false;
        if (btn) {
            btn.disabled = !generalHasMore;
            btn.innerHTML = originalText;
        }
    }
}

function updateGeneralLogsInfo() {
    const info = document.getElementById('general-logs-info');
    const btn = document.getElementById('btn-load-more-general');
    if (info) {
        info.textContent = `Mostrando ${auditLogs.length} logs cargados (${generalHasMore ? 'Lotes de 200 bajo solicitud para cuidar lecturas' : 'Totalidad de registros cargados'})`;
    }
    if (btn) {
        if (!generalHasMore) {
            btn.disabled = true;
            btn.innerHTML = '✅ Todos cargados';
            btn.classList.add('opacity-40');
        } else {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Cargar 200 anteriores (Bajo solicitud)';
            btn.classList.remove('opacity-40');
        }
    }
}

// ==========================================================================
// 2. ESCUCHAR CATÁLOGO DE PRODUCTOS
// ==========================================================================
function initProductsListener() {
    AdminStore.subscribeToProducts((products) => {
        allProducts = products || [];
        renderProductsGrid();
    });
}

// ==========================================================================
// 3. PESTAÑAS Y NAVEGACIÓN
// ==========================================================================
function initTabsNav() {
    const btnLogs = document.getElementById('tab-btn-logs');
    const btnProducts = document.getElementById('tab-btn-products');
    const secLogs = document.getElementById('section-logs');
    const secProducts = document.getElementById('section-products');

    if (btnLogs && btnProducts && secLogs && secProducts) {
        btnLogs.addEventListener('click', () => {
            secLogs.classList.remove('hidden');
            secProducts.classList.add('hidden');
            btnLogs.className = "px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all bg-brand-cyan text-brand-black shadow-lg shadow-cyan-500/20 flex items-center gap-2";
            btnProducts.className = "px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all text-gray-400 hover:text-white hover:bg-gray-800 flex items-center gap-2";
        });

        btnProducts.addEventListener('click', () => {
            secProducts.classList.remove('hidden');
            secLogs.classList.add('hidden');
            btnProducts.className = "px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all bg-brand-cyan text-brand-black shadow-lg shadow-cyan-500/20 flex items-center gap-2";
            btnLogs.className = "px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all text-gray-400 hover:text-white hover:bg-gray-800 flex items-center gap-2";
            renderProductsGrid();
        });
    }

    const prodSearch = document.getElementById('product-search-input');
    if (prodSearch) {
        prodSearch.addEventListener('input', () => {
            currentProdPage = 1;
            renderProductsGrid();
        });
    }

    const btnPrev = document.getElementById('btn-prev-prod-page');
    const btnNext = document.getElementById('btn-next-prod-page');

    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (currentProdPage > 1) {
                currentProdPage--;
                renderProductsGrid();
            }
        });
    }

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            currentProdPage++;
            renderProductsGrid();
        });
    }
}

// ==========================================================================
// 4. RENDERIZADO DE MÉTRICAS Y TABLA GENERAL
// ==========================================================================
function updateStatCards(logs) {
    const statTotal = document.getElementById('stat-total');
    const statManual = document.getElementById('stat-manual');
    const statEntries = document.getElementById('stat-entries');
    const statSales = document.getElementById('stat-sales');

    if (statTotal) statTotal.textContent = logs.length;
    if (statManual) statManual.textContent = logs.filter(l => l.changeType === 'AJUSTE_MANUAL').length;
    if (statEntries) statEntries.textContent = logs.filter(l => l.changeType === 'ENTRADA_COMPRA').length;
    if (statSales) statSales.textContent = logs.filter(l => l.changeType === 'VENTA_PEDIDO').length;
}

function renderAuditLogs() {
    const tableBody = document.getElementById('audit-logs-table-body');
    const searchVal = document.getElementById('audit-search-input')?.value.toLowerCase().trim() || '';
    const filterType = document.getElementById('audit-filter-type')?.value || 'ALL';

    if (!tableBody) return;

    let filtered = auditLogs.filter(log => {
        const matchesType = filterType === 'ALL' || log.changeType === filterType;
        const variantsStr = (log.variantChanges || []).map(v => `${v.color || ''} ${v.capacity || ''}`).join(' ');
        const searchStr = `${log.productName || ''} ${log.sku || ''} ${log.changeDetails || ''} ${variantsStr}`.toLowerCase();
        const matchesSearch = !searchVal || searchStr.includes(searchVal);
        return matchesType && matchesSearch;
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="py-12 text-center text-gray-500">
                    <i class="fa-solid fa-folder-open text-3xl mb-2 opacity-40"></i>
                    <p class="font-bold uppercase tracking-wider text-xs">No hay eventos de auditoría registrados.</p>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = filtered.map(log => formatAuditLogRowHTML(log)).join('');
}

function formatAuditLogRowHTML(log) {
    let dateStr = 'Reciente';
    if (log.timestamp?.toDate) {
        dateStr = log.timestamp.toDate().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
    } else if (log.createdAtISO) {
        dateStr = new Date(log.createdAtISO).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
    }

    let typeBadge = '';
    switch (log.changeType) {
        case 'INVENTARIO_INICIAL':
            typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-[10px] uppercase tracking-wider"><i class="fa-solid fa-flag-checkered"></i> Stock Inicial</span>`;
            break;
        case 'AJUSTE_MANUAL':
            typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-brand-cyan font-bold text-[10px] uppercase tracking-wider"><i class="fa-solid fa-sliders"></i> Ajuste Manual</span>`;
            break;
        case 'ENTRADA_COMPRA':
            typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[10px] uppercase tracking-wider"><i class="fa-solid fa-truck-loading"></i> Entrada Compra</span>`;
            break;
        case 'VENTA_PEDIDO':
            typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold text-[10px] uppercase tracking-wider"><i class="fa-solid fa-basket-shopping"></i> Venta Pedido</span>`;
            break;
        case 'DEVOLUCION_CANCELACION':
            typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 font-bold text-[10px] uppercase tracking-wider"><i class="fa-solid fa-rotate-left"></i> Devolución Cancelación</span>`;
            break;
        case 'CREACION_PRODUCTO':
            typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-[10px] uppercase tracking-wider"><i class="fa-solid fa-plus-circle"></i> Producto Creado</span>`;
            break;
        default:
            typeBadge = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-gray-700/40 border border-gray-600 text-gray-300 font-bold text-[10px] uppercase tracking-wider"><i class="fa-solid fa-pen-to-square"></i> ${log.changeType || 'Modificación'}</span>`;
    }

    const delta = typeof log.deltaStock === 'number' ? log.deltaStock : 0;
    const deltaClass = delta > 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : (delta < 0 ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : 'text-gray-400 bg-gray-800 border-gray-700');
    const deltaSign = delta > 0 ? `+${delta}` : `${delta}`;

    let variantsHTML = '';
    if (Array.isArray(log.variantChanges) && log.variantChanges.length > 0) {
        variantsHTML = `
            <div class="mt-2 space-y-1 bg-black/40 p-2.5 rounded-xl border border-gray-800 text-[11px]">
                <span class="text-[9px] font-black uppercase tracking-wider text-gray-500 block mb-1">Detalle Combinaciones:</span>
                ${log.variantChanges.map(v => `
                    <div class="flex items-center justify-between text-gray-300">
                        <span>🎨 <strong>${v.color || 'Estándar'}</strong> ${v.capacity ? `/ ${v.capacity}` : ''}</span>
                        <span class="font-mono font-bold ${v.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}">${v.before} ➔ ${v.after} (${v.delta > 0 ? '+' : ''}${v.delta})</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    return `
        <tr class="hover:bg-gray-800/30 transition-colors">
            <td class="py-4 px-6 whitespace-nowrap text-gray-400 font-mono text-[11px]">
                ${dateStr}
            </td>
            <td class="py-4 px-6">
                <div class="flex items-center gap-3">
                    ${log.image ? `<img src="${log.image}" alt="Producto" class="w-10 h-10 object-contain rounded-xl bg-white/5 p-1 border border-gray-800 shrink-0">` : `<div class="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-xs shrink-0"><i class="fa-solid fa-box"></i></div>`}
                    <div>
                        <div class="font-bold text-white uppercase text-xs tracking-wide">${log.productName || 'Producto'}</div>
                        <div class="flex items-center gap-2 mt-0.5">
                            ${log.sku ? `<span class="bg-gray-800 text-gray-400 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded">SKU: ${log.sku}</span>` : ''}
                            ${log.category ? `<span class="text-[9px] text-gray-500 uppercase font-semibold">${log.category}</span>` : ''}
                        </div>
                    </div>
                </div>
            </td>
            <td class="py-4 px-6 whitespace-nowrap">${typeBadge}</td>
            <td class="py-4 px-6 text-center whitespace-nowrap">
                <div class="inline-flex items-center gap-2">
                    <span class="text-xs font-mono font-bold text-gray-300">${log.beforeStock} ➔ ${log.afterStock}</span>
                    <span class="px-2 py-0.5 text-xs font-black font-mono rounded-lg border ${deltaClass}">${deltaSign}</span>
                </div>
            </td>
            <td class="py-4 px-6">
                <p class="text-gray-300 font-medium leading-snug">${log.changeDetails || 'Cambio registrado'}</p>
                ${variantsHTML}
            </td>
        </tr>
    `;
}

// ==========================================================================
// 5. GRILLA DE PRODUCTOS CON CANTIDADES Y TRAZABILIDAD Y PAGINACIÓN
// ==========================================================================
function renderProductsGrid() {
    const grid = document.getElementById('products-grid');
    const infoSpan = document.getElementById('prod-pagination-info');
    const pageSpan = document.getElementById('prod-page-indicator');
    const btnPrev = document.getElementById('btn-prev-prod-page');
    const btnNext = document.getElementById('btn-next-prod-page');
    const searchVal = document.getElementById('product-search-input')?.value.toLowerCase().trim() || '';

    if (!grid) return;

    let filteredProducts = allProducts.filter(p => {
        const str = `${p.name || ''} ${p.sku || ''} ${p.brand || ''} ${p.category || ''}`.toLowerCase();
        return !searchVal || str.includes(searchVal);
    });

    const totalItems = filteredProducts.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PRODS_PER_PAGE));

    if (currentProdPage > totalPages) currentProdPage = totalPages;
    if (currentProdPage < 1) currentProdPage = 1;

    const startIdx = (currentProdPage - 1) * PRODS_PER_PAGE;
    const endIdx = Math.min(startIdx + PRODS_PER_PAGE, totalItems);
    const paginatedProducts = filteredProducts.slice(startIdx, endIdx);

    // Actualizar controles de paginación
    if (infoSpan) {
        infoSpan.textContent = totalItems > 0 
            ? `Mostrando ${startIdx + 1}-${endIdx} de ${totalItems} productos`
            : `Mostrando 0 de 0 productos`;
    }
    if (pageSpan) pageSpan.textContent = `Pág. ${currentProdPage} / ${totalPages}`;
    if (btnPrev) btnPrev.disabled = (currentProdPage <= 1);
    if (btnNext) btnNext.disabled = (currentProdPage >= totalPages);

    if (paginatedProducts.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center text-gray-500">
                <i class="fa-solid fa-box-open text-3xl mb-2 opacity-40"></i>
                <p class="font-bold uppercase tracking-wider text-xs">No se encontraron productos en el catálogo.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = paginatedProducts.map(p => {
        const stock = typeof p.stock === 'number' ? p.stock : 0;
        const img = p.mainImage || p.image || (p.images ? p.images[0] : '');

        return `
            <div class="bg-black/40 border border-gray-800 hover:border-brand-cyan/50 rounded-2xl p-4 transition-all duration-300 flex flex-col justify-between group cursor-pointer" onclick="window.inspectProductAudit('${p.id}')">
                <div class="space-y-3">
                    <div class="flex items-start justify-between gap-3">
                        ${img ? `<img src="${img}" alt="${p.name}" class="w-12 h-12 object-contain rounded-xl bg-white/5 p-1 border border-gray-800 shrink-0">` : `<div class="w-12 h-12 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-sm shrink-0"><i class="fa-solid fa-box"></i></div>`}
                        <span class="px-3 py-1 rounded-xl text-xs font-black font-mono ${stock > 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'}">
                            ${stock} ud(s)
                        </span>
                    </div>

                    <div>
                        <h4 class="font-bold text-white uppercase text-xs group-hover:text-brand-cyan transition leading-tight line-clamp-2">${p.name}</h4>
                        <div class="flex items-center gap-2 mt-2">
                            ${p.sku ? `<span class="bg-gray-800 text-gray-400 text-[9px] font-mono font-bold px-2 py-0.5 rounded">SKU: ${p.sku}</span>` : ''}
                            ${p.category ? `<span class="text-[9px] text-gray-500 font-bold uppercase">${p.category}</span>` : ''}
                        </div>
                    </div>
                </div>

                <div class="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[10px] font-black uppercase text-brand-cyan tracking-wider">
                    <span><i class="fa-solid fa-clock-rotate-left mr-1"></i> Inspeccionar Historial</span>
                    <i class="fa-solid fa-chevron-right group-hover:translate-x-1 transition-transform"></i>
                </div>
            </div>
        `;
    }).join('');
}

// ==========================================================================
// 6. MODAL DE TRAZABILIDAD INDIVIDUAL DEL PRODUCTO CON FILTRO POR VARIANTE Y PAGINACIÓN
// ==========================================================================
window.inspectProductAudit = function(productId) {
    const prod = allProducts.find(p => p.id === productId);
    if (!prod) return;
    selectedProduct = prod;
    openProductHistoryModal(prod);
};

function getVariantKey(color, capacity) {
    const c = (color || '').trim().toLowerCase();
    const cap = (capacity || '').trim().toLowerCase();
    return `${c}|${cap}`;
}

function logMatchesVariant(log, targetVariantKey) {
    if (!targetVariantKey || targetVariantKey === 'ALL') return true;

    // 1. Revisar desglose específico en variantChanges
    if (Array.isArray(log.variantChanges) && log.variantChanges.length > 0) {
        return log.variantChanges.some(v => {
            const vKey = getVariantKey(v.color, v.capacity);
            return vKey === targetVariantKey;
        });
    }

    // 2. Revisar si changeDetails contiene el texto de la variante
    const parts = targetVariantKey.split('|');
    const targetColor = parts[0] || '';
    const targetCap = parts[1] || '';
    const details = (log.changeDetails || '').toLowerCase();
    if (targetColor && targetCap) {
        return details.includes(targetColor) && details.includes(targetCap);
    } else if (targetColor) {
        return details.includes(targetColor);
    } else if (targetCap) {
        return details.includes(targetCap);
    }

    return false;
}

function getProductDisplayLogs() {
    if (!productLogsState.selectedVariant || productLogsState.selectedVariant === 'ALL') {
        return productLogsState.allLoadedLogs;
    }
    return productLogsState.allLoadedLogs.filter(log => logMatchesVariant(log, productLogsState.selectedVariant));
}

function setVariantFilter(key) {
    productLogsState.selectedVariant = key;
    productLogsState.currentPage = 1;

    const filterSelect = document.getElementById('modal-variant-filter');
    if (filterSelect) filterSelect.value = key;

    // Actualizar estilos activos de las tarjetas
    document.querySelectorAll('.variant-chip-card').forEach(chip => {
        if (chip.dataset.variantKey === key) {
            chip.classList.add('border-brand-cyan', 'bg-cyan-500/10', 'ring-1', 'ring-brand-cyan/50');
            chip.classList.remove('border-gray-800', 'bg-black/40');
        } else {
            chip.classList.remove('border-brand-cyan', 'bg-cyan-500/10', 'ring-1', 'ring-brand-cyan/50');
            chip.classList.add('border-gray-800', 'bg-black/40');
        }
    });

    renderProductTimeline();
    updateProductBreakdown();
    updateProductPaginationUI();
}

async function openProductHistoryModal(product) {
    const modal = document.getElementById('modal-product-history');
    if (!modal) return;

    // 1. Llenar cabecera del producto
    document.getElementById('modal-prod-name').textContent = product.name || 'Producto';
    document.getElementById('modal-prod-sku').textContent = `SKU: ${product.sku || 'N/A'}`;
    document.getElementById('modal-prod-cat').textContent = product.category || 'Sin Categoría';
    document.getElementById('modal-stock-current').textContent = `${typeof product.stock === 'number' ? product.stock : 0} ud(s)`;

    const imgEl = document.getElementById('modal-prod-img');
    if (imgEl) {
        const img = product.mainImage || product.image || (product.images ? product.images[0] : '');
        imgEl.src = img || '../img/logo.webp';
    }

    // 2. Renderizar desglose de variantes si existen combinaciones y poblar filtro
    const variantsSection = document.getElementById('modal-variants-section');
    const variantsGrid = document.getElementById('modal-variants-grid');
    const filterContainer = document.getElementById('modal-variant-filter-container');
    const filterSelect = document.getElementById('modal-variant-filter');
    const comboList = Array.isArray(product.combinations) ? product.combinations : [];

    if (variantsSection && variantsGrid) {
        if (comboList.length > 0) {
            variantsGrid.innerHTML = comboList.map(c => {
                const comboStock = typeof c.stock === 'number' ? c.stock : (typeof c.quantity === 'number' ? c.quantity : 0);
                const vKey = getVariantKey(c.color, c.capacity);
                return `
                    <div data-variant-key="${vKey}" class="variant-chip-card bg-black/40 hover:bg-gray-800/60 border border-gray-800 hover:border-brand-cyan/40 p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition select-none" title="Filtrar por esta variante">
                        <span class="text-gray-300 font-medium">🎨 <strong>${c.color || 'Estándar'}</strong> ${c.capacity ? `/ ${c.capacity}` : ''}</span>
                        <span class="font-mono font-bold ${comboStock > 0 ? 'text-emerald-400' : 'text-rose-400'}">${comboStock} ud(s)</span>
                    </div>
                `;
            }).join('');
            variantsSection.classList.remove('hidden');

            if (filterContainer && filterSelect) {
                filterSelect.innerHTML = `
                    <option value="ALL">✨ Todas las Variantes</option>
                    ${comboList.map(c => {
                        const comboStock = typeof c.stock === 'number' ? c.stock : (typeof c.quantity === 'number' ? c.quantity : 0);
                        const vKey = getVariantKey(c.color, c.capacity);
                        return `<option value="${vKey}">🎨 ${c.color || 'Estándar'} ${c.capacity ? `/ ${c.capacity}` : ''} (${comboStock} uds)</option>`;
                    }).join('')}
                `;
                filterSelect.value = 'ALL';
                filterContainer.classList.remove('hidden');
            }

            // Click listener en las tarjetas de variantes para filtrar de inmediato
            variantsGrid.querySelectorAll('.variant-chip-card').forEach(chip => {
                chip.onclick = () => {
                    const key = chip.dataset.variantKey;
                    if (productLogsState.selectedVariant === key) {
                        setVariantFilter('ALL');
                    } else {
                        setVariantFilter(key);
                    }
                };
            });
        } else {
            variantsSection.classList.add('hidden');
            if (filterContainer) filterContainer.classList.add('hidden');
        }
    }

    // 3. Reiniciar estado de paginación para este producto específico
    productLogsState = {
        productId: product.id,
        allLoadedLogs: [],
        lastDocSnapshot: null,
        hasMoreInFirestore: true,
        currentPage: 1,
        isLoading: false,
        selectedVariant: 'ALL'
    };

    // Resetear tarjetas de desglose a 0 mientras carga
    updateProductBreakdown();

    // 4. Mostrar el modal
    modal.classList.remove('hidden');

    // 5. Cargar primer lote de 200 logs directamente de Firestore bajo solicitud
    await fetchProductLogsBatch();
}

async function fetchProductLogsBatch() {
    if (productLogsState.isLoading || !productLogsState.hasMoreInFirestore || !productLogsState.productId) return;
    productLogsState.isLoading = true;

    const container = document.getElementById('modal-timeline-container');
    const loadMoreBtn = document.getElementById('btn-modal-load-more');
    const nextBtn = document.getElementById('btn-modal-next-page');

    if (productLogsState.allLoadedLogs.length === 0 && container) {
        container.innerHTML = `
            <div class="py-12 text-center text-gray-500">
                <i class="fa-solid fa-circle-notch fa-spin text-brand-cyan text-2xl mb-2"></i>
                <p class="font-bold uppercase tracking-wider text-xs">Cargando primeros 200 logs del producto...</p>
                <p class="text-[10px] text-gray-600 mt-1">Cuidando cuota de lecturas de Firestore</p>
            </div>
        `;
    }

    if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...';
    }
    if (nextBtn) nextBtn.disabled = true;

    try {
        const logsRef = collection(db, "inventory_audit_logs");
        let q;

        // Intentar consulta indexada con orden timestamp DESC
        try {
            if (productLogsState.lastDocSnapshot) {
                q = query(
                    logsRef,
                    where("productId", "==", productLogsState.productId),
                    orderBy("timestamp", "desc"),
                    startAfter(productLogsState.lastDocSnapshot),
                    limit(PROD_LOGS_PER_PAGE)
                );
            } else {
                q = query(
                    logsRef,
                    where("productId", "==", productLogsState.productId),
                    orderBy("timestamp", "desc"),
                    limit(PROD_LOGS_PER_PAGE)
                );
            }
            const snap = await getDocs(q);
            processProductLogsSnapshot(snap);
        } catch (queryErr) {
            console.warn("Consulta indexada falló (falta índice compuesto). Reintentando fallback...", queryErr);
            // Fallback en caso de que falte el índice compuesto: consulta directa y orden en memoria
            if (productLogsState.allLoadedLogs.length === 0) {
                const fallbackQ = query(
                    logsRef,
                    where("productId", "==", productLogsState.productId),
                    limit(PROD_LOGS_PER_PAGE)
                );
                const fallbackSnap = await getDocs(fallbackQ);
                processProductLogsSnapshot(fallbackSnap, true);
            } else {
                throw queryErr;
            }
        }

    } catch (err) {
        console.error("Error al obtener logs del producto:", err);
        if (container && productLogsState.allLoadedLogs.length === 0) {
            container.innerHTML = `
                <div class="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center text-red-400 text-xs">
                    <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
                    <p class="font-bold uppercase tracking-wider">Error cargando logs del producto.</p>
                    <p class="text-[10px] text-gray-400 mt-1">${err.message || 'Verifica la consola.'}</p>
                </div>
            `;
        }
    } finally {
        productLogsState.isLoading = false;
        updateProductPaginationUI();
    }
}

function processProductLogsSnapshot(snap, sortInMemory = false) {
    if (snap.empty) {
        productLogsState.hasMoreInFirestore = false;
    } else {
        const fetched = [];
        snap.forEach(d => {
            if (!productLogsState.allLoadedLogs.some(existing => existing.id === d.id)) {
                fetched.push({ id: d.id, ...d.data() });
            }
        });

        if (sortInMemory) {
            fetched.sort((a, b) => {
                const tA = a.timestamp?.toMillis?.() || (a.createdAtISO ? new Date(a.createdAtISO).getTime() : 0);
                const tB = b.timestamp?.toMillis?.() || (b.createdAtISO ? new Date(b.createdAtISO).getTime() : 0);
                return tB - tA;
            });
        }

        productLogsState.allLoadedLogs.push(...fetched);
        productLogsState.lastDocSnapshot = snap.docs[snap.docs.length - 1];

        if (snap.docs.length < PROD_LOGS_PER_PAGE) {
            productLogsState.hasMoreInFirestore = false;
        }
    }

    renderProductTimeline();
    updateProductBreakdown();
}

function renderProductTimeline() {
    const container = document.getElementById('modal-timeline-container');
    if (!container) return;

    const filteredLogs = getProductDisplayLogs();

    if (filteredLogs.length === 0) {
        if (productLogsState.allLoadedLogs.length === 0) {
            container.innerHTML = `
                <div class="bg-black/30 border border-gray-800 rounded-2xl p-6 text-center text-gray-500 text-xs">
                    <i class="fa-solid fa-clock opacity-30 text-2xl mb-2"></i>
                    <p class="font-bold uppercase tracking-wider">Aún no hay eventos registrados para este producto.</p>
                    <p class="text-[10px] text-gray-600 mt-1">Los futuros cambios de stock en edición, compras o ventas aparecerán aquí en vivo.</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="bg-black/30 border border-gray-800 rounded-2xl p-6 text-center text-gray-500 text-xs">
                    <i class="fa-solid fa-filter opacity-30 text-2xl mb-2"></i>
                    <p class="font-bold uppercase tracking-wider">No se encontraron movimientos para esta variante en los registros cargados.</p>
                    <p class="text-[10px] text-gray-600 mt-1">Prueba seleccionando otra variante o cargando más registros con el botón inferior.</p>
                </div>
            `;
        }
        return;
    }

    // Paginación: Mostrar solo los 200 logs de la página actual sobre los filtrados
    const startIdx = (productLogsState.currentPage - 1) * PROD_LOGS_PER_PAGE;
    const endIdx = startIdx + PROD_LOGS_PER_PAGE;
    const pageLogs = filteredLogs.slice(startIdx, endIdx);

    const isVariantFiltered = productLogsState.selectedVariant && productLogsState.selectedVariant !== 'ALL';

    container.innerHTML = pageLogs.map(log => {
        let dateStr = 'Reciente';
        if (log.timestamp?.toDate) {
            dateStr = log.timestamp.toDate().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
        } else if (log.createdAtISO) {
            dateStr = new Date(log.createdAtISO).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
        }

        let typeBadge = '';
        switch (log.changeType) {
            case 'INVENTARIO_INICIAL':
                typeBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-[9px] uppercase tracking-wider"><i class="fa-solid fa-flag-checkered"></i> Stock Inicial</span>`;
                break;
            case 'AJUSTE_MANUAL':
                typeBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-brand-cyan font-bold text-[9px] uppercase tracking-wider"><i class="fa-solid fa-sliders"></i> Ajuste Manual</span>`;
                break;
            case 'ENTRADA_COMPRA':
                typeBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[9px] uppercase tracking-wider"><i class="fa-solid fa-truck-loading"></i> Entrada Compra</span>`;
                break;
            case 'VENTA_PEDIDO':
                typeBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold text-[9px] uppercase tracking-wider"><i class="fa-solid fa-basket-shopping"></i> Venta Pedido</span>`;
                break;
            case 'DEVOLUCION_CANCELACION':
                typeBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400 font-bold text-[9px] uppercase tracking-wider"><i class="fa-solid fa-rotate-left"></i> Devolución</span>`;
                break;
            case 'CREACION_PRODUCTO':
                typeBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-[9px] uppercase tracking-wider"><i class="fa-solid fa-plus-circle"></i> Creado</span>`;
                break;
            default:
                typeBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-gray-700/40 border border-gray-600 text-gray-300 font-bold text-[9px] uppercase tracking-wider">${log.changeType || 'Modificación'}</span>`;
        }

        // Si está filtrado por variante, obtener el delta específico de esa variante
        let delta = typeof log.deltaStock === 'number' ? log.deltaStock : 0;
        let variantStockText = (typeof log.beforeStock === 'number' && typeof log.afterStock === 'number') 
            ? `${log.beforeStock} ➔ ${log.afterStock}` 
            : '';

        if (isVariantFiltered && Array.isArray(log.variantChanges) && log.variantChanges.length > 0) {
            const vMatch = log.variantChanges.find(v => getVariantKey(v.color, v.capacity) === productLogsState.selectedVariant);
            if (vMatch && typeof vMatch.delta === 'number') {
                delta = vMatch.delta;
                variantStockText = `${vMatch.before} ➔ ${vMatch.after} (Variante)`;
            }
        }

        const deltaClass = delta > 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : (delta < 0 ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : 'text-gray-400 bg-gray-800 border-gray-700');

        let timelineVariantsHTML = '';
        if (Array.isArray(log.variantChanges) && log.variantChanges.length > 0) {
            timelineVariantsHTML = `
                <div class="mt-2 space-y-1 bg-black/40 p-2.5 rounded-xl border border-gray-800/80 text-[11px]">
                    <span class="text-[9px] font-black uppercase tracking-wider text-gray-500 block mb-1">Variantes Modificadas:</span>
                    ${log.variantChanges.map(v => {
                        const isThis = isVariantFiltered && (getVariantKey(v.color, v.capacity) === productLogsState.selectedVariant);
                        return `
                            <div class="flex items-center justify-between text-gray-300 ${isThis ? 'bg-cyan-500/10 p-1.5 rounded-lg border border-cyan-500/40' : ''}">
                                <span>🎨 <strong>${v.color || 'Estándar'}</strong> ${v.capacity ? `/ ${v.capacity}` : ''} ${isThis ? '<span class="text-[8px] bg-brand-cyan text-brand-black px-1.5 py-0.2 rounded font-black ml-1 uppercase">Filtrada</span>' : ''}</span>
                                <span class="font-mono font-bold ${v.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}">${v.before} ➔ ${v.after} (${v.delta > 0 ? '+' : ''}${v.delta})</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        return `
            <div class="bg-black/40 border border-gray-800 rounded-2xl p-4 space-y-2 hover:border-gray-700 transition">
                <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2">
                        <span class="text-gray-400 font-mono text-[11px]"><i class="fa-solid fa-calendar-day mr-1"></i> ${dateStr}</span>
                        ${typeBadge}
                    </div>
                    <span class="px-2 py-0.5 font-mono font-bold text-xs rounded-lg border ${deltaClass}">${delta > 0 ? '+' : ''}${delta} ud(s)</span>
                </div>

                <div class="flex items-center justify-between text-xs pt-1 border-t border-gray-800/60">
                    <span class="font-bold text-white">${log.changeDetails || 'Modificación registrada'}</span>
                    <span class="font-mono text-gray-400 text-[11px]">${variantStockText}</span>
                </div>
                ${timelineVariantsHTML}
            </div>
        `;
    }).join('');
}

function updateProductBreakdown() {
    let totalInitial = 0;
    let totalEntries = 0;
    let totalSales = 0;
    let totalReturns = 0;
    let totalManual = 0;

    const isVariantFiltered = productLogsState.selectedVariant && productLogsState.selectedVariant !== 'ALL';
    const variantLabel = document.getElementById('modal-breakdown-variant-label');

    if (variantLabel) {
        if (isVariantFiltered) {
            const [c, cap] = productLogsState.selectedVariant.split('|');
            const nameDisplay = `${c || 'Estándar'} ${cap ? `/ ${cap}` : ''}`;
            variantLabel.innerHTML = `<i class="fa-solid fa-filter mr-1"></i> Variante: <strong class="text-white">${nameDisplay}</strong>`;
            variantLabel.classList.remove('hidden');
        } else {
            variantLabel.classList.add('hidden');
        }
    }

    productLogsState.allLoadedLogs.forEach(log => {
        let delta = typeof log.deltaStock === 'number' ? log.deltaStock : 0;

        if (isVariantFiltered) {
            if (!logMatchesVariant(log, productLogsState.selectedVariant)) {
                return; // Omitir eventos que no afectaron a esta variante
            }
            if (Array.isArray(log.variantChanges) && log.variantChanges.length > 0) {
                const vMatch = log.variantChanges.find(v => getVariantKey(v.color, v.capacity) === productLogsState.selectedVariant);
                if (vMatch && typeof vMatch.delta === 'number') {
                    delta = vMatch.delta;
                }
            }
        }

        switch (log.changeType) {
            case 'INVENTARIO_INICIAL':
                totalInitial += delta;
                break;
            case 'ENTRADA_COMPRA':
                totalEntries += delta;
                break;
            case 'VENTA_PEDIDO':
                totalSales += Math.abs(delta);
                break;
            case 'DEVOLUCION_CANCELACION':
                totalReturns += delta;
                break;
            case 'AJUSTE_MANUAL':
                totalManual += delta;
                break;
        }
    });

    const initSpan = document.getElementById('modal-breakdown-initial');
    if (initSpan) initSpan.textContent = `+${totalInitial}`;
    const entSpan = document.getElementById('modal-breakdown-entries');
    if (entSpan) entSpan.textContent = `+${totalEntries}`;
    const salSpan = document.getElementById('modal-breakdown-sales');
    if (salSpan) salSpan.textContent = `-${totalSales}`;
    const retSpan = document.getElementById('modal-breakdown-returns');
    if (retSpan) retSpan.textContent = `+${totalReturns}`;
    const manSpan = document.getElementById('modal-breakdown-manual');
    if (manSpan) manSpan.textContent = `${totalManual >= 0 ? '+' : ''}${totalManual}`;
}

function updateProductPaginationUI() {
    const paginationDiv = document.getElementById('modal-logs-pagination');
    const badgeCount = document.getElementById('modal-logs-badge-count');
    const infoSpan = document.getElementById('modal-logs-pagination-info');
    const pageIndicator = document.getElementById('modal-logs-page-indicator');
    const btnPrev = document.getElementById('btn-modal-prev-page');
    const btnNext = document.getElementById('btn-modal-next-page');
    const btnLoadMore = document.getElementById('btn-modal-load-more');

    const filteredLogs = getProductDisplayLogs();
    const totalFiltered = filteredLogs.length;
    const totalAllLoaded = productLogsState.allLoadedLogs.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / PROD_LOGS_PER_PAGE));

    if (badgeCount) {
        if (productLogsState.selectedVariant !== 'ALL') {
            badgeCount.innerHTML = `<span class="text-brand-cyan">${totalFiltered}</span> / ${totalAllLoaded} logs`;
        } else {
            badgeCount.textContent = `${totalAllLoaded} logs`;
        }
    }

    if (totalAllLoaded === 0) {
        if (paginationDiv) paginationDiv.classList.add('hidden');
        return;
    }

    if (paginationDiv) paginationDiv.classList.remove('hidden');

    const startIdx = (productLogsState.currentPage - 1) * PROD_LOGS_PER_PAGE;
    const endIdx = Math.min(startIdx + PROD_LOGS_PER_PAGE, totalFiltered);

    if (infoSpan) {
        if (productLogsState.selectedVariant !== 'ALL') {
            infoSpan.textContent = `Mostrando ${totalFiltered > 0 ? startIdx + 1 : 0}-${endIdx} de ${totalFiltered} logs para esta variante`;
        } else {
            infoSpan.textContent = `Mostrando ${startIdx + 1}-${endIdx} de ${totalAllLoaded} logs`;
        }
    }

    if (pageIndicator) {
        pageIndicator.textContent = `Pág. ${productLogsState.currentPage} / ${totalPages}${productLogsState.hasMoreInFirestore ? '+' : ''}`;
    }

    if (btnPrev) {
        btnPrev.disabled = (productLogsState.currentPage <= 1);
    }

    if (btnNext) {
        const canGoNext = (productLogsState.currentPage < totalPages) || productLogsState.hasMoreInFirestore;
        btnNext.disabled = !canGoNext;
    }

    if (btnLoadMore) {
        if (productLogsState.hasMoreInFirestore) {
            btnLoadMore.disabled = false;
            btnLoadMore.classList.remove('opacity-40');
            btnLoadMore.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Cargar 200 más';
        } else {
            btnLoadMore.disabled = true;
            btnLoadMore.innerHTML = '✅ Todos cargados';
            btnLoadMore.classList.add('opacity-40');
        }
    }
}

function initModalEvents() {
    const modal = document.getElementById('modal-product-history');
    const closeBtn = document.getElementById('modal-close-btn');

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            selectedProduct = null;
            productLogsState.productId = null;
            productLogsState.selectedVariant = 'ALL';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                selectedProduct = null;
                productLogsState.productId = null;
                productLogsState.selectedVariant = 'ALL';
            }
        });
    }

    const filterSelect = document.getElementById('modal-variant-filter');
    if (filterSelect) {
        filterSelect.addEventListener('change', (e) => {
            setVariantFilter(e.target.value);
        });
    }

    const btnModalPrev = document.getElementById('btn-modal-prev-page');
    const btnModalNext = document.getElementById('btn-modal-next-page');
    const btnModalLoadMore = document.getElementById('btn-modal-load-more');

    if (btnModalPrev) {
        btnModalPrev.addEventListener('click', () => {
            if (productLogsState.currentPage > 1) {
                productLogsState.currentPage--;
                renderProductTimeline();
                updateProductPaginationUI();
            }
        });
    }

    if (btnModalNext) {
        btnModalNext.addEventListener('click', async () => {
            const filteredLogs = getProductDisplayLogs();
            const totalPages = Math.ceil(filteredLogs.length / PROD_LOGS_PER_PAGE);
            if (productLogsState.currentPage < totalPages) {
                // Navegación en memoria a página ya cargada (0 lecturas a Firestore)
                productLogsState.currentPage++;
                renderProductTimeline();
                updateProductPaginationUI();
            } else if (productLogsState.hasMoreInFirestore) {
                // Cargar siguientes 200 registros de Firestore bajo solicitud
                await fetchProductLogsBatch();
            }
        });
    }

    if (btnModalLoadMore) {
        btnModalLoadMore.addEventListener('click', async () => {
            if (productLogsState.hasMoreInFirestore) {
                await fetchProductLogsBatch();
            }
        });
    }
}

function initFilterEvents() {
    const searchInput = document.getElementById('audit-search-input');
    const filterType = document.getElementById('audit-filter-type');
    const btnPurge = document.getElementById('btn-purge-logs');
    const btnSnapshot = document.getElementById('btn-snapshot-initial');

    if (searchInput) searchInput.addEventListener('input', renderAuditLogs);
    if (filterType) filterType.addEventListener('change', renderAuditLogs);

    if (btnSnapshot) {
        btnSnapshot.addEventListener('click', async () => {
            if (!allProducts || allProducts.length === 0) {
                alert("⚠️ No hay productos cargados en el catálogo.");
                return;
            }

            const confirmMsg = `📸 ¿Deseas registrar el Stock Inicial (Línea Base) para los ${allProducts.length} productos del catálogo?\n\nEsto creará el primer movimiento de inicio por cada producto con su stock actual.`;
            if (!confirm(confirmMsg)) return;

            btnSnapshot.disabled = true;
            btnSnapshot.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando Snapshot (${allProducts.length})...`;

            try {
                const logsRef = collection(db, "inventory_audit_logs");
                let createdCount = 0;

                for (const prod of allProducts) {
                    const stock = typeof prod.stock === 'number' ? prod.stock : 0;
                    const img = prod.mainImage || prod.image || (prod.images ? prod.images[0] : '');

                    const comboList = Array.isArray(prod.combinations) ? prod.combinations : [];
                    const variantChanges = comboList.map(c => ({
                        color: c.color || '',
                        capacity: c.capacity || '',
                        before: 0,
                        after: typeof c.stock === 'number' ? c.stock : (typeof c.quantity === 'number' ? c.quantity : 0),
                        delta: typeof c.stock === 'number' ? c.stock : (typeof c.quantity === 'number' ? c.quantity : 0)
                    }));

                    await addDoc(logsRef, {
                        productId: prod.id,
                        productName: prod.name || 'Producto',
                        sku: prod.sku || '',
                        category: prod.category || '',
                        brand: prod.brand || '',
                        image: img,
                        beforeStock: 0,
                        afterStock: stock,
                        deltaStock: stock,
                        changeType: "INVENTARIO_INICIAL",
                        changeDetails: `Punto de partida de inventario (Stock inicial registrado: ${stock} ud(s))`,
                        variantChanges: variantChanges,
                        timestamp: serverTimestamp(),
                        createdAtISO: new Date().toISOString()
                    });
                    createdCount++;
                }

                alert(`✅ Se registraron exitosamente ${createdCount} movimientos de Stock Inicial.`);
            } catch (err) {
                console.error("Error guardando stock inicial:", err);
                alert("Error al guardar stock inicial: " + err.message);
            } finally {
                btnSnapshot.disabled = false;
                btnSnapshot.innerHTML = `<i class="fa-solid fa-camera-retro"></i> Guardar Stock Inicial`;
            }
        });
    }

    if (btnPurge) {
        btnPurge.addEventListener('click', async () => {
            if (!confirm("⚠️ ¿Estás seguro de borrar todos los registros de auditoría de prueba en inventory_audit_logs?")) return;
            
            btnPurge.disabled = true;
            btnPurge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Limpiando...`;

            try {
                const snap = await getDocs(collection(db, "inventory_audit_logs"));
                const deletes = snap.docs.map(d => deleteDoc(doc(db, "inventory_audit_logs", d.id)));
                await Promise.all(deletes);
                alert("✅ Registros de auditoría limpios.");
            } catch (err) {
                console.error("Error limpiando logs:", err);
                alert("Error al limpiar los logs: " + err.message);
            } finally {
                btnPurge.disabled = false;
                btnPurge.innerHTML = `<i class="fa-solid fa-trash-can"></i> Limpiar Logs`;
            }
        });
    }
}
