import { db, collection, addDoc, doc, runTransaction } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js';

loadAdminSidebar();

// ==========================================================================
// ESTADO GLOBAL
// ==========================================================================
let rawReceivables = [];
let rawPayables = [];
let groupedReceivables = [];
let groupedPayables = [];
let accounts = [];

let currentTab = 'receivable';
let currentSort = 'debt-desc';
let searchTerm = '';
let walletPageSize = 50;
let walletCurrentPage = 1;

let currentDetailEntity = null; // { key, type }
let activePayTarget = null;     // { targetId, mode, maxAmount, type, name, refLabel }

// DOM Elements
const listReceivable = document.getElementById('list-receivable');
const listPayable = document.getElementById('list-payable');
const accountSelect = document.getElementById('pay-account');
const paymentModal = document.getElementById('payment-modal');
const paymentForm = document.getElementById('payment-form');
const searchInput = document.getElementById('wallet-search');
const searchClearBtn = document.getElementById('wallet-search-clear');
const sortSelect = document.getElementById('wallet-sort');
const detailsModal = document.getElementById('details-modal');
const dtList = document.getElementById('dt-list');

// Helpers Financieros
const formatMoney = (amount) => `$ ${Math.round(amount || 0).toLocaleString('es-CO')}`;
const cleanNumber = (val) => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    return parseFloat(val.toString().replace(/[^\d.-]/g, '')) || 0;
};
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";

const formatDate = (dateVal) => {
    if (!dateVal) return '-';
    let d = null;
    if (typeof dateVal.toDate === 'function') d = dateVal.toDate();
    else if (dateVal instanceof Date) d = dateVal;
    else if (typeof dateVal === 'object' && (dateVal.seconds || dateVal._seconds)) {
        d = new Date((dateVal.seconds || dateVal._seconds) * 1000);
    } else {
        d = new Date(dateVal);
    }
    if (!d || isNaN(d.getTime())) return '-';
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
// CONEXIÓN AL STORE CENTRAL (Delta Sync Realtime)
// ==========================================================================

AdminStore.subscribeToAccounts((accs) => {
    accounts = accs || [];
    renderAccountSelectOptions();
});

function renderAccountSelectOptions() {
    if (!accountSelect) return;
    const currentVal = accountSelect.value;
    accountSelect.innerHTML = '<option value="">Seleccione cuenta de tesorería...</option>';
    accounts.forEach(acc => {
        const bal = formatMoney(cleanNumber(acc.balance));
        accountSelect.innerHTML += `<option value="${acc.id}">${acc.name} (Saldo: ${bal})</option>`;
    });
    if (currentVal) accountSelect.value = currentVal;
}

AdminStore.subscribeToReceivables((recs) => {
    rawReceivables = recs || [];
    calculateAndRender();
    if (currentDetailEntity && !detailsModal.classList.contains('hidden')) {
        renderEntityDetails();
    }
});

AdminStore.subscribeToPayables((pays) => {
    rawPayables = pays || [];
    calculateAndRender();
    if (currentDetailEntity && !detailsModal.classList.contains('hidden')) {
        renderEntityDetails();
    }
});

// ==========================================================================
// CÁLCULOS Y AGRUPACIÓN
// ==========================================================================

function normalizeEntityClient(o) {
    const name = (o.userName || o.buyerInfo?.name || o.billingInfo?.name || o.shippingData?.name || `Cliente #${o.id.slice(0, 6)}`).trim();
    const doc = (o.clientDoc || o.buyerInfo?.document || o.billingInfo?.document || o.document || '').trim();
    const phone = (o.phone || o.buyerInfo?.phone || o.billingInfo?.phone || o.shippingData?.phone || '').trim();
    const email = (o.email || o.buyerInfo?.email || o.billingInfo?.email || '').trim();
    
    // Clave de agrupación consistente
    let key = '';
    if (o.userId && o.userId.length > 5) {
        key = `uid_${o.userId}`;
    } else if (doc && doc.replace(/\D/g, '').length >= 5) {
        key = `doc_${doc.replace(/\D/g, '')}`;
    } else {
        key = `name_${normalizeText(name)}`;
    }

    return { key, name, doc, phone, email, userId: o.userId || null };
}

function calculateAndRender() {
    // 1. Agrupar Cartera de Clientes (Órdenes por cobrar)
    const clientMap = {};
    let totalRecAmount = 0;
    let totalRecInvoices = 0;

    rawReceivables.forEach(o => {
        if (['CANCELADO', 'RECHAZADO'].includes(o.status)) return;
        if (o.paymentStatus === 'PAID' || o.status === 'PAGADO') return;

        const total = cleanNumber(o.total);
        const paid = cleanNumber(o.amountPaid);
        const refunded = cleanNumber(o.refundedAmount);
        const balance = Math.max(0, total - paid - refunded);

        // Si tiene saldo pendiente real
        if (balance > 0) {
            const clientInfo = normalizeEntityClient(o);
            const { key } = clientInfo;

            if (!clientMap[key]) {
                clientMap[key] = {
                    key: key,
                    id: key,
                    realUserId: clientInfo.userId,
                    name: clientInfo.name,
                    doc: clientInfo.doc,
                    phone: clientInfo.phone,
                    email: clientInfo.email,
                    count: 0,
                    totalDebt: 0,
                    totalPurchased: 0,
                    totalPaid: 0,
                    orders: []
                };
            }

            clientMap[key].count++;
            clientMap[key].totalDebt += balance;
            clientMap[key].totalPurchased += total;
            clientMap[key].totalPaid += paid;
            clientMap[key].orders.push({
                ...o,
                computedTotal: total,
                computedPaid: paid,
                computedRefunded: refunded,
                computedBalance: balance
            });

            totalRecAmount += balance;
            totalRecInvoices++;
        }
    });

    groupedReceivables = Object.values(clientMap);

    // 2. Agrupar Cuentas por Pagar a Proveedores
    const providerMap = {};
    let totalPayAmount = 0;
    let totalPayCount = 0;

    rawPayables.forEach(p => {
        if (p.status === 'PAID') return;

        const total = cleanNumber(p.total);
        const paid = cleanNumber(p.amountPaid);
        const balance = p.balance !== undefined ? cleanNumber(p.balance) : Math.max(0, total - paid);

        if (balance > 0) {
            const key = (p.provider || "Proveedor Varios").trim();
            if (!providerMap[key]) {
                providerMap[key] = {
                    key: key,
                    name: key,
                    count: 0,
                    totalDebt: 0,
                    totalPurchased: 0,
                    totalPaid: 0,
                    payables: [],
                    nextDueDate: null
                };
            }

            providerMap[key].count++;
            providerMap[key].totalDebt += balance;
            providerMap[key].totalPurchased += total;
            providerMap[key].totalPaid += paid;
            providerMap[key].payables.push({
                ...p,
                computedTotal: total,
                computedPaid: paid,
                computedBalance: balance
            });

            // Registrar próximo vencimiento
            if (p.dueDate) {
                const dueTime = new Date(p.dueDate).getTime();
                if (!isNaN(dueTime)) {
                    if (!providerMap[key].nextDueDate || dueTime < providerMap[key].nextDueDate.getTime()) {
                        providerMap[key].nextDueDate = new Date(dueTime);
                    }
                }
            }

            totalPayAmount += balance;
            totalPayCount++;
        }
    });

    groupedPayables = Object.values(providerMap);

    // 3. Calcular Alertas de Vencimiento de Proveedores
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    let overduePayablesCount = 0;
    let overduePayablesAmount = 0;
    let dueSoonPayablesCount = 0;
    let dueSoonPayablesAmount = 0;

    groupedPayables.forEach(prov => {
        prov.payables.forEach(p => {
            if (p.dueDate) {
                let dObj;
                if (typeof p.dueDate === 'string' && p.dueDate.includes('-')) {
                    const parts = p.dueDate.split('-');
                    dObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                } else {
                    dObj = p.dueDate.toDate ? p.dueDate.toDate() : new Date(p.dueDate);
                }
                dObj.setHours(0, 0, 0, 0);

                if (dObj < today) {
                    overduePayablesCount++;
                    overduePayablesAmount += p.computedBalance;
                } else if (dObj <= in7Days) {
                    dueSoonPayablesCount++;
                    dueSoonPayablesAmount += p.computedBalance;
                }
            }
        });
    });

    const elDueAlert = document.getElementById('cartera-due-alert');
    const elDueAlertText = document.getElementById('cartera-due-alert-text');
    if (elDueAlert && elDueAlertText) {
        if (overduePayablesCount > 0 || dueSoonPayablesCount > 0) {
            elDueAlert.classList.remove('hidden');
            let msgParts = [];
            if (overduePayablesCount > 0) {
                msgParts.push(`<strong class="text-rose-700">${overduePayablesCount} facturas vencidas</strong> (${formatMoney(overduePayablesAmount)})`);
            }
            if (dueSoonPayablesCount > 0) {
                msgParts.push(`<strong class="text-amber-800">${dueSoonPayablesCount} por vencer en los próximos 7 días</strong> (${formatMoney(dueSoonPayablesAmount)})`);
            }
            elDueAlertText.innerHTML = `Tienes ${msgParts.join(' y ')}. Revisa tus cuentas para evitar retrasos en pagos.`;
        } else {
            elDueAlert.classList.add('hidden');
        }
    }

    // 4. Actualizar KPIs Superiores
    const netBalance = totalRecAmount - totalPayAmount;
    
    document.getElementById('total-receivable').textContent = formatMoney(totalRecAmount);
    document.getElementById('kpi-rec-clients').textContent = `${groupedReceivables.length} clientes con deuda`;
    document.getElementById('kpi-rec-invoices').textContent = `${totalRecInvoices} facturas/órdenes`;

    document.getElementById('total-payable').textContent = formatMoney(totalPayAmount);
    document.getElementById('kpi-pay-providers').textContent = `${groupedPayables.length} proveedores`;
    document.getElementById('kpi-pay-count').textContent = `${totalPayCount} cuentas pendientes`;

    const elNetBal = document.getElementById('total-balance');
    const elNetBadge = document.getElementById('total-balance-badge');
    const elNetDesc = document.getElementById('total-balance-desc');

    elNetBal.textContent = formatMoney(netBalance);

    if (netBalance >= 0) {
        elNetBal.className = "text-2xl lg:text-3xl font-black tracking-tight text-emerald-400";
        elNetBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
        elNetBadge.textContent = "Superávit Comercial";
        elNetDesc.textContent = "Cartera a favor de la empresa";
    } else {
        elNetBal.className = "text-2xl lg:text-3xl font-black tracking-tight text-rose-400";
        elNetBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30";
        elNetBadge.textContent = "Déficit Pendiente";
        elNetDesc.textContent = "Compromisos superiores a cartera";
    }

    // Actualizar Badges en los Tabs
    document.getElementById('tab-badge-receivable').textContent = groupedReceivables.length;
    document.getElementById('tab-badge-payable').textContent = groupedPayables.length;

    renderTables();
}

// ==========================================================================
// RENDERIZADO DE TABLAS PRINCIPALES
// ==========================================================================

function sortEntities(list) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    let sorted = [...list];

    // Filtros especiales por vencimiento
    if (currentSort === 'due-overdue') {
        sorted = sorted.filter(prov => {
            return prov.payables && prov.payables.some(p => {
                if (!p.dueDate) return false;
                const d = new Date(p.dueDate);
                d.setHours(0, 0, 0, 0);
                return d < today;
            });
        });
    } else if (currentSort === 'due-soon') {
        sorted = sorted.filter(prov => {
            return prov.payables && prov.payables.some(p => {
                if (!p.dueDate) return false;
                const d = new Date(p.dueDate);
                d.setHours(0, 0, 0, 0);
                return d >= today && d <= in7Days;
            });
        });
    }

    switch (currentSort) {
        case 'due-asc':
            return sorted.sort((a, b) => {
                const timeA = a.nextDueDate ? a.nextDueDate.getTime() : 9999999999999;
                const timeB = b.nextDueDate ? b.nextDueDate.getTime() : 9999999999999;
                return timeA - timeB;
            });
        case 'debt-desc':
            return sorted.sort((a, b) => b.totalDebt - a.totalDebt);
        case 'debt-asc':
            return sorted.sort((a, b) => a.totalDebt - b.totalDebt);
        case 'count-desc':
            return sorted.sort((a, b) => b.count - a.count);
        case 'name-asc':
            return sorted.sort((a, b) => a.name.localeCompare(b.name));
        default:
            return sorted.sort((a, b) => b.totalDebt - a.totalDebt);
    }
}

function renderTables() {
    const term = normalizeText(searchTerm);

    // 1. Filtrar Clientes (Cartera)
    let filteredRec = groupedReceivables;
    if (term) {
        filteredRec = filteredRec.filter(c => {
            const matchName = normalizeText(c.name).includes(term);
            const matchDoc = normalizeText(c.doc).includes(term);
            const matchPhone = normalizeText(c.phone).includes(term);
            const matchOrder = c.orders.some(o => 
                (o.id && o.id.toLowerCase().includes(term)) ||
                (o.orderNumber && String(o.orderNumber).includes(term)) ||
                (o.internalOrderNumber && String(o.internalOrderNumber).includes(term))
            );
            return matchName || matchDoc || matchPhone || matchOrder;
        });
    }
    filteredRec = sortEntities(filteredRec);

    // 2. Filtrar Proveedores (Por Pagar)
    let filteredPay = groupedPayables;
    if (term) {
        filteredPay = filteredPay.filter(p => {
            const matchName = normalizeText(p.name).includes(term);
            const matchConcept = p.payables.some(item => normalizeText(item.description || '').includes(term));
            return matchName || matchConcept;
        });
    }
    filteredPay = sortEntities(filteredPay);

    // Paginación según la pestaña activa
    const activeList = currentTab === 'receivable' ? filteredRec : filteredPay;
    const totalDocs = activeList.length;
    const maxPages = Math.max(1, Math.ceil(totalDocs / walletPageSize));
    if (walletCurrentPage > maxPages) walletCurrentPage = maxPages;

    const startIdx = (walletCurrentPage - 1) * walletPageSize;
    const endIdx = Math.min(startIdx + walletPageSize, totalDocs);

    // RENDER TABLA CLIENTES
    listReceivable.innerHTML = "";
    if (filteredRec.length === 0) {
        listReceivable.innerHTML = `
            <tr>
                <td colspan="5" class="py-12 px-4 text-center text-slate-400">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3 text-lg">
                        <i class="fa-solid fa-circle-check"></i>
                    </div>
                    <p class="text-xs font-bold uppercase tracking-wider text-slate-600">No hay clientes con saldos pendientes</p>
                    <p class="text-[11px] text-slate-400 mt-0.5">Toda la cartera de clientes se encuentra al día.</p>
                </td>
            </tr>`;
    } else {
        // En pestaña activa mostramos la página actual; en pestaña inactiva mostramos hasta el límite de la primera página
        const recSlice = currentTab === 'receivable' ? filteredRec.slice(startIdx, endIdx) : filteredRec.slice(0, walletPageSize);
        recSlice.forEach(c => {
            const initial = (c.name.charAt(0) || 'C').toUpperCase();
            const pctPaid = c.totalPurchased > 0 ? Math.round((c.totalPaid / c.totalPurchased) * 100) : 0;

            listReceivable.innerHTML += `
                <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0 group">
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center font-black text-xs shrink-0 uppercase">
                                ${initial}
                            </div>
                            <div class="min-w-0">
                                <p class="font-black text-xs uppercase text-slate-900 truncate">${c.name}</p>
                                <div class="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-medium">
                                    ${c.doc ? `<span><i class="fa-solid fa-id-card text-[9px]"></i> ${c.doc}</span>` : ''}
                                    ${c.phone ? `<span><i class="fa-solid fa-phone text-[9px]"></i> ${c.phone}</span>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <span class="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-slate-200/60">
                            <i class="fa-solid fa-receipt text-[9px] text-slate-400"></i>
                            ${c.count} ${c.count === 1 ? 'orden' : 'órdenes'}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-right">
                        <div class="w-32 ml-auto">
                            <div class="flex justify-between items-center text-[10px] font-bold mb-1">
                                <span class="text-slate-400">${pctPaid}% pagado</span>
                                <span class="text-slate-600">${formatMoney(c.totalPaid)}</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div class="bg-emerald-500 h-1.5 rounded-full" style="width: ${Math.min(100, Math.max(0, pctPaid))}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right">
                        <p class="font-black text-slate-900 text-sm tracking-tight">${formatMoney(c.totalDebt)}</p>
                        <p class="text-[9px] font-semibold text-slate-400">Pendiente</p>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button onclick="window.openDetails('${c.key}', 'client')" class="bg-white hover:bg-slate-900 text-slate-700 hover:text-white border border-slate-200 hover:border-slate-900 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shadow-2xs flex items-center gap-1.5">
                                <i class="fa-solid fa-eye text-[9px]"></i>
                                <span>Ver Detalle</span>
                            </button>
                            <button onclick="window.openQuickPayment('${c.key}', 'client')" title="Abonar a la cuenta" class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center shadow-2xs active:scale-95">
                                <i class="fa-solid fa-hand-holding-dollar text-xs"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        });
    }

    // RENDER TABLA PROVEEDORES
    listPayable.innerHTML = "";
    if (filteredPay.length === 0) {
        listPayable.innerHTML = `
            <tr>
                <td colspan="5" class="py-12 px-4 text-center text-slate-400">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3 text-lg">
                        <i class="fa-solid fa-circle-check"></i>
                    </div>
                    <p class="text-xs font-bold uppercase tracking-wider text-slate-600">No hay cuentas por pagar pendientes</p>
                    <p class="text-[11px] text-slate-400 mt-0.5">Todos los pagos a proveedores están cancelados.</p>
                </td>
            </tr>`;
    } else {
        const paySlice = currentTab === 'payable' ? filteredPay.slice(startIdx, endIdx) : filteredPay.slice(0, walletPageSize);
        paySlice.forEach(p => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let dueBadge = `<span class="text-[10px] text-slate-400 font-medium">Sin fecha límite</span>`;
            if (p.nextDueDate) {
                const isOverdue = p.nextDueDate < today;
                const formattedDate = formatDate(p.nextDueDate);
                if (isOverdue) {
                    dueBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
                        <i class="fa-solid fa-clock text-[9px]"></i> Vencida (${formattedDate})
                    </span>`;
                } else {
                    dueBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                        <i class="fa-solid fa-calendar text-[9px]"></i> Vence ${formattedDate}
                    </span>`;
                }
            }

            listPayable.innerHTML += `
                <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0 group">
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center font-black text-xs shrink-0">
                                <i class="fa-solid fa-truck"></i>
                            </div>
                            <div class="min-w-0">
                                <p class="font-black text-xs uppercase text-slate-900 truncate">${p.name}</p>
                                <p class="text-[10px] text-slate-400 font-medium">${p.count} ${p.count === 1 ? 'cuenta por pagar' : 'cuentas por pagar'}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <span class="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-slate-200/60">
                            <i class="fa-solid fa-file-invoice-dollar text-[9px] text-slate-400"></i>
                            ${p.count} ${p.count === 1 ? 'cuenta' : 'cuentas'}
                        </span>
                    </td>
                    <td class="px-6 py-4">
                        ${dueBadge}
                    </td>
                    <td class="px-6 py-4 text-right">
                        <p class="font-black text-slate-900 text-sm tracking-tight">${formatMoney(p.totalDebt)}</p>
                        <p class="text-[9px] font-semibold text-rose-500">Por pagar</p>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button onclick="window.openDetails('${p.key}', 'supplier')" class="bg-white hover:bg-slate-900 text-slate-700 hover:text-white border border-slate-200 hover:border-slate-900 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shadow-2xs flex items-center gap-1.5">
                                <i class="fa-solid fa-eye text-[9px]"></i>
                                <span>Ver Detalle</span>
                            </button>
                            <button onclick="window.openQuickPayment('${p.key}', 'supplier')" title="Registrar pago" class="w-7 h-7 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-600 hover:text-white transition-all flex items-center justify-center shadow-2xs active:scale-95">
                                <i class="fa-solid fa-credit-card text-xs"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        });
    }

    // Actualizar UI de Paginación
    updateWalletPaginationUI(startIdx + 1, endIdx, totalDocs, maxPages);
}

function updateWalletPaginationUI(start, end, total, maxPages) {
    const rangeSpan = document.getElementById('wallet-pagination-range');
    const totalSpan = document.getElementById('wallet-pagination-total');
    const entityLabel = document.getElementById('wallet-pagination-entity-label');
    const btnPrev = document.getElementById('wallet-btn-prev');
    const btnNext = document.getElementById('wallet-btn-next');

    const labelText = currentTab === 'receivable' ? 'clientes' : 'proveedores';

    if (rangeSpan) rangeSpan.textContent = total > 0 ? `${start}-${end}` : "0-0";
    if (totalSpan) totalSpan.textContent = total;
    if (entityLabel) entityLabel.textContent = labelText;
    if (btnPrev) btnPrev.disabled = walletCurrentPage <= 1;
    if (btnNext) btnNext.disabled = walletCurrentPage >= maxPages;
}

window.changeWalletPage = (delta) => {
    walletCurrentPage += delta;
    if (walletCurrentPage < 1) walletCurrentPage = 1;
    renderTables();
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
};

window.handleWalletPageSizeChange = (val) => {
    walletPageSize = parseInt(val, 10) || 50;
    walletCurrentPage = 1;
    renderTables();
};

// Búsqueda y Ordenamiento Listeners
searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value;
    walletCurrentPage = 1;
    if (searchTerm.trim().length > 0) {
        searchClearBtn.classList.remove('hidden');
    } else {
        searchClearBtn.classList.add('hidden');
    }
    renderTables();
});

window.clearSearch = () => {
    searchInput.value = '';
    searchTerm = '';
    walletCurrentPage = 1;
    searchClearBtn.classList.add('hidden');
    renderTables();
};

window.handleSortChange = () => {
    currentSort = sortSelect.value;
    walletCurrentPage = 1;
    renderTables();
};

window.switchTab = (tab) => {
    currentTab = tab;
    walletCurrentPage = 1;
    const btnRec = document.getElementById('tab-btn-receivable');
    const btnPay = document.getElementById('tab-btn-payable');
    const tabRec = document.getElementById('tab-receivable');
    const tabPay = document.getElementById('tab-payable');

    if (tab === 'receivable') {
        btnRec.classList.add('active', 'bg-slate-900', 'text-white');
        btnRec.classList.remove('text-slate-600');
        btnPay.classList.remove('active', 'bg-slate-900', 'text-white');
        btnPay.classList.add('text-slate-600');
        tabRec.classList.remove('hidden');
        tabPay.classList.add('hidden');
    } else {
        btnPay.classList.add('active', 'bg-slate-900', 'text-white');
        btnPay.classList.remove('text-slate-600');
        btnRec.classList.remove('active', 'bg-slate-900', 'text-white');
        btnRec.classList.add('text-slate-600');
        tabPay.classList.remove('hidden');
        tabRec.classList.add('hidden');
    }

    renderTables();
};

window.filterPayablesByDue = (mode) => {
    window.switchTab('payable');
    walletCurrentPage = 1;
    if (sortSelect) {
        sortSelect.value = mode === 'overdue' ? 'due-overdue' : 'due-soon';
        currentSort = sortSelect.value;
        renderTables();
    }
};

// ==========================================================================
// MODAL DE DETALLES (Consulta en memoria reactiva con sincronización 100%)
// ==========================================================================

window.openDetails = (key, type) => {
    currentDetailEntity = { key, type };
    renderEntityDetails();
    detailsModal.classList.remove('hidden');
};

function renderEntityDetails() {
    if (!currentDetailEntity) return;
    const { key, type } = currentDetailEntity;

    let entity = null;
    if (type === 'client') {
        entity = groupedReceivables.find(c => c.key === key);
    } else {
        entity = groupedPayables.find(p => p.key === key);
    }

    if (!entity) {
        // La entidad ya no tiene deuda (fue cancelada o actualizada)
        document.getElementById('dt-title').textContent = "Entidad al día";
        document.getElementById('dt-subtitle').textContent = "No existen saldos pendientes.";
        document.getElementById('dt-sum-total').textContent = "$ 0";
        document.getElementById('dt-sum-paid').textContent = "$ 0";
        document.getElementById('dt-sum-balance').textContent = "$ 0";
        document.getElementById('dt-total-debt').textContent = "$ 0";
        dtList.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-xs font-bold text-slate-400 uppercase">Sin deudas pendientes registradas.</td></tr>`;
        return;
    }

    // Cabecera del modal
    document.getElementById('dt-title').textContent = entity.name;
    const initial = (entity.name.charAt(0) || (type === 'client' ? 'C' : 'P')).toUpperCase();
    document.getElementById('dt-avatar').textContent = initial;

    const badge = document.getElementById('dt-type-badge');
    if (type === 'client') {
        badge.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200";
        badge.textContent = "Cliente";
        document.getElementById('dt-subtitle').textContent = `${entity.doc ? 'CC/NIT: ' + entity.doc : ''} ${entity.phone ? '• Tel: ' + entity.phone : ''}`.trim() || 'Cliente Registrado';
    } else {
        badge.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200";
        badge.textContent = "Proveedor";
        document.getElementById('dt-subtitle').textContent = `${entity.count} cuentas por pagar pendientes`;
    }

    // Mini Tarjetas de Totales
    document.getElementById('dt-sum-total').textContent = formatMoney(entity.totalPurchased);
    document.getElementById('dt-sum-paid').textContent = formatMoney(entity.totalPaid);
    document.getElementById('dt-sum-balance').textContent = formatMoney(entity.totalDebt);
    document.getElementById('dt-total-debt').textContent = formatMoney(entity.totalDebt);

    // Listado de Facturas / Deudas
    dtList.innerHTML = "";

    if (type === 'client') {
        // Ordenar FIFO (más antiguas primero)
        const sortedOrders = [...entity.orders].sort((a, b) => {
            const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return timeA - timeB;
        });

        sortedOrders.forEach(o => {
            const refText = o.orderNumber ? `#${o.orderNumber}` : (o.internalOrderNumber ? `Remisión #${o.internalOrderNumber}` : `#${o.id.slice(0, 8)}`);
            const dateStr = formatDate(o.createdAt);
            const isPartial = cleanNumber(o.computedPaid) > 0;
            const statusBadge = isPartial 
                ? `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-black uppercase px-2 py-0.5 rounded-md">Abonada (${Math.round((o.computedPaid / o.computedTotal) * 100)}%)</span>`
                : `<span class="bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-bold uppercase px-2 py-0.5 rounded-md">Sin abonos</span>`;

            dtList.innerHTML += `
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                    <td class="p-3">
                        <p class="font-black text-slate-900 text-xs uppercase">${refText}</p>
                        <p class="text-[9px] text-slate-400 font-bold">ID: ${o.id.slice(0, 10)}</p>
                    </td>
                    <td class="p-3 text-slate-600 font-medium">${dateStr}</td>
                    <td class="p-3 text-center">${statusBadge}</td>
                    <td class="p-3 text-right font-medium text-slate-500">${formatMoney(o.computedTotal)}</td>
                    <td class="p-3 text-right font-bold text-emerald-600">${formatMoney(o.computedPaid)}</td>
                    <td class="p-3 text-right font-black text-slate-900">${formatMoney(o.computedBalance)}</td>
                    <td class="p-3 text-center">
                        <button onclick="window.openPaymentModalSingle('${o.id}', ${o.computedBalance}, 'client', '${refText}')" title="Abonar a esta orden" class="bg-white border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 w-8 h-8 rounded-lg transition-all flex items-center justify-center mx-auto shadow-2xs active:scale-95">
                            <i class="fa-solid fa-hand-holding-dollar text-xs"></i>
                        </button>
                    </td>
                </tr>`;
        });
    } else {
        // Proveedores
        const sortedPayables = [...entity.payables].sort((a, b) => {
            const timeA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
            const timeB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
            return timeA - timeB;
        });

        sortedPayables.forEach(p => {
            const refText = p.description || `Cuenta #${p.id.slice(0, 6)}`;
            const dateStr = formatDate(p.dueDate || p.createdAt);
            const isPartial = cleanNumber(p.computedPaid) > 0;
            const statusBadge = isPartial 
                ? `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-black uppercase px-2 py-0.5 rounded-md">Abonada</span>`
                : `<span class="bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-bold uppercase px-2 py-0.5 rounded-md">Pendiente</span>`;

            dtList.innerHTML += `
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                    <td class="p-3">
                        <p class="font-black text-slate-900 text-xs uppercase">${refText}</p>
                        ${p.purchaseId ? `<p class="text-[9px] text-slate-400 font-bold">Compra #${p.purchaseId.slice(0, 6)}</p>` : ''}
                    </td>
                    <td class="p-3 text-slate-600 font-medium">${dateStr}</td>
                    <td class="p-3 text-center">${statusBadge}</td>
                    <td class="p-3 text-right font-medium text-slate-500">${formatMoney(p.computedTotal)}</td>
                    <td class="p-3 text-right font-bold text-emerald-600">${formatMoney(p.computedPaid)}</td>
                    <td class="p-3 text-right font-black text-slate-900">${formatMoney(p.computedBalance)}</td>
                    <td class="p-3 text-center">
                        <button onclick="window.openPaymentModalSingle('${p.id}', ${p.computedBalance}, 'supplier', '${refText}')" title="Pagar esta cuenta" class="bg-white border border-slate-200 hover:border-rose-500 hover:bg-rose-50 text-slate-600 hover:text-rose-700 w-8 h-8 rounded-lg transition-all flex items-center justify-center mx-auto shadow-2xs active:scale-95">
                            <i class="fa-solid fa-money-bill-wave text-xs"></i>
                        </button>
                    </td>
                </tr>`;
        });
    }
}

// ==========================================================================
// MODAL DE PAGO (Transaccional Atómico)
// ==========================================================================

window.openQuickPayment = (key, type) => {
    currentDetailEntity = { key, type };
    window.openPaymentModalGlobal();
};

window.openPaymentModalGlobal = () => {
    if (!currentDetailEntity) return;
    const { key, type } = currentDetailEntity;

    let entity = null;
    if (type === 'client') {
        entity = groupedReceivables.find(c => c.key === key);
    } else {
        entity = groupedPayables.find(p => p.key === key);
    }

    if (!entity || entity.totalDebt <= 0) {
        alert("Esta entidad no tiene saldo pendiente por pagar.");
        return;
    }

    activePayTarget = {
        targetId: 'GLOBAL',
        mode: 'fifo',
        maxAmount: entity.totalDebt,
        type: type,
        name: entity.name,
        refLabel: 'Todas las facturas pendientes (FIFO)'
    };

    document.getElementById('pay-target-id').value = 'GLOBAL';
    document.getElementById('pay-target-mode').value = 'fifo';
    document.getElementById('pay-modal-title').textContent = type === 'client' ? `Abonar a Cartera de Cliente` : `Pago a Proveedor`;
    document.getElementById('pay-modal-subtitle').textContent = `${entity.name} • Distribución FIFO`;
    document.getElementById('pay-target-max-label').textContent = formatMoney(entity.totalDebt);
    document.getElementById('pay-amount').value = formatMoney(entity.totalDebt);

    renderAccountSelectOptions();
    paymentModal.classList.remove('hidden');
};

window.openPaymentModalSingle = (docId, balance, type, refLabel) => {
    const entityName = currentDetailEntity ? (type === 'client' ? groupedReceivables.find(c => c.key === currentDetailEntity.key)?.name : groupedPayables.find(p => p.key === currentDetailEntity.key)?.name) : 'Entidad';

    activePayTarget = {
        targetId: docId,
        mode: 'single',
        maxAmount: cleanNumber(balance),
        type: type,
        name: entityName || 'Entidad',
        refLabel: refLabel || `#${docId.slice(0, 6)}`
    };

    document.getElementById('pay-target-id').value = docId;
    document.getElementById('pay-target-mode').value = 'single';
    document.getElementById('pay-modal-title').textContent = type === 'client' ? `Abono a Documento Específico` : `Pago de Cuenta Específica`;
    document.getElementById('pay-modal-subtitle').textContent = `${entityName} • ${refLabel}`;
    document.getElementById('pay-target-max-label').textContent = formatMoney(balance);
    document.getElementById('pay-amount').value = formatMoney(balance);

    renderAccountSelectOptions();
    paymentModal.classList.remove('hidden');
};

window.setPaymentPreset = (ratio) => {
    if (!activePayTarget) return;
    const input = document.getElementById('pay-amount');
    if (ratio === 0) {
        input.value = "";
        input.focus();
    } else {
        const amt = Math.round(activePayTarget.maxAmount * ratio);
        input.value = formatMoney(amt);
    }
};

paymentForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-confirm-payment');
    const originalText = btn.innerHTML;
    btn.disabled = true; 
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i><span>Procesando transacción...</span>';

    const mode = document.getElementById('pay-target-mode').value;
    const targetId = document.getElementById('pay-target-id').value;
    const accId = accountSelect.value;
    const amount = cleanNumber(document.getElementById('pay-amount').value);

    if (!accId) { 
        alert("Por favor seleccione la cuenta de tesorería."); 
        btn.disabled = false; btn.innerHTML = originalText; return; 
    }
    if (amount <= 0) { 
        alert("El monto debe ser superior a cero."); 
        btn.disabled = false; btn.innerHTML = originalText; return; 
    }

    const { type, name: entityName, maxAmount } = activePayTarget;
    if (amount > maxAmount + 100) {
        alert(`El monto ingresado ($ ${amount.toLocaleString('es-CO')}) excede la deuda pendiente ($ ${maxAmount.toLocaleString('es-CO')}).`);
        btn.disabled = false; btn.innerHTML = originalText; return;
    }

    try {
        let docsToProcess = [];

        if (mode === 'single') {
            const colName = type === 'client' ? 'orders' : 'payables';
            const docRef = doc(db, colName, targetId);
            docsToProcess.push({ id: targetId, ref: docRef });
        } else {
            // Modo FIFO Global: Tomamos los documentos pendientes en memoria ya ordenados por fecha
            let entity = null;
            if (type === 'client') {
                entity = groupedReceivables.find(c => c.key === currentDetailEntity.key);
                if (entity && entity.orders) {
                    const sorted = [...entity.orders].sort((a, b) => {
                        const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
                        const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
                        return timeA - timeB;
                    });
                    docsToProcess = sorted.map(o => ({ id: o.id, ref: doc(db, 'orders', o.id) }));
                }
            } else {
                entity = groupedPayables.find(p => p.key === currentDetailEntity.key);
                if (entity && entity.payables) {
                    const sorted = [...entity.payables].sort((a, b) => {
                        const timeA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
                        const timeB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
                        return timeA - timeB;
                    });
                    docsToProcess = sorted.map(p => ({ id: p.id, ref: doc(db, 'payables', p.id), purchaseId: p.purchaseId || null }));
                }
            }
        }

        if (docsToProcess.length === 0) {
            throw new Error("No hay documentos pendientes para aplicar el abono.");
        }

        // Ejecutar Transacción Atómica
        await runTransaction(db, async (t) => {
            const accRef = doc(db, "accounts", accId);

            // PASO 1: LEER TODOS LOS DOCUMENTOS PRIMERO (Regla de oro de Firestore)
            const readPromises = [
                t.get(accRef),
                ...docsToProcess.map(item => t.get(item.ref))
            ];
            const snapshots = await Promise.all(readPromises);

            const accDoc = snapshots[0];
            const docSnaps = snapshots.slice(1);

            if (!accDoc.exists()) throw new Error("La cuenta de tesorería seleccionada no existe.");

            // Identificar si hay compras asociadas a los payables que necesitamos leer
            const purchaseRefsToRead = [];
            const purchaseIdToPayableMap = {};
            if (type !== 'client') {
                docSnaps.forEach(dSnap => {
                    if (dSnap.exists() && dSnap.data().purchaseId) {
                        const pid = dSnap.data().purchaseId;
                        const pRef = doc(db, "purchases", pid);
                        purchaseRefsToRead.push(t.get(pRef));
                        purchaseIdToPayableMap[pid] = true;
                    }
                });
            }

            let purchaseSnaps = [];
            if (purchaseRefsToRead.length > 0) {
                purchaseSnaps = await Promise.all(purchaseRefsToRead);
            }

            // PASO 2: APLICAR DISTRIBUCIÓN Y ACTUALIZACIONES
            let remainingMoney = amount;
            let totalApplied = 0;

            for (const dSnap of docSnaps) {
                if (!dSnap.exists()) continue;
                if (remainingMoney <= 0 && mode === 'fifo') break;

                const data = dSnap.data();

                if (type === 'client') {
                    // Orden de Cliente
                    const total = cleanNumber(data.total);
                    const currentPaid = cleanNumber(data.amountPaid);
                    const refunded = cleanNumber(data.refundedAmount);
                    const debt = Math.max(0, total - currentPaid - refunded);

                    if (debt <= 0) continue;

                    let apply = mode === 'single' ? amount : Math.min(remainingMoney, debt);
                    const newPaid = currentPaid + apply;
                    const isFullyPaid = newPaid >= (total - refunded);

                    let nextStatus = data.status;
                    if (isFullyPaid && ['PENDIENTE', 'PENDIENTE_PAGO', 'CANCELADO'].includes(data.status)) {
                        nextStatus = 'PAGADO';
                    }

                    t.update(dSnap.ref, {
                        status: nextStatus,
                        paymentStatus: isFullyPaid ? 'PAID' : 'PARTIAL',
                        amountPaid: newPaid,
                        paymentAccountId: accId,
                        paymentMethod: accDoc.data().name || 'Cartera',
                        paymentDate: new Date(),
                        lastPaymentDate: new Date(),
                        updatedAt: new Date()
                    });

                    // Registrar Ingreso en Gastos/Ingresos
                    const expRef = doc(collection(db, "expenses"));
                    t.set(expRef, {
                        description: `Abono Cartera: ${entityName} (Orden #${dSnap.id.slice(0, 8)})`,
                        amount: apply,
                        type: 'INCOME',
                        category: "Ingreso Ventas",
                        paymentMethod: accDoc.data().name,
                        orderId: dSnap.id,
                        supplierName: entityName,
                        date: new Date(),
                        createdAt: new Date(),
                        mode: mode
                    });

                    remainingMoney -= apply;
                    totalApplied += apply;

                } else {
                    // Cuenta por Pagar a Proveedor
                    const total = cleanNumber(data.total);
                    const currentPaid = cleanNumber(data.amountPaid);
                    const debt = Math.max(0, total - currentPaid);

                    if (debt <= 0) continue;

                    let apply = mode === 'single' ? amount : Math.min(remainingMoney, debt);
                    const newPaid = currentPaid + apply;
                    const isFullyPaid = newPaid >= total;

                    t.update(dSnap.ref, {
                        amountPaid: newPaid,
                        balance: Math.max(0, total - newPaid),
                        status: isFullyPaid ? 'PAID' : 'PENDING',
                        paymentAccountId: accId,
                        paymentMethod: accDoc.data().name,
                        lastPaymentDate: new Date(),
                        updatedAt: new Date()
                    });

                    // Sincronizar compra asociada si existe
                    if (data.purchaseId) {
                        const pSnap = purchaseSnaps.find(snap => snap.id === data.purchaseId);
                        if (pSnap && pSnap.exists()) {
                            const pData = pSnap.data();
                            const pTotal = cleanNumber(pData.totalCost);
                            const pNewPaid = cleanNumber(pData.amountPaid) + apply;
                            const pStatus = pNewPaid >= pTotal ? 'PAID' : (pNewPaid > 0 ? 'PARTIAL' : 'PENDING');
                            t.update(pSnap.ref, {
                                amountPaid: pNewPaid,
                                paymentStatus: pStatus,
                                paymentAccountId: accId,
                                paymentMethod: accDoc.data().name,
                                lastPaymentDate: new Date(),
                                updatedAt: new Date()
                            });
                        }
                    }

                    // Registrar Egreso
                    const expRef = doc(collection(db, "expenses"));
                    t.set(expRef, {
                        description: `Pago Proveedor: ${entityName} (${data.description || 'Cuenta por Pagar'})`,
                        amount: apply,
                        type: 'EXPENSE',
                        category: "Pago Proveedores",
                        paymentMethod: accDoc.data().name,
                        payableId: dSnap.id,
                        purchaseId: data.purchaseId || null,
                        supplierName: entityName,
                        date: new Date(),
                        createdAt: new Date(),
                        mode: mode
                    });

                    remainingMoney -= apply;
                    totalApplied += apply;
                }
            }

            if (totalApplied <= 0) {
                throw new Error("No se pudo aplicar ningún abono. Verifique saldos pendientes.");
            }

            // Actualizar Saldo de la Cuenta de Tesorería
            const currentAccBal = cleanNumber(accDoc.data().balance);
            const newAccBal = type === 'client' ? (currentAccBal + totalApplied) : (currentAccBal - totalApplied);
            t.update(accRef, { balance: newAccBal });
        });

        alert("Transacción registrada y sincronizada exitosamente.");
        window.closeModal('payment-modal');

        // Si el modal de detalle está abierto, re-renderizar
        if (currentDetailEntity) {
            renderEntityDetails();
        }

    } catch (err) {
        console.error("Error en pago:", err);
        alert("Error procesando pago: " + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

// ==========================================================================
// CREAR DEUDA MANUAL (PROVEEDORES)
// ==========================================================================

document.getElementById('create-payable-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i><span>Guardando...</span>';

    const provider = document.getElementById('new-pay-provider').value.trim();
    const desc = document.getElementById('new-pay-desc').value.trim();
    const total = cleanNumber(document.getElementById('new-pay-total').value);
    const date = document.getElementById('new-pay-date').value;

    if (!provider || !desc || total <= 0) {
        alert("Por favor complete los campos requeridos con valores válidos.");
        btn.disabled = false; btn.innerHTML = originalText; return;
    }

    try {
        await addDoc(collection(db, "payables"), {
            provider,
            description: desc,
            total,
            dueDate: date,
            amountPaid: 0,
            balance: total,
            status: 'PENDING',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        alert("Cuenta por pagar registrada exitosamente.");
        window.closeModal('create-payable-modal');
        document.getElementById('create-payable-form').reset();

    } catch (err) {
        console.error("Error creando deuda manual:", err);
        alert("Error guardando cuenta por pagar: " + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

window.openCreatePayable = () => {
    document.getElementById('create-payable-form').reset();
    document.getElementById('create-payable-modal').classList.remove('hidden');
};

window.closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
};

// ==========================================================================
// SINCRONIZACIÓN MANUAL
// ==========================================================================

window.refreshCarteraData = async () => {
    const icon = document.getElementById('sync-icon');
    if (icon) icon.classList.add('fa-spin');
    try {
        await Promise.all([
            AdminStore.forceSyncReceivables(),
            AdminStore.forceSyncPayables()
        ]);
    } catch (e) {
        console.error("Error forzando sync:", e);
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('fa-spin');
        }, 800);
    }
};