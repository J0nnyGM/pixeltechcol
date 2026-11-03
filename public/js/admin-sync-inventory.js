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
// Historial completo de auditorías por producto { [productId]: Date[] }
let productAuditHistoryMap = {};
// Período de auditoría activo (por defecto la semana actual empezando el lunes)
let activeAuditRange = null;

// Estado del producto en sincronización activa
let currentProduct = null;
let currentSystemTotalStock = 0;
let currentPhysicalTotalStock = 0;
let variantRowsState = []; // [{ key, color, capacity, sku, systemStock, physicalStock }]
let currentProductSerials = []; // [{ id, serialNumber, color, capacity, status, auditState: 'EXISTING'|'NEW'|'REMOVED', docRef }]

const normalize = (str) => str ? str.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";

const cleanNumber = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    let s = String(val).trim();
    if (!s) return 0;

    // Quitar símbolo de moneda, espacios y caracteres no numéricos
    s = s.replace(/[^\d.,-]/g, '');
    if (!s || s === '-') return 0;

    // Normalizar separadores de miles y decimales
    if (s.includes('.') && s.includes(',')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            // Formato estándar es-CO: 1.000.000,50
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            // Formato en-US: 1,000,000.50
            s = s.replace(/,/g, '');
        }
    } else if (s.includes('.')) {
        const parts = s.split('.');
        // Más de un punto (ej: 1.000.000) o un punto seguido de exactamente 3 dígitos (ej: 50.000, 1.000)
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
            s = s.replace(/\./g, '');
        }
    } else if (s.includes(',')) {
        const parts = s.split(',');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
            s = s.replace(/,/g, '');
        } else {
            s = s.replace(',', '.');
        }
    }

    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
};

const formatCOP = (val) => {
    const num = cleanNumber(val);
    return '$ ' + new Intl.NumberFormat('es-CO', {
        maximumFractionDigits: 0
    }).format(num);
};

const formatNumberWithThousands = (val) => {
    const num = Math.round(cleanNumber(val));
    if (num === 0) return '';
    return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(num);
};

// =========================================================================
// 2.1 HELPERS DE ESTADO DE AUDITORÍA SEMANAL
// =========================================================================

// =========================================================================
// 2.1 GESTIÓN Y SELECCIÓN DEL PERÍODO DE AUDITORÍA
// =========================================================================

function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const parts = dateStr.split('-').map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date(dateStr);
}

// Obtiene el rango exacto de la semana que contiene a la fecha dada (Lunes 00:00:00 a Domingo 23:59:59)
function getWeekRangeForDate(d = new Date()) {
    const target = parseLocalDate(d);
    const day = target.getDay(); // 0: Domingo, 1: Lunes, ...
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    
    const monday = new Date(target);
    monday.setDate(target.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { start: monday, end: sunday };
}

// Obtiene el rango de la semana actual (empieza el lunes por defecto)
function getCurrentWeekRange() {
    return getWeekRangeForDate(new Date());
}

function formatRangeLabel(start, end) {
    const opt = { day: 'numeric', month: 'short' };
    return `Lun ${start.toLocaleDateString('es-CO', opt)} - Dom ${end.toLocaleDateString('es-CO', opt)} ${end.getFullYear()}`;
}

function formatDateToISO(d) {
    const date = parseLocalDate(d);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

// Inicializa el período de auditoría por defecto en la semana actual que inicia el lunes
function initAuditPeriod() {
    const current = getCurrentWeekRange();
    activeAuditRange = {
        ...current,
        isCurrent: true,
        label: formatRangeLabel(current.start, current.end),
        weekKey: getWeekKey(current.start)
    };

    const inputCal = document.getElementById('input-audit-calendar');
    if (inputCal) {
        inputCal.value = formatDateToISO(new Date());
    }

    updateAuditPeriodUI();
}

function updateAuditPeriodUI() {
    if (!activeAuditRange) return;

    const weekLabel = document.getElementById('label-audit-selected-week');
    const weekBadge = document.getElementById('badge-audit-week');
    const kpiPendingLabel = document.getElementById('kpi-pending-label');
    const kpiAuditedLabel = document.getElementById('kpi-audited-label');

    if (weekLabel) {
        const prefix = activeAuditRange.isCurrent ? 'Semana Actual' : 'Semana Histórica';
        weekLabel.textContent = `${prefix} (${activeAuditRange.label})`;
    }

    if (weekBadge) {
        if (activeAuditRange.isCurrent) {
            weekBadge.className = "flex items-center gap-2 bg-slate-100 border border-gray-200 rounded-2xl px-3.5 py-2 text-xs font-bold text-gray-700 transition";
        } else {
            weekBadge.className = "flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-2xl px-3.5 py-2 text-xs font-bold text-amber-800 transition shadow-xs";
        }
    }

    // Etiquetas dinámicas de tarjetas KPI
    if (kpiPendingLabel) {
        kpiPendingLabel.textContent = activeAuditRange.isCurrent ? "Faltan Esta Semana" : "Faltan en el Período";
    }
    if (kpiAuditedLabel) {
        kpiAuditedLabel.textContent = activeAuditRange.isCurrent ? "Auditados Esta Semana" : "Auditados en el Período";
    }
}

window.handleAuditCalendarChange = (val) => {
    if (!val) {
        window.setAuditPeriodFromDate(new Date());
        return;
    }
    const d = parseLocalDate(val);
    window.setAuditPeriodFromDate(d);
};

window.setAuditPeriodFromDate = (d) => {
    const targetDate = parseLocalDate(d);
    const range = getWeekRangeForDate(targetDate);
    const current = getCurrentWeekRange();
    const isCurrent = range.start.getTime() === current.start.getTime();

    activeAuditRange = {
        ...range,
        isCurrent,
        label: formatRangeLabel(range.start, range.end),
        weekKey: getWeekKey(range.start)
    };

    const inputCal = document.getElementById('input-audit-calendar');
    if (inputCal && (!inputCal.value || targetDate)) {
        inputCal.value = formatDateToISO(targetDate);
    }

    updateAuditPeriodUI();
    currentPage = 1;
    applyFilters();
};

window.resetAuditToCurrentWeek = () => {
    window.setAuditPeriodFromDate(new Date());
};

// Determina si el producto fue auditado en el período activo (semana actual o semana histórica seleccionada)
function checkIsAuditedInActivePeriod(p) {
    if (!p) return false;
    if (!activeAuditRange) return false;
    const { start, end } = activeAuditRange;

    // 1. Revisar historial completo de auditorías
    const history = productAuditHistoryMap[p.id] || [];
    for (const d of history) {
        if (d >= start && d <= end) return true;
    }

    // 2. Si es la semana actual, revisar clave de semana guardada
    if (activeAuditRange.isCurrent) {
        const currentWeekKey = getWeekKey(new Date());
        if (p.lastInventoryAuditWeek && p.lastInventoryAuditWeek === currentWeekKey) {
            return true;
        }
    }

    // 3. Revisar última auditoría registrada en el producto o mapa de auditorías
    const auditVal = p.lastInventoryAudit || auditedProductIdsMap[p.id];
    const auditDate = parseAuditDate(auditVal);
    if (auditDate && auditDate >= start && auditDate <= end) {
        return true;
    }

    return false;
}

// Alias para retrocompatibilidad
function checkIsAuditedThisWeek(p) {
    return checkIsAuditedInActivePeriod(p);
}

// Devuelve los detalles de auditoría para renderizado visual según el período activo
function getAuditStatusDetails(p) {
    if (p && p.status === 'deactivated') {
        const auditVal = p.lastInventoryAudit || auditedProductIdsMap[p.id];
        const auditDate = parseAuditDate(auditVal);
        const formattedDate = auditDate ? auditDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : 'Previamente';
        return {
            auditedThisWeek: true,
            isDeactivated: true,
            badgeHtml: `<span class="px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-300 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                          <i class="fa-solid fa-ban text-[9px] text-slate-500"></i> Auditado Desactivado
                        </span>`,
            subtextHtml: `<span class="text-slate-500 font-sans text-[10px] font-bold"><i class="fa-solid fa-circle-minus mr-1 text-[9px]"></i>Discontinuado (${formattedDate})</span>`,
            buttonText: 'Auditar',
            buttonIcon: 'fa-rotate-left',
            buttonClass: 'bg-slate-700 hover:bg-slate-800'
        };
    }

    const isAuditedInPeriod = checkIsAuditedInActivePeriod(p);
    const auditVal = p.lastInventoryAudit || auditedProductIdsMap[p.id];
    const auditDate = parseAuditDate(auditVal);

    if (isAuditedInPeriod) {
        const history = productAuditHistoryMap[p.id] || [];
        const matchDate = history.find(d => d >= activeAuditRange.start && d <= activeAuditRange.end) || auditDate;

        const now = new Date();
        const isToday = matchDate && matchDate.toDateString() === now.toDateString();
        const timeStr = matchDate ? matchDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
        const formattedDate = isToday ? `Hoy, ${timeStr}` : (matchDate ? matchDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : 'Auditado');

        const periodLabel = activeAuditRange?.isCurrent ? 'Esta Semana' : 'en Período';

        return {
            auditedThisWeek: true,
            badgeHtml: `<span class="px-2 py-0.5 bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                          <i class="fa-solid fa-circle-check text-[9px]"></i> Auditado ${periodLabel}
                        </span>`,
            subtextHtml: `<span class="text-emerald-600 font-sans text-[10px] font-bold"><i class="fa-solid fa-calendar-check mr-1 text-[9px]"></i>Auditado: ${formattedDate}</span>`,
            buttonText: 'Reauditar',
            buttonIcon: 'fa-pen-to-square',
            buttonClass: 'bg-slate-900 hover:bg-emerald-600'
        };
    } else {
        const periodLabel = activeAuditRange?.isCurrent ? 'Semana' : 'Período';
        let lastAuditSubtext = 'Sin auditar en este período';
        if (auditDate) {
            const lastFormatted = auditDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
            lastAuditSubtext = `Última: ${lastFormatted}`;
        }

        return {
            auditedThisWeek: false,
            badgeHtml: `<span class="px-2 py-0.5 bg-amber-500/15 text-amber-700 border border-amber-500/30 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                          <i class="fa-regular fa-clock text-[9px]"></i> Pendiente ${periodLabel}
                        </span>`,
            subtextHtml: `<span class="text-amber-600 font-sans text-[10px] font-bold"><i class="fa-regular fa-clock mr-1 text-[9px]"></i>${lastAuditSubtext}</span>`,
            buttonText: 'Auditar',
            buttonIcon: 'fa-arrows-rotate',
            buttonClass: 'bg-brand-black hover:bg-brand-cyan hover:text-brand-black'
        };
    }
}

async function loadAuditedProductsFromLogs() {
    try {
        const logsRef = collection(db, "inventory_audit_logs");
        const q = query(logsRef, where("type", "==", "SYNC_AUDIT"), limit(2000));
        const snap = await getDocs(q);
        snap.forEach(d => {
            const data = d.data();
            // REGLA ESTRICTA: Solo contar auditorías físicas de inventario (type === 'SYNC_AUDIT')
            if (data.productId && data.type === 'SYNC_AUDIT') {
                const ts = parseAuditDate(data.timestamp || data.createdAtISO);
                if (ts) {
                    if (!productAuditHistoryMap[data.productId]) {
                        productAuditHistoryMap[data.productId] = [];
                    }
                    productAuditHistoryMap[data.productId].push(ts);

                    const currentTs = parseAuditDate(auditedProductIdsMap[data.productId]);
                    if (!currentTs || ts.getTime() > currentTs.getTime()) {
                        auditedProductIdsMap[data.productId] = ts;
                    }
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
    const cardDeactivated = document.getElementById('card-filter-deactivated');

    if (cardAll) cardAll.classList.remove('ring-4', 'ring-brand-cyan/40', 'bg-cyan-50/40');
    if (cardPending) cardPending.classList.remove('ring-4', 'ring-amber-400/40', 'bg-amber-50/40');
    if (cardAudited) cardAudited.classList.remove('ring-4', 'ring-emerald-400/40', 'bg-emerald-50/40');
    if (cardDeactivated) cardDeactivated.classList.remove('ring-4', 'ring-slate-400/40', 'bg-slate-100');

    if (activeFilter === 'pending_audit' && cardPending) {
        cardPending.classList.add('ring-4', 'ring-amber-400/40', 'bg-amber-50/40');
    } else if (activeFilter === 'audited' && cardAudited) {
        cardAudited.classList.add('ring-4', 'ring-emerald-400/40', 'bg-emerald-50/40');
    } else if (activeFilter === 'deactivated' && cardDeactivated) {
        cardDeactivated.classList.add('ring-4', 'ring-slate-400/40', 'bg-slate-100');
    } else if (activeFilter === 'all' && cardAll) {
        cardAll.classList.add('ring-4', 'ring-brand-cyan/40', 'bg-cyan-50/40');
    }
}

// =========================================================================
// 3. INICIALIZACIÓN Y SUSCRIPCIÓN AL CATÁLOGO
// =========================================================================
async function initApp() {
    initAuditPeriod();
    initSearchAndFilters();
    initModalEvents();

    // Precargar mapa histórico de auditorías desde logs
    await loadAuditedProductsFromLogs();

    AdminStore.subscribeToProducts((products) => {
        allProducts = products || [];
        allProducts.forEach(p => {
            if (p.lastInventoryAudit) {
                const d = parseAuditDate(p.lastInventoryAudit);
                if (d) {
                    if (!productAuditHistoryMap[p.id]) {
                        productAuditHistoryMap[p.id] = [];
                    }
                    if (!productAuditHistoryMap[p.id].some(t => t.getTime() === d.getTime())) {
                        productAuditHistoryMap[p.id].push(d);
                    }
                    const existing = parseAuditDate(auditedProductIdsMap[p.id]);
                    if (!existing || d.getTime() > existing.getTime()) {
                        auditedProductIdsMap[p.id] = d;
                    }
                }
            }
        });
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

        const isDeactivated = p.status === 'deactivated';
        const hasSearch = term.length > 0;

        // Regla: Los productos desactivados SOLO se muestran si se seleccionó el filtro 'deactivated' O si hay un término de búsqueda activo
        if (isDeactivated && filterType !== 'deactivated' && !hasSearch) {
            return false;
        }
        if (filterType === 'deactivated' && !isDeactivated) {
            return false;
        }

        const isAuditedThisWeek = checkIsAuditedThisWeek(p);

        // Filtro por Estado de Auditoría Semanal / Período
        if (filterType === 'pending_audit' && (isAuditedThisWeek || isDeactivated)) return false;
        if (filterType === 'audited' && (!isAuditedThisWeek || isDeactivated)) return false;

        // Filtro por Costo FIFO
        const prodCost = cleanNumber(p.lastPurchaseCost || p.costPrice || p.cost || p.fifoCost || 0);
        if (filterType === 'without_fifo_cost' && prodCost > 0) return false;
        if (filterType === 'with_fifo_cost' && prodCost <= 0) return false;

        // Filtro por tipo de producto y stock
        if (filterType === 'with_variants' && !hasVariants) return false;
        if (filterType === 'simple' && hasVariants) return false;
        if (filterType === 'with_stock' && stock <= 0) return false;
        if (filterType === 'zero_stock' && stock > 0) return false;

        // Filtro por texto
        if (hasSearch) {
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
    const deactivatedCount = allProducts.filter(p => p.status === 'deactivated').length;
    const auditableProducts = allProducts.filter(p => p.status !== 'deactivated');
    const auditedCount = auditableProducts.filter(p => checkIsAuditedInActivePeriod(p)).length;
    const pendingCount = Math.max(0, auditableProducts.length - auditedCount);
    const percent = auditableProducts.length > 0 ? Math.round((auditedCount / auditableProducts.length) * 100) : 0;

    // Actualizar KPI Cards de Auditoría
    const kpiTotal = document.getElementById('kpi-total-products');
    const kpiPending = document.getElementById('kpi-pending-products');
    const kpiAudited = document.getElementById('kpi-audited-products');
    const kpiDeactivated = document.getElementById('kpi-deactivated-products');
    const progressText = document.getElementById('audit-progress-text');
    const progressBar = document.getElementById('audit-progress-bar');

    if (kpiTotal) kpiTotal.textContent = total;
    if (kpiPending) kpiPending.textContent = pendingCount;
    if (kpiAudited) kpiAudited.textContent = auditedCount;
    if (kpiDeactivated) kpiDeactivated.textContent = deactivatedCount;

    const rangeLabel = activeAuditRange?.label || '';
    const periodDesc = activeAuditRange?.isCurrent ? 'esta semana' : 'en período';

    if (progressText) {
        progressText.textContent = `${percent}% (${auditedCount} de ${auditableProducts.length} ${periodDesc})`;
    }
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }

    // Texto informativo del listado
    const info = document.getElementById('sync-counter-info');
    if (info) {
        const activeFilter = document.getElementById('filter-type-select')?.value || 'all';
        let filterLabel = 'todos los productos';
        if (activeFilter === 'pending_audit') filterLabel = `pendientes en período (${rangeLabel})`;
        else if (activeFilter === 'audited') filterLabel = `auditados en período (${rangeLabel})`;
        else if (activeFilter === 'deactivated') filterLabel = 'auditados por desactivado (discontinuados)';
        else if (activeFilter === 'without_fifo_cost') filterLabel = 'sin costo FIFO asignado';
        else if (activeFilter === 'with_fifo_cost') filterLabel = 'con costo FIFO asignado';
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

        const prodFifoCost = cleanNumber(prod.lastPurchaseCost || prod.costPrice || prod.cost || prod.fifoCost || 0);

        const typeBadge = hasVariants
            ? `<span class="px-2 py-0.5 bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20 rounded-md text-[9px] font-black uppercase tracking-wider">${prod.combinations.length} Variantes</span>`
            : `<span class="px-2 py-0.5 bg-slate-100 text-gray-600 border border-gray-200 rounded-md text-[9px] font-black uppercase tracking-wider">Simple</span>`;

        let sideStripe = 'border-l-[6px] border-l-amber-400 border-gray-200 hover:border-amber-400';
        if (audit.isDeactivated) {
            sideStripe = 'border-l-[6px] border-l-slate-400 border-gray-200 hover:border-slate-500';
        } else if (audit.auditedThisWeek) {
            sideStripe = 'border-l-[6px] border-l-emerald-500 border-gray-200 hover:border-emerald-500';
        }

        const imgOpacityClass = audit.isDeactivated ? 'opacity-60 grayscale' : '';

        return `
            <div class="bg-white border-2 ${sideStripe} rounded-3xl p-5 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between group">
                <div class="flex items-start gap-3.5 mb-4">
                    <img src="${img}" alt="${prod.name}" class="w-16 h-16 object-contain rounded-2xl bg-slate-50 p-1.5 border border-gray-100 shrink-0 group-hover:scale-105 transition ${imgOpacityClass}">
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
                        <div class="flex items-center gap-1.5 mt-1 text-[9px] font-bold text-gray-400 flex-wrap">
                            <span>Bodega: <strong class="text-brand-black">${bodegaStock}</strong></span>
                            ${fullStock > 0 ? `<span class="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-black border border-amber-200">Full: ${fullStock}</span>` : ''}
                        </div>
                        <div class="mt-1">
                            ${prodFifoCost > 0 
                                ? `<span class="text-[9px] font-mono font-bold text-gray-600 block">FIFO: <strong class="text-brand-black font-black">${formatCOP(prodFifoCost)}</strong></span>` 
                                : `<span class="text-[8px] font-mono font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 inline-block">Sin Costo FIFO</span>`}
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
    const isAuditedInActive = checkIsAuditedInActivePeriod(prod);
    const auditVal = prod.lastInventoryAudit || auditedProductIdsMap[prod.id];
    const auditDate = parseAuditDate(auditVal);
    const auditBadge = document.getElementById('modal-product-audit-badge');
    const periodLabel = activeAuditRange?.isCurrent ? 'Esta Semana' : 'en Período';

    if (auditBadge) {
        if (isAuditedInActive) {
            const history = productAuditHistoryMap[prod.id] || [];
            const matchDate = history.find(d => d >= activeAuditRange.start && d <= activeAuditRange.end) || auditDate;
            const timeStr = matchDate ? matchDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
            const dateStr = matchDate ? matchDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';
            auditBadge.innerHTML = `<i class="fa-solid fa-circle-check mr-1 text-[8px]"></i> Auditado ${periodLabel} (${dateStr} ${timeStr})`.trim();
            auditBadge.className = "text-[9px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-400/20 px-2 py-0.5 rounded-md border border-emerald-400/30 inline-flex items-center";
            auditBadge.classList.remove('hidden');
        } else if (auditDate) {
            const opt = { day: '2-digit', month: 'short' };
            auditBadge.innerHTML = `<i class="fa-solid fa-clock-rotate-left mr-1 text-[8px]"></i> Pendiente ${periodLabel} (Última: ${auditDate.toLocaleDateString('es-CO', opt)})`;
            auditBadge.className = "text-[9px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/20 px-2 py-0.5 rounded-md border border-amber-400/30 inline-flex items-center";
            auditBadge.classList.remove('hidden');
        } else {
            auditBadge.innerHTML = `<i class="fa-regular fa-clock mr-1 text-[8px]"></i> Pendiente ${periodLabel} (Sin auditar)`;
            auditBadge.className = "text-[9px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/20 px-2 py-0.5 rounded-md border border-amber-400/30 inline-flex items-center";
            auditBadge.classList.remove('hidden');
        }
    }

    // Estado del producto en el selector y badge del modal
    const currentProdStatus = prod.status || 'active';
    const statusSelect = document.getElementById('sync-product-status-select');
    if (statusSelect) {
        statusSelect.value = currentProdStatus;
    }

    const statusBadge = document.getElementById('modal-product-status-badge');
    if (statusBadge) {
        if (currentProdStatus === 'deactivated') {
            statusBadge.innerHTML = `<i class="fa-solid fa-ban mr-1 text-[8px]"></i> Desactivado`;
            statusBadge.className = "text-[9px] font-black uppercase tracking-widest text-slate-300 bg-slate-700/60 px-2 py-0.5 rounded-md border border-slate-500/50 inline-flex items-center";
            statusBadge.classList.remove('hidden');
        } else if (currentProdStatus === 'draft') {
            statusBadge.innerHTML = `<i class="fa-solid fa-circle mr-1 text-[8px] text-amber-400"></i> Borrador`;
            statusBadge.className = "text-[9px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-400/30 inline-flex items-center";
            statusBadge.classList.remove('hidden');
        } else {
            statusBadge.innerHTML = `<i class="fa-solid fa-circle mr-1 text-[8px] text-emerald-400"></i> Activo`;
            statusBadge.className = "text-[9px] font-black uppercase tracking-widest text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-400/30 inline-flex items-center";
            statusBadge.classList.remove('hidden');
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

        // Preparar estado de Costo FIFO
        const currentFifoCost = cleanNumber(prod.lastPurchaseCost || prod.costPrice || prod.cost || prod.fifoCost || 0);
        const inputFifoCost = document.getElementById('input-product-fifo-cost');
        if (inputFifoCost) {
            inputFifoCost.value = currentFifoCost > 0 ? formatNumberWithThousands(currentFifoCost) : '';
        }

        const propagateContainer = document.getElementById('btn-propagate-variant-cost-container');
        if (propagateContainer) {
            propagateContainer.classList.toggle('hidden', !hasVariants);
        }

        // Configurar filas de variantes
        variantRowsState = prod.combinations.map((c, idx) => {
            const key = `${c.color || ''}__${c.capacity || ''}__${idx}`;
            const sysStock = Number(c.stock) || 0;
            const varCost = cleanNumber(c.cost || c.lastPurchaseCost || c.unitCost || currentFifoCost || 0);
            return {
                key,
                color: c.color || '',
                capacity: c.capacity || '',
                sku: c.sku || `${prod.sku || 'SKU'}-${idx+1}`,
                systemStock: sysStock,
                physicalStock: sysStock, // Inicializa igual al sistema
                price: cleanNumber(c.price || prod.price || 0),
                fifoCost: varCost
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

        const currentFifoCost = cleanNumber(prod.lastPurchaseCost || prod.costPrice || prod.cost || prod.fifoCost || 0);
        const inputFifoCost = document.getElementById('input-product-fifo-cost');
        if (inputFifoCost) {
            inputFifoCost.value = currentFifoCost > 0 ? formatNumberWithThousands(currentFifoCost) : '';
        }

        const propagateContainer = document.getElementById('btn-propagate-variant-cost-container');
        if (propagateContainer) {
            propagateContainer.classList.add('hidden');
        }

        currentSystemTotalStock = Number(prod.stock) || 0;
        currentPhysicalTotalStock = currentSystemTotalStock;

        const inputSimple = document.getElementById('input-simple-physical-stock');
        if (inputSimple) inputSimple.value = currentPhysicalTotalStock;
    }

    updateGlobalStockMetrics();
    updateFifoCalculations();

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

function updateFifoCalculations() {
    if (!currentProduct) return;

    const inputFifoCost = document.getElementById('input-product-fifo-cost');
    const baseCost = cleanNumber(inputFifoCost?.value || 0);

    const hasVariants = Array.isArray(currentProduct.combinations) && currentProduct.combinations.length > 0;
    const sellingPrice = cleanNumber(currentProduct.price || 0);

    // Valuación total de existencias físicas en sede
    let totalValuation = 0;
    if (hasVariants && variantRowsState.length > 0) {
        totalValuation = variantRowsState.reduce((sum, r) => {
            const costToUse = r.fifoCost > 0 ? r.fifoCost : baseCost;
            return sum + (r.physicalStock * costToUse);
        }, 0);
    } else {
        totalValuation = currentPhysicalTotalStock * baseCost;
    }

    // Utilidad y Margen unitario sobre precio de venta base
    const unitProfit = sellingPrice - baseCost;
    const marginPct = sellingPrice > 0 ? (unitProfit / sellingPrice) * 100 : 0;

    // Actualizar elementos del DOM
    const elValuation = document.getElementById('kpi-product-total-valuation');
    const elValUnits = document.getElementById('kpi-valuation-units');
    const elValCost = document.getElementById('kpi-valuation-unit-cost');
    const elSellPrice = document.getElementById('kpi-product-selling-price');
    const elUnitProfit = document.getElementById('kpi-product-unit-profit');
    const elMargin = document.getElementById('kpi-product-profit-margin');
    const badgeCostStatus = document.getElementById('badge-fifo-cost-status');
    const fifoBadgeHeader = document.getElementById('modal-product-fifo-badge');

    if (elValuation) elValuation.textContent = formatCOP(totalValuation);
    if (elValUnits) elValUnits.textContent = currentPhysicalTotalStock;
    if (elValCost) elValCost.textContent = formatCOP(baseCost);

    if (elSellPrice) elSellPrice.textContent = formatCOP(sellingPrice);
    if (elUnitProfit) {
        elUnitProfit.textContent = `${unitProfit >= 0 ? '+' : ''}${formatCOP(unitProfit)}`;
        elUnitProfit.className = `font-mono font-black text-xs sm:text-sm ${unitProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }
    if (elMargin) {
        elMargin.textContent = `${marginPct.toFixed(1)}%`;
        elMargin.className = `font-mono font-black text-xs sm:text-sm ${marginPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }

    if (badgeCostStatus) {
        if (baseCost > 0) {
            badgeCostStatus.textContent = "Costo Asignado";
            badgeCostStatus.className = "px-2.5 py-1 rounded-xl text-[9px] font-mono font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0";
        } else {
            badgeCostStatus.textContent = "Sin Costo";
            badgeCostStatus.className = "px-2.5 py-1 rounded-xl text-[9px] font-mono font-black uppercase tracking-wider bg-amber-50 text-amber-600 border border-amber-200 shrink-0";
        }
    }

    if (fifoBadgeHeader) {
        if (baseCost > 0) {
            fifoBadgeHeader.textContent = `Costo FIFO: ${formatCOP(baseCost)}`;
            fifoBadgeHeader.className = "text-[9px] font-black uppercase tracking-widest text-cyan-300 bg-cyan-400/20 px-2 py-0.5 rounded-md border border-cyan-400/30 inline-flex items-center";
        } else {
            fifoBadgeHeader.textContent = "Sin Costo FIFO";
            fifoBadgeHeader.className = "text-[9px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/20 px-2 py-0.5 rounded-md border border-amber-400/30 inline-flex items-center";
        }
        fifoBadgeHeader.classList.remove('hidden');
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
    updateFifoCalculations();
};

window.setSimpleCountToSerialsCount = () => {
    const activeSerials = currentProductSerials.filter(s => s.auditState !== 'REMOVED');
    const input = document.getElementById('input-simple-physical-stock');
    if (input) {
        input.value = activeSerials.length;
        currentPhysicalTotalStock = activeSerials.length;
        updateGlobalStockMetrics();
        updateFifoCalculations();
    }
};

window.setVariantsCountToSerialsCount = () => {
    const activeSerials = currentProductSerials.filter(s => s.auditState !== 'REMOVED');
    if (activeSerials.length === 0) return;

    variantRowsState.forEach(row => {
        const countForVar = activeSerials.filter(s => 
            (s.color || '') === row.color && 
            (s.capacity || '') === row.capacity
        ).length;
        row.physicalStock = countForVar;
    });

    currentPhysicalTotalStock = variantRowsState.reduce((sum, r) => sum + r.physicalStock, 0);

    // Si hay seriales sin color o capacidad asignada, asignarlos a la primera variante para preservar el total
    if (currentPhysicalTotalStock < activeSerials.length && variantRowsState.length > 0) {
        const diff = activeSerials.length - currentPhysicalTotalStock;
        variantRowsState[0].physicalStock += diff;
        currentPhysicalTotalStock = activeSerials.length;
    }

    renderVariantsTable();
    updateGlobalStockMetrics();
    updateFifoCalculations();
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

        const varCostVal = row.fifoCost > 0 ? formatNumberWithThousands(row.fifoCost) : '';

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
                        <button type="button" onclick="window.stepVariantCount(${idx}, -1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-brand-black font-bold flex items-center justify-center transition cursor-pointer">
                            <i class="fa-solid fa-minus text-[10px]"></i>
                        </button>
                        <input type="number" min="0" value="${row.physicalStock}" 
                            onchange="window.updateVariantCountInput(${idx}, this.value)"
                            class="count-input w-16 text-center font-mono font-black text-sm bg-slate-50 border border-gray-300 rounded-lg py-1 text-brand-black outline-none focus:border-brand-cyan">
                        <button type="button" onclick="window.stepVariantCount(${idx}, 1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-brand-black font-bold flex items-center justify-center transition cursor-pointer">
                            <i class="fa-solid fa-plus text-[10px]"></i>
                        </button>
                    </div>
                </td>
                <td class="p-3 text-center">
                    <div class="relative w-28 mx-auto">
                        <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-[10px] font-bold">$</span>
                        <input type="text" value="${varCostVal}" placeholder="0"
                            oninput="window.updateVariantFifoCostInput(${idx}, this.value)"
                            onblur="window.formatVariantFifoCostInput(${idx}, this)"
                            onfocus="this.select()"
                            class="count-input w-full text-right font-mono font-bold text-xs bg-slate-50 border border-gray-300 rounded-lg pl-5 pr-2 py-1 text-brand-black outline-none focus:border-brand-cyan shadow-2xs">
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

window.updateVariantFifoCostInput = (idx, value) => {
    if (!variantRowsState[idx]) return;
    variantRowsState[idx].fifoCost = cleanNumber(value);
    updateFifoCalculations();
};

window.formatVariantFifoCostInput = (idx, inputEl) => {
    if (!variantRowsState[idx]) return;
    const num = cleanNumber(inputEl.value);
    variantRowsState[idx].fifoCost = num;
    inputEl.value = num > 0 ? formatNumberWithThousands(num) : '';
    updateFifoCalculations();
};

window.propagateFifoCostToAllVariants = () => {
    const inputFifoCost = document.getElementById('input-product-fifo-cost');
    const baseCost = cleanNumber(inputFifoCost?.value || 0);
    if (baseCost <= 0) {
        alert("Por favor ingresa un Costo FIFO Unitario superior a 0 en el campo principal antes de copiarlo a las variantes.");
        if (inputFifoCost) inputFifoCost.focus();
        return;
    }
    variantRowsState.forEach(r => {
        r.fifoCost = baseCost;
    });
    renderVariantsTable();
    updateFifoCalculations();
};

function recalculateVariantsTotal() {
    currentPhysicalTotalStock = variantRowsState.reduce((sum, r) => sum + r.physicalStock, 0);
    updateGlobalStockMetrics();
    updateFifoCalculations();
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
            unitCost: d.data().unitCost || 0,
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
        const btnMatchVariants = document.getElementById('btn-variants-match-serials');
        const counterVarSpan = document.getElementById('variants-serials-counter');
        if (btnMatchVariants) {
            btnMatchVariants.classList.toggle('hidden', currentProductSerials.length === 0);
        }
        if (counterVarSpan) {
            counterVarSpan.textContent = currentProductSerials.length;
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
    const counterVarSpan = document.getElementById('variants-serials-counter');
    const active = currentProductSerials.filter(s => s.auditState !== 'REMOVED').length;
    if (badge) badge.textContent = `${active} seriales verificados`;
    if (counterSpan) counterSpan.textContent = active;
    if (counterVarSpan) counterVarSpan.textContent = active;
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
            updateFifoCalculations();
        });
    }

    const inputFifoCost = document.getElementById('input-product-fifo-cost');
    if (inputFifoCost) {
        inputFifoCost.addEventListener('input', () => {
            updateFifoCalculations();
        });

        inputFifoCost.addEventListener('blur', (e) => {
            const num = cleanNumber(e.target.value);
            e.target.value = num > 0 ? formatNumberWithThousands(num) : '';
            updateFifoCalculations();
        });

        inputFifoCost.addEventListener('focus', (e) => {
            e.target.select();
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
            activeEl.id === 'input-product-fifo-cost' ||
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

    const prodStatusSelect = document.getElementById('sync-product-status-select');
    if (prodStatusSelect) {
        prodStatusSelect.addEventListener('change', (e) => {
            const newSt = e.target.value;
            const statusBadge = document.getElementById('modal-product-status-badge');
            if (statusBadge) {
                if (newSt === 'deactivated') {
                    statusBadge.innerHTML = `<i class="fa-solid fa-ban mr-1 text-[8px]"></i> Desactivado`;
                    statusBadge.className = "text-[9px] font-black uppercase tracking-widest text-slate-300 bg-slate-700/60 px-2 py-0.5 rounded-md border border-slate-500/50 inline-flex items-center";
                    statusBadge.classList.remove('hidden');
                } else if (newSt === 'draft') {
                    statusBadge.innerHTML = `<i class="fa-solid fa-circle mr-1 text-[8px] text-amber-400"></i> Borrador`;
                    statusBadge.className = "text-[9px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-400/30 inline-flex items-center";
                    statusBadge.classList.remove('hidden');
                } else {
                    statusBadge.innerHTML = `<i class="fa-solid fa-circle mr-1 text-[8px] text-emerald-400"></i> Activo`;
                    statusBadge.className = "text-[9px] font-black uppercase tracking-widest text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-400/30 inline-flex items-center";
                    statusBadge.classList.remove('hidden');
                }
            }
            if (newSt === 'deactivated') {
                const reasonSel = document.getElementById('sync-reason-select');
                if (reasonSel) reasonSel.value = 'Desactivación por Producto Discontinuado';
            }
        });
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
            const extraSerials = activeSerials.length - finalPhysicalStock;
            const adjustChoice = confirm(
                `AVISO DE DESCUADRE ENTRE SERIALES Y STOCK:\n\n` +
                `- Conteo Físico total indicado: ${finalPhysicalStock} unidad(es).\n` +
                `- Seriales verificados en lista: ${activeSerials.length} serial(es).\n` +
                `- Hay ${extraSerials} serial(es) más en sistema que el stock físico contado.\n\n` +
                `¿Deseas igualar automáticamente el Conteo Físico a ${activeSerials.length} para que coincida con los seriales verificados?\n\n` +
                `• ACEPTAR: Sí, tengo los ${activeSerials.length} productos físicamente (subir conteo a ${activeSerials.length}).\n` +
                `• CANCELAR: No, solo hay ${finalPhysicalStock} unidades físicas (en la columna derecha de seriales debes retirar los ${extraSerials} que ya no existen).`
            );
            if (adjustChoice) {
                if (!hasVariants) {
                    window.setSimpleCountToSerialsCount();
                } else {
                    window.setVariantsCountToSerialsCount();
                }
                alert(`Conteo físico actualizado a ${currentPhysicalTotalStock} unidad(es). Ahora puedes pulsar "Guardar y Sincronizar Inventario".`);
            }
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

    // Costo FIFO ingresado
    const inputFifoCost = document.getElementById('input-product-fifo-cost');
    const enteredFifoCost = cleanNumber(inputFifoCost?.value || 0);

    if (enteredFifoCost <= 0 && finalPhysicalStock > 0) {
        const proceedWithoutCost = confirm(
            `AVISO DE COSTO FIFO:\n\n` +
            `- No has establecido un Costo FIFO para este producto ($0 COP).\n` +
            `- Sin costo asignado, el sistema contable y de rentabilidad mostrará valuación de existencias en $0 y un margen de utilidad irreal del 100%.\n\n` +
            `¿Deseas guardar de todas formas con Costo FIFO en $0, o prefieres regresar a asignarle un costo?`
        );
        if (!proceedWithoutCost) {
            if (inputFifoCost) {
                inputFifoCost.focus();
                inputFifoCost.select();
            }
            return;
        }
    }

    let finalValuation = 0;
    if (hasVariants && variantRowsState.length > 0) {
        finalValuation = variantRowsState.reduce((sum, r) => {
            const cost = r.fifoCost > 0 ? r.fifoCost : enteredFifoCost;
            return sum + (r.physicalStock * cost);
        }, 0);
    } else {
        finalValuation = finalPhysicalStock * enteredFifoCost;
    }

    // Resumen de confirmación
    const reason = reasonSelect?.value || 'Toma de Inventario Físico (Sede Principal)';
    const notes = notesInput?.value.trim() || 'Sin notas adicionales.';
    const selectedStatus = document.getElementById('sync-product-status-select')?.value || currentProduct.status || 'active';

    let confirmMsg = `CONFIRMAR SINCRONIZACIÓN DE INVENTARIO FÍSICO:\n\n`;
    confirmMsg += `Producto: ${currentProduct.name}\n`;
    if (selectedStatus !== (currentProduct.status || 'active')) {
        confirmMsg += `Estado Catálogo: ${(currentProduct.status || 'active').toUpperCase()} -> ${selectedStatus.toUpperCase()}\n`;
    }
    confirmMsg += `Stock Sistema: ${currentSystemTotalStock} -> Stock Físico: ${finalPhysicalStock} (${deltaTotal >= 0 ? '+' : ''}${deltaTotal})\n`;
    confirmMsg += `Costo FIFO Unitario: ${formatCOP(enteredFifoCost)}\n`;
    if (finalPhysicalStock > 0) {
        confirmMsg += `Valoración Total en Sede: ${formatCOP(finalValuation)}\n`;
    }
    
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
            const vCost = r.fifoCost > 0 ? r.fifoCost : enteredFifoCost;
            confirmMsg += ` - ${r.color || 'Estándar'} ${r.capacity || ''}: ${r.systemStock} -> ${r.physicalStock} (${d >= 0 ? '+' : ''}${d}) | Costo FIFO: ${formatCOP(vCost)}\n`;
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
            status: selectedStatus,
            lastPurchaseCost: enteredFifoCost,
            costPrice: enteredFifoCost,
            cost: enteredFifoCost,
            fifoCost: enteredFifoCost,
            updatedAt: now,
            lastInventoryAudit: now,
            lastInventoryAuditWeek: weekKey,
            lastInventoryAuditAdmin: currentUser?.email || 'admin@pixeltechcol.com'
        };

        if (currentProduct.branchStock || typeof currentProduct.branchStock === 'object') {
            productUpdateData.branchStock = {
                ...(currentProduct.branchStock || {}),
                bodega: finalPhysicalStock
            };
        }

        let variantChangesForLog = [];
        let updatedCombinations = null;

        if (hasVariants) {
            updatedCombinations = currentProduct.combinations.map((comb, idx) => {
                const matchRow = variantRowsState.find(r => r.color === (comb.color || '') && r.capacity === (comb.capacity || '')) 
                    || variantRowsState[idx];
                
                const newVarStock = matchRow ? matchRow.physicalStock : (Number(comb.stock) || 0);
                const varCost = (matchRow && matchRow.fifoCost > 0) ? matchRow.fifoCost : enteredFifoCost;

                variantChangesForLog.push({
                    color: comb.color || 'Estándar',
                    capacity: comb.capacity || '',
                    before: Number(comb.stock) || 0,
                    after: newVarStock,
                    delta: newVarStock - (Number(comb.stock) || 0),
                    fifoCost: varCost
                });

                const updatedComb = {
                    ...comb,
                    stock: newVarStock,
                    cost: varCost,
                    lastPurchaseCost: varCost,
                    unitCost: varCost
                };

                if (comb.branchStock || typeof comb.branchStock === 'object') {
                    updatedComb.branchStock = {
                        ...(comb.branchStock || {}),
                        bodega: newVarStock
                    };
                }

                return updatedComb;
            });

            productUpdateData.combinations = updatedCombinations;
        }

        batch.update(productRef, productUpdateData);

        // 2. Registrar nuevos seriales en product_serials
        addedSerials.forEach(s => {
            const sRef = doc(collection(db, "product_serials"));
            let serCost = enteredFifoCost;
            if (s.color || s.capacity) {
                const matchRow = variantRowsState.find(r => r.color === (s.color || '') && r.capacity === (s.capacity || ''));
                if (matchRow && matchRow.fifoCost > 0) serCost = matchRow.fifoCost;
            }

            batch.set(sRef, {
                serialNumber: s.serialNumber,
                productId: currentProduct.id,
                productName: currentProduct.name,
                sku: s.sku || currentProduct.sku || '',
                brand: currentProduct.brand || '',
                color: s.color || null,
                capacity: s.capacity || null,
                status: 'AVAILABLE',
                unitCost: serCost,
                purchaseId: 'SYNC_AUDIT',
                supplierName: 'Toma Física de Inventario',
                verifiedAt: now,
                createdAt: now,
                updatedAt: now
            });
        });

        // 2.1 Backfill de seriales activos existentes que no tengan costo asignado
        activeSerials.forEach(s => {
            if (s.auditState === 'EXISTING' && (!s.unitCost || Number(s.unitCost) <= 0) && s.docRef) {
                let serCost = enteredFifoCost;
                if (s.color || s.capacity) {
                    const matchRow = variantRowsState.find(r => r.color === (s.color || '') && r.capacity === (s.capacity || ''));
                    if (matchRow && matchRow.fifoCost > 0) serCost = matchRow.fifoCost;
                }
                if (serCost > 0) {
                    batch.update(s.docRef, { unitCost: serCost, updatedAt: now });
                }
            }
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
            beforeStatus: currentProduct.status || 'active',
            afterStatus: selectedStatus,
            type: 'SYNC_AUDIT',
            weekKey: weekKey,
            reason: reason,
            notes: notes,
            beforeStock: currentSystemTotalStock,
            afterStock: finalPhysicalStock,
            deltaStock: deltaTotal,
            fifoCostBefore: cleanNumber(currentProduct.lastPurchaseCost || currentProduct.costPrice || 0),
            fifoCostAfter: enteredFifoCost,
            totalValuation: finalValuation,
            changeDetails: `Sincronización física de inventario: ${currentSystemTotalStock} -> ${finalPhysicalStock} (${deltaTotal >= 0 ? '+' : ''}${deltaTotal} uds) | Costo FIFO: $${enteredFifoCost.toLocaleString('es-CO')}${selectedStatus !== (currentProduct.status || 'active') ? ` | Estado: ${selectedStatus}` : ''}`,
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

        // Actualizar estado local inmediato para reactividad de interfaz
        if (currentProduct) {
            currentProduct.lastInventoryAudit = new Date();
            currentProduct.lastInventoryAuditWeek = weekKey;
            currentProduct.stock = finalPhysicalStock;
            currentProduct.status = selectedStatus;
            currentProduct.lastPurchaseCost = enteredFifoCost;
            currentProduct.costPrice = enteredFifoCost;
            currentProduct.cost = enteredFifoCost;
            currentProduct.fifoCost = enteredFifoCost;
            if (currentProduct.branchStock) {
                currentProduct.branchStock.bodega = finalPhysicalStock;
            }
            auditedProductIdsMap[currentProduct.id] = new Date();
            if (!productAuditHistoryMap[currentProduct.id]) {
                productAuditHistoryMap[currentProduct.id] = [];
            }
            productAuditHistoryMap[currentProduct.id].push(new Date());
            const prodInAll = allProducts.find(p => p.id === currentProduct.id);
            if (prodInAll) {
                prodInAll.lastInventoryAudit = new Date();
                prodInAll.lastInventoryAuditWeek = weekKey;
                prodInAll.stock = finalPhysicalStock;
                prodInAll.status = selectedStatus;
                prodInAll.lastPurchaseCost = enteredFifoCost;
                prodInAll.costPrice = enteredFifoCost;
                prodInAll.cost = enteredFifoCost;
                prodInAll.fifoCost = enteredFifoCost;
                if (prodInAll.branchStock) {
                    prodInAll.branchStock.bodega = finalPhysicalStock;
                }
                if (hasVariants && updatedCombinations) {
                    prodInAll.combinations = updatedCombinations;
                }
            }
        }

        try {
            await AdminStore.forceSyncProducts();
        } catch (e) {
            console.warn("Aviso al forzar sincronización con AdminStore:", e);
        }

        alert("Sincronización de inventario completada con éxito.\nLos datos de stock, costo FIFO, valuación, variantes y seriales ya están actualizados en el sistema.");
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


window.forceSyncInventory = async () => {
    const btn = document.getElementById('btn-sync-refresh');
    let oldHtml = '';
    if (btn) {
        oldHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin text-xs"></i> <span>Actualizando...</span>';
    }
    try {
        await AdminStore.forceSyncProducts();
        await loadAuditedProductsFromLogs();
        applyFilters();
    } catch (err) {
        console.error("Error forzando sincronizacion:", err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = oldHtml;
        }
    }
};

// =========================================================================
// 8. ANULACIÓN DE PEDIDOS PRE-INVENTARIO (SIN RETORNO DE STOCK)
// =========================================================================
let currentPreCancelOrder = null;

window.openPreInventoryCancelModal = () => {
    const modal = document.getElementById('modal-pre-inventory-cancel');
    if (!modal) return;
    currentPreCancelOrder = null;

    const input = document.getElementById('input-pre-cancel-search');
    if (input) input.value = '';

    const errorEl = document.getElementById('pre-cancel-search-error');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    const previewBox = document.getElementById('box-pre-cancel-order-preview');
    if (previewBox) previewBox.classList.add('hidden');

    modal.classList.remove('hidden');

    setTimeout(() => {
        if (input) {
            input.focus();
            input.select();
        }
    }, 100);
};

window.closePreInventoryCancelModal = () => {
    const modal = document.getElementById('modal-pre-inventory-cancel');
    if (modal) modal.classList.add('hidden');
    currentPreCancelOrder = null;
};

// Listener para disparar búsqueda con tecla Enter
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('input-pre-cancel-search');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.searchOrderForPreCancel();
            }
        });
    }
});

window.searchOrderForPreCancel = async () => {
    const input = document.getElementById('input-pre-cancel-search');
    const errorEl = document.getElementById('pre-cancel-search-error');
    const previewBox = document.getElementById('box-pre-cancel-order-preview');
    const btnSearch = document.getElementById('btn-pre-cancel-search');

    if (!input || !errorEl || !previewBox) return;

    const rawTerm = input.value.trim();
    if (!rawTerm) {
        errorEl.textContent = 'Por favor ingresa un número de orden o ID.';
        errorEl.classList.remove('hidden');
        previewBox.classList.add('hidden');
        return;
    }

    errorEl.classList.add('hidden');
    const oldBtnHtml = btnSearch ? btnSearch.innerHTML : '';
    if (btnSearch) {
        btnSearch.disabled = true;
        btnSearch.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Buscando...';
    }

    try {
        let foundDoc = null;

        // 1. Búsqueda directa por ID de documento en Firestore
        try {
            const directSnap = await getDoc(doc(db, "orders", rawTerm));
            if (directSnap.exists()) {
                foundDoc = { id: directSnap.id, ...directSnap.data() };
            }
        } catch (e) {}

        // 2. Si no se encontró por ID directo, buscar por internalOrderNumber (ej: #1045 o 1045)
        if (!foundDoc) {
            const numClean = rawTerm.replace('#', '').trim();
            const numParsed = Number(numClean);
            
            // Buscar por internalOrderNumber como string o number
            let q1 = query(collection(db, "orders"), where("internalOrderNumber", "==", numClean), limit(1));
            let s1 = await getDocs(q1);
            if (!s1.empty) {
                foundDoc = { id: s1.docs[0].id, ...s1.docs[0].data() };
            } else if (!isNaN(numParsed) && numParsed > 0) {
                let q2 = query(collection(db, "orders"), where("internalOrderNumber", "==", numParsed), limit(1));
                let s2 = await getDocs(q2);
                if (!s2.empty) {
                    foundDoc = { id: s2.docs[0].id, ...s2.docs[0].data() };
                }
            }
        }

        // 3. Buscar por mlOrderId
        if (!foundDoc) {
            let q3 = query(collection(db, "orders"), where("mlOrderId", "==", rawTerm), limit(1));
            let s3 = await getDocs(q3);
            if (!s3.empty) {
                foundDoc = { id: s3.docs[0].id, ...s3.docs[0].data() };
            }
        }

        if (!foundDoc) {
            errorEl.textContent = `No se encontró ningún pedido con el identificador "${rawTerm}". Verifica el número.`;
            errorEl.classList.remove('hidden');
            previewBox.classList.add('hidden');
            return;
        }

        currentPreCancelOrder = foundDoc;

        // Renderizar vista previa de la orden encontrada
        const numEl = document.getElementById('prev-order-number');
        const sourceEl = document.getElementById('prev-order-source');
        const statusEl = document.getElementById('prev-order-status');
        const clientEl = document.getElementById('prev-order-client');
        const dateEl = document.getElementById('prev-order-date');
        const totalEl = document.getElementById('prev-order-total');
        const itemsListEl = document.getElementById('prev-order-items-list');
        const boxTreasury = document.getElementById('box-pre-cancel-treasury');

        if (numEl) numEl.textContent = foundDoc.internalOrderNumber ? `#${foundDoc.internalOrderNumber}` : `#${foundDoc.id.slice(0, 8)}`;
        if (sourceEl) sourceEl.textContent = foundDoc.source || foundDoc.channel || 'Manual';
        
        const isCancelled = foundDoc.status === 'CANCELADO';
        if (statusEl) {
            statusEl.textContent = foundDoc.status || 'PENDIENTE';
            statusEl.className = isCancelled 
                ? 'px-2.5 py-1 bg-rose-100 border border-rose-200 rounded-xl text-[10px] font-black uppercase text-rose-700'
                : 'px-2.5 py-1 bg-amber-100 border border-amber-200 rounded-xl text-[10px] font-black uppercase text-amber-700';
        }

        if (clientEl) clientEl.textContent = foundDoc.userName || foundDoc.customerName || (foundDoc.shippingAddress && foundDoc.shippingAddress.name) || 'Cliente sin nombre';
        
        let formattedDate = 'N/A';
        const rawDate = foundDoc.createdAt || foundDoc.date;
        if (rawDate) {
            const d = rawDate.toDate ? rawDate.toDate() : new Date(rawDate);
            formattedDate = d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
        if (dateEl) dateEl.textContent = formattedDate;

        const totalAmount = Number(foundDoc.total) || Number(foundDoc.amountPaid) || 0;
        if (totalEl) totalEl.textContent = formatCOP(totalAmount);

        // Renderizar items del pedido
        const items = foundDoc.items || [];
        if (itemsListEl) {
            if (items.length === 0) {
                itemsListEl.innerHTML = '<p class="text-xs text-gray-400 italic">Este pedido no tiene items registrados.</p>';
            } else {
                itemsListEl.innerHTML = items.map(it => {
                    const variantText = `${it.color || ''} ${it.capacity ? '- ' + it.capacity : ''}`.trim();
                    const qty = Number(it.quantity) || 1;
                    return `
                        <div class="flex items-center justify-between p-2.5 bg-white rounded-xl border border-gray-200 shadow-2xs text-xs">
                            <div class="min-w-0 pr-2">
                                <span class="font-black text-brand-black truncate block">${it.name || 'Producto'}</span>
                                ${variantText ? `<span class="text-[10px] text-gray-400 font-bold block">${variantText}</span>` : ''}
                                <span class="text-[9px] font-mono text-gray-400">SKU: ${it.sku || 'N/A'}</span>
                            </div>
                            <div class="text-right shrink-0">
                                <span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-black text-xs">${qty} ud(s)</span>
                                <span class="text-[9px] text-rose-500 font-bold block mt-0.5">Sin retorno</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Mostrar opción de tesorería si hay pago registrado
        const hasPayment = (Number(foundDoc.amountPaid) > 0 || Number(foundDoc.total) > 0) && foundDoc.paymentAccountId;
        if (boxTreasury) {
            boxTreasury.classList.toggle('hidden', !hasPayment);
            const chkTreasury = document.getElementById('chk-pre-cancel-treasury');
            if (chkTreasury) chkTreasury.checked = false;
        }

        const btnExec = document.getElementById('btn-pre-cancel-execute');
        if (btnExec) {
            if (isCancelled) {
                btnExec.disabled = true;
                btnExec.classList.add('opacity-50', 'cursor-not-allowed');
                btnExec.innerHTML = '<i class="fa-solid fa-check"></i> <span>Este Pedido ya se encuentra CANCELADO</span>';
            } else {
                btnExec.disabled = false;
                btnExec.classList.remove('opacity-50', 'cursor-not-allowed');
                btnExec.innerHTML = '<i class="fa-solid fa-ban"></i> <span>Anular Pedido Definitivamente (0 Retorno de Stock)</span>';
            }
        }

        previewBox.classList.remove('hidden');

    } catch (err) {
        console.error("Error buscando pedido:", err);
        errorEl.textContent = 'Error al consultar la base de datos: ' + (err.message || err);
        errorEl.classList.remove('hidden');
    } finally {
        if (btnSearch) {
            btnSearch.disabled = false;
            btnSearch.innerHTML = oldBtnHtml;
        }
    }
};

window.confirmAndExecutePreCancel = async () => {
    if (!currentPreCancelOrder) return;
    const order = currentPreCancelOrder;

    if (order.status === 'CANCELADO') {
        alert("Este pedido ya está marcado como CANCELADO.");
        return;
    }

    const releaseSerials = document.getElementById('chk-pre-cancel-serials')?.checked ?? true;
    const reverseTreasury = document.getElementById('chk-pre-cancel-treasury')?.checked ?? false;
    const reasonText = document.getElementById('input-pre-cancel-reason')?.value.trim() || 'Anulación por Regularización Pre-Inventario Físico (Sin Retorno de Stock)';

    let msg = `CONFIRMAR ANULACIÓN PRE-INVENTARIO:\n\n`;
    msg += `Pedido: ${order.internalOrderNumber ? '#' + order.internalOrderNumber : order.id}\n`;
    msg += `Cliente: ${order.userName || 'Cliente'}\n\n`;
    msg += `GARANTÍA DE STOCK:\n`;
    msg += `• 0 unidades volverán a bodega. El stock de los productos NO SE MODIFICARÁ.\n`;
    if (releaseSerials) {
        msg += `• Los seriales asignados a este pedido volverán a quedar disponibles en bodega.\n`;
    } else {
        msg += `• Los seriales mantendrán su estado actual.\n`;
    }
    if (reverseTreasury) {
        msg += `• Se restará el valor pagado de la cuenta de tesorería asociada.\n`;
    }
    msg += `\n¿Confirmas anular este pedido con estas condiciones?`;

    if (!confirm(msg)) return;

    const btnExec = document.getElementById('btn-pre-cancel-execute');
    const oldBtnHtml = btnExec ? btnExec.innerHTML : '';
    if (btnExec) {
        btnExec.disabled = true;
        btnExec.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Anulando Pedido...';
    }

    try {
        const batch = writeBatch(db);
        const now = serverTimestamp();
        const nowISO = new Date().toISOString();
        const adminEmail = currentUser?.email || 'admin@pixeltechcol.com';

        // 1. Actualizar Orden a CANCELADO sin retorno de stock
        const orderRef = doc(db, "orders", order.id);
        const orderUpdateData = {
            status: 'CANCELADO',
            isStockDeducted: false,
            cancelledWithoutStockReturn: true,
            preInventoryCancelled: true,
            cancelReason: reasonText,
            cancelledAt: now,
            cancelledBy: adminEmail,
            cancellationConfirmed: true,
            cancellationPendingConfirm: false,
            updatedAt: now
        };
        batch.update(orderRef, orderUpdateData);

        // 2. Anular remisión vinculada si existe
        try {
            const remRef = doc(db, "remissions", order.id);
            const remSnap = await getDoc(remRef);
            if (remSnap.exists()) {
                batch.update(remRef, { status: 'CANCELADO', updatedAt: now });
            }
        } catch (e) {}

        // 3. Seriales vinculados a la orden
        let serialsProcessed = [];
        if (releaseSerials) {
            try {
                const serialsQuery = query(collection(db, "product_serials"), where("orderId", "==", order.id));
                const serialsSnap = await getDocs(serialsQuery);
                serialsSnap.forEach(sDoc => {
                    const serData = sDoc.data();
                    serialsProcessed.push(serData.serialNumber || sDoc.id);
                    batch.update(sDoc.ref, {
                        status: 'AVAILABLE',
                        orderId: null,
                        orderInternalNumber: null,
                        clientName: null,
                        clientPhone: null,
                        dispatchedAt: null,
                        returnedAt: now,
                        updatedAt: now,
                        notes: `Liberado por anulación pre-inventario del pedido #${order.internalOrderNumber || order.id.slice(0, 8)}`
                    });
                });
            } catch (errSerials) {
                console.warn("Aviso al liberar seriales de pedido pre-inventario:", errSerials);
            }
        }

        // 4. Reversar tesorería si el admin lo marcó explícitamente
        if (reverseTreasury && order.paymentAccountId) {
            try {
                const accRef = doc(db, "accounts", order.paymentAccountId);
                const accSnap = await getDoc(accRef);
                if (accSnap.exists()) {
                    const amountPaid = Number(order.amountPaid) || Number(order.total) || 0;
                    const curBal = Number(accSnap.data().balance) || 0;
                    batch.update(accRef, { balance: Math.max(0, curBal - amountPaid) });

                    const expRef = doc(collection(db, "expenses"));
                    batch.set(expRef, {
                        amount: amountPaid,
                        category: "Anulación Pre-Inventario",
                        description: `Reverso por anulación pre-inventario de Orden #${order.internalOrderNumber || order.id.slice(0, 8)}`,
                        paymentMethod: accSnap.data().name || order.paymentMethod || 'Manual',
                        supplierName: order.userName || "Cliente",
                        date: now,
                        createdAt: now,
                        type: 'EXPENSE',
                        orderId: order.id,
                        isRefund: true
                    });
                }
            } catch (accErr) {
                console.warn("Aviso al reversar tesorería:", accErr);
            }
        }

        // 5. Registrar en inventory_audit_logs para trazabilidad inmutable
        const auditLogRef = doc(collection(db, "inventory_audit_logs"));
        batch.set(auditLogRef, {
            type: 'PRE_INVENTORY_ORDER_CANCEL',
            orderId: order.id,
            internalOrderNumber: order.internalOrderNumber || 'N/A',
            clientName: order.userName || 'N/A',
            orderTotal: Number(order.total) || 0,
            items: order.items || [],
            serialsReleased: serialsProcessed,
            reason: reasonText,
            adminEmail: adminEmail,
            adminName: currentUser?.displayName || 'Administrador',
            notes: 'Pedido anulado sin retorno de stock por regularización física previa.',
            timestamp: now,
            createdAtISO: nowISO
        });

        // Ejecutar Batch atómico
        await batch.commit();

        alert(`Pedido #${order.internalOrderNumber || order.id.slice(0, 8)} anulado con éxito.\n\nEl stock de bodega se mantuvo 100% intacto y no fue alterado.`);
        window.closePreInventoryCancelModal();

    } catch (err) {
        console.error("Error al ejecutar anulación pre-inventario:", err);
        alert("Error al anular el pedido: " + (err.message || err));
    } finally {
        if (btnExec) {
            btnExec.disabled = false;
            btnExec.innerHTML = oldBtnHtml;
        }
    }
};
