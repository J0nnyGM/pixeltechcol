import { db, collection, addDoc, updateDoc, doc, getDocs, query, where, orderBy, Timestamp, runTransaction, limit, startAfter, onSnapshot } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// --- ESTADO GLOBAL ---
let groupedReceivables = [];
let groupedPayables = [];
let accounts = [];

// Estado del Modal de Detalles
let currentDetailEntity = null; // { id, name, type }
let lastDetailDoc = null;
const DETAILS_PAGE_SIZE = 10;

// Listeners de Tiempo Real
let unsubscribeOrders = null;
let unsubscribePayables = null;
let unsubscribeAccounts = null;

// DOM Elements
const listReceivable = document.getElementById('list-receivable');
const listPayable = document.getElementById('list-payable');
const accountSelect = document.getElementById('pay-account');
const paymentModal = document.getElementById('payment-modal');
const paymentForm = document.getElementById('payment-form');
const searchInput = document.getElementById('wallet-search');
const detailsModal = document.getElementById('details-modal');
const dtList = document.getElementById('dt-list');
const dtLoadMore = document.getElementById('dt-load-more');

// Helpers
const formatMoney = (amount) => `$${Math.round(amount).toLocaleString('es-CO')}`;

const cleanNumber = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    return parseFloat(val.toString().replace(/[^\d-]/g, '')) || 0;
};

// Input Mascara
document.querySelectorAll('.currency-input').forEach(input => {
    input.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, "");
        if (val === "") { e.target.value = ""; return; }
        e.target.value = "$" + parseInt(val, 10).toLocaleString('es-CO');
    });
});

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE: CARTERA Y TESORERÍA
// ==========================================================================

const SmartCarteraSync = {
    REC_KEY: 'pixeltech_admin_receivables_cache',
    PAY_KEY: 'pixeltech_admin_payables_cache',
    ACC_KEY: 'pixeltech_admin_accounts_cache',

    runtimeRecMap: {},
    runtimePayMap: {},
    lastRecSync: 0,
    lastPaySync: 0,

    init() {
        this.loadCaches();
        this.listenForAccounts();
        this.listenForReceivables();
        this.listenForPayables();
    },

    loadCaches() {
        // Cuentas (Caché rápido visual)
        try {
            const accCached = sessionStorage.getItem(this.ACC_KEY);
            if (accCached) {
                accounts = JSON.parse(accCached);
                this.renderAccountsDropdown();
            }
        } catch(e) {}

        // Cartera Clientes (Órdenes)
        try {
            const recCached = localStorage.getItem(this.REC_KEY);
            if (recCached) {
                const parsed = JSON.parse(recCached);
                if (parsed.map && parsed.lastSync) {
                    this.runtimeRecMap = parsed.map;
                    this.lastRecSync = parsed.lastSync;
                    this.calculateAndRender();
                }
            }
        } catch (e) { localStorage.removeItem(this.REC_KEY); }

        // Deudas Proveedores (Payables)
        try {
            const payCached = localStorage.getItem(this.PAY_KEY);
            if (payCached) {
                const parsed = JSON.parse(payCached);
                if (parsed.map && parsed.lastSync) {
                    this.runtimePayMap = parsed.map;
                    this.lastPaySync = parsed.lastSync;
                    this.calculateAndRender();
                }
            }
        } catch (e) { localStorage.removeItem(this.PAY_KEY); }

        if (Object.keys(this.runtimeRecMap).length === 0) {
            listReceivable.innerHTML = `<tr><td colspan="4" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i> Auditando clientes...</td></tr>`;
        }
        if (Object.keys(this.runtimePayMap).length === 0) {
            listPayable.innerHTML = `<tr><td colspan="4" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i> Auditando proveedores...</td></tr>`;
        }
    },

    listenForAccounts() {
        if (unsubscribeAccounts) unsubscribeAccounts();
        const q = query(collection(db, "accounts"), orderBy("name", "asc"));
        unsubscribeAccounts = onSnapshot(q, (snap) => {
            accounts = [];
            snap.forEach(d => accounts.push({ id: d.id, ...d.data() }));
            sessionStorage.setItem(this.ACC_KEY, JSON.stringify(accounts));
            this.renderAccountsDropdown();
        });
    },

    renderAccountsDropdown() {
        accountSelect.innerHTML = '<option value="">Seleccione...</option>';
        accounts.forEach(acc => {
            accountSelect.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
        });
    },

    listenForReceivables() {
        if (unsubscribeOrders) unsubscribeOrders();

        const colRef = collection(db, "orders");
        let q;

        if (this.lastRecSync === 0 || Object.keys(this.runtimeRecMap).length === 0) {
            console.log("☁️ [Cartera] Descargando deudas completas de clientes...");
            q = query(colRef, where("paymentStatus", "in", ["PENDING", "PARTIAL"]));
        } else {
            console.log("🔄 [Cartera] Buscando actualizaciones en cobros a clientes...");
            q = query(colRef, where("updatedAt", ">", new Date(this.lastRecSync)));
        }

        unsubscribeOrders = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) return;

            let hasChanges = false;

            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                const id = change.doc.id;

                // Si se canceló/rechazó o se pagó completamente, lo sacamos del mapa de deudas
                const isCanceled = data.status === 'CANCELADO' || data.status === 'RECHAZADO';
                const isPaid = data.paymentStatus === 'PAID' || cleanNumber(data.amountPaid) >= cleanNumber(data.total);

                if (change.type === 'removed' || isCanceled || isPaid) {
                    if (this.runtimeRecMap[id]) {
                        delete this.runtimeRecMap[id];
                        hasChanges = true;
                    }
                } else if (change.type === 'added' || change.type === 'modified') {
                    // Si aún debe plata y no está cancelado, lo actualizamos/agregamos
                    if (!data.updatedAt) data.updatedAt = data.createdAt || new Date();
                    
                    this.runtimeRecMap[id] = { 
                        id, 
                        userId: data.userId,
                        userName: data.userName,
                        billingInfo: data.billingInfo,
                        shippingData: data.shippingData,
                        total: data.total,
                        amountPaid: data.amountPaid
                    };
                    hasChanges = true;
                }
            });

            if (hasChanges) {
                console.log(`🔥 [Cartera] ${snapshot.docChanges().length} cambios en deudas de clientes.`);
                localStorage.setItem(this.REC_KEY, JSON.stringify({ map: this.runtimeRecMap, lastSync: Date.now() }));
                this.calculateAndRender();
            }
        });
    },

    listenForPayables() {
        if (unsubscribePayables) unsubscribePayables();

        const colRef = collection(db, "payables");
        let q;

        if (this.lastPaySync === 0 || Object.keys(this.runtimePayMap).length === 0) {
            console.log("☁️ [Cartera] Descargando deudas a proveedores...");
            q = query(colRef, where("status", "==", "PENDING"));
        } else {
            console.log("🔄 [Cartera] Buscando pagos a proveedores...");
            q = query(colRef, where("createdAt", ">", new Date(this.lastPaySync))); // Asumiendo que las creas o editas recientemente
        }

        unsubscribePayables = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) return;

            let hasChanges = false;

            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                const id = change.doc.id;

                if (change.type === 'removed' || data.status === 'PAID' || cleanNumber(data.amountPaid) >= cleanNumber(data.total)) {
                    if (this.runtimePayMap[id]) {
                        delete this.runtimePayMap[id];
                        hasChanges = true;
                    }
                } else if (change.type === 'added' || change.type === 'modified') {
                    this.runtimePayMap[id] = { id, ...data };
                    hasChanges = true;
                }
            });

            if (hasChanges) {
                console.log(`🔥 [Cartera] ${snapshot.docChanges().length} cambios en deudas de proveedores.`);
                localStorage.setItem(this.PAY_KEY, JSON.stringify({ map: this.runtimePayMap, lastSync: Date.now() }));
                this.calculateAndRender();
            }
        });
    },

    calculateAndRender() {
        // Agrupación de Clientes en Memoria RAM
        const clientMap = {};
        let totalRecAmount = 0;

        Object.values(this.runtimeRecMap).forEach(o => {
            const total = cleanNumber(o.total);
            const paid = cleanNumber(o.amountPaid);
            const balance = total - paid;

            if (balance > 0) {
                let name = o.userName;
                if (!name && o.billingInfo) name = o.billingInfo.name;
                if (!name && o.shippingData) name = o.shippingData.name;
                if (!name) name = `Cliente (ID: ${o.id.slice(0,4)})`;

                const key = o.userId || name; 
                
                if (!clientMap[key]) {
                    clientMap[key] = { id: key, realUserId: o.userId, name: name, count: 0, totalDebt: 0 };
                }
                clientMap[key].count++;
                clientMap[key].totalDebt += balance;
                totalRecAmount += balance;
            }
        });
        groupedReceivables = Object.values(clientMap).sort((a, b) => b.totalDebt - a.totalDebt);

        // Agrupación de Proveedores en Memoria RAM
        const providerMap = {};
        let totalPayAmount = 0;

        Object.values(this.runtimePayMap).forEach(p => {
            const total = cleanNumber(p.total);
            const paid = cleanNumber(p.amountPaid);
            const balance = total - paid;

            if (balance > 0) {
                const key = p.provider || "Varios";
                if (!providerMap[key]) {
                    providerMap[key] = { name: key, count: 0, totalDebt: 0 };
                }
                providerMap[key].count++;
                providerMap[key].totalDebt += balance;
                totalPayAmount += balance;
            }
        });
        groupedPayables = Object.values(providerMap).sort((a, b) => b.totalDebt - a.totalDebt);

        // Actualizar KPIs de la UI
        const bal = totalRecAmount - totalPayAmount;
        document.getElementById('total-receivable').textContent = formatMoney(totalRecAmount);
        document.getElementById('total-payable').textContent = formatMoney(totalPayAmount);
        document.getElementById('total-balance').textContent = formatMoney(bal);
        document.getElementById('total-balance').className = `text-2xl font-black ${bal >= 0 ? 'text-green-400' : 'text-red-400'}`;

        renderTables();
    }
};

// ==========================================================================
// RENDERIZADO VISUAL
// ==========================================================================

function renderTables() {
    const term = searchInput.value.toLowerCase();

    // Clientes
    const filteredRec = groupedReceivables.filter(c => c.name.toLowerCase().includes(term));
    listReceivable.innerHTML = "";
    if (filteredRec.length === 0) listReceivable.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-300 text-xs font-bold uppercase">Sin deudas.</td></tr>`;
    else {
        filteredRec.forEach(c => {
            listReceivable.innerHTML += `
                <tr class="hover:bg-slate-50 transition border-b border-gray-50 last:border-0 group">
                    <td class="px-8 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center font-bold text-xs uppercase">${c.name.charAt(0)}</div>
                            <span class="font-black text-xs uppercase text-brand-black">${c.name}</span>
                        </div>
                    </td>
                    <td class="px-8 py-4 text-center">
                        <span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-[10px] font-bold">${c.count} Facturas</span>
                    </td>
                    <td class="px-8 py-4 text-right font-black text-brand-black text-sm">${formatMoney(c.totalDebt)}</td>
                    <td class="px-8 py-4 text-center">
                        <button onclick="window.openDetails('${c.id}', '${c.name}', 'client', ${c.totalDebt})" class="bg-blue-50 text-blue-600 border border-blue-100 px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-blue-500 hover:text-white transition shadow-sm">
                            Ver Detalle
                        </button>
                    </td>
                </tr>`;
        });
    }

    // Proveedores
    const filteredPay = groupedPayables.filter(p => p.name.toLowerCase().includes(term));
    listPayable.innerHTML = "";
    if (filteredPay.length === 0) listPayable.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-300 text-xs font-bold uppercase">Sin deudas.</td></tr>`;
    else {
        filteredPay.forEach(p => {
            listPayable.innerHTML += `
                <tr class="hover:bg-slate-50 transition border-b border-gray-50 last:border-0 group">
                    <td class="px-8 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-red-50 text-red-400 flex items-center justify-center font-bold text-xs"><i class="fa-solid fa-truck"></i></div>
                            <span class="font-black text-xs uppercase text-brand-black">${p.name}</span>
                        </div>
                    </td>
                    <td class="px-8 py-4 text-center">
                        <span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-[10px] font-bold">${p.count} Cuentas</span>
                    </td>
                    <td class="px-8 py-4 text-right font-black text-brand-black text-sm">${formatMoney(p.totalDebt)}</td>
                    <td class="px-8 py-4 text-center">
                        <button onclick="window.openDetails('${p.name}', '${p.name}', 'supplier', ${p.totalDebt})" class="bg-blue-50 text-blue-600 border border-blue-100 px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-blue-500 hover:text-white transition shadow-sm">
                            Ver Detalle
                        </button>
                    </td>
                </tr>`;
        });
    }
}

searchInput.addEventListener('input', renderTables);

// ==========================================================================
// DETALLES Y PAGINACIÓN DEL MODAL
// ==========================================================================

window.openDetails = (id, name, type, totalDebt) => {
    currentDetailEntity = { id, name, type, totalDebt };
    lastDetailDoc = null;
    
    document.getElementById('dt-title').textContent = name;
    document.getElementById('dt-subtitle').textContent = type === 'client' ? 'Historial de Deudas (Cliente)' : 'Historial de Pagos (Proveedor)';
    document.getElementById('dt-total-debt').textContent = formatMoney(totalDebt);
    
    dtList.innerHTML = "";
    detailsModal.classList.remove('hidden');
    
    loadEntityDetails();
};

window.loadMoreDetails = () => loadEntityDetails();

async function loadEntityDetails() {
    const { id, name, type } = currentDetailEntity;
    dtLoadMore.classList.add('hidden');
    
    if(!lastDetailDoc) dtList.innerHTML = `<tr><td colspan="5" class="p-4 text-center"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</td></tr>`;

    try {
        let q;
        if (type === 'client') {
            const collectionRef = collection(db, "orders");
            let constraints = [
                where("paymentStatus", "in", ["PENDING", "PARTIAL"]),
                orderBy("createdAt", "asc"),
                limit(DETAILS_PAGE_SIZE)
            ];
            
            if (id.length > 20 && !id.includes(" ")) { 
                constraints.unshift(where("userId", "==", id));
            } else {
                constraints.unshift(where("userName", "==", name));
            }

            if (lastDetailDoc) constraints.push(startAfter(lastDetailDoc));
            q = query(collectionRef, ...constraints);

        } else {
            let constraints = [
                where("provider", "==", name),
                where("status", "==", "PENDING"),
                orderBy("dueDate", "asc"),
                limit(DETAILS_PAGE_SIZE)
            ];
            if (lastDetailDoc) constraints.push(startAfter(lastDetailDoc));
            q = query(collection(db, "payables"), ...constraints);
        }

        const snap = await getDocs(q);
        
        if (!lastDetailDoc) dtList.innerHTML = ""; 

        if (snap.empty && !lastDetailDoc) {
            dtList.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-gray-400">No hay detalles pendientes.</td></tr>`;
            return;
        }

        lastDetailDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length === DETAILS_PAGE_SIZE) dtLoadMore.classList.remove('hidden');

        snap.forEach(d => {
            const data = d.data();
            if(type === 'client' && (data.status === 'CANCELADO' || data.status === 'RECHAZADO')) return;

            const total = cleanNumber(data.total);
            const paid = cleanNumber(data.amountPaid);
            const balance = total - paid;
            
            const date = type === 'client' ? data.createdAt : data.dueDate;
            let dateString = '-';
            if (date) {
                 dateString = date.toDate ? date.toDate().toLocaleDateString() : new Date(date).toLocaleDateString();
            }
            
            const ref = type === 'client' ? `#${d.id.slice(0,6)}` : (data.description || "N/A");

            dtList.innerHTML += `
                <tr class="border-b border-gray-50 last:border-0 hover:bg-slate-50">
                    <td class="p-3">
                        <p class="font-bold text-brand-black text-xs uppercase">${ref}</p>
                        <p class="text-[9px] text-gray-400 font-bold">${dateString}</p>
                    </td>
                    <td class="p-3 text-right text-xs font-bold text-gray-400">${formatMoney(total)}</td>
                    <td class="p-3 text-right text-xs font-bold text-green-600">${formatMoney(paid)}</td>
                    <td class="p-3 text-right text-xs font-black text-brand-black">${formatMoney(balance)}</td>
                    <td class="p-3 text-center">
                        <button onclick="window.openPaymentModalSingle('${d.id}', '${balance}')" class="bg-white border border-gray-200 text-gray-500 w-8 h-8 rounded-lg hover:border-brand-black hover:text-brand-black transition flex items-center justify-center mx-auto" title="Pagar solo esta">
                            <i class="fa-solid fa-money-bill-wave text-xs"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

    } catch (e) {
        console.error(e);
        dtList.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-400 text-xs">Error cargando detalles (Verifica índices).</td></tr>`;
    }
}

// ==========================================================================
// MODAL DE PAGO (Transaccional)
// ==========================================================================

window.openPaymentModalGlobal = () => {
    document.getElementById('pay-target-id').value = 'GLOBAL';
    document.getElementById('pay-target-mode').value = 'fifo';
    document.getElementById('pay-amount').value = "";
    document.getElementById('pay-modal-title').textContent = `Abono Global a ${currentDetailEntity.name}`;
    paymentModal.classList.remove('hidden');
};

window.openPaymentModalSingle = (docId, balance) => {
    document.getElementById('pay-target-id').value = docId;
    document.getElementById('pay-target-mode').value = 'single';
    // Autocompletamos con la deuda exacta de ese documento
    document.getElementById('pay-amount').value = formatMoney(balance); 
    document.getElementById('pay-modal-title').textContent = `Pagar Documento Específico`;
    paymentModal.classList.remove('hidden');
};

paymentForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = paymentForm.querySelector('button');
    const originalText = btn.innerText;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

    const mode = document.getElementById('pay-target-mode').value;
    const targetId = document.getElementById('pay-target-id').value;
    const accId = accountSelect.value;
    const amount = cleanNumber(document.getElementById('pay-amount').value);
    const { id: entityId, name: entityName, type } = currentDetailEntity;

    if(!accId) { alert("Seleccione cuenta"); btn.disabled=false; btn.innerText = originalText; return; }
    if(amount <= 0) { alert("Monto inválido"); btn.disabled=false; btn.innerText = originalText; return; }

    try {
        let docsToProcess = [];

        if (mode === 'single') {
            docsToProcess.push({ id: targetId, ref: doc(db, type === 'client' ? 'orders' : 'payables', targetId) });
        } else {
            let qDocs;
            if (type === 'client') {
                const colRef = collection(db, "orders");
                if (entityId.length > 20 && !entityId.includes(" ")) {
                    qDocs = query(colRef, where("userId", "==", entityId), where("paymentStatus", "in", ["PENDING", "PARTIAL"]), orderBy("createdAt", "asc"));
                } else {
                    qDocs = query(colRef, where("userName", "==", entityName), where("paymentStatus", "in", ["PENDING", "PARTIAL"]), orderBy("createdAt", "asc"));
                }
            } else {
                qDocs = query(collection(db, "payables"), where("provider", "==", entityName), where("status", "==", "PENDING"), orderBy("dueDate", "asc"));
            }
            
            const qSnap = await getDocs(qDocs);
            
            let moneySimulated = amount;
            for (const d of qSnap.docs) {
                if (moneySimulated <= 0) break; 

                const data = d.data();
                if (type === 'client' && (data.status === 'CANCELADO' || data.status === 'RECHAZADO')) continue;

                const currentPaid = cleanNumber(data.amountPaid);
                const total = cleanNumber(data.total);
                const debt = total - currentPaid;

                if (debt > 0) {
                    docsToProcess.push({ id: d.id, ref: d.ref });
                    moneySimulated -= debt;
                }
            }
        }

        if (docsToProcess.length === 0) throw "No hay deudas pendientes para aplicar el pago.";

        await runTransaction(db, async (t) => {
            const accRef = doc(db, "accounts", accId);
            const readPromises = [t.get(accRef), ...docsToProcess.map(item => t.get(item.ref))];
            const snapshots = await Promise.all(readPromises);

            const accDoc = snapshots[0];
            const docSnaps = snapshots.slice(1);

            if(!accDoc.exists()) throw "Cuenta no existe";

            let remainingMoney = amount;
            let totalApplied = 0;

            for (const dSnap of docSnaps) {
                if (!dSnap.exists()) continue;
                if (remainingMoney <= 0 && mode === 'fifo') break;

                const data = dSnap.data();
                const currentPaid = cleanNumber(data.amountPaid);
                const total = cleanNumber(data.total);
                const debt = total - currentPaid;

                if (debt <= 0) continue; 

                if (mode === 'single' && amount > debt + 100) throw `El monto excede la deuda ($${debt.toLocaleString()})`;

                let apply = mode === 'single' ? amount : Math.min(remainingMoney, debt);
                const newPaid = currentPaid + apply;
                const isPaid = newPaid >= total - 100; 

                const updates = { amountPaid: newPaid, lastPaymentDate: new Date(), updatedAt: new Date() }; // <-- updatedAt vital para el onSnapshot
                if (type === 'client') {
                    updates.paymentStatus = isPaid ? 'PAID' : 'PARTIAL';
                } else {
                    updates.status = isPaid ? 'PAID' : 'PENDING';
                    updates.balance = total - newPaid;
                }
                
                t.update(dSnap.ref, updates);
                
                remainingMoney -= apply;
                totalApplied += apply;
            }

            const currentAccBal = cleanNumber(accDoc.data().balance);
            const newAccBal = type === 'client' ? (currentAccBal + totalApplied) : (currentAccBal - totalApplied);
            t.update(accRef, { balance: newAccBal });

            const expRef = doc(collection(db, "expenses"));
            t.set(expRef, {
                description: type === 'client' ? `Abono Cliente: ${entityName}` : `Pago Proveedor: ${entityName}`,
                amount: totalApplied,
                type: type === 'client' ? 'INCOME' : 'EXPENSE',
                category: type === 'client' ? "Ingreso Ventas" : "Pago Proveedores",
                paymentMethod: accDoc.data().name,
                date: new Date(),
                createdAt: new Date(),
                supplierName: entityName,
                mode: mode 
            });
        });

        alert("✅ Pago registrado correctamente.");
        window.closeModal('payment-modal');
        
        if(currentDetailEntity) {
            const newDebt = currentDetailEntity.totalDebt - amount; 
            document.getElementById('dt-total-debt').textContent = formatMoney(newDebt > 0 ? newDebt : 0);
            lastDetailDoc = null;
            loadEntityDetails(); // Recargar el modal interior
        }
        
        // No necesitamos recargar las tablas globales, el onSnapshot lo hará al detectar los `updatedAt` modificados.

    } catch (e) {
        console.error(e);
        alert("Error: " + e.message || e);
    } finally {
        btn.disabled = false; btn.innerText = originalText;
    }
};

// Crear Deuda Manual
document.getElementById('create-payable-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; 
    const provider = document.getElementById('new-pay-provider').value;
    const desc = document.getElementById('new-pay-desc').value;
    const total = cleanNumber(document.getElementById('new-pay-total').value);
    const date = document.getElementById('new-pay-date').value;
    try {
        await addDoc(collection(db, "payables"), {
            provider, description: desc, total, dueDate: date,
            amountPaid: 0, balance: total, status: 'PENDING', createdAt: new Date()
        });
        alert("✅ Deuda registrada");
        window.closeModal('create-payable-modal');
        // El onSnapshot de payables agregará esta deuda al instante
    } catch (e) { alert("Error: " + e.message); }
    finally { btn.disabled = false; }
};

window.switchTab = (tab) => {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active', 'bg-slate-900', 'text-white');
        b.classList.add('bg-white', 'text-gray-400');
    });
    event.target.classList.add('active', 'bg-slate-900', 'text-white');
    event.target.classList.remove('bg-white', 'text-gray-400');
    document.getElementById('tab-receivable').classList.add('hidden');
    document.getElementById('tab-payable').classList.add('hidden');
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
};

window.openCreatePayable = () => {
    document.getElementById('create-payable-form').reset();
    document.getElementById('create-payable-modal').classList.remove('hidden');
};

window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

// Iniciar Motor
SmartCarteraSync.init();