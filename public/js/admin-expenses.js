import { db, collection, doc, getDocs, getDoc, query, where, orderBy, Timestamp, runTransaction, limit } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js';

loadAdminSidebar();

// --- DOM ELEMENTS ---
const listContainer = document.getElementById('expenses-list');
const tableRecordCount = document.getElementById('table-record-count');
const modal = document.getElementById('expense-modal');
const form = document.getElementById('expense-form');
const accountSelect = document.getElementById('account-select');
const taxAlert = document.getElementById('tax-alert');
const taxVal = document.getElementById('tax-val');
const taxTotalDeduction = document.getElementById('tax-total-deduction');
const amountDisplay = document.getElementById('amount-display');
const supplierSearch = document.getElementById('supplier-search');
const supplierDropdown = document.getElementById('supplier-dropdown');
const selectedSupplierId = document.getElementById('selected-supplier-id');
const searchInput = document.getElementById('search-input');
const filterMonthInput = document.getElementById('filter-month');
const btnClearDate = document.getElementById('btn-clear-date');
const filterCategorySelect = document.getElementById('filter-category');
const sortExpensesSelect = document.getElementById('sort-expenses');
const trashModal = document.getElementById('trash-modal');
const trashList = document.getElementById('trash-list');
const syncIcon = document.getElementById('sync-icon');

// KPI Elements
const lblPeriodTotal = document.getElementById('lbl-period-total');
const statsTotal = document.getElementById('stats-total');
const statsCount = document.getElementById('stats-count');
const statsPeriodBadge = document.getElementById('stats-period-badge');
const statsTopCategory = document.getElementById('stats-top-category');
const statsTopCategoryAmount = document.getElementById('stats-top-category-amount');
const statsTopCategoryPercent = document.getElementById('stats-top-category-percent');
const statsTopAccount = document.getElementById('stats-top-account');
const statsTopAccountAmount = document.getElementById('stats-top-account-amount');

// Pagination Elements
const expPageInfo = document.getElementById('exp-page-info');
const expPageSizeSelect = document.getElementById('exp-page-size');
const expBtnPrev = document.getElementById('exp-btn-prev');
const expPageCurrent = document.getElementById('exp-page-current');
const expBtnNext = document.getElementById('exp-btn-next');

// --- ESTADO EN RAM ---
let currentPage = 1;
let pageSize = 30;
let currentFilterDate = null;
let currentCategory = "";
let currentSort = "date-desc";
let adminExpensesCache = [];
let accountsList = [];

// ==========================================================================
// HELPERS & FORMATEADORES
// ==========================================================================

const getCurrentAdminName = () => document.getElementById('admin-name')?.textContent || 'Admin Desconocido';

const cleanNumber = (val) => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    return parseFloat(val.toString().replace(/[^\d.-]/g, '')) || 0;
};

const normalizeText = (str) => {
    return str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
};

function parseExpenseDate(expense) {
    if (!expense) return new Date();
    if (expense.dateObj instanceof Date && !isNaN(expense.dateObj)) return expense.dateObj;
    const raw = expense.date || expense.createdAt || expense.updatedAt;
    if (!raw) return new Date();
    if (raw instanceof Date && !isNaN(raw)) return raw;
    if (typeof raw.toDate === 'function') return raw.toDate();
    if (raw.seconds) return new Date(raw.seconds * 1000);
    const parsed = new Date(raw);
    return isNaN(parsed) ? new Date() : parsed;
}

function formatCOP(amount) {
    const val = Math.round(cleanNumber(amount));
    return '$' + Math.abs(val).toLocaleString('es-CO');
}

function formatDate(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj)) return '--';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
}

function getCategoryBadge(category) {
    const cat = category || 'Otros';
    const styles = {
        'Nómina': 'bg-indigo-50 text-indigo-700 border-indigo-200',
        'Operativo': 'bg-slate-100 text-slate-700 border-slate-200',
        'Servicios': 'bg-sky-50 text-sky-700 border-sky-200',
        'Arriendo': 'bg-purple-50 text-purple-700 border-purple-200',
        'Marketing': 'bg-pink-50 text-pink-700 border-pink-200',
        'Logística': 'bg-amber-50 text-amber-700 border-amber-200',
        'Impuestos': 'bg-rose-50 text-rose-700 border-rose-200',
        'Inventario': 'bg-emerald-50 text-emerald-700 border-emerald-200',
        'Pago Proveedores': 'bg-blue-50 text-blue-700 border-blue-200',
        'Otros': 'bg-gray-100 text-gray-700 border-gray-200'
    };
    const style = styles[cat] || styles['Otros'];
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${style}">${cat}</span>`;
}

// ==========================================================================
// CONEXIÓN A ADMIN STORE (TIEMPO REAL)
// ==========================================================================

AdminStore.subscribeToAccounts((accs) => {
    accountsList = accs || [];
    const previousSelection = accountSelect.value;
    accountSelect.innerHTML = '<option value="">Seleccione Cuenta de Origen...</option>';
    accountsList.forEach(a => {
        const bal = cleanNumber(a.balance);
        const exemptTag = a.isExempt ? ' [Exenta 4x1000]' : '';
        accountSelect.innerHTML += `<option value="${a.id}">${a.name} (${formatCOP(bal)})${exemptTag}</option>`;
    });
    if (previousSelection) accountSelect.value = previousSelection;
});

AdminStore.subscribeToExpenses((expenses) => {
    adminExpensesCache = (expenses || []).map(e => ({
        ...e,
        dateObj: parseExpenseDate(e)
    }));
    renderExpenses();
});

// ==========================================================================
// INICIALIZACIÓN Y EVENT LISTENERS
// ==========================================================================

function init() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    filterMonthInput.value = `${yyyy}-${mm}`;
    currentFilterDate = new Date(yyyy, now.getMonth(), 1);

    if (expPageSizeSelect) {
        pageSize = parseInt(expPageSizeSelect.value, 10) || 30;
    }
}

filterMonthInput.addEventListener('change', (e) => {
    if (e.target.value) {
        const [y, m] = e.target.value.split('-');
        currentFilterDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    } else {
        currentFilterDate = null;
    }
    currentPage = 1;
    renderExpenses();
});

btnClearDate.addEventListener('click', () => {
    filterMonthInput.value = "";
    currentFilterDate = null;
    currentPage = 1;
    renderExpenses();
});

if (filterCategorySelect) {
    filterCategorySelect.addEventListener('change', (e) => {
        currentCategory = e.target.value;
        currentPage = 1;
        renderExpenses();
    });
}

if (sortExpensesSelect) {
    sortExpensesSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        renderExpenses();
    });
}

searchInput.addEventListener('input', () => {
    currentPage = 1;
    renderExpenses();
});

if (expPageSizeSelect) {
    expPageSizeSelect.addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value, 10) || 30;
        currentPage = 1;
        renderExpenses();
    });
}

window.changeExpensePage = (delta) => {
    currentPage += delta;
    renderExpenses();
};

window.refreshExpensesData = async () => {
    if (syncIcon) syncIcon.classList.add('fa-spin');
    try {
        await AdminStore.forceSyncExpenses();
    } catch (e) {
        console.error("Error al sincronizar gastos:", e);
    } finally {
        setTimeout(() => {
            if (syncIcon) syncIcon.classList.remove('fa-spin');
        }, 600);
    }
};

// ==========================================================================
// RENDERIZADO Y CÁLCULO DE KPIS
// ==========================================================================

function renderExpenses() {
    if (!listContainer) return;

    let filtered = [...adminExpensesCache];
    const term = normalizeText(searchInput.value);

    // 1. Filtro de Mes
    if (currentFilterDate) {
        const start = currentFilterDate;
        const end = new Date(currentFilterDate.getFullYear(), currentFilterDate.getMonth() + 1, 0, 23, 59, 59);
        filtered = filtered.filter(e => e.dateObj >= start && e.dateObj <= end);
    }

    // 2. Filtro de Categoría
    if (currentCategory) {
        filtered = filtered.filter(e => (e.category || 'Otros') === currentCategory);
    }

    // 3. Filtro de Búsqueda de Texto
    if (term.length > 0) {
        filtered = filtered.filter(e => {
            const desc = normalizeText(e.description || '');
            const supp = normalizeText(e.supplierName || '');
            const cat = normalizeText(e.category || '');
            const payMethod = normalizeText(e.paymentMethod || '');
            return desc.includes(term) || supp.includes(term) || cat.includes(term) || payMethod.includes(term);
        });
    }

    // 4. Ordenamiento
    filtered.sort((a, b) => {
        const timeA = a.dateObj ? a.dateObj.getTime() : 0;
        const timeB = b.dateObj ? b.dateObj.getTime() : 0;
        const amtA = cleanNumber(a.amount);
        const amtB = cleanNumber(b.amount);

        switch (currentSort) {
            case 'date-asc':
                return timeA - timeB;
            case 'amount-desc':
                return amtB - amtA;
            case 'amount-asc':
                return amtA - amtB;
            case 'date-desc':
            default:
                return timeB - timeA;
        }
    });

    // 5. Cálculo de KPIs
    const totalPeriod = filtered.reduce((sum, item) => sum + cleanNumber(item.amount), 0);
    if (statsTotal) statsTotal.textContent = formatCOP(totalPeriod);
    if (statsCount) statsCount.textContent = `${filtered.length} registro(s)`;

    if (currentFilterDate) {
        const monthName = currentFilterDate.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
        if (lblPeriodTotal) lblPeriodTotal.textContent = `Total ${monthName}`.toUpperCase();
        if (statsPeriodBadge) statsPeriodBadge.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    } else {
        if (lblPeriodTotal) lblPeriodTotal.textContent = "TOTAL HISTÓRICO";
        if (statsPeriodBadge) statsPeriodBadge.textContent = "Todo el historial";
    }

    // Top Categoría
    const catSums = {};
    const accSums = {};
    filtered.forEach(item => {
        const cat = item.category || 'Otros';
        const acc = item.paymentMethod || 'No especificada';
        const amt = cleanNumber(item.amount);
        catSums[cat] = (catSums[cat] || 0) + amt;
        accSums[acc] = (accSums[acc] || 0) + amt;
    });

    const topCategoryEntry = Object.entries(catSums).sort((a, b) => b[1] - a[1])[0];
    if (topCategoryEntry && totalPeriod > 0) {
        const [catName, catAmt] = topCategoryEntry;
        const pct = Math.round((catAmt / totalPeriod) * 100);
        if (statsTopCategory) statsTopCategory.textContent = catName;
        if (statsTopCategoryAmount) statsTopCategoryAmount.textContent = formatCOP(catAmt);
        if (statsTopCategoryPercent) statsTopCategoryPercent.textContent = `${pct}% del total`;
    } else {
        if (statsTopCategory) statsTopCategory.textContent = "---";
        if (statsTopCategoryAmount) statsTopCategoryAmount.textContent = "$0";
        if (statsTopCategoryPercent) statsTopCategoryPercent.textContent = "0% del total";
    }

    // Top Cuenta
    const topAccountEntry = Object.entries(accSums).sort((a, b) => b[1] - a[1])[0];
    if (topAccountEntry && totalPeriod > 0) {
        const [accName, accAmt] = topAccountEntry;
        if (statsTopAccount) statsTopAccount.textContent = accName;
        if (statsTopAccountAmount) statsTopAccountAmount.textContent = formatCOP(accAmt);
    } else {
        if (statsTopAccount) statsTopAccount.textContent = "---";
        if (statsTopAccountAmount) statsTopAccountAmount.textContent = "$0";
    }

    if (tableRecordCount) {
        tableRecordCount.textContent = `${filtered.length} gasto(s) encontrado(s)`;
    }

    // 6. Paginación
    const totalPages = Math.ceil(filtered.length / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filtered.length);
    const pageExpenses = filtered.slice(startIdx, endIdx);

    // Actualizar controles de paginación
    if (expPageInfo) {
        expPageInfo.textContent = filtered.length > 0 
            ? `Mostrando ${startIdx + 1} - ${endIdx} de ${filtered.length} gastos`
            : `Mostrando 0 de 0`;
    }
    if (expPageCurrent) {
        expPageCurrent.textContent = `Pág ${currentPage} / ${totalPages}`;
    }
    if (expBtnPrev) expBtnPrev.disabled = currentPage <= 1;
    if (expBtnNext) expBtnNext.disabled = currentPage >= totalPages;

    // 7. Renderizado en Tabla
    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <tr>
                <td colspan="7" class="p-12 text-center text-slate-400 font-bold">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto mb-3 flex items-center justify-center text-xl">
                        <i class="fa-solid fa-receipt"></i>
                    </div>
                    <p class="text-xs uppercase tracking-wider text-slate-600">No se encontraron gastos registrados</p>
                    <p class="text-[11px] font-normal text-slate-400 mt-1">Prueba cambiando el mes, categoría o término de búsqueda.</p>
                </td>
            </tr>`;
        return;
    }

    const rows = pageExpenses.map(item => {
        const isTax = item.description?.startsWith('4x1000') || item.category === 'Impuestos';
        const isNegative = cleanNumber(item.amount) < 0;
        const initial = (item.supplierName || 'G').charAt(0).toUpperCase();

        return `
            <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0 group fade-in">
                <td class="px-6 py-3.5 text-slate-500 font-mono text-xs whitespace-nowrap">
                    ${formatDate(item.dateObj)}
                </td>
                <td class="px-6 py-3.5">
                    <div class="flex items-center gap-2.5">
                        <div class="w-7 h-7 rounded-lg ${isTax ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'} flex items-center justify-center font-black text-xs shrink-0">
                            ${initial}
                        </div>
                        <div class="min-w-0">
                            <p class="font-bold text-xs text-slate-800 uppercase truncate max-w-[200px]" title="${item.supplierName || 'General'}">
                                ${item.supplierName || 'General'}
                            </p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-3.5">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-xs font-semibold text-slate-800">${item.description || 'Sin concepto'}</span>
                        ${isTax ? '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-200">4x1000</span>' : ''}
                    </div>
                </td>
                <td class="px-6 py-3.5 whitespace-nowrap">
                    ${getCategoryBadge(item.category)}
                </td>
                <td class="px-6 py-3.5 whitespace-nowrap">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        <i class="fa-solid fa-building-columns text-[10px] text-slate-400"></i>
                        <span>${item.paymentMethod || '---'}</span>
                    </span>
                </td>
                <td class="px-6 py-3.5 text-right whitespace-nowrap font-black text-xs ${isNegative ? 'text-emerald-600' : 'text-slate-900'}">
                    ${isNegative ? '+' : ''}${formatCOP(item.amount)}
                </td>
                <td class="px-6 py-3.5 text-center whitespace-nowrap">
                    <button onclick="window.deleteExpense('${item.id}')" 
                        class="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-all shadow-2xs flex items-center justify-center mx-auto" 
                        title="Reversar y mover a papelera">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    listContainer.innerHTML = rows;
}

// ==========================================================================
// ELIMINAR / REVERSAR GASTO Y PAPELERA
// ==========================================================================

window.deleteExpense = async (id) => {
    try {
        const expenseSnap = await getDoc(doc(db, "expenses", id));
        if (!expenseSnap.exists()) {
            alert("El gasto seleccionado no existe o ya fue eliminado.");
            return;
        }

        const expenseData = expenseSnap.data();
        const amountToReverse = cleanNumber(expenseData.amount);
        const accountName = expenseData.paymentMethod || 'Cuenta no especificada';
        const supplierName = expenseData.supplierName || 'General';
        const description = expenseData.description || 'Sin concepto';
        const isSupplierPayment = expenseData.category === "Pago Proveedores" || expenseData.category === "Logística" || expenseData.category === "Inventario";

        const confirmMsg = 
            `Confirmar Reversion de Gasto\n\n` +
            `Concepto: ${description}\n` +
            `Valor: ${formatCOP(amountToReverse)}\n` +
            `Beneficiario: ${supplierName}\n` +
            `Cuenta: ${accountName}\n\n` +
            `- Se devolvera el dinero a la cuenta ${accountName}.\n` +
            (isSupplierPayment ? `- Se reactivara la deuda con el proveedor ${supplierName}.\n` : '') +
            `- El registro se movera a la papelera de auditoria.\n\n` +
            `Deseas continuar?`;

        if (!confirm(confirmMsg)) return;

        // Localizar el ID de la cuenta bancaria / caja
        let accountId = expenseData.accountId;
        if (!accountId) {
            const accObj = accountsList.find(a => a.name === accountName);
            accountId = accObj ? accObj.id : null;
        }

        // Si es pago a proveedores, localizamos las deudas para reactivarlas
        let payablesToReopen = [];
        if (isSupplierPayment && supplierName && supplierName !== 'General') {
            try {
                const payQuery = query(
                    collection(db, "payables"), 
                    where("provider", "==", supplierName), 
                    where("amountPaid", ">", 0)
                );
                const pSnap = await getDocs(payQuery);
                const docs = pSnap.docs.map(d => ({ ...d.data(), id: d.id, ref: d.ref }));
                docs.sort((a, b) => {
                    const dateA = a.lastPaymentDate?.seconds || a.createdAt?.seconds || 0;
                    const dateB = b.lastPaymentDate?.seconds || b.createdAt?.seconds || 0;
                    return dateB - dateA;
                });

                let remainingReverse = amountToReverse;
                for (const p of docs) {
                    if (remainingReverse <= 0) break;
                    const paidInThisDoc = cleanNumber(p.amountPaid);
                    const amountToSubtract = Math.min(remainingReverse, paidInThisDoc);

                    payablesToReopen.push({
                        ref: p.ref,
                        currentPaid: paidInThisDoc,
                        currentTotal: cleanNumber(p.total),
                        subtract: amountToSubtract
                    });
                    remainingReverse -= amountToSubtract;
                }
            } catch (payErr) {
                console.warn("Aviso al consultar cuentas por pagar vinculadas:", payErr);
            }
        }

        // Ejecutar Transacción Atómica
        await runTransaction(db, async (t) => {
            // Lecturas primero (todas antes de escrituras)
            let accDoc = null;
            let accRefDoc = null;
            if (accountId) {
                accRefDoc = doc(db, "accounts", accountId);
                accDoc = await t.get(accRefDoc);
            }

            // Actualizaciones
            if (accDoc && accDoc.exists()) {
                const currentBal = cleanNumber(accDoc.data().balance);
                t.update(accRefDoc, { 
                    balance: currentBal + amountToReverse,
                    updatedAt: Timestamp.now()
                });
            }

            for (const item of payablesToReopen) {
                const newPaid = item.currentPaid - item.subtract;
                const newBalance = item.currentTotal - newPaid;
                t.update(item.ref, {
                    amountPaid: newPaid,
                    balance: newBalance,
                    status: newPaid === 0 ? 'PENDING' : 'PARTIAL',
                    updatedAt: Timestamp.now()
                });
            }

            // Registrar en Papelera de Auditoría
            const trashRef = doc(db, "expenses_trash", id);
            t.set(trashRef, {
                ...expenseData,
                deletedAt: Timestamp.now(),
                deletedBy: getCurrentAdminName(),
                reversalType: isSupplierPayment ? "FULL_REVERSAL" : "REFUND_ONLY",
                originalCollection: "expenses",
                restoredAccountId: accountId || null
            });

            // Eliminar de colección principal
            t.delete(doc(db, "expenses", id));
        });

        let successMsg = `Gasto eliminado y ${formatCOP(amountToReverse)} devueltos a ${accountName}.`;
        if (payablesToReopen.length > 0) {
            successMsg += `\nSe reactivo la deuda en ${payablesToReopen.length} cuenta(s) por pagar de ${supplierName}.`;
        }
        alert(successMsg);

    } catch (e) {
        console.error("Error al reversar gasto:", e);
        const errText = e.message || e;
        alert("Error al reversar el gasto: " + errText);
    }
};

window.openTrashModal = async () => {
    trashModal.classList.remove('hidden');
    trashList.innerHTML = `
        <tr>
            <td colspan="5" class="p-8 text-center text-slate-400 font-bold">
                <i class="fa-solid fa-circle-notch fa-spin text-base text-rose-500 mb-2 block"></i>
                Cargando historial de eliminaciones...
            </td>
        </tr>`;

    try {
        const q = query(collection(db, "expenses_trash"), orderBy("deletedAt", "desc"), limit(50));
        const snap = await getDocs(q);

        trashList.innerHTML = "";
        if (snap.empty) {
            trashList.innerHTML = `
                <tr>
                    <td colspan="5" class="p-8 text-center text-slate-400 font-bold uppercase text-xs">
                        No hay registros en la papelera.
                    </td>
                </tr>`;
            return;
        }

        const rows = snap.docs.map(d => {
            const item = d.data();
            const delDate = item.deletedAt?.toDate ? item.deletedAt.toDate().toLocaleString('es-CO') : '--';
            const origDate = item.date?.toDate ? item.date.toDate().toLocaleDateString('es-CO') : '--';
            const reversalBadge = item.reversalType === 'FULL_REVERSAL' 
                ? '<span class="inline-flex px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-blue-50 text-blue-700 border border-blue-200">Reversión Total</span>'
                : '<span class="inline-flex px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-slate-100 text-slate-700 border border-slate-200">Devolución Saldo</span>';

            return `
                <tr class="border-b border-slate-100 last:border-0 hover:bg-rose-50/20 transition-colors">
                    <td class="p-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        <div class="font-bold text-rose-700">${delDate}</div>
                        <div class="text-[9px] text-slate-400">ID: ${d.id.slice(0, 8)}</div>
                    </td>
                    <td class="p-3 text-xs font-bold text-slate-800 uppercase whitespace-nowrap">
                        ${item.deletedBy || 'Desconocido'}
                    </td>
                    <td class="p-3">
                        <p class="text-xs font-bold text-slate-800">${item.description || 'Sin concepto'}</p>
                        <p class="text-[10px] text-slate-400 font-medium">Prov: ${item.supplierName || 'General'} | Fecha Orig: ${origDate}</p>
                    </td>
                    <td class="p-3 whitespace-nowrap">
                        <p class="text-xs font-bold text-slate-700">${item.paymentMethod || '---'}</p>
                        ${reversalBadge}
                    </td>
                    <td class="p-3 text-right text-xs font-black text-slate-400 line-through decoration-rose-400 whitespace-nowrap">
                        ${formatCOP(item.amount)}
                    </td>
                </tr>
            `;
        }).join('');

        trashList.innerHTML = rows;

    } catch (e) {
        console.error("Error al cargar papelera:", e);
        trashList.innerHTML = `
            <tr>
                <td colspan="5" class="p-8 text-center text-rose-500 font-bold text-xs">
                    Error al cargar los registros de auditoría.
                </td>
            </tr>`;
    }
};

// ==========================================================================
// FORMULARIO DE REGISTRO DE NUEVO GASTO
// ==========================================================================

let expenseSuppliersCache = null;

async function getExpenseSuppliersList() {
    if (expenseSuppliersCache) return expenseSuppliersCache;
    try {
        const coll = collection(db, "suppliers");
        const snap = await getDocs(coll);
        expenseSuppliersCache = [];
        snap.forEach(d => {
            const data = d.data();
            const name = (data.name || data.supplierName || data.razonSocial || data.company || '').trim();
            const nit = (data.nit || data.document || '').trim();
            const cleanNit = nit.replace(/[^a-zA-Z0-9]/g, '');
            const contact = (data.contactName || data.contact || '').trim();
            expenseSuppliersCache.push({
                id: d.id,
                name: name || 'Proveedor sin nombre',
                nit: nit,
                searchStr: normalizeText(`${name} ${nit} ${cleanNit} ${contact}`)
            });
        });
        return expenseSuppliersCache;
    } catch (e) {
        console.error("Error al obtener proveedores:", e);
        return [];
    }
}

let supplierTimeout = null;
if (supplierSearch) {
    supplierSearch.addEventListener('focus', () => { getExpenseSuppliersList(); });

    supplierSearch.addEventListener('input', (e) => {
        const rawTerm = e.target.value.trim();
        const cleanTerm = normalizeText(rawTerm);
        selectedSupplierId.value = "";
        supplierDropdown.innerHTML = `<div class="p-3 text-xs text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
        supplierDropdown.classList.remove('hidden');

        if (cleanTerm.length < 1) { 
            supplierDropdown.classList.add('hidden'); 
            return; 
        }

        clearTimeout(supplierTimeout);
        supplierTimeout = setTimeout(async () => {
            try {
                const list = await getExpenseSuppliersList();
                const matches = list.filter(s => s.searchStr && s.searchStr.includes(cleanTerm));
                
                supplierDropdown.innerHTML = "";
                const divGen = document.createElement('div');
                divGen.className = "p-3 hover:bg-slate-50 cursor-pointer text-xs font-bold text-slate-600 border-b border-slate-100 italic";
                divGen.textContent = "Gasto General / Varios";
                divGen.onclick = () => {
                    supplierSearch.value = "General / Varios";
                    selectedSupplierId.value = "general";
                    supplierDropdown.classList.add('hidden');
                };
                supplierDropdown.appendChild(divGen);

                if (matches.length === 0) {
                    const item = document.createElement('div');
                    item.className = "p-3 text-xs text-slate-400 italic text-center";
                    item.textContent = "No se encontraron proveedores coincidentes";
                    supplierDropdown.appendChild(item);
                } else {
                    matches.slice(0, 10).forEach(s => {
                        const item = document.createElement('div');
                        item.className = "p-3 hover:bg-slate-50 cursor-pointer text-xs font-bold text-slate-800 border-b border-slate-100 last:border-0 transition-colors flex justify-between items-center";
                        item.innerHTML = `<span>${s.name}</span><span class="text-[10px] text-slate-400 font-normal">${s.nit ? 'NIT: ' + s.nit : ''}</span>`;
                        item.onclick = () => {
                            supplierSearch.value = s.name;
                            selectedSupplierId.value = s.id;
                            supplierDropdown.classList.add('hidden');
                        };
                        supplierDropdown.appendChild(item);
                    });
                }
            } catch (err) { 
                console.error("Error en autocompletado:", err); 
            }
        }, 120);
    });
}

// Cerrar dropdown de proveedores si se hace clic afuera
document.addEventListener('click', (e) => {
    if (supplierDropdown && !supplierDropdown.contains(e.target) && e.target !== supplierSearch) {
        supplierDropdown.classList.add('hidden');
    }
});

function getCleanAmount() {
    const raw = amountDisplay.value.replace(/\D/g, "");
    return raw ? parseInt(raw, 10) : 0;
}

if (amountDisplay) {
    amountDisplay.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value === "") { 
            e.target.value = ""; 
            checkTax(); 
            return; 
        }
        e.target.value = "$" + parseInt(value, 10).toLocaleString('es-CO');
        checkTax();
    });
}

function checkTax() {
    const accId = accountSelect.value;
    const amount = getCleanAmount();
    const acc = accountsList.find(a => a.id === accId);
    
    if (acc && acc.type === 'banco' && !acc.isExempt && amount > 0) {
        const tax = Math.ceil(amount * 0.004);
        const total = amount + tax;
        if (taxVal) taxVal.textContent = formatCOP(tax);
        if (taxTotalDeduction) taxTotalDeduction.textContent = formatCOP(total);
        if (taxAlert) taxAlert.classList.remove('hidden');
    } else {
        if (taxAlert) taxAlert.classList.add('hidden');
    }
}

if (accountSelect) {
    accountSelect.addEventListener('change', checkTax);
}

if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-save');
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Registrando...</span>`;

        const supplierId = selectedSupplierId.value;
        const supplierName = supplierSearch.value.trim();
        const desc = document.getElementById('desc').value.trim();
        const amount = getCleanAmount();
        const dateVal = document.getElementById('date').value;
        const category = document.getElementById('category').value;
        const accountId = accountSelect.value;
        const accountOption = accountSelect.options[accountSelect.selectedIndex];
        const accountName = accountOption ? accountOption.text.split(' (')[0] : 'Cuenta';

        if (!supplierName || amount <= 0 || !accountId || !desc || !dateVal) {
            alert("Por favor completa todos los campos obligatorios.");
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check text-xs"></i> <span>Confirmar y Registrar Gasto</span>`;
            return;
        }

        const dateParts = dateVal.split('-');
        const localDate = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10), 12, 0, 0);

        try {
            await runTransaction(db, async (t) => {
                const accRef = doc(db, "accounts", accountId);
                const accDoc = await t.get(accRef);
                if (!accDoc.exists()) throw new Error("La cuenta seleccionada no existe.");

                const accData = accDoc.data();
                const accBalance = cleanNumber(accData.balance);

                let tax = 0;
                if (accData.type === 'banco' && !accData.isExempt) {
                    tax = Math.ceil(amount * 0.004);
                }

                const totalDeduction = amount + tax;
                if (accBalance < totalDeduction) {
                    throw new Error(`Saldo insuficiente en ${accData.name}. Disponible: ${formatCOP(accBalance)}, Requerido: ${formatCOP(totalDeduction)}`);
                }

                // 1. Descontar saldo de la cuenta con updatedAt para delta sync
                t.update(accRef, { 
                    balance: accBalance - totalDeduction,
                    updatedAt: Timestamp.now()
                });

                // 2. Si aplica 4x1000, registrar el impuesto como egreso individual
                if (tax > 0) {
                    const taxDocRef = doc(collection(db, "expenses"));
                    t.set(taxDocRef, {
                        description: `4x1000 ${desc}`,
                        amount: tax,
                        type: 'EXPENSE',
                        category: "Impuestos",
                        paymentMethod: accountName,
                        accountId: accountId,
                        date: Timestamp.fromDate(localDate),
                        createdAt: Timestamp.now(),
                        updatedAt: Timestamp.now(),
                        supplierName: "DIAN / Banco"
                    });
                }

                // 3. Registrar el gasto principal
                const expenseDocRef = doc(collection(db, "expenses"));
                t.set(expenseDocRef, {
                    supplierId: (!supplierId || supplierId === 'general') ? null : supplierId,
                    supplierName: supplierName,
                    description: desc,
                    category: category,
                    amount: amount,
                    type: 'EXPENSE',
                    paymentMethod: accountName,
                    accountId: accountId,
                    date: Timestamp.fromDate(localDate),
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now()
                });
            });

            alert("Gasto registrado exitosamente.");
            window.closeModal();

        } catch (error) {
            console.error("Error al registrar gasto:", error);
            alert("Error: " + (error.message || error));
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check text-xs"></i> <span>Confirmar y Registrar Gasto</span>`;
        }
    });
}

window.openModal = () => {
    if (form) form.reset();
    if (supplierSearch) supplierSearch.value = "";
    if (selectedSupplierId) selectedSupplierId.value = "";
    if (amountDisplay) amountDisplay.value = "";
    const dateInput = document.getElementById('date');
    if (dateInput) dateInput.valueAsDate = new Date();
    if (taxAlert) taxAlert.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');
};

window.closeModal = () => {
    if (modal) modal.classList.add('hidden');
};

// Arrancar inicialización
init();