import { db, doc, collection, runTransaction, getDocs, query, where } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js';

loadAdminSidebar();

// ==========================================================================
// REFERENCIAS DOM
// ==========================================================================
const tableBody = document.getElementById('purchases-table-body');
const rangeSpan = document.getElementById('pagination-range');
const totalSpan = document.getElementById('pagination-total');
const btnPrev = document.getElementById('btn-prev-page');
const btnNext = document.getElementById('btn-next-page');
const pageSizeSelect = document.getElementById('page-size-select');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const modalBtnEdit = document.getElementById('modal-btn-edit');

// Modal Pago Compra
const purchasePaymentModal = document.getElementById('purchase-payment-modal');
const purchasePaymentForm = document.getElementById('purchase-payment-form');
const payAccountSelect = document.getElementById('pay-account-select');

// ==========================================================================
// ESTADO GLOBAL
// ==========================================================================
let pageSize = 50;
let currentPage = 1;
let adminPurchasesCache = [];
let accounts = [];

let currentFilter = 'all'; // 'all' | 'pending' | 'due-soon' | 'overdue' | 'paid' | 'urgent'
let currentSort = 'recent-desc';
let searchTerm = '';

let currentActivePurchase = null;
let currentModalPurchase = null;

// Helpers
const formatMoney = (amount) => `$ ${Math.round(amount || 0).toLocaleString('es-CO')}`;
const cleanNumber = (val) => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    return parseFloat(val.toString().replace(/[^\d.-]/g, '')) || 0;
};
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";

const formatDate = (dateVal) => {
    if (!dateVal) return '--';
    let d = null;
    if (typeof dateVal.toDate === 'function') d = dateVal.toDate();
    else if (dateVal instanceof Date) d = dateVal;
    else if (typeof dateVal === 'object' && (dateVal.seconds || dateVal._seconds)) {
        d = new Date((dateVal.seconds || dateVal._seconds) * 1000);
    } else {
        d = new Date(dateVal);
    }
    if (!d || isNaN(d.getTime())) return '--';
    return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
};

// ==========================================================================
// MÁSCARA MONEDA PARA INPUTS
// ==========================================================================
document.querySelectorAll('.currency-input').forEach(input => {
    input.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, "");
        if (val === "") { e.target.value = ""; return; }
        e.target.value = "$ " + parseInt(val, 10).toLocaleString('es-CO');
    });
});

// ==========================================================================
// CÁLCULO DE VENCIMIENTOS Y SEMÁFORO DE URGENCIAS
// ==========================================================================
function getPurchaseDueStatus(p) {
    const total = cleanNumber(p.totalCost);
    const paid = cleanNumber(p.amountPaid);
    const balance = Math.max(0, total - paid);
    const isPaid = (p.paymentStatus === 'PAID') || (balance <= 0);

    if (isPaid) {
        return {
            status: 'PAID',
            badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            iconClass: 'fa-solid fa-circle-check',
            label: 'Liquidada (Sin deuda)',
            diffDays: null,
            isOverdue: false,
            isDueSoon: false,
            isDueToday: false,
            dateFormatted: p.dueDate ? formatDate(p.dueDate) : null
        };
    }

    if (!p.dueDate) {
        return {
            status: 'PENDING_NODATE',
            badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
            iconClass: 'fa-regular fa-calendar-xmark',
            label: 'Sin fecha límite fijada',
            diffDays: null,
            isOverdue: false,
            isDueSoon: false,
            isDueToday: false,
            dateFormatted: null
        };
    }

    // Calcular días restantes contra hoy a las 00:00:00
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dueObj;
    if (typeof p.dueDate === 'string' && p.dueDate.includes('-')) {
        const parts = p.dueDate.split('-');
        dueObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
        dueObj = p.dueDate.toDate ? p.dueDate.toDate() : new Date(p.dueDate);
    }
    dueObj.setHours(0, 0, 0, 0);

    const diffMs = dueObj.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const dateFormatted = formatDate(dueObj);

    if (diffDays < 0) {
        const overdueDays = Math.abs(diffDays);
        return {
            status: 'OVERDUE',
            badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
            iconClass: 'fa-solid fa-triangle-exclamation',
            label: `Vencida hace ${overdueDays} ${overdueDays === 1 ? 'día' : 'días'} (${dateFormatted})`,
            diffDays,
            isOverdue: true,
            isDueSoon: false,
            isDueToday: false,
            dateFormatted
        };
    } else if (diffDays === 0) {
        return {
            status: 'DUE_TODAY',
            badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 font-black animate-pulse',
            iconClass: 'fa-solid fa-clock',
            label: `Vence Hoy! (${dateFormatted})`,
            diffDays,
            isOverdue: false,
            isDueSoon: true,
            isDueToday: true,
            dateFormatted
        };
    } else if (diffDays <= 7) {
        return {
            status: 'DUE_SOON',
            badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
            iconClass: 'fa-solid fa-calendar-day',
            label: `Vence en ${diffDays} ${diffDays === 1 ? 'día' : 'días'} (${dateFormatted})`,
            diffDays,
            isOverdue: false,
            isDueSoon: true,
            isDueToday: false,
            dateFormatted
        };
    } else {
        return {
            status: 'ON_TRACK',
            badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
            iconClass: 'fa-regular fa-calendar',
            label: `Vence el ${dateFormatted}`,
            diffDays,
            isOverdue: false,
            isDueSoon: false,
            isDueToday: false,
            dateFormatted
        };
    }
}

// ==========================================================================
// CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToPurchases((purchases) => {
    adminPurchasesCache = purchases || [];
    calculateSummaryKPIs();
    renderPurchasesFromMemory();
});

AdminStore.subscribeToAccounts((accs) => {
    accounts = accs || [];
    renderAccountSelectOptions();
});

function renderAccountSelectOptions() {
    if (!payAccountSelect) return;
    const currentVal = payAccountSelect.value;
    payAccountSelect.innerHTML = '<option value="">Seleccione cuenta de tesorería...</option>';
    accounts.forEach(acc => {
        const bal = formatMoney(cleanNumber(acc.balance));
        payAccountSelect.innerHTML += `<option value="${acc.id}">${acc.name} (Saldo: ${bal})</option>`;
    });
    if (currentVal) payAccountSelect.value = currentVal;
}

// ==========================================================================
// CÁLCULO DE KPIS Y ASISTENTE DE PRÓXIMOS PAGOS
// ==========================================================================
function calculateSummaryKPIs() {
    let totalPurchasesAmount = 0;
    let totalPurchasesCount = adminPurchasesCache.length;

    let totalPendingAmount = 0;
    let pendingPurchasesCount = 0;

    let overdueCount = 0;
    let overdueAmount = 0;

    let dueSoonCount = 0;
    let dueSoonAmount = 0;

    let paidCount = 0;

    adminPurchasesCache.forEach(p => {
        const total = cleanNumber(p.totalCost);
        const paid = cleanNumber(p.amountPaid);
        const balance = Math.max(0, total - paid);
        totalPurchasesAmount += total;

        const dueStatus = getPurchaseDueStatus(p);

        if (dueStatus.status === 'PAID') {
            paidCount++;
        } else {
            if (balance > 0) {
                totalPendingAmount += balance;
                pendingPurchasesCount++;

                if (dueStatus.isOverdue) {
                    overdueCount++;
                    overdueAmount += balance;
                } else if (dueStatus.isDueSoon || dueStatus.isDueToday) {
                    dueSoonCount++;
                    dueSoonAmount += balance;
                }
            }
        }
    });

    const urgentCount = overdueCount + dueSoonCount;
    const urgentAmount = overdueAmount + dueSoonAmount;

    // Actualizar KPIs del DOM
    const elTotPurch = document.getElementById('kpi-total-purchases');
    if (elTotPurch) elTotPurch.textContent = formatMoney(totalPurchasesAmount);

    const elCountPurch = document.getElementById('kpi-count-purchases');
    if (elCountPurch) elCountPurch.textContent = `${totalPurchasesCount} entradas registradas`;

    const elTotPend = document.getElementById('kpi-total-pending');
    if (elTotPend) elTotPend.textContent = formatMoney(totalPendingAmount);

    const elCountPend = document.getElementById('kpi-count-pending');
    if (elCountPend) elCountPend.textContent = `${pendingPurchasesCount} compras con saldo`;

    const elUrgAmt = document.getElementById('kpi-urgent-amount');
    if (elUrgAmt) elUrgAmt.textContent = formatMoney(urgentAmount);

    const elUrgBreakdown = document.getElementById('kpi-urgent-breakdown');
    if (elUrgBreakdown) elUrgBreakdown.textContent = `${overdueCount} vencidas • ${dueSoonCount} por vencer (7d)`;

    const elUrgBadge = document.getElementById('kpi-urgent-badge');
    if (elUrgBadge) {
        if (overdueCount > 0) {
            elUrgBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30";
            elUrgBadge.textContent = "Pagos Vencidos Requieren Atención";
        } else if (dueSoonCount > 0) {
            elUrgBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30";
            elUrgBadge.textContent = "Vencimientos Próximos";
        } else {
            elUrgBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
            elUrgBadge.textContent = "Al Día Sin Vencimientos Inmediatos";
        }
    }

    // Actualizar Badges de Filtros
    const bAll = document.getElementById('badge-count-all');
    if (bAll) bAll.textContent = totalPurchasesCount;

    const bPending = document.getElementById('badge-count-pending');
    if (bPending) bPending.textContent = pendingPurchasesCount;

    const bDueSoon = document.getElementById('badge-count-due-soon');
    if (bDueSoon) bDueSoon.textContent = dueSoonCount;

    const bOverdue = document.getElementById('badge-count-overdue');
    if (bOverdue) bOverdue.textContent = overdueCount;

    const bPaid = document.getElementById('badge-count-paid');
    if (bPaid) bPaid.textContent = paidCount;
}

// ==========================================================================
// FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================
function renderPurchasesFromMemory() {
    if (!tableBody) return;

    let filtered = adminPurchasesCache;
    const term = normalizeText(searchTerm);

    // 1. Filtro Tipo Pill
    if (currentFilter === 'pending') {
        filtered = filtered.filter(p => {
            const bal = cleanNumber(p.totalCost) - cleanNumber(p.amountPaid);
            return bal > 0 && p.paymentStatus !== 'PAID';
        });
    } else if (currentFilter === 'due-soon') {
        filtered = filtered.filter(p => {
            const due = getPurchaseDueStatus(p);
            return due.isDueSoon || due.isDueToday;
        });
    } else if (currentFilter === 'overdue') {
        filtered = filtered.filter(p => {
            const due = getPurchaseDueStatus(p);
            return due.isOverdue;
        });
    } else if (currentFilter === 'urgent') {
        filtered = filtered.filter(p => {
            const due = getPurchaseDueStatus(p);
            return due.isOverdue || due.isDueSoon || due.isDueToday;
        });
    } else if (currentFilter === 'paid') {
        filtered = filtered.filter(p => {
            const due = getPurchaseDueStatus(p);
            return due.status === 'PAID';
        });
    }

    // 2. Búsqueda por término (ID, Proveedor o Ítems)
    if (term.length > 0) {
        filtered = filtered.filter(p => {
            const matchId = p.id.toLowerCase().includes(term);
            const matchSupplier = normalizeText(p.supplierName || '').includes(term);
            const matchItems = p.items && Array.isArray(p.items) && p.items.some(item => normalizeText(item.name || '').includes(term));
            return matchId || matchSupplier || matchItems;
        });
    }

    // 3. Ordenamiento
    filtered = sortPurchases(filtered);

    const totalDocs = filtered.length;
    const maxPages = Math.max(1, Math.ceil(totalDocs / pageSize));
    if (currentPage > maxPages) currentPage = maxPages;

    tableBody.innerHTML = "";

    if (totalDocs === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 px-4 text-center text-slate-400">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3 text-lg">
                        <i class="fa-solid fa-folder-open"></i>
                    </div>
                    <p class="text-xs font-bold uppercase tracking-wider text-slate-600">No se encontraron compras con los filtros seleccionados</p>
                    <p class="text-[11px] text-slate-400 mt-0.5">Prueba cambiando el filtro o la búsqueda.</p>
                </td>
            </tr>`;
        updatePaginationUI(0, 0, 0, maxPages);
        return;
    }

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalDocs);
    const pageData = filtered.slice(startIdx, endIdx);

    pageData.forEach(p => renderRow(p));
    updatePaginationUI(startIdx + 1, endIdx, totalDocs, maxPages);
}

function sortPurchases(list) {
    const sorted = [...list];
    switch (currentSort) {
        case 'due-asc':
            return sorted.sort((a, b) => {
                const dueA = getPurchaseDueStatus(a);
                const dueB = getPurchaseDueStatus(b);
                // Vencidas primero
                if (dueA.isOverdue && !dueB.isOverdue) return -1;
                if (!dueA.isOverdue && dueB.isOverdue) return 1;
                // Luego por vencer
                if (dueA.isDueSoon && !dueB.isDueSoon) return -1;
                if (!dueA.isDueSoon && dueB.isDueSoon) return 1;
                // Luego fecha ascendente
                const timeA = a.dueDate ? new Date(a.dueDate).getTime() : 9999999999999;
                const timeB = b.dueDate ? new Date(b.dueDate).getTime() : 9999999999999;
                return timeA - timeB;
            });
        case 'pending-desc':
            return sorted.sort((a, b) => {
                const balA = Math.max(0, cleanNumber(a.totalCost) - cleanNumber(a.amountPaid));
                const balB = Math.max(0, cleanNumber(b.totalCost) - cleanNumber(b.amountPaid));
                return balB - balA;
            });
        case 'total-desc':
            return sorted.sort((a, b) => cleanNumber(b.totalCost) - cleanNumber(a.totalCost));
        case 'recent-desc':
        default:
            return sorted.sort((a, b) => {
                const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
                const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
                return timeB - timeA;
            });
    }
}

function updatePaginationUI(start, end, total, maxPages) {
    if (rangeSpan) rangeSpan.textContent = total > 0 ? `${start}-${end}` : "0-0";
    if (totalSpan) totalSpan.textContent = total;
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= maxPages;
}

window.changePurchasesPage = (delta) => {
    currentPage += delta;
    if (currentPage < 1) currentPage = 1;
    renderPurchasesFromMemory();
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
};

window.setFilter = (filterKey) => {
    currentFilter = filterKey;
    currentPage = 1;

    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.classList.remove('active');
    });

    const activeBtn = document.getElementById(`pill-${filterKey === 'urgent' ? 'due-soon' : filterKey}`);
    if (activeBtn) activeBtn.classList.add('active');

    renderPurchasesFromMemory();
};

window.handleSortChange = () => {
    if (sortSelect) {
        currentSort = sortSelect.value;
        renderPurchasesFromMemory();
    }
};

if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value, 10) || 50;
        currentPage = 1;
        renderPurchasesFromMemory();
    });
}

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        currentPage = 1;
        renderPurchasesFromMemory();
    });
}

// ==========================================================================
// RENDERIZADO DE FILAS
// ==========================================================================
function renderRow(p) {
    const dateObj = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
    const dateStr = !isNaN(dateObj) ? dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
    
    let totalItems = 0;
    if (p.items && Array.isArray(p.items)) {
        totalItems = p.items.reduce((sum, item) => sum + (parseInt(item.quantity, 10) || 0), 0);
    }

    const shortId = p.id.slice(0, 8).toUpperCase();
    const total = cleanNumber(p.totalCost);
    const paid = cleanNumber(p.amountPaid);
    const balance = Math.max(0, total - paid);
    const isPaid = (p.paymentStatus === 'PAID') || (balance <= 0);

    // Estado Financiero & Abonos
    let paymentBadge = '';
    if (isPaid) {
        paymentBadge = `
            <span class="inline-flex items-center gap-1 text-[10px] font-black uppercase text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                <i class="fa-solid fa-circle-check text-[9px]"></i> Pagado 100%
            </span>`;
    } else if (paid > 0) {
        paymentBadge = `
            <div class="space-y-0.5">
                <span class="inline-flex items-center gap-1 text-[10px] font-black uppercase text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                    <i class="fa-solid fa-clock-rotate-left text-[9px]"></i> Abono Parcial
                </span>
                <p class="text-[10px] font-bold text-slate-500">Abonado: ${formatMoney(paid)}</p>
            </div>`;
    } else {
        paymentBadge = `
            <span class="inline-flex items-center gap-1 text-[10px] font-black uppercase text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                <i class="fa-solid fa-receipt text-[9px]"></i> Crédito Pendiente
            </span>`;
    }

    // Vencimiento & Semáforo de Urgencia
    const dueStatus = getPurchaseDueStatus(p);
    const dueBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border ${dueStatus.badgeClass}">
            <i class="${dueStatus.iconClass} text-[9px]"></i>
            <span>${dueStatus.label}</span>
        </span>
    `;

    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
    tr.innerHTML = `
        <td class="px-6 py-4">
            <div class="font-black text-slate-900 uppercase tracking-tight text-xs">#${shortId}</div>
            <div class="text-[10px] font-medium text-slate-400 mt-0.5">${dateStr}</div>
        </td>
        <td class="px-6 py-4">
            <p class="font-black text-slate-900 uppercase text-xs truncate max-w-[200px]">${p.supplierName || 'Desconocido'}</p>
            <p class="text-[10px] text-slate-400 font-medium">${p.createdBy || 'Sistema'}</p>
        </td>
        <td class="px-6 py-4 text-center">
            <span class="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-slate-200/60">
                ${totalItems} ${totalItems === 1 ? 'unidad' : 'unidades'}
            </span>
        </td>
        <td class="px-6 py-4">
            ${paymentBadge}
        </td>
        <td class="px-6 py-4">
            ${dueBadge}
        </td>
        <td class="px-6 py-4 text-right">
            <p class="font-black text-slate-900 text-sm tracking-tight">${formatMoney(total)}</p>
            ${!isPaid && balance > 0 ? `<p class="text-[10px] font-bold text-rose-600 mt-0.5">Saldo: ${formatMoney(balance)}</p>` : `<p class="text-[10px] font-semibold text-emerald-600 mt-0.5">Saldada</p>`}
        </td>
        <td class="px-6 py-4 text-center">
            <div class="flex items-center justify-center gap-1.5">
                <button onclick="window.viewPurchaseDetail('${p.id}')" title="Ver Factura Completa" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-800 transition flex items-center justify-center shadow-2xs active:scale-95">
                    <i class="fa-solid fa-eye text-xs"></i>
                </button>
                ${!isPaid && balance > 0 ? `
                    <button onclick="window.openPurchasePayment('${p.id}')" title="Abonar / Pagar Factura" class="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center shadow-2xs active:scale-95">
                        <i class="fa-solid fa-hand-holding-dollar text-xs"></i>
                    </button>
                ` : ''}
                <button onclick="window.editPurchase('${p.id}')" title="Editar Entrada" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-900 hover:border-slate-800 transition flex items-center justify-center shadow-2xs active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
            </div>
        </td>
    `;
    tableBody.appendChild(tr);
}

// Redireccionar a edición de entrada
window.editPurchase = (id) => {
    window.location.href = `inventory-entry.html?editId=${encodeURIComponent(id)}`;
};

// ==========================================================================
// MODAL DETALLE DE COMPRA
// ==========================================================================
window.viewPurchaseDetail = (id) => {
    const p = adminPurchasesCache.find(x => x.id === id);
    if (!p) return;

    currentModalPurchase = p;

    document.getElementById('modal-purchase-id').textContent = `#${p.id.slice(0, 8).toUpperCase()}`;
    const dateObj = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
    document.getElementById('modal-purchase-date').textContent = !isNaN(dateObj) ? dateObj.toLocaleString('es-CO') : '--';

    document.getElementById('modal-supplier-name').textContent = p.supplierName || 'No registrado';
    document.getElementById('modal-admin-name').textContent = p.createdBy || 'Sistema';

    const total = cleanNumber(p.totalCost);
    const paid = cleanNumber(p.amountPaid);
    const balance = Math.max(0, total - paid);
    const isPaid = (p.paymentStatus === 'PAID') || (balance <= 0);

    const dueStatus = getPurchaseDueStatus(p);

    // Métricas del Panel Modal
    document.getElementById('modal-metric-total').textContent = formatMoney(total);
    document.getElementById('modal-metric-paid').textContent = formatMoney(paid);
    document.getElementById('modal-metric-pending').textContent = formatMoney(balance);
    
    const elModalDue = document.getElementById('modal-metric-due');
    elModalDue.innerHTML = `
        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold border ${dueStatus.badgeClass}">
            <i class="${dueStatus.iconClass} text-[9px]"></i>
            <span>${dueStatus.label}</span>
        </span>
    `;

    // Badge de Estado Cabecera
    const statusBadge = document.getElementById('modal-payment-status-badge');
    if (isPaid) {
        statusBadge.className = "px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200";
        statusBadge.textContent = "Pagado 100%";
    } else if (paid > 0) {
        statusBadge.className = "px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200";
        statusBadge.textContent = "Abono Parcial";
    } else {
        statusBadge.className = "px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200";
        statusBadge.textContent = "Crédito Pendiente";
    }

    // Botón Pagar en Modal
    const btnPayModal = document.getElementById('modal-btn-pay');
    if (btnPayModal) {
        if (!isPaid && balance > 0) {
            btnPayModal.classList.remove('hidden');
        } else {
            btnPayModal.classList.add('hidden');
        }
    }

    if (modalBtnEdit) {
        modalBtnEdit.onclick = () => window.editPurchase(p.id);
    }

    const ivaBadge = document.getElementById('modal-iva-badge');
    if (p.hasIVA) {
        ivaBadge.textContent = "SÍ (19% Aplicado)";
        ivaBadge.className = "inline-block px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-cyan-50 text-cyan-700 border border-cyan-200";
    } else {
        ivaBadge.textContent = "NO APLICADO";
        ivaBadge.className = "inline-block px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200";
    }

    // Lista de Mercancía
    const itemsTbody = document.getElementById('modal-items-list');
    itemsTbody.innerHTML = "";

    if (p.items && p.items.length > 0) {
        p.items.forEach(item => {
            let variantText = '';
            if (item.color || item.capacity) {
                variantText = `<br><span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${item.capacity ? item.capacity + ' ' : ''}${item.color ? item.color : ''}</span>`;
            }

            itemsTbody.innerHTML += `
                <tr class="hover:bg-slate-50/80 transition-colors">
                    <td class="p-3">
                        <span class="font-black text-slate-900 text-xs uppercase">${item.name}</span>
                        ${variantText}
                    </td>
                    <td class="p-3 text-center font-black text-slate-800">${item.quantity}</td>
                    <td class="p-3 text-right font-medium text-slate-600">${formatMoney(item.unitCostBase)}</td>
                    <td class="p-3 text-right font-black text-slate-900">${formatMoney(item.totalRow)}</td>
                </tr>
            `;
        });
    } else {
        itemsTbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-xs font-bold text-slate-400">Sin detalles de productos registrados.</td></tr>`;
    }

    document.getElementById('modal-purchase-total').textContent = formatMoney(p.totalCost);
    document.getElementById('purchase-modal').classList.remove('hidden');
};

window.closePurchaseModal = () => {
    document.getElementById('purchase-modal').classList.add('hidden');
    currentModalPurchase = null;
};

window.payCurrentModalPurchase = () => {
    if (currentModalPurchase) {
        window.closePurchaseModal();
        window.openPurchasePayment(currentModalPurchase.id);
    }
};

// ==========================================================================
// MODAL DE PAGO DIRECTO A COMPRA (Transaccional)
// ==========================================================================
window.openPurchasePayment = (purchaseId) => {
    const p = adminPurchasesCache.find(x => x.id === purchaseId);
    if (!p) return;

    const total = cleanNumber(p.totalCost);
    const paid = cleanNumber(p.amountPaid);
    const balance = Math.max(0, total - paid);

    if (balance <= 0) {
        alert("Esta compra ya se encuentra totalmente saldada.");
        return;
    }

    currentActivePurchase = {
        id: p.id,
        supplierName: p.supplierName || 'Proveedor',
        total: total,
        paid: paid,
        balance: balance
    };

    document.getElementById('pay-purchase-id').value = p.id;
    document.getElementById('pay-supplier-name').textContent = `${p.supplierName || 'Proveedor'} • Compra #${p.id.slice(0, 8).toUpperCase()}`;
    document.getElementById('pay-pending-balance-label').textContent = formatMoney(balance);
    document.getElementById('pay-amount-input').value = formatMoney(balance);

    renderAccountSelectOptions();
    purchasePaymentModal.classList.remove('hidden');
};

window.closePurchasePaymentModal = () => {
    purchasePaymentModal.classList.add('hidden');
    currentActivePurchase = null;
};

window.setPurchasePaymentPreset = (ratio) => {
    if (!currentActivePurchase) return;
    const input = document.getElementById('pay-amount-input');
    if (ratio === 0) {
        input.value = "";
        input.focus();
    } else {
        const amt = Math.round(currentActivePurchase.balance * ratio);
        input.value = formatMoney(amt);
    }
};

purchasePaymentForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-confirm-purchase-pay');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i><span>Procesando pago...</span>';

    const purchaseId = document.getElementById('pay-purchase-id').value;
    const accId = payAccountSelect.value;
    const amount = cleanNumber(document.getElementById('pay-amount-input').value);

    if (!accId) {
        alert("Por favor seleccione la cuenta de tesorería.");
        btn.disabled = false; btn.innerHTML = originalText; return;
    }

    if (amount <= 0) {
        alert("El monto debe ser superior a cero.");
        btn.disabled = false; btn.innerHTML = originalText; return;
    }

    if (!currentActivePurchase || amount > currentActivePurchase.balance + 100) {
        alert(`El monto ingresado ($ ${amount.toLocaleString('es-CO')}) excede el saldo pendiente ($ ${currentActivePurchase.balance.toLocaleString('es-CO')}).`);
        btn.disabled = false; btn.innerHTML = originalText; return;
    }

    try {
        const purchaseRef = doc(db, "purchases", purchaseId);

        // Buscar si existe una cuenta por pagar asociada (en payables) con este purchaseId
        const payablesQuery = query(collection(db, "payables"), where("purchaseId", "==", purchaseId));
        const payablesSnap = await getDocs(payablesQuery);
        let payableDocRef = null;
        if (!payablesSnap.empty) {
            payableDocRef = payablesSnap.docs[0].ref;
        }

        await runTransaction(db, async (t) => {
            const accRef = doc(db, "accounts", accId);

            // PASO 1: LECTURAS
            const accDoc = await t.get(accRef);
            if (!accDoc.exists()) throw new Error("La cuenta de tesorería seleccionada no existe.");

            const pDoc = await t.get(purchaseRef);
            if (!pDoc.exists()) throw new Error("La compra no existe en la base de datos.");

            let payableDoc = null;
            if (payableDocRef) {
                payableDoc = await t.get(payableDocRef);
            }

            // PASO 2: ESCRITURAS
            const pData = pDoc.data();
            const pTotal = cleanNumber(pData.totalCost);
            const currentPaid = cleanNumber(pData.amountPaid);
            const newPaid = currentPaid + amount;
            const isFullyPaid = newPaid >= pTotal - 100;

            // Actualizar Compra
            t.update(purchaseRef, {
                amountPaid: newPaid,
                paymentStatus: isFullyPaid ? 'PAID' : 'PARTIAL',
                paymentAccountId: accId,
                paymentMethod: accDoc.data().name || 'Egreso',
                lastPaymentDate: new Date(),
                updatedAt: new Date()
            });

            // Si existe cuenta por pagar vinculada, actualizarla en paralelo
            if (payableDoc && payableDoc.exists()) {
                const payTotal = cleanNumber(payableDoc.data().total);
                t.update(payableDocRef, {
                    amountPaid: newPaid,
                    balance: Math.max(0, payTotal - newPaid),
                    status: isFullyPaid ? 'PAID' : 'PENDING',
                    paymentAccountId: accId,
                    paymentMethod: accDoc.data().name,
                    lastPaymentDate: new Date(),
                    updatedAt: new Date()
                });
            }

            // Registrar Egreso en Gastos / Egresos
            const expRef = doc(collection(db, "expenses"));
            t.set(expRef, {
                description: `Pago Compra: ${pData.supplierName || 'Proveedor'} (Compra #${purchaseId.slice(0, 8).toUpperCase()})`,
                amount: amount,
                type: 'EXPENSE',
                category: "Pago Proveedores",
                paymentMethod: accDoc.data().name,
                purchaseId: purchaseId,
                supplierName: pData.supplierName || 'Proveedor',
                date: new Date(),
                createdAt: new Date(),
                mode: 'single'
            });

            // Descontar saldo de la cuenta de tesorería
            const currentAccBal = cleanNumber(accDoc.data().balance);
            t.update(accRef, { balance: currentAccBal - amount });
        });

        alert("Pago registrado y sincronizado exitosamente.");
        window.closePurchasePaymentModal();

    } catch (err) {
        console.error("Error registrando pago de compra:", err);
        alert("Error al procesar el pago: " + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};