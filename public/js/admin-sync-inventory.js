// public/js/admin-sync-inventory.js
import { 
    db, 
    auth, 
    doc, 
    getDoc, 
    getDocs, 
    collection, 
    query, 
    where, 
    limit,
    writeBatch, 
    serverTimestamp, 
    onAuthStateChanged 
} from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js';
import { isAuthorizedForTransfer, openTransferFullModal } from './inventory-transfer.js';

// =========================================================================
// 1. SEGURIDAD: CONTROL DE ACCESO (ADMIN, DEVELOPER, VENTAS)
// =========================================================================
let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace("/auth/login.html");
        return;
    }

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const role = userDoc.data().role || 'customer';
            
            // Acceso exclusivo a admin, developer y ventas
            if (role !== 'admin' && role !== 'developer' && role !== 'ventas') {
                alert("Acceso denegado: Esta ventana de inventario está restringida a Administrador, Desarrollador y Ventas.");
                window.location.replace("/admin/index.html");
                return;
            }

            currentUser = user;
            loadAdminSidebar(role);

            const btnTransferHeader = document.getElementById('btn-sync-transfer-full');
            if (btnTransferHeader && isAuthorizedForTransfer()) {
                btnTransferHeader.classList.remove('hidden');
            }

            const emailDisplay = document.getElementById('sync-admin-email');
            if (emailDisplay) {
                emailDisplay.textContent = user.email || 'Administrador';
            }

            document.body.style.display = 'flex';
            initApp();
        } else {
            window.location.replace("/auth/login.html");
        }
    } catch (err) {
        console.error("Error validando permisos de administrador:", err);
        alert("Error validando permisos de acceso.");
        window.location.replace("/admin/index.html");
    }
});

// =========================================================================
// 2. ESTADO GLOBAL
// =========================================================================
let allProducts = [];
let filteredProducts = [];
let currentPage = 1;
const PAGE_SIZE = 18;

// Mapa de productos auditados { [productId]: timestamp/Date }
let auditedProductIdsMap = {};

// Estado del producto en sincronización activa
let currentProduct = null;
let currentSystemTotalStock = 0;
let currentPhysicalTotalStock = 0;
let variantRowsState = []; // [{ key, color, capacity, sku, systemStock, physicalStock }]
let currentProductSerials = []; // [{ id, serialNumber, color, capacity, status, auditState: 'EXISTING'|'NEW'|'REMOVED', docRef }]

const normalize = (str) => str ? str.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";

// =========================================================================
// 2.1 HELPERS DE ESTADO DE AUDITORÍA SEMANAL
// =========================================================================

// Obtiene el rango exacto de la semana actual (Lunes 00:00:00 a Domingo 23:59:59)
function getCurrentWeekRange() {
    const now = new Date();
    const day = now.getDay(); // 0: Domingo, 1: Lunes, ...
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { start: monday, end: sunday };
}

function getWeekFormattedLabel() {
    const { start, end } = getCurrentWeekRange();
    const opt = { day: 'numeric', month: 'short' };
    return `${start.toLocaleDateString('es-CO', opt)} - ${end.toLocaleDateString('es-CO', opt)} ${end.getFullYear()}`;
}

function getWeekKey(d = new Date()) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    const weekNo = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${date.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function parseAuditDate(val) {
    if (!val) return null;
    let d = null;
    if (typeof val.toDate === 'function') d = val.toDate();
    else if (val.seconds) d = new Date(val.seconds * 1000);
    else if (val instanceof Date) d = val;
    else if (typeof val === 'string' || typeof val === 'number') d = new Date(val);
    return (d && !isNaN(d.getTime())) ? d : null;
}

// Determina si el producto fue auditado explícitamente en la semana en curso
function checkIsAuditedThisWeek(p) {
    if (!p) return false;
    const currentWeekKey = getWeekKey(new Date());
    if (p.lastInventoryAuditWeek && p.lastInventoryAuditWeek === currentWeekKey) {
        return true;
    }

    const auditVal = p.lastInventoryAudit || auditedProductIdsMap[p.id];
    const auditDate = parseAuditDate(auditVal);
    if (!auditDate) return false;

    const { start, end } = getCurrentWeekRange();
    return auditDate >= start && auditDate <= end;
}

// Devuelve los detalles de auditoría para renderizado visual
function getAuditStatusDetails(p) {
    const auditVal = p.lastInventoryAudit || auditedProductIdsMap[p.id];
    const auditDate = parseAuditDate(auditVal);

    if (!auditDate) {
        return {
            auditedThisWeek: false,
            badgeHtml: `<span class="px-2 py-0.5 bg-amber-500/15 text-amber-700 border border-amber-500/30 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                          <i class="fa-regular fa-clock text-[9px]"></i> Pendiente Semana
                        </span>`,
            subtextHtml: `<span class="text-amber-600 font-sans text-[10px] font-bold"><i class="fa-regular fa-clock mr-1 text-[9px]"></i>Sin auditar</span>`,
            buttonText: 'Auditar',
            buttonIcon: 'fa-arrows-rotate',
            buttonClass: 'bg-brand-black hover:bg-brand-cyan hover:text-brand-black'
        };
    }

    const { start, end } = getCurrentWeekRange();
    const isThisWeek = auditDate >= start && auditDate <= end;

    const now = new Date();
    const isToday = auditDate.toDateString() === now.toDateString();
    const timeStr = auditDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const formattedDate = isToday ? `Hoy, ${timeStr}` : auditDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

    if (isThisWeek) {
        return {
            auditedThisWeek: true,
            badgeHtml: `<span class="px-2 py-0.5 bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                          <i class="fa-solid fa-circle-check text-[9px]"></i> Auditado Esta Semana
                        </span>`,
            subtextHtml: `<span class="text-emerald-600 font-sans text-[10px] font-bold"><i class="fa-solid fa-calendar-check mr-1 text-[9px]"></i>Auditado: ${formattedDate}</span>`,
            buttonText: 'Reauditar',
            buttonIcon: 'fa-pen-to-square',
            buttonClass: 'bg-slate-900 hover:bg-emerald-600'
        };
    } else {
        return {
            auditedThisWeek: false,
            badgeHtml: `<span class="px-2 py-0.5 bg-amber-500/15 text-amber-700 border border-amber-500/30 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                          <i class="fa-solid fa-rotate text-[9px]"></i> Requiere Auditoría
                        </span>`,
            subtextHtml: `<span class="text-gray-500 font-sans text-[10px] font-bold"><i class="fa-solid fa-clock-rotate-left mr-1 text-[9px]"></i>Última: ${formattedDate} (Sem. anterior)</span>`,
            buttonText: 'Auditar',
            buttonIcon: 'fa-arrows-rotate',
            buttonClass: 'bg-brand-black hover:bg-brand-cyan hover:text-brand-black'
        };
    }
}

async function loadAuditedProductsFromLogs() {
    try {
        const logsRef = collection(db, "inventory_audit_logs");
        const snap = await getDocs(query(logsRef, limit(1000)));
        snap.forEach(d => {
            const data = d.data();
            // REGLA ESTRICTA: Solo contar auditorías físicas de inventario (type === 'SYNC_AUDIT')
            // Ignora compras, ventas, cambios de stock automáticos y ediciones regulares del catálogo
            if (data.productId && data.type === 'SYNC_AUDIT') {
                const ts = data.timestamp || data.createdAtISO;
                if (ts && (!auditedProductIdsMap[data.productId] || ts > auditedProductIdsMap[data.productId])) {
                    auditedProductIdsMap[data.productId] = ts;
                }
            }
        });
    } catch (err) {
        console.warn("Aviso al consultar historial previo de auditorías:", err);
    }
}

// Filtro rápido interactivo por tarjetas KPI
window.setAuditFilter = (filterType) => {
    const select = document.getElementById('filter-type-select');
    if (select) {
        select.value = filterType;
    }
    currentPage = 1;
    applyFilters();
};

function highlightActiveKpiCard() {
    const activeFilter = document.getElementById('filter-type-select')?.value || 'all';
    
    const cardAll = document.getElementById('card-filter-all');
    const cardPending = document.getElementById('card-filter-pending');
    const cardAudited = document.getElementById('card-filter-audited');

    if (!cardAll || !cardPending || !cardAudited) return;

    // Resetear estilos de resaltado
    cardAll.classList.remove('ring-4', 'ring-brand-cyan/40', 'bg-cyan-50/40');
    cardPending.classList.remove('ring-4', 'ring-amber-400/40', 'bg-amber-50/40');
    cardAudited.classList.remove('ring-4', 'ring-emerald-400/40', 'bg-emerald-50/40');

    if (activeFilter === 'pending_audit') {
        cardPending.classList.add('ring-4', 'ring-amber-400/40', 'bg-amber-50/40');
    } else if (activeFilter === 'audited') {
        cardAudited.classList.add('ring-4', 'ring-emerald-400/40', 'bg-emerald-50/40');
    } else if (activeFilter === 'all') {
        cardAll.classList.add('ring-4', 'ring-brand-cyan/40', 'bg-cyan-50/40');
    }
}

// =========================================================================
// 3. INICIALIZACIÓN Y SUSCRIPCIÓN AL CATÁLOGO
// =========================================================================
async function initApp() {
    initSearchAndFilters();
    initModalEvents();

    // Precargar mapa histórico de auditorías desde logs
    await loadAuditedProductsFromLogs();

    AdminStore.subscribeToProducts((products) => {
        allProducts = products || [];
        applyFilters();
    });
}

function initSearchAndFilters() {
    const searchInput = document.getElementById('sync-search-input');
    const filterSelect = document.getElementById('filter-type-select');
    const btnClear = document.getElementById('btn-clear-search');
    const btnPrev = document.getElementById('btn-sync-prev');
    const btnNext = document.getElementById('btn-sync-next');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            if (btnClear) {
                btnClear.classList.toggle('hidden', !e.target.value);
            }
            currentPage = 1;
            applyFilters();
        });

        // Soporte de escáner en el buscador: si escanean un serial y presionan Enter
        searchInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const term = searchInput.value.trim();
                if (term) {
                    await checkDirectSerialScan(term);
                }
            }
        });
    }

    if (btnClear) {
        btnClear.addEventListener('click', () => {
            searchInput.value = '';
            btnClear.classList.add('hidden');
            currentPage = 1;
            applyFilters();
        });
    }

    if (filterSelect) {
        filterSelect.addEventListener('change', () => {
            currentPage = 1;
            applyFilters();
        });
    }

    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderCatalogGrid();
            }
        });
    }

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE) || 1;
            if (currentPage < totalPages) {
                currentPage++;
                renderCatalogGrid();
            }
        });
    }
}

// Búsqueda inteligente por escáner de serial
async function checkDirectSerialScan(term) {
    const cleanTerm = term.trim().toUpperCase();
    try {
        const q = query(
            collection(db, "product_serials"), 
            where("serialNumber", "==", cleanTerm), 
            where("status", "==", "AVAILABLE")
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
            const serialData = snap.docs[0].data();
            const prod = allProducts.find(p => p.id === serialData.productId);
            if (prod) {
                openSyncModal(prod);
                return;
            }
        }
    } catch (e) {
        console.warn("Serial scan direct match error:", e);
    }
}

function applyFilters() {
    const term = normalize(document.getElementById('sync-search-input')?.value || '');
    const filterType = document.getElementById('filter-type-select')?.value || 'all';

    filteredProducts = allProducts.filter(p => {
        const hasVariants = Array.isArray(p.combinations) && p.combinations.length > 0;
        const stock = hasVariants 
            ? p.combinations.reduce((acc, c) => acc + (Number(c.stock) || 0), 0)
            : (Number(p.stock) || 0);

        const isAuditedThisWeek = checkIsAuditedThisWeek(p);

        // Filtro por Estado de Auditoría Semanal
        if (filterType === 'pending_audit' && isAuditedThisWeek) return false;
        if (filterType === 'audited' && !isAuditedThisWeek) return false;

        // Filtro por tipo de producto y stock
        if (filterType === 'with_variants' && !hasVariants) return false;
        if (filterType === 'simple' && hasVariants) return false;
        if (filterType === 'with_stock' && stock <= 0) return false;
        if (filterType === 'zero_stock' && stock > 0) return false;

        // Filtro por texto
        if (term) {
            const searchStr = normalize(`${p.name || ''} ${p.sku || ''} ${p.brand || ''} ${p.category || ''} ${p.subcategory || ''}`);
            if (!searchStr.includes(term)) {
                // Verificar si coincide con algún SKU de variantes
                if (hasVariants) {
                    const matchVarSku = p.combinations.some(c => normalize(c.sku || '').includes(term));
                    if (!matchVarSku) return false;
                } else {
                    return false;
                }
            }
        }

        return true;
    });

    updateCounters();
    renderCatalogGrid();
}

function updateCounters() {
    const total = allProducts.length;
    const auditedThisWeek = allProducts.filter(p => checkIsAuditedThisWeek(p)).length;
    const pendingThisWeek = Math.max(0, total - auditedThisWeek);
    const percent = total > 0 ? Math.round((auditedThisWeek / total) * 100) : 0;

    // Actualizar KPI Cards de Auditoría Semanal
    const kpiTotal = document.getElementById('kpi-total-products');
    const kpiPending = document.getElementById('kpi-pending-products');
    const kpiAudited = document.getElementById('kpi-audited-products');
    const progressText = document.getElementById('audit-progress-text');
    const progressBar = document.getElementById('audit-progress-bar');
    const weekRangeText = document.getElementById('audit-week-range-text');

    if (kpiTotal) kpiTotal.textContent = total;
    if (kpiPending) kpiPending.textContent = pendingThisWeek;
    if (kpiAudited) kpiAudited.textContent = auditedThisWeek;

    const weekLabel = getWeekFormattedLabel();
    if (weekRangeText) {
        weekRangeText.textContent = weekLabel;
    }

    if (progressText) {
        progressText.textContent = `${percent}% (${auditedThisWeek} de ${total} productos)`;
    }
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }

    // Texto informativo del listado
    const info = document.getElementById('sync-counter-info');
    if (info) {
        const activeFilter = document.getElementById('filter-type-select')?.value || 'all';
        let filterLabel = 'todos los productos';
        if (activeFilter === 'pending_audit') filterLabel = `pendientes esta semana (${weekLabel})`;
        else if (activeFilter === 'audited') filterLabel = `auditados esta semana (${weekLabel})`;
        else if (activeFilter === 'with_stock') filterLabel = 'con stock';
        else if (activeFilter === 'zero_stock') filterLabel = 'sin stock';
        else if (activeFilter === 'with_variants') filterLabel = 'con variantes';

        info.innerHTML = `Mostrando <strong class="text-brand-black">${filteredProducts.length}</strong> de <strong class="text-brand-black">${total}</strong> (${filterLabel})`;
    }

    highlightActiveKpiCard();
}

// =========================================================================
// 4. RENDERIZADO DEL DIRECTORIO DE PRODUCTOS
// =========================================================================
function renderCatalogGrid() {
    const grid = document.getElementById('sync-products-grid');
    const paginationBar = document.getElementById('sync-pagination-bar');
    const pageInfo = document.getElementById('sync-page-info');
    const pageNumber = document.getElementById('sync-page-number');
    const btnPrev = document.getElementById('btn-sync-prev');
    const btnNext = document.getElementById('btn-sync-next');

    if (!grid) return;

    if (filteredProducts.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-16 text-center text-gray-400 bg-white border border-gray-200 rounded-3xl p-8">
                <i class="fa-solid fa-box-open text-4xl text-gray-300 mb-3 block"></i>
                <p class="font-black text-sm uppercase tracking-wider text-gray-700">No se encontraron productos</p>
                <p class="text-xs text-gray-400 mt-1">Prueba con otro término de búsqueda o limpia los filtros.</p>
            </div>
        `;
        if (paginationBar) paginationBar.classList.add('hidden');
        return;
    }

    if (paginationBar) paginationBar.classList.remove('hidden');

    const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, filteredProducts.length);
    const pageProducts = filteredProducts.slice(startIdx, endIdx);

    if (pageInfo) pageInfo.textContent = `Mostrando ${startIdx + 1}-${endIdx} de ${filteredProducts.length} productos`;
    if (pageNumber) pageNumber.textContent = `${currentPage} / ${totalPages}`;
    if (btnPrev) btnPrev.disabled = (currentPage <= 1);
    if (btnNext) btnNext.disabled = (currentPage >= totalPages);

    const canTransfer = isAuthorizedForTransfer();

    grid.innerHTML = pageProducts.map(prod => {
        const hasVariants = Array.isArray(prod.combinations) && prod.combinations.length > 0;
        const totalStock = hasVariants 
            ? prod.combinations.reduce((sum, c) => sum + (Number(c.stock) || 0), 0)
            : (Number(prod.stock) || 0);

        let bodegaStock = 0;
        let fullStock = 0;
        if (hasVariants) {
            prod.combinations.forEach(c => {
                if (c.branchStock) {
                    bodegaStock += Number(c.branchStock.bodega) || 0;
                    fullStock += Number(c.branchStock.full) || 0;
                } else {
                    bodegaStock += Number(c.stock) || 0;
                }
            });
        } else if (prod.branchStock) {
            bodegaStock = Number(prod.branchStock.bodega) || 0;
            fullStock = Number(prod.branchStock.full) || 0;
        } else {
            bodegaStock = totalStock;
            fullStock = 0;
        }

        const audit = getAuditStatusDetails(prod);

        const img = prod.mainImage || (Array.isArray(prod.images) && prod.images[0]) || '/img/logo.webp';
        const brand = prod.brand || 'PixelTech';
        const sku = prod.sku || 'SIN-SKU';

        const stockBadgeClass = totalStock > 0 
            ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
            : 'bg-rose-50 text-rose-600 border-rose-200';

        const typeBadge = hasVariants
            ? `<span class="px-2 py-0.5 bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20 rounded-md text-[9px] font-black uppercase tracking-wider">${prod.combinations.length} Variantes</span>`
            : `<span class="px-2 py-0.5 bg-slate-100 text-gray-600 border border-gray-200 rounded-md text-[9px] font-black uppercase tracking-wider">Simple</span>`;

        const sideStripe = audit.auditedThisWeek
            ? 'border-l-[6px] border-l-emerald-500 border-gray-200 hover:border-emerald-500'
            : 'border-l-[6px] border-l-amber-400 border-gray-200 hover:border-amber-400';

        return `
            <div class="bg-white border-2 ${sideStripe} rounded-3xl p-5 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between group">
                <div class="flex items-start gap-3.5 mb-4">
                    <img src="${img}" alt="${prod.name}" class="w-16 h-16 object-contain rounded-2xl bg-slate-50 p-1.5 border border-gray-100 shrink-0 group-hover:scale-105 transition">
                    <div class="flex-grow min-w-0">
                        <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
                            <span class="text-[9px] font-black uppercase text-gray-400">${brand}</span>
                            ${typeBadge}
                            ${audit.badgeHtml}
                        </div>
                        <h3 class="text-xs sm:text-sm font-black text-brand-black line-clamp-2 uppercase leading-snug group-hover:text-brand-cyan transition-colors" title="${prod.name}">
                            ${prod.name}
                        </h3>
                        <div class="flex items-center justify-between text-[10px] font-mono text-gray-400 mt-1.5 font-bold flex-wrap gap-1">
                            <span>SKU: ${sku}</span>
                            ${audit.subtextHtml}
                        </div>
                    </div>
                </div>

                <div class="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                    <div>
                        <span class="text-[9px] font-black uppercase tracking-widest text-gray-400 block mb-0.5">Stock Sistema</span>
                        <span class="px-2.5 py-1 rounded-xl text-xs font-mono font-black border ${stockBadgeClass} inline-block">
                            ${totalStock} ud(s)
                        </span>
                        <div class="flex items-center gap-1.5 mt-1 text-[9px] font-bold text-gray-400">
                            <span>Bodega: <strong class="text-brand-black">${bodegaStock}</strong></span>
                            ${fullStock > 0 ? `<span class="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-black border border-amber-200">Full: ${fullStock}</span>` : ''}
                        </div>
                    </div>

                    <div class="flex items-center gap-1.5">
                        ${canTransfer ? `
                        <button type="button" onclick="window.openTransferFullModal('${prod.id}')"
                            class="px-2.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-wider rounded-xl transition shadow-xs flex items-center gap-1 cursor-pointer" title="Trasladar a Full o Bodega">
                            <i class="fa-solid fa-truck-ramp-box text-[11px]"></i>
                            <span class="hidden sm:inline">Trasladar</span>
                        </button>
                        ` : ''}
                        <button type="button" onclick="window.selectProductForSync('${prod.id}')"
                            class="px-4 py-2 ${audit.buttonClass} text-white font-black text-xs uppercase tracking-wider rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer">
                            <i class="fa-solid ${audit.buttonIcon} text-[11px]"></i> 
                            ${audit.buttonText}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.addEventListener('inventoryTransferCompleted', async (e) => {
    const { productId } = e.detail || {};
    if (productId) {
        try {
            const snap = await getDoc(doc(db, "products", productId));
            if (snap.exists()) {
                const updatedProd = { id: snap.id, ...snap.data() };
                const idx = allProducts.findIndex(p => p.id === productId);
                if (idx >= 0) {
                    allProducts[idx] = updatedProd;
                }
                applyFilters();
            }
        } catch (err) {
            console.error("Error al actualizar producto tras traslado:", err);
        }
    }
});

window.selectProductForSync = (productId) => {
    const prod = allProducts.find(p => p.id === productId);
    if (!prod) {
        alert("Producto no encontrado.");
        return;
    }
    openSyncModal(prod);
};

// =========================================================================
// 5. ESPACIO DE TRABAJO Y MODAL DE SINCRONIZACIÓN
// =========================================================================
async function openSyncModal(prod) {
    currentProduct = prod;
    const modal = document.getElementById('sync-modal');
    if (!modal) return;

    // Llenar información de cabecera
    const img = prod.mainImage || (Array.isArray(prod.images) && prod.images[0]) || '/img/logo.webp';
    document.getElementById('modal-product-img').src = img;
    document.getElementById('modal-product-brand').textContent = prod.brand || 'PixelTech';
    document.getElementById('modal-product-category').textContent = prod.category || 'General';
    document.getElementById('modal-product-title').textContent = prod.name;
    document.getElementById('modal-product-sku').textContent = prod.sku || 'SIN-SKU';

    const hasVariants = Array.isArray(prod.combinations) && prod.combinations.length > 0;
    document.getElementById('modal-product-type-badge').textContent = hasVariants 
        ? `${prod.combinations.length} Variantes` 
        : 'Producto Simple';

    // Badge de estado de auditoría en la cabecera del modal
    const isThisWeek = checkIsAuditedThisWeek(prod);
    const auditVal = prod.lastInventoryAudit || auditedProductIdsMap[prod.id];
    const auditDate = parseAuditDate(auditVal);
    const auditBadge = document.getElementById('modal-product-audit-badge');
    if (auditBadge) {
        if (isThisWeek && auditDate) {
            const timeStr = auditDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            auditBadge.innerHTML = `<i class="fa-solid fa-circle-check mr-1 text-[8px]"></i> Auditado Esta Semana (${timeStr})`;
            auditBadge.className = "text-[9px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-400/20 px-2 py-0.5 rounded-md border border-emerald-400/30 inline-flex items-center";
            auditBadge.classList.remove('hidden');
        } else if (auditDate) {
            const opt = { day: '2-digit', month: 'short' };
            auditBadge.innerHTML = `<i class="fa-solid fa-clock-rotate-left mr-1 text-[8px]"></i> Pendiente Esta Semana (Última: ${auditDate.toLocaleDateString('es-CO', opt)})`;
            auditBadge.className = "text-[9px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/20 px-2 py-0.5 rounded-md border border-amber-400/30 inline-flex items-center";
            auditBadge.classList.remove('hidden');
        } else {
            auditBadge.innerHTML = `<i class="fa-regular fa-clock mr-1 text-[8px]"></i> Pendiente Esta Semana (Sin auditar)`;
            auditBadge.className = "text-[9px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/20 px-2 py-0.5 rounded-md border border-amber-400/30 inline-flex items-center";
            auditBadge.classList.remove('hidden');
        }
    }

    // Preparar estado de conteo
    const boxSimple = document.getElementById('box-simple-count');
    const boxVariants = document.getElementById('box-variants-count');
    const variantSelectCol = document.getElementById('serial-variant-picker-col');
    const serialInputCol = document.getElementById('serial-input-col');
    const variantSelect = document.getElementById('serial-variant-select');

    if (hasVariants) {
        boxSimple.classList.add('hidden');
        boxVariants.classList.remove('hidden');

        // Configurar selector de variantes para seriales
        if (variantSelectCol) variantSelectCol.classList.remove('hidden');
        if (serialInputCol) {
            serialInputCol.classList.remove('sm:col-span-12');
            serialInputCol.classList.add('sm:col-span-8');
        }

        if (variantSelect) {
            variantSelect.innerHTML = '<option value="">-- Selecciona Variante --</option>' + 
                prod.combinations.map(c => {
                    const label = `${c.color || 'Estándar'} ${c.capacity ? `/ ${c.capacity}` : ''}`;
                    const val = `${c.color || ''}__${c.capacity || ''}`;
                    return `<option value="${val}">${label} (${c.sku || ''})</option>`;
                }).join('');
        }

        // Configurar filas de variantes
        variantRowsState = prod.combinations.map((c, idx) => {
            const key = `${c.color || ''}__${c.capacity || ''}__${idx}`;
            const sysStock = Number(c.stock) || 0;
            return {
                key,
                color: c.color || '',
                capacity: c.capacity || '',
                sku: c.sku || `${prod.sku || 'SKU'}-${idx+1}`,
                systemStock: sysStock,
                physicalStock: sysStock // Inicializa igual al sistema
            };
        });

        currentSystemTotalStock = variantRowsState.reduce((sum, r) => sum + r.systemStock, 0);
        currentPhysicalTotalStock = currentSystemTotalStock;

        renderVariantsTable();
    } else {
        boxSimple.classList.remove('hidden');
        boxVariants.classList.add('hidden');

        if (variantSelectCol) variantSelectCol.classList.add('hidden');
        if (serialInputCol) {
            serialInputCol.classList.remove('sm:col-span-8');
            serialInputCol.classList.add('sm:col-span-12');
        }

        currentSystemTotalStock = Number(prod.stock) || 0;
        currentPhysicalTotalStock = currentSystemTotalStock;

        const inputSimple = document.getElementById('input-simple-physical-stock');
        if (inputSimple) inputSimple.value = currentPhysicalTotalStock;
    }

    updateGlobalStockMetrics();

    // Cargar seriales actuales desde Firestore
    await loadProductSerialsFromFirestore(prod.id);

    modal.classList.remove('hidden');

    // Auto-enfocar el campo de escaneo para lectura inmediata con pistola láser
    setTimeout(() => {
        const inputSerial = document.getElementById('input-new-serial');
        if (inputSerial) {
            inputSerial.focus();
            inputSerial.select();
        }
    }, 150);
}

function updateGlobalStockMetrics() {
    const statSys = document.getElementById('stat-system-stock');
    const statPhy = document.getElementById('stat-physical-stock');
    const statDelta = document.getElementById('stat-delta-stock');
    const statLabel = document.getElementById('stat-delta-label');

    if (statSys) statSys.textContent = currentSystemTotalStock;
    if (statPhy) statPhy.textContent = currentPhysicalTotalStock;

    const delta = currentPhysicalTotalStock - currentSystemTotalStock;

    if (statDelta) {
        statDelta.textContent = `${delta > 0 ? '+' : ''}${delta} ud(s)`;
        if (delta === 0) {
            statDelta.className = "text-xl sm:text-2xl font-black font-mono px-3 py-1 rounded-xl bg-slate-100 text-brand-black";
            if (statLabel) statLabel.textContent = "Inventario Cuadrado";
        } else if (delta > 0) {
            statDelta.className = "text-xl sm:text-2xl font-black font-mono px-3 py-1 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200";
            if (statLabel) statLabel.textContent = `Sobrante Físico (+${delta})`;
        } else {
            statDelta.className = "text-xl sm:text-2xl font-black font-mono px-3 py-1 rounded-xl bg-rose-50 text-rose-600 border border-rose-200";
            if (statLabel) statLabel.textContent = `Faltante / Merma (${delta})`;
        }
    }
}

// =========================================================================
// 6. CONTROL DE CONTEO EN PRODUCTOS SIMPLES
// =========================================================================
window.stepSimpleCount = (step) => {
    const input = document.getElementById('input-simple-physical-stock');
    if (!input) return;
    let val = (parseInt(input.value, 10) || 0) + step;
    if (val < 0) val = 0;
    input.value = val;
    currentPhysicalTotalStock = val;
    updateGlobalStockMetrics();
};

window.setSimpleCountToSerialsCount = () => {
    const activeSerials = currentProductSerials.filter(s => s.auditState !== 'REMOVED');
    const input = document.getElementById('input-simple-physical-stock');
    if (input) {
        input.value = activeSerials.length;
        currentPhysicalTotalStock = activeSerials.length;
        updateGlobalStockMetrics();
    }
};

// =========================================================================
// 7. CONTROL DE CONTEO EN PRODUCTOS CON VARIANTES
// =========================================================================
function renderVariantsTable() {
    const tbody = document.getElementById('variants-sync-tbody');
    if (!tbody) return;

    tbody.innerHTML = variantRowsState.map((row, idx) => {
        const delta = row.physicalStock - row.systemStock;
        const deltaClass = delta === 0 
            ? 'text-gray-400 bg-slate-100' 
            : (delta > 0 ? 'text-emerald-600 bg-emerald-50 border border-emerald-200' : 'text-rose-600 bg-rose-50 border border-rose-200');

        const activeSerialsThisVar = currentProductSerials.filter(s => 
            s.auditState !== 'REMOVED' && 
            (s.color || '') === row.color && 
            (s.capacity || '') === row.capacity
        ).length;

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3">
                    <span class="font-black text-brand-black text-xs block">${row.color || 'Estándar'}</span>
                    ${row.capacity ? `<span class="text-[10px] text-gray-400 font-bold">${row.capacity}</span>` : ''}
                </td>
                <td class="p-3 font-mono text-[11px] text-gray-500">${row.sku}</td>
                <td class="p-3 text-center font-mono text-sm">${row.systemStock}</td>
                <td class="p-3 text-center">
                    <div class="inline-flex items-center justify-center gap-1.5">
                        <button type="button" onclick="window.stepVariantCount(${idx}, -1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-brand-black font-bold flex items-center justify-center transition">
                            <i class="fa-solid fa-minus text-[10px]"></i>
                        </button>
                        <input type="number" min="0" value="${row.physicalStock}" 
                            onchange="window.updateVariantCountInput(${idx}, this.value)"
                            class="w-16 text-center font-mono font-black text-sm bg-slate-50 border border-gray-300 rounded-lg py-1 text-brand-black outline-none focus:border-brand-cyan">
                        <button type="button" onclick="window.stepVariantCount(${idx}, 1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-brand-black font-bold flex items-center justify-center transition">
                            <i class="fa-solid fa-plus text-[10px]"></i>
                        </button>
                    </div>
                </td>
                <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded-md font-mono text-xs font-black ${deltaClass}">
                        ${delta > 0 ? '+' : ''}${delta}
                    </span>
                </td>
                <td class="p-3 text-center font-mono text-xs text-brand-cyan font-bold">
                    ${activeSerialsThisVar}
                </td>
            </tr>
        `;
    }).join('');
}

window.stepVariantCount = (idx, step) => {
    if (!variantRowsState[idx]) return;
    let val = variantRowsState[idx].physicalStock + step;
    if (val < 0) val = 0;
    variantRowsState[idx].physicalStock = val;
    recalculateVariantsTotal();
    renderVariantsTable();
};

window.updateVariantCountInput = (idx, value) => {
    if (!variantRowsState[idx]) return;
    let val = parseInt(value, 10);
    if (isNaN(val) || val < 0) val = 0;
    variantRowsState[idx].physicalStock = val;
    recalculateVariantsTotal();
    renderVariantsTable();
};

function recalculateVariantsTotal() {
    currentPhysicalTotalStock = variantRowsState.reduce((sum, r) => sum + r.physicalStock, 0);
    updateGlobalStockMetrics();
}

// =========================================================================
// 8. CARGA Y GESTIÓN DE SERIALES (SN / IMEI)
// =========================================================================
async function loadProductSerialsFromFirestore(productId) {
    const tbody = document.getElementById('serials-sync-tbody');
    const badge = document.getElementById('serials-summary-badge');
    const btnMatch = document.getElementById('btn-simple-match-serials');
    const counterSpan = document.getElementById('simple-serials-counter');

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400 font-sans text-xs"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan mr-1"></i> Cargando seriales desde Firestore...</td></tr>`;
    }

    try {
        const q = query(
            collection(db, "product_serials"), 
            where("productId", "==", productId),
            where("status", "==", "AVAILABLE")
        );
        const snap = await getDocs(q);

        currentProductSerials = snap.docs.map(d => ({
            id: d.id,
            docRef: d.ref,
            serialNumber: d.data().serialNumber,
            color: d.data().color || null,
            capacity: d.data().capacity || null,
            status: d.data().status,
            auditState: 'EXISTING', // 'EXISTING' | 'NEW' | 'REMOVED'
            supplierName: d.data().supplierName || ''
        }));

        renderSerialsTable();

        if (badge) {
            badge.textContent = `${currentProductSerials.length} seriales en sistema`;
        }

        if (counterSpan) counterSpan.textContent = currentProductSerials.length;
        if (btnMatch) {
            btnMatch.classList.toggle('hidden', currentProductSerials.length === 0);
        }

        // Detectar si hay descuadre histórico (Stock numérico en 0 pero con seriales disponibles)
        const mismatchBanner = document.getElementById('modal-mismatch-banner');
        const mismatchCount = document.getElementById('mismatch-serials-count');
        const btnFixStock = document.getElementById('btn-fix-stock-to-serials');
        const btnRetireAll = document.getElementById('btn-retire-all-serials');

        if (currentSystemTotalStock === 0 && currentProductSerials.length > 0) {
            if (mismatchBanner) mismatchBanner.classList.remove('hidden');
            if (mismatchCount) mismatchCount.textContent = currentProductSerials.length;
            if (btnFixStock) btnFixStock.textContent = currentProductSerials.length;
            if (btnRetireAll) btnRetireAll.textContent = currentProductSerials.length;
        } else {
            if (mismatchBanner) mismatchBanner.classList.add('hidden');
        }

    } catch (err) {
        console.error("Error cargando seriales de producto:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-400 font-sans text-xs">Error al consultar seriales en Firestore.</td></tr>`;
        }
    }
}

function renderSerialsTable() {
    const tbody = document.getElementById('serials-sync-tbody');
    if (!tbody) return;

    if (currentProductSerials.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="p-6 text-center text-gray-500 font-sans text-xs">
                    No hay seriales activos registrados para este producto. Puedes escanearlos arriba.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = currentProductSerials.map((s, idx) => {
        let stateBadge = '';
        let rowClass = 'hover:bg-slate-900/60 transition';
        let actionBtn = '';

        if (s.auditState === 'NEW') {
            stateBadge = `<span class="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-black uppercase font-sans inline-flex items-center gap-1"><i class="fa-solid fa-plus text-[8px]"></i> Nuevo Físico</span>`;
            actionBtn = `
                <button type="button" onclick="window.removePendingSerial(${idx})" class="text-rose-400 hover:text-rose-300 font-bold font-sans text-xs px-2 py-1 transition" title="Eliminar serial ingresado">
                    <i class="fa-solid fa-trash-can mr-1"></i> Quitar
                </button>
            `;
        } else if (s.auditState === 'REMOVED') {
            stateBadge = `<span class="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[9px] font-black uppercase font-sans inline-flex items-center gap-1"><i class="fa-solid fa-ban text-[8px]"></i> No Encontrado</span>`;
            rowClass = 'bg-rose-950/20 opacity-60';
            actionBtn = `
                <button type="button" onclick="window.restoreSerial(${idx})" class="text-brand-cyan hover:underline font-bold font-sans text-xs px-2 py-1 transition">
                    <i class="fa-solid fa-rotate-left mr-1"></i> Conservar
                </button>
            `;
        } else {
            stateBadge = `<span class="px-2 py-0.5 rounded-md bg-white/10 text-gray-300 border border-white/10 text-[9px] font-bold uppercase font-sans inline-flex items-center gap-1"><i class="fa-solid fa-check text-[8px]"></i> En Sistema</span>`;
            actionBtn = `
                <button type="button" onclick="window.markSerialRemoved(${idx})" class="text-rose-400 hover:text-rose-300 font-bold font-sans text-[11px] px-2 py-1 rounded-lg hover:bg-rose-500/10 transition" title="Marcar como no encontrado en físico">
                    <i class="fa-solid fa-ban mr-1"></i> Retirar
                </button>
            `;
        }

        const variantLabel = (s.color || s.capacity) 
            ? `${s.color || ''} ${s.capacity ? `/ ${s.capacity}` : ''}`
            : '<span class="text-gray-600 font-sans italic">Estándar</span>';

        return `
            <tr class="${rowClass}">
                <td class="p-3 font-bold text-white tracking-wider">${s.serialNumber}</td>
                <td class="p-3 text-gray-400 font-sans text-xs">${variantLabel}</td>
                <td class="p-3 text-center">${stateBadge}</td>
                <td class="p-3 text-right">${actionBtn}</td>
            </tr>
        `;
    }).join('');
}

window.removePendingSerial = (idx) => {
    currentProductSerials.splice(idx, 1);
    renderSerialsTable();
    updateSerialsSummaryCounter();
    if (currentProduct?.combinations?.length > 0) renderVariantsTable();
};

window.markSerialRemoved = (idx) => {
    if (currentProductSerials[idx]) {
        currentProductSerials[idx].auditState = 'REMOVED';
        renderSerialsTable();
        updateSerialsSummaryCounter();
        if (currentProduct?.combinations?.length > 0) renderVariantsTable();
    }
};

window.restoreSerial = (idx) => {
    if (currentProductSerials[idx]) {
        currentProductSerials[idx].auditState = 'EXISTING';
        renderSerialsTable();
        updateSerialsSummaryCounter();
        if (currentProduct?.combinations?.length > 0) renderVariantsTable();
    }
};

window.markAllSerialsRemoved = () => {
    const existingCount = currentProductSerials.filter(s => s.auditState !== 'REMOVED').length;
    if (existingCount === 0) return;
    if (!confirm(`¿Estás seguro de marcar TODOS los ${existingCount} seriales como "NO ENCONTRADOS / RETIRADOS"?\n\n(Usa esto si físicamente no queda ningún producto en sede).`)) return;

    currentProductSerials.forEach(s => {
        if (s.auditState !== 'NEW') s.auditState = 'REMOVED';
    });
    renderSerialsTable();
    updateSerialsSummaryCounter();
    if (currentProduct?.combinations?.length > 0) renderVariantsTable();
};

window.restoreAllSerials = () => {
    currentProductSerials.forEach(s => {
        if (s.auditState === 'REMOVED') s.auditState = 'EXISTING';
    });
    renderSerialsTable();
    updateSerialsSummaryCounter();
    if (currentProduct?.combinations?.length > 0) renderVariantsTable();
};

function updateSerialsSummaryCounter() {
    const badge = document.getElementById('serials-summary-badge');
    const counterSpan = document.getElementById('simple-serials-counter');
    const active = currentProductSerials.filter(s => s.auditState !== 'REMOVED').length;
    if (badge) badge.textContent = `${active} seriales verificados`;
    if (counterSpan) counterSpan.textContent = active;
}

// =========================================================================
// 9. AGREGAR SERIALES MANUALMENTE O POR ESCÁNER LÁSER
// =========================================================================

// Retroalimentación de audio para pistola de código de barras
function playScanAudio(success = true) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (success) {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, ctx.currentTime);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.08);
        } else {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(280, ctx.currentTime);
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.16);
        }
    } catch (e) {
        // Silencioso si el navegador bloquea audio inicial
    }
}

let laserScanDebounceTimer = null;

function initModalEvents() {
    const modal = document.getElementById('sync-modal');
    const btnClose = document.getElementById('btn-close-sync-modal');
    const btnCancel = document.getElementById('btn-cancel-modal');
    const btnSubmit = document.getElementById('btn-submit-sync');
    const inputSerial = document.getElementById('input-new-serial');
    const btnAddSerial = document.getElementById('btn-add-serial');
    const inputSimple = document.getElementById('input-simple-physical-stock');

    if (inputSimple) {
        inputSimple.addEventListener('input', (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < 0) val = 0;
            currentPhysicalTotalStock = val;
            updateGlobalStockMetrics();
        });
    }

    if (btnClose) btnClose.addEventListener('click', closeSyncModal);
    if (btnCancel) btnCancel.addEventListener('click', closeSyncModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSyncModal();
    });

    if (btnAddSerial && inputSerial) {
        btnAddSerial.addEventListener('click', () => {
            if (laserScanDebounceTimer) clearTimeout(laserScanDebounceTimer);
            processSingleSerialInput();
        });

        // 1. Enter automático enviado por la pistola láser o teclado manual
        inputSerial.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (laserScanDebounceTimer) clearTimeout(laserScanDebounceTimer);
                processSingleSerialInput();
            }
        });

        // 2. Detección automática por ráfaga láser para escáneres sin sufijo Enter
        inputSerial.addEventListener('input', () => {
            if (laserScanDebounceTimer) clearTimeout(laserScanDebounceTimer);
            const val = inputSerial.value.trim();
            if (val.length >= 3) {
                laserScanDebounceTimer = setTimeout(() => {
                    processSingleSerialInput();
                }, 130);
            }
        });
    }

    // 3. Captura global de pistola láser mientras el modal esté abierto
    window.addEventListener('keydown', (e) => {
        const m = document.getElementById('sync-modal');
        if (!m || m.classList.contains('hidden')) return;

        const activeEl = document.activeElement;
        // Respetar campos de texto donde el usuario escribe intencionalmente
        if (activeEl && (
            activeEl.id === 'sync-notes-input' ||
            activeEl.id === 'textarea-bulk-serials' ||
            activeEl.id === 'serial-variant-select' ||
            activeEl.id === 'sync-reason-select' ||
            activeEl.id === 'input-simple-physical-stock' ||
            activeEl.classList?.contains('count-input') ||
            activeEl.tagName === 'SELECT'
        )) {
            return;
        }

        const inputTarget = document.getElementById('input-new-serial');
        if (!inputTarget) return;

        // Si el foco se perdió y la pistola láser dispara un carácter imprimible, re-enfocar de inmediato
        if (activeEl !== inputTarget && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            inputTarget.focus();
        }
    });

    // Toggle Pegado Masivo
    const btnToggleBulk = document.getElementById('btn-toggle-bulk-serials');
    const bulkContainer = document.getElementById('bulk-serials-container');
    const btnCancelBulk = document.getElementById('btn-cancel-bulk');
    const btnProcessBulk = document.getElementById('btn-process-bulk-serials');

    if (btnToggleBulk && bulkContainer) {
        btnToggleBulk.addEventListener('click', () => {
            bulkContainer.classList.toggle('hidden');
        });
    }

    if (btnCancelBulk && bulkContainer) {
        btnCancelBulk.addEventListener('click', () => {
            bulkContainer.classList.add('hidden');
            document.getElementById('textarea-bulk-serials').value = '';
        });
    }

    if (btnProcessBulk) {
        btnProcessBulk.addEventListener('click', processBulkSerials);
    }

    if (btnSubmit) {
        btnSubmit.addEventListener('click', handleSubmitSync);
    }
}

function closeSyncModal() {
    const modal = document.getElementById('sync-modal');
    if (modal) modal.classList.add('hidden');
    if (laserScanDebounceTimer) clearTimeout(laserScanDebounceTimer);
    currentProduct = null;
    currentProductSerials = [];
    variantRowsState = [];
}

async function processSingleSerialInput() {
    const input = document.getElementById('input-new-serial');
    const variantSelect = document.getElementById('serial-variant-select');
    const statusMsg = document.getElementById('serial-scan-status-msg');

    if (!input) return;
    if (laserScanDebounceTimer) clearTimeout(laserScanDebounceTimer);

    const val = input.value.trim().toUpperCase();
    if (!val) return;

    const flashBorder = (type) => {
        const cls = type === 'success' 
            ? ['border-emerald-500', 'ring-2', 'ring-emerald-500/50']
            : ['border-amber-400', 'ring-2', 'ring-amber-400/50'];
        input.classList.add(...cls);
        setTimeout(() => input.classList.remove(...cls), 400);
    };

    let color = null;
    let capacity = null;

    if (currentProduct?.combinations?.length > 0) {
        if (!variantSelect?.value) {
            playScanAudio(false);
            flashBorder('error');
            if (statusMsg) {
                statusMsg.innerHTML = `<span class="text-rose-400 font-bold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Selecciona primero la variante para este serial.</span>`;
            }
            alert("Aviso: Selecciona a qué variante pertenece el serial que estás agregando.");
            variantSelect?.focus();
            return;
        }
        const [c, cap] = variantSelect.value.split('__');
        color = c || null;
        capacity = cap || null;
    }

    // Validar si ya está en la lista actual
    const existing = currentProductSerials.find(s => s.serialNumber === val);
    if (existing) {
        if (existing.auditState === 'REMOVED') {
            existing.auditState = 'EXISTING';
            playScanAudio(true);
            flashBorder('success');
            if (statusMsg) {
                statusMsg.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-check mr-1"></i>Serial ${val} restaurado a la lista activa.</span>`;
                setTimeout(() => { if (statusMsg) statusMsg.innerHTML = ''; }, 3500);
            }
            input.value = '';
            input.focus();
            renderSerialsTable();
            updateSerialsSummaryCounter();
            return;
        } else {
            playScanAudio(false);
            flashBorder('error');
            if (statusMsg) {
                statusMsg.innerHTML = `<span class="text-amber-400 font-bold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Serial ${val} ya escaneado en la lista.</span>`;
                setTimeout(() => { if (statusMsg) statusMsg.innerHTML = ''; }, 3500);
            }
            input.value = '';
            input.focus();
            return;
        }
    }

    // Validar en Firestore si el serial ya pertenece a otro producto o compra
    try {
        const q = query(collection(db, "product_serials"), where("serialNumber", "==", val));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const conflict = snap.docs[0].data();
            if (conflict.productId !== currentProduct.id) {
                playScanAudio(false);
                flashBorder('error');
                alert(`Conflicto: El serial ${val} ya existe en el sistema asignado a otro producto: "${conflict.productName}".`);
                input.value = '';
                input.focus();
                return;
            }
        }
    } catch (e) {
        console.warn("Serial validation query warning:", e);
    }

    // Agregar a la lista (al inicio para visualización instantánea del escaneo)
    currentProductSerials.unshift({
        id: `NEW_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        serialNumber: val,
        color: color,
        capacity: capacity,
        status: 'AVAILABLE',
        auditState: 'NEW'
    });

    playScanAudio(true);
    flashBorder('success');

    input.value = '';
    input.focus();

    if (statusMsg) {
        statusMsg.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-barcode mr-1"></i>Serial ${val} agregado correctamente.</span>`;
        setTimeout(() => { if (statusMsg) statusMsg.innerHTML = ''; }, 3500);
    }

    renderSerialsTable();
    updateSerialsSummaryCounter();
    if (currentProduct?.combinations?.length > 0) renderVariantsTable();
}

function processBulkSerials() {
    const textarea = document.getElementById('textarea-bulk-serials');
    const variantSelect = document.getElementById('serial-variant-select');
    if (!textarea) return;

    const raw = textarea.value;
    const tokens = raw.split(/[\r\n,;\t]+/).map(t => t.trim().toUpperCase()).filter(Boolean);

    if (tokens.length === 0) {
        alert("Pega al menos un número de serie.");
        return;
    }

    let color = null;
    let capacity = null;

    if (currentProduct?.combinations?.length > 0) {
        if (!variantSelect?.value) {
            alert("Aviso: Selecciona a qué variante pertenecen los seriales a procesar.");
            variantSelect?.focus();
            return;
        }
        const [c, cap] = variantSelect.value.split('__');
        color = c || null;
        capacity = cap || null;
    }

    let addedCount = 0;
    tokens.forEach(val => {
        const exists = currentProductSerials.some(s => s.serialNumber === val);
        if (!exists) {
            currentProductSerials.push({
                id: `NEW_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                serialNumber: val,
                color: color,
                capacity: capacity,
                status: 'AVAILABLE',
                auditState: 'NEW'
            });
            addedCount++;
        }
    });

    textarea.value = '';
    document.getElementById('bulk-serials-container')?.classList.add('hidden');
    renderSerialsTable();
    updateSerialsSummaryCounter();
    if (currentProduct?.combinations?.length > 0) renderVariantsTable();

    alert(`Sincronización: Se agregaron ${addedCount} nuevos seriales a la lista.`);
}

// =========================================================================
// 10. APLICAR SINCRONIZACIÓN Y ACTUALIZAR FIRESTORE ATÓMICAMENTE
// =========================================================================
async function handleSubmitSync() {
    if (!currentProduct) return;

    const btnSubmit = document.getElementById('btn-submit-sync');
    const reasonSelect = document.getElementById('sync-reason-select');
    const notesInput = document.getElementById('sync-notes-input');

    const hasVariants = Array.isArray(currentProduct.combinations) && currentProduct.combinations.length > 0;
    const finalPhysicalStock = currentPhysicalTotalStock;
    const deltaTotal = finalPhysicalStock - currentSystemTotalStock;

    const addedSerials = currentProductSerials.filter(s => s.auditState === 'NEW');
    const removedSerials = currentProductSerials.filter(s => s.auditState === 'REMOVED');
    const activeSerials = currentProductSerials.filter(s => s.auditState !== 'REMOVED');
    const unitsWithoutSerial = Math.max(0, finalPhysicalStock - activeSerials.length);

    // Validación de coherencia y distribución con/sin serial
    if (activeSerials.length > 0 && activeSerials.length !== finalPhysicalStock) {
        if (finalPhysicalStock > activeSerials.length) {
            const proceed = confirm(
                `DISTRIBUCIÓN DE UNIDADES EN SINCRONIZACIÓN:\n\n` +
                `- Conteo físico total: ${finalPhysicalStock} unidad(es).\n` +
                `- Con serial físico (SN/IMEI): ${activeSerials.length} serial(es).\n` +
                `- Quedarán SIN SERIAL: ${unitsWithoutSerial} unidad(es).\n\n` +
                `¿Deseas aplicar la sincronización registrando ${unitsWithoutSerial} unidad(es) sin serial en el sistema?`
            );
            if (!proceed) return;
        } else if (finalPhysicalStock === 0) {
            const retireAll = confirm(
                `DESCUADRE DETECTADO:\n\n` +
                `- Has indicado Conteo Físico = 0 unidades en sede.\n` +
                `- Pero en el sistema figuran ${activeSerials.length} seriales que no fueron marcados como despachados en el pasado.\n\n` +
                `¿Deseas dar de baja automáticamente todos estos ${activeSerials.length} seriales para que el producto y sus seriales queden 100% en 0?`
            );
            if (retireAll) {
                currentProductSerials.forEach(s => {
                    if (s.auditState !== 'NEW') s.auditState = 'REMOVED';
                });
                renderSerialsTable();
                updateSerialsSummaryCounter();
            } else {
                return;
            }
        } else {
            alert(`Aviso de Descuadre: Tienes más seriales verificados (${activeSerials.length}) que el stock físico total (${finalPhysicalStock}). Ajusta el conteo de stock o retira los seriales que ya no existan en la sede.`);
            return;
        }
    } else if (activeSerials.length === 0 && finalPhysicalStock > 0) {
        const proceed = confirm(
            `PRODUCTO SIN SERIALES:\n\n` +
            `- Conteo físico total: ${finalPhysicalStock} unidad(es).\n` +
            `- No hay seriales físicos registrados para este producto.\n` +
            `- Todas las ${finalPhysicalStock} unidades quedarán registradas SIN SERIAL en el sistema.\n\n` +
            `¿Deseas guardar el inventario sin seriales?`
        );
        if (!proceed) return;
    }

    // Resumen de confirmación
    const reason = reasonSelect?.value || 'Toma de Inventario Físico (Sede Principal)';
    const notes = notesInput?.value.trim() || 'Sin notas adicionales.';

    let confirmMsg = `CONFIRMAR SINCRONIZACIÓN DE INVENTARIO FÍSICO:\n\n`;
    confirmMsg += `Producto: ${currentProduct.name}\n`;
    confirmMsg += `Stock Sistema: ${currentSystemTotalStock} -> Stock Físico: ${finalPhysicalStock} (${deltaTotal >= 0 ? '+' : ''}${deltaTotal})\n`;
    
    if (activeSerials.length > 0) {
        confirmMsg += `\n- Unidades con serial verificado: ${activeSerials.length}`;
        if (unitsWithoutSerial > 0) {
            confirmMsg += `\n- Unidades sin serial: ${unitsWithoutSerial}`;
        }
    } else if (finalPhysicalStock > 0) {
        confirmMsg += `\n- Unidades sin serial: ${finalPhysicalStock}`;
    }

    if (hasVariants) {
        confirmMsg += `\n\nDesglose por Variante:\n`;
        variantRowsState.forEach(r => {
            const d = r.physicalStock - r.systemStock;
            confirmMsg += ` - ${r.color || 'Estándar'} ${r.capacity || ''}: ${r.systemStock} -> ${r.physicalStock} (${d >= 0 ? '+' : ''}${d})\n`;
        });
    }

    if (addedSerials.length > 0) confirmMsg += `\n+ ${addedSerials.length} seriales nuevos serán registrados.`;
    if (removedSerials.length > 0) confirmMsg += `\n- ${removedSerials.length} seriales serán marcados como no encontrados.`;
    confirmMsg += `\n\nMotivo: ${reason}\n\n¿Deseas guardar los cambios en la base de datos de inmediato?`;

    if (!confirm(confirmMsg)) return;

    const originalBtnHtml = btnSubmit.innerHTML;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-brand-black"></i> Sincronizando...`;

    try {
        const batch = writeBatch(db);
        const now = serverTimestamp();
        const nowISO = new Date().toISOString();

        const weekKey = getWeekKey(new Date());

        // 1. Actualizar Producto
        const productRef = doc(db, "products", currentProduct.id);
        const productUpdateData = {
            stock: finalPhysicalStock,
            updatedAt: now,
            lastInventoryAudit: now,
            lastInventoryAuditWeek: weekKey,
            lastInventoryAuditAdmin: currentUser?.email || 'admin@pixeltechcol.com'
        };

        let variantChangesForLog = [];
        let updatedCombinations = null;

        if (hasVariants) {
            updatedCombinations = currentProduct.combinations.map((comb, idx) => {
                const matchRow = variantRowsState.find(r => r.color === (comb.color || '') && r.capacity === (comb.capacity || '')) 
                    || variantRowsState[idx];
                
                const newVarStock = matchRow ? matchRow.physicalStock : (Number(comb.stock) || 0);

                variantChangesForLog.push({
                    color: comb.color || 'Estándar',
                    capacity: comb.capacity || '',
                    before: Number(comb.stock) || 0,
                    after: newVarStock,
                    delta: newVarStock - (Number(comb.stock) || 0)
                });

                return {
                    ...comb,
                    stock: newVarStock
                };
            });

            productUpdateData.combinations = updatedCombinations;
        }

        batch.update(productRef, productUpdateData);

        // 2. Registrar nuevos seriales en product_serials
        addedSerials.forEach(s => {
            const sRef = doc(collection(db, "product_serials"));
            batch.set(sRef, {
                serialNumber: s.serialNumber,
                productId: currentProduct.id,
                productName: currentProduct.name,
                sku: s.sku || currentProduct.sku || '',
                brand: currentProduct.brand || '',
                color: s.color || null,
                capacity: s.capacity || null,
                status: 'AVAILABLE',
                purchaseId: 'SYNC_AUDIT',
                supplierName: 'Toma Física de Inventario',
                verifiedAt: now,
                createdAt: now,
                updatedAt: now
            });
        });

        // 3. Actualizar seriales dados de baja
        removedSerials.forEach(s => {
            if (s.docRef) {
                batch.update(s.docRef, {
                    status: 'AUDIT_REMOVED',
                    removalReason: reason,
                    removalNotes: notes,
                    updatedAt: now
                });
            }
        });

        // 4. Registrar en inventory_audit_logs para trazabilidad inmutable
        const auditLogRef = doc(collection(db, "inventory_audit_logs"));
        batch.set(auditLogRef, {
            productId: currentProduct.id,
            productName: currentProduct.name,
            image: currentProduct.mainImage || (currentProduct.images && currentProduct.images[0]) || '',
            sku: currentProduct.sku || '',
            category: currentProduct.category || '',
            brand: currentProduct.brand || '',
            type: 'SYNC_AUDIT',
            weekKey: weekKey,
            reason: reason,
            notes: notes,
            beforeStock: currentSystemTotalStock,
            afterStock: finalPhysicalStock,
            deltaStock: deltaTotal,
            changeDetails: `Sincronización física de inventario: ${currentSystemTotalStock} -> ${finalPhysicalStock} (${deltaTotal >= 0 ? '+' : ''}${deltaTotal} uds)`,
            variantChanges: variantChangesForLog,
            serialsAdded: addedSerials.map(s => s.serialNumber),
            serialsRemoved: removedSerials.map(s => s.serialNumber),
            adminEmail: currentUser?.email || 'admin@pixeltechcol.com',
            adminName: currentUser?.displayName || 'Administrador',
            timestamp: now,
            createdAtISO: nowISO
        });

        // Ejecutar Batch atómico
        await batch.commit();

        // Actualizar estado de auditoría local inmediato para actualización instantánea de interfaz
        if (currentProduct) {
            currentProduct.lastInventoryAudit = new Date();
            currentProduct.lastInventoryAuditWeek = weekKey;
            auditedProductIdsMap[currentProduct.id] = new Date();
            const prodInAll = allProducts.find(p => p.id === currentProduct.id);
            if (prodInAll) {
                prodInAll.lastInventoryAudit = new Date();
                prodInAll.lastInventoryAuditWeek = weekKey;
                prodInAll.stock = finalPhysicalStock;
                if (hasVariants && updatedCombinations) {
                    prodInAll.combinations = updatedCombinations;
                }
            }
        }

        alert("Sincronización de inventario completada con éxito.\nLos datos de stock, variantes y seriales ya están actualizados en el sistema.");
        closeSyncModal();
        applyFilters();

    } catch (err) {
        console.error("Error aplicando sincronización de inventario:", err);
        alert("Error al aplicar sincronización: " + (err.message || err));
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnHtml;
    }
}
