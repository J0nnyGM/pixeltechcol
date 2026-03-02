import { db, collection, addDoc, updateDoc, deleteDoc, doc, getDocs, getDoc, query, orderBy, Timestamp, runTransaction, limit, startAfter, startAt, endAt, where, getAggregateFromServer, sum, onSnapshot } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// DOM
const listContainer = document.getElementById('expenses-list');
const loadMoreBtn = document.getElementById('load-more-container');
const modal = document.getElementById('expense-modal');
const form = document.getElementById('expense-form');
const accountSelect = document.getElementById('account-select');
const taxAlert = document.getElementById('tax-alert');
const amountDisplay = document.getElementById('amount-display');
const supplierSearch = document.getElementById('supplier-search');
const supplierDropdown = document.getElementById('supplier-dropdown');
const selectedSupplierId = document.getElementById('selected-supplier-id');
const searchInput = document.getElementById('search-input');
const filterMonthInput = document.getElementById('filter-month');
const btnClearDate = document.getElementById('btn-clear-date');
const lblPeriodTotal = document.getElementById('lbl-period-total');
const trashModal = document.getElementById('trash-modal');
const trashList = document.getElementById('trash-list');

// Estado
let lastDoc = null;
let isLoading = false;
let accountsList = [];
let currentFilterDate = null;
const DOCS_PER_PAGE = 50;

// Estado Smart Cache
let unsubscribeExpensesList = null;
let adminExpensesCache = [];

// Obtener nombre del admin actual
const getCurrentAdminName = () => document.getElementById('admin-name')?.textContent || 'Admin Desconocido';

const cleanNumber = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    return parseFloat(val.toString().replace(/[^\d-]/g, '')) || 0;
};

// Init
async function init() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    filterMonthInput.value = `${yyyy}-${mm}`;
    currentFilterDate = new Date(yyyy, now.getMonth(), 1); 

    await loadAccounts();
    reloadAll();
}

function reloadAll() {
    lastDoc = null; 
    startExpensesListener(false);
    loadStats();
}

// Filtros Fecha
filterMonthInput.addEventListener('change', (e) => {
    if(e.target.value) {
        const [y, m] = e.target.value.split('-');
        currentFilterDate = new Date(y, m - 1, 1);
    } else {
        currentFilterDate = null;
    }
    reloadAll();
});

btnClearDate.addEventListener('click', () => {
    filterMonthInput.value = "";
    currentFilterDate = null;
    reloadAll();
});


// ==========================================================================
// 🧠 SMART REAL-TIME CACHE: LISTA DE GASTOS
// ==========================================================================

function startExpensesListener(isNextPage = false) {
    if (isLoading) return;
    isLoading = true;

    if (!isNextPage) {
        listContainer.innerHTML = `<tr><td colspan="7" class="p-8 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i> Cargando...</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        if (unsubscribeExpensesList) unsubscribeExpensesList();
    } else {
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
    }

    try {
        const coll = collection(db, "expenses");
        let constraints = [];

        constraints.push(where("type", "==", "EXPENSE"));

        if (currentFilterDate) {
            const start = Timestamp.fromDate(currentFilterDate);
            const nextMonth = new Date(currentFilterDate.getFullYear(), currentFilterDate.getMonth() + 1, 0, 23, 59, 59);
            const end = Timestamp.fromDate(nextMonth);
            
            constraints.push(where("date", ">=", start));
            constraints.push(where("date", "<=", end));
        }

        constraints.push(orderBy("date", "desc"));

        // EJECUCIÓN HÍBRIDA
        if (isNextPage && lastDoc) {
            constraints.push(startAfter(lastDoc));
            constraints.push(limit(DOCS_PER_PAGE));
            
            const q = query(coll, ...constraints);
            getDocs(q).then(snapshot => handleSnapshotResult(snapshot, true)).catch(e => {
                console.error("Error Paginación Gastos:", e);
                isLoading = false;
            });
            
        } else {
            constraints.push(limit(DOCS_PER_PAGE));
            const q = query(coll, ...constraints);
            
            unsubscribeExpensesList = onSnapshot(q, (snapshot) => {
                handleSnapshotResult(snapshot, false);
                // Si hay un cambio en vivo en la página 1, también actualizamos el KPI total en background
                if (!snapshot.metadata.fromCache && !snapshot.empty) loadStats();
            }, (error) => {
                console.error(error);
                const msg = error.message.includes("index") ? "Falta índice (type + date)" : "Error de conexión en vivo";
                listContainer.innerHTML = `<tr><td colspan="7" class="text-center text-red-400 font-bold p-10 text-xs">${msg}</td></tr>`;
            });
        }

    } catch (error) {
        console.error("Error configurando query gastos:", error);
        isLoading = false;
    }
}

function handleSnapshotResult(snapshot, isNextPage) {
    if (!isNextPage) {
        listContainer.innerHTML = "";
        adminExpensesCache = []; 
    }

    if (snapshot.empty) {
        if (!isNextPage) listContainer.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-gray-400 text-xs font-bold uppercase">No hay gastos en este periodo.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        isLoading = false;
        return;
    }

    if (snapshot.docs.length > 0 && !snapshot.metadata.hasPendingWrites) {
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    if (snapshot.docs.length === DOCS_PER_PAGE) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar siguientes 50`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }

    const expenses = snapshot.docs.map(d => {
        const data = d.data();
        const dateObj = data.date && data.date.toDate ? data.date.toDate() : new Date(data.date);
        const item = { id: d.id, ...data, dateObj };
        adminExpensesCache.push(item);
        return item;
    });

    renderTable(expenses);
    isLoading = false;
}

window.loadMoreExpenses = () => startExpensesListener(true);

function renderTable(data) {
    const html = data.map(item => `
        <tr class="hover:bg-slate-50 transition border-b border-gray-50 last:border-0 group fade-in">
            <td class="px-6 py-4 text-gray-500 font-mono text-xs">${item.dateObj.toLocaleDateString('es-CO')}</td>
            <td class="px-6 py-4 font-bold text-xs uppercase">${item.supplierName || 'General'}</td>
            <td class="px-6 py-4 text-xs text-brand-black">${item.description}</td>
            <td class="px-6 py-4"><span class="bg-gray-100 px-2 py-1 rounded text-[9px] font-black uppercase text-gray-500">${item.category}</span></td>
            <td class="px-6 py-4 text-xs font-bold text-brand-cyan">${item.paymentMethod || '---'}</td>
            <td class="px-6 py-4 text-right font-black ${item.amount < 0 ? 'text-green-500' : 'text-brand-black'}">$${Math.abs(Number(item.amount)).toLocaleString('es-CO')}</td>
            <td class="px-6 py-4 text-center">
                <button onclick="window.deleteExpense('${item.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition shadow-sm opacity-0 group-hover:opacity-100" title="Borrar (Mover a Papelera)">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        </tr>`).join('');

    listContainer.insertAdjacentHTML('beforeend', html);
}


// --- BUSCADOR LOCAL EN RAM ---
searchInput.addEventListener('keyup', (e) => {
    const term = e.target.value.toLowerCase().trim();

    if (term.length === 0) {
        listContainer.innerHTML = "";
        renderTable(adminExpensesCache);
        return;
    }

    const results = adminExpensesCache.filter(item => {
        const suppMatch = (item.supplierName || "").toLowerCase().includes(term);
        const descMatch = (item.description || "").toLowerCase().includes(term);
        return suppMatch || descMatch;
    });

    listContainer.innerHTML = "";
    if (results.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-400 text-xs font-bold uppercase">No encontrado en la página actual. (Busca cargando más registros primero)</td></tr>`;
    } else {
        renderTable(results);
    }
});


// 2. ELIMINACIÓN MAESTRA (Reembolso Banco + Reversión Deuda + Auditoría)
window.deleteExpense = async (id) => {
    if (!confirm("⚠️ ¿Estás seguro?\n\n1. Se devolverá el dinero a la cuenta.\n2. Si es pago a proveedor, la deuda volverá a aparecer.\n3. El registro irá a la papelera.")) return;

    try {
        const expenseSnap = await getDoc(doc(db, "expenses", id));
        if (!expenseSnap.exists()) throw "El documento no existe.";
        
        const expenseData = expenseSnap.data();
        const amountToReverse = Number(expenseData.amount);
        const accountName = expenseData.paymentMethod;
        const supplierName = expenseData.supplierName;
        
        const isSupplierPayment = expenseData.category === "Pago Proveedores" || expenseData.category === "Logística" || expenseData.category === "Inventario"; 

        const accQuery = query(collection(db, "accounts"), where("name", "==", accountName), limit(1));
        const accSnapshot = await getDocs(accQuery);
        let accountRef = null;
        if (!accSnapshot.empty) accountRef = accSnapshot.docs[0].ref;

        let payablesToReopen = [];
        if (isSupplierPayment && supplierName) {
            const payQuerySimple = query(
                collection(db, "payables"), 
                where("provider", "==", supplierName),
                where("amountPaid", ">", 0)
            );
            
            const pSnap = await getDocs(payQuerySimple);
            
            const docs = pSnap.docs.map(d => ({...d.data(), id: d.id, ref: d.ref}));
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
        }

        await runTransaction(db, async (t) => {
            if (accountRef) {
                const accDoc = await t.get(accountRef);
                if (accDoc.exists()) {
                    const currentBal = Number(accDoc.data().balance);
                    t.update(accountRef, { balance: currentBal + amountToReverse });
                }
            }

            for (const item of payablesToReopen) {
                const newPaid = item.currentPaid - item.subtract;
                const newBalance = item.currentTotal - newPaid;
                
                t.update(item.ref, {
                    amountPaid: newPaid,
                    balance: newBalance,
                    status: newPaid === 0 ? 'PENDING' : 'PARTIAL', 
                });
            }

            const trashRef = doc(db, "expenses_trash", id);
            t.set(trashRef, {
                ...expenseData,
                deletedAt: Timestamp.now(),
                deletedBy: getCurrentAdminName(),
                reversalType: isSupplierPayment ? "FULL_REVERSAL" : "REFUND_ONLY",
                originalCollection: "expenses"
            });

            t.delete(doc(db, "expenses", id));
        });

        let msg = `✅ Gasto eliminado y $${amountToReverse.toLocaleString()} devueltos a ${accountName}.`;
        if (payablesToReopen.length > 0) {
            msg += `\n\n🔄 Se reactivó la deuda en ${payablesToReopen.length} factura(s) de ${supplierName}.`;
        }
        alert(msg);
        
        // NO hacemos reloadAll(). El onSnapshot repintará la tabla.

    } catch (e) {
        console.error(e);
        let errText = e.message;
        if(errText.includes("index")) errText = "Falta índice compuesto en Firebase (payables). Abre la consola.";
        alert("Error al reversar: " + errText);
    }
};

// 3. VER PAPELERA
window.openTrashModal = async () => {
    trashModal.classList.remove('hidden');
    trashList.innerHTML = `<tr><td colspan="4" class="p-8 text-center"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando logs...</td></tr>`;

    try {
        const q = query(collection(db, "expenses_trash"), orderBy("deletedAt", "desc"), limit(50));
        const snap = await getDocs(q);

        trashList.innerHTML = "";
        if (snap.empty) {
            trashList.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-400 text-xs font-bold uppercase">Papelera vacía.</td></tr>`;
            return;
        }

        snap.forEach(d => {
            const item = d.data();
            const delDate = item.deletedAt?.toDate().toLocaleString('es-CO') || '--';
            const origDate = item.date?.toDate().toLocaleDateString('es-CO') || '--';

            trashList.innerHTML += `
                <tr class="border-b border-gray-50 last:border-0 hover:bg-red-50/30">
                    <td class="p-3 font-mono text-[10px] text-gray-500">
                        <div class="font-bold text-brand-red">${delDate}</div>
                        <div class="text-[9px] text-gray-300">ID: ${d.id.slice(0,6)}</div>
                    </td>
                    <td class="p-3 text-xs font-bold text-brand-black uppercase">${item.deletedBy}</td>
                    <td class="p-3">
                        <p class="text-xs font-bold text-gray-600">${item.description}</p>
                        <p class="text-[9px] text-gray-400">Prov: ${item.supplierName} • Fecha Orig: ${origDate}</p>
                    </td>
                    <td class="p-3 text-right text-xs font-black text-gray-400 line-through decoration-red-300">
                        $${Number(item.amount).toLocaleString('es-CO')}
                    </td>
                </tr>
            `;
        });

    } catch (e) {
        console.error(e);
        trashList.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-red-400">Error cargando papelera.</td></tr>`;
    }
};

// 4. STATS (1 Lectura usando AggregateFromServer)
async function loadStats() {
    try {
        const coll = collection(db, "expenses");
        let constraints = [where("type", "==", "EXPENSE")];

        let labelText = "Total Histórico";

        if (currentFilterDate) {
            const start = Timestamp.fromDate(currentFilterDate);
            const nextMonth = new Date(currentFilterDate.getFullYear(), currentFilterDate.getMonth() + 1, 0, 23, 59, 59);
            const end = Timestamp.fromDate(nextMonth);
            
            constraints.push(where("date", ">=", start));
            constraints.push(where("date", "<=", end));
            
            const monthName = currentFilterDate.toLocaleString('es-CO', { month: 'long' });
            labelText = `Total ${monthName}`;
        }

        const q = query(coll, ...constraints);
        const snap = await getAggregateFromServer(q, { total: sum('amount') });
        const total = snap.data().total || 0;

        document.getElementById('stats-total').textContent = `$${Math.round(total).toLocaleString('es-CO')}`;
        lblPeriodTotal.textContent = labelText.toUpperCase();

    } catch (e) {
        console.error("Error Stats:", e);
    }
}


// --- FORMULARIO Y CREACIÓN ---
let supplierTimeout = null;
supplierSearch.addEventListener('input', (e) => {
    const term = e.target.value.trim();
    selectedSupplierId.value = "";
    supplierDropdown.innerHTML = `<div class="p-3 text-xs text-gray-400"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    supplierDropdown.classList.remove('hidden');

    if (term.length < 1) { supplierDropdown.classList.add('hidden'); return; }

    clearTimeout(supplierTimeout);
    supplierTimeout = setTimeout(async () => {
        try {
            const termCap = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
            const q = query(collection(db, "suppliers"), orderBy('name'), startAt(termCap), endAt(termCap + '\uf8ff'), limit(5));
            const snap = await getDocs(q);
            
            supplierDropdown.innerHTML = "";
            const divGen = document.createElement('div');
            divGen.className = "p-3 hover:bg-slate-50 cursor-pointer text-xs font-bold text-gray-500 border-b border-gray-50 italic";
            divGen.textContent = "-- Gasto General / Varios --";
            divGen.onclick = () => {
                supplierSearch.value = "General / Varios";
                selectedSupplierId.value = "general";
                supplierDropdown.classList.add('hidden');
            };
            supplierDropdown.appendChild(divGen);

            snap.forEach(d => {
                const s = d.data();
                const item = document.createElement('div');
                item.className = "p-3 hover:bg-slate-50 cursor-pointer text-xs font-bold text-brand-black border-b border-gray-50 last:border-0 transition-colors";
                item.textContent = s.name;
                item.onclick = () => {
                    supplierSearch.value = s.name;
                    selectedSupplierId.value = d.id;
                    supplierDropdown.classList.add('hidden');
                };
                supplierDropdown.appendChild(item);
            });
        } catch(e) { console.error(e); }
    }, 300);
});

async function loadAccounts() {
    try {
        const q = query(collection(db, "accounts"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        accountSelect.innerHTML = '<option value="">Seleccione Cuenta...</option>';
        accountsList = [];
        snap.forEach(d => {
            const acc = { id: d.id, ...d.data() };
            accountsList.push(acc);
            accountSelect.innerHTML += `<option value="${d.id}">${acc.name} ($${(acc.balance || 0).toLocaleString()})</option>`;
        });
    } catch(e) { console.error(e); }
}

amountDisplay.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value === "") { e.target.value = ""; checkTax(); return; }
    e.target.value = "$" + parseInt(value, 10).toLocaleString('es-CO');
    checkTax();
});

function getCleanAmount() {
    const raw = amountDisplay.value.replace(/\D/g, "");
    return raw ? parseInt(raw, 10) : 0;
}

function checkTax() {
    const accId = accountSelect.value;
    const amount = getCleanAmount();
    const acc = accountsList.find(a => a.id === accId);
    if (acc && acc.type === 'banco' && !acc.isExempt && amount > 0) {
        const tax = Math.ceil(amount * 0.004);
        document.getElementById('tax-val').textContent = `$${tax.toLocaleString('es-CO')}`;
        taxAlert.classList.remove('hidden');
    } else {
        taxAlert.classList.add('hidden');
    }
}
accountSelect.addEventListener('change', checkTax);

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save');
    btn.disabled = true; btn.innerText = "Procesando...";

    const supplierId = selectedSupplierId.value;
    const supplierName = supplierSearch.value;
    const desc = document.getElementById('desc').value;
    const amount = getCleanAmount();
    const dateVal = document.getElementById('date').value;
    const category = document.getElementById('category').value;
    const accountId = accountSelect.value;
    const accountName = accountSelect.options[accountSelect.selectedIndex].text.split(' (')[0];

    if(!supplierName || amount <= 0 || !accountId) { alert("Datos incompletos"); btn.disabled=false; return; }

    const dateParts = dateVal.split('-');
    const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);

    try {
        await runTransaction(db, async (t) => {
            const accRef = doc(db, "accounts", accountId);
            const accDoc = await t.get(accRef);
            if(!accDoc.exists()) throw "La cuenta no existe.";
            const accData = accDoc.data();
            
            let tax = 0;
            if (accData.type === 'banco' && !accData.isExempt) tax = Math.ceil(amount * 0.004);

            const totalDeduction = amount + tax;
            if (accData.balance < totalDeduction) throw `Saldo insuficiente en ${accData.name}.`;

            t.update(accRef, { balance: accData.balance - totalDeduction });

            if (tax > 0) {
                t.set(doc(collection(db, "expenses")), {
                    description: `4x1000 ${desc}`,
                    amount: tax,
                    type: 'EXPENSE',
                    category: "Impuestos",
                    paymentMethod: accountName,
                    date: Timestamp.fromDate(localDate),
                    createdAt: Timestamp.now(),
                    supplierName: "DIAN / Banco"
                });
            }

            t.set(doc(collection(db, "expenses")), {
                supplierId: (!supplierId || supplierId === 'general') ? null : supplierId,
                supplierName: supplierName,
                description: desc,
                category: category,
                amount: amount,
                type: 'EXPENSE',
                paymentMethod: accountName,
                date: Timestamp.fromDate(localDate),
                createdAt: Timestamp.now()
            });
        });

        alert("✅ Gasto registrado");
        window.closeModal();
        // El onSnapshot de la tabla se encarga del update visual.
        loadAccounts(); // Recargamos select para actualizar saldos visuales en el modal.

    } catch (error) { alert("Error: " + error.message); } 
    finally { btn.disabled = false; btn.innerText = "Registrar Gasto"; }
});

window.openModal = () => {
    form.reset();
    supplierSearch.value = "";
    selectedSupplierId.value = "";
    amountDisplay.value = "";
    document.getElementById('date').valueAsDate = new Date();
    taxAlert.classList.add('hidden');
    modal.classList.remove('hidden');
};
window.closeModal = () => modal.classList.add('hidden');

init();