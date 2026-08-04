// public/js/test-inventory-audit.js
import { db, collection, query, orderBy, limit, onSnapshot, getDocs, deleteDoc, doc, addDoc, serverTimestamp } from './firebase-init.js';
import { AdminStore } from './admin-store.js';

let auditLogs = [];
let allProducts = [];
let selectedProduct = null;
let currentProdPage = 1;
const PRODS_PER_PAGE = 12;

document.addEventListener('DOMContentLoaded', () => {
    initAuditListener();
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
        auditLogs = [];
        snapshot.forEach(docSnap => {
            auditLogs.push({ id: docSnap.id, ...docSnap.data() });
        });

        updateStatCards(auditLogs);
        renderAuditLogs();
        if (selectedProduct) {
            openProductHistoryModal(selectedProduct);
        }
    }, (error) => {
        console.error("Error escuchando logs de auditoría:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-red-400 font-bold">Error cargando el vigilante de inventario. Verifica las reglas de Firestore.</td></tr>`;
        }
    });
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
        const searchStr = `${log.productName || ''} ${log.sku || ''} ${log.changeDetails || ''}`.toLowerCase();
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
// 6. MODAL DE TRAZABILIDAD INDIVIDUAL DEL PRODUCTO
// ==========================================================================
window.inspectProductAudit = function(productId) {
    const prod = allProducts.find(p => p.id === productId);
    if (!prod) return;
    selectedProduct = prod;
    openProductHistoryModal(prod);
};

function openProductHistoryModal(product) {
    const modal = document.getElementById('modal-product-history');
    if (!modal) return;

    // Llenar cabecera del producto
    document.getElementById('modal-prod-name').textContent = product.name || 'Producto';
    document.getElementById('modal-prod-sku').textContent = `SKU: ${product.sku || 'N/A'}`;
    document.getElementById('modal-prod-cat').textContent = product.category || 'Sin Categoría';
    document.getElementById('modal-stock-current').textContent = `${typeof product.stock === 'number' ? product.stock : 0} ud(s)`;

    const imgEl = document.getElementById('modal-prod-img');
    if (imgEl) {
        const img = product.mainImage || product.image || (product.images ? product.images[0] : '');
        imgEl.src = img || '../img/logo.webp';
    }

    // Filtrar todos los eventos registrados para este producto específico
    const prodLogs = auditLogs.filter(l => l.productId === product.id);

    // Calcular desgloses del origen de valor
    let totalInitial = 0;
    let totalEntries = 0;
    let totalSales = 0;
    let totalReturns = 0;
    let totalManual = 0;

    prodLogs.forEach(log => {
        const delta = typeof log.deltaStock === 'number' ? log.deltaStock : 0;
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
    document.getElementById('modal-breakdown-entries').textContent = `+${totalEntries}`;
    document.getElementById('modal-breakdown-sales').textContent = `-${totalSales}`;
    document.getElementById('modal-breakdown-returns').textContent = `+${totalReturns}`;
    document.getElementById('modal-breakdown-manual').textContent = `${totalManual >= 0 ? '+' : ''}${totalManual}`;

    // Renderizar desglose de variantes si existen combinaciones
    const variantsSection = document.getElementById('modal-variants-section');
    const variantsGrid = document.getElementById('modal-variants-grid');
    const comboList = Array.isArray(product.combinations) ? product.combinations : [];

    if (variantsSection && variantsGrid) {
        if (comboList.length > 0) {
            variantsGrid.innerHTML = comboList.map(c => {
                const comboStock = typeof c.stock === 'number' ? c.stock : (typeof c.quantity === 'number' ? c.quantity : 0);
                return `
                    <div class="bg-black/40 border border-gray-800 p-2.5 rounded-xl flex items-center justify-between">
                        <span class="text-gray-300 font-medium">🎨 <strong>${c.color || 'Estándar'}</strong> ${c.capacity ? `/ ${c.capacity}` : ''}</span>
                        <span class="font-mono font-bold ${comboStock > 0 ? 'text-emerald-400' : 'text-rose-400'}">${comboStock} ud(s)</span>
                    </div>
                `;
            }).join('');
            variantsSection.classList.remove('hidden');
        } else {
            variantsSection.classList.add('hidden');
        }
    }

    // Renderizar línea de tiempo cronológica de este producto
    const container = document.getElementById('modal-timeline-container');
    if (container) {
        if (prodLogs.length === 0) {
            container.innerHTML = `
                <div class="bg-black/30 border border-gray-800 rounded-2xl p-6 text-center text-gray-500 text-xs">
                    <i class="fa-solid fa-clock opacity-30 text-2xl mb-2"></i>
                    <p class="font-bold uppercase tracking-wider">Aún no hay eventos registrados para este producto.</p>
                    <p class="text-[10px] text-gray-600 mt-1">Los futuros cambios de stock en edición, compras o ventas aparecerán aquí en vivo.</p>
                </div>
            `;
        } else {
            container.innerHTML = prodLogs.map(log => {
                let dateStr = 'Reciente';
                if (log.timestamp?.toDate) {
                    dateStr = log.timestamp.toDate().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
                } else if (log.createdAtISO) {
                    dateStr = new Date(log.createdAtISO).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
                }

                const delta = typeof log.deltaStock === 'number' ? log.deltaStock : 0;
                const deltaClass = delta > 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : (delta < 0 ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : 'text-gray-400 bg-gray-800 border-gray-700');

                let timelineVariantsHTML = '';
                if (Array.isArray(log.variantChanges) && log.variantChanges.length > 0) {
                    timelineVariantsHTML = `
                        <div class="mt-2 space-y-1 bg-black/40 p-2.5 rounded-xl border border-gray-800/80 text-[11px]">
                            <span class="text-[9px] font-black uppercase tracking-wider text-gray-500 block mb-1">Variantes Modificadas:</span>
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
                    <div class="bg-black/40 border border-gray-800 rounded-2xl p-4 space-y-2">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-gray-400 font-mono text-[11px]"><i class="fa-solid fa-calendar-day mr-1"></i> ${dateStr}</span>
                            <span class="px-2 py-0.5 font-mono font-bold text-xs rounded-lg border ${deltaClass}">${delta > 0 ? '+' : ''}${delta} ud(s)</span>
                        </div>

                        <div class="flex items-center justify-between text-xs pt-1 border-t border-gray-800/60">
                            <span class="font-bold text-white">${log.changeDetails || 'Modificación registrada'}</span>
                            <span class="font-mono text-gray-400 text-[11px]">${log.beforeStock} ➔ ${log.afterStock}</span>
                        </div>
                        ${timelineVariantsHTML}
                    </div>
                `;
            }).join('');
        }
    }

    modal.classList.remove('hidden');
}

function initModalEvents() {
    const modal = document.getElementById('modal-product-history');
    const closeBtn = document.getElementById('modal-close-btn');

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            selectedProduct = null;
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                selectedProduct = null;
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
