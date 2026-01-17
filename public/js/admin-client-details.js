import { db, doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, runTransaction, Timestamp } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const params = new URLSearchParams(window.location.search);
const clientId = params.get('id');

if (!clientId) window.location.href = 'clients.html';

// REFERENCIAS DOM
const els = {
    // Header Info
    initials: document.getElementById('client-initials'),
    nameBig: document.getElementById('client-name-big'),
    emailBig: document.getElementById('client-email-big'),
    tagsContainer: document.getElementById('client-tags'),
    ltv: document.getElementById('stat-ltv'),
    balance: document.getElementById('stat-balance'), // Nuevo stat
    
    // Formulario
    inpName: document.getElementById('edit-name'),
    inpPhone: document.getElementById('edit-phone'),
    inpDoc: document.getElementById('edit-doc'),
    inpDept: document.getElementById('edit-department'),
    inpCity: document.getElementById('edit-city'),
    inpAddress: document.getElementById('edit-address'),
    inpNotes: document.getElementById('edit-notes'),
    btnUpdate: document.getElementById('btn-update-client'),
    
    // Listas
    ordersList: document.getElementById('client-orders-list'),
    pendingList: document.getElementById('pending-invoices-list'), // Nueva lista
    snList: document.getElementById('client-sn-list'),

    // Pagos
    debtAmount: document.getElementById('debt-amount'),
    modalDebt: document.getElementById('modal-debt-amount'),
    payAccount: document.getElementById('pay-account'),
    payAmount: document.getElementById('pay-amount'),
    payNote: document.getElementById('pay-note'),
    payForm: document.getElementById('payment-form'),
    paymentModal: document.getElementById('payment-modal')
};

let clientData = null;
let pendingOrders = []; // Almacenar órdenes con deuda para procesar pagos

// --- FORMATO MONEDA INPUT ---
document.querySelectorAll('.currency-input').forEach(input => {
    input.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value === "") { e.target.value = ""; return; }
        e.target.value = "$" + parseInt(value, 10).toLocaleString('es-CO');
    });
});
const getCleanVal = (val) => val ? parseInt(val.replace(/\D/g, ""), 10) : 0;


// --- 1. CARGA INICIAL ---
async function init() {
    await Promise.all([loadDepartmentsAPI(), loadClientData(), loadAccounts()]);
}

// --- 2. CARGAR CUENTAS TESORERÍA ---
async function loadAccounts() {
    try {
        const q = query(collection(db, "accounts"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        els.payAccount.innerHTML = '<option value="">Seleccione Cuenta Destino...</option>';
        snap.forEach(d => {
            const acc = d.data();
            els.payAccount.innerHTML += `<option value="${d.id}">${acc.name}</option>`;
        });
    } catch (e) { console.error("Error loading accounts:", e); }
}

async function loadDepartmentsAPI() {
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        depts.sort((a, b) => a.name.localeCompare(b.name));
        els.inpDept.innerHTML = '<option value="">Seleccione...</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; opt.textContent = d.name; opt.dataset.name = d.name;
            els.inpDept.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}
els.inpDept.addEventListener('change', (e) => loadCitiesAPI(e.target.value));
async function loadCitiesAPI(deptId, cityToSelect = null) {
    els.inpCity.innerHTML = '<option value="">Cargando...</option>'; els.inpCity.disabled = true;
    if (!deptId) return;
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        const cities = await res.json();
        cities.sort((a, b) => a.name.localeCompare(b.name));
        els.inpCity.innerHTML = '<option value="">Seleccione Ciudad...</option>';
        cities.forEach(c => {
            const opt = document.createElement('option'); opt.value = c.name; opt.textContent = c.name; els.inpCity.appendChild(opt);
        });
        els.inpCity.disabled = false;
        if (cityToSelect) els.inpCity.value = cityToSelect;
    } catch (e) { console.error(e); }
}

async function loadClientData() {
    try {
        const snap = await getDoc(doc(db, "users", clientId));
        if (!snap.exists()) { alert("Cliente no encontrado"); return; }
        clientData = snap.data();
        
        // Render Header & Form
        els.nameBig.textContent = clientData.name || "Sin Nombre";
        els.initials.textContent = (clientData.name || "U").charAt(0).toUpperCase();
        els.emailBig.textContent = clientData.email || "";
        
        els.inpName.value = clientData.name || "";
        els.inpPhone.value = clientData.phone || "";
        els.inpDoc.value = clientData.document || "";
        els.inpNotes.value = clientData.adminNotes || "";
        
        // Dirección
        const addr = (clientData.addresses && clientData.addresses[0]) || {};
        els.inpAddress.value = addr.address || clientData.address || "";
        
        if (addr.dept || clientData.dept) {
            // Lógica para preseleccionar departamento si existe nombre
            // (Simplificada para no extender código, idealmente buscar ID por nombre)
        }

        loadClientOrders();

    } catch (e) { console.error(e); }
}

// --- 3. CARGAR PEDIDOS Y CALCULAR DEUDA ---
async function loadClientOrders() {
    els.ordersList.innerHTML = `<tr><td colspan="6" class="p-8 text-center"><i class="fa-solid fa-spinner fa-spin text-brand-cyan"></i></td></tr>`;
    
    try {
        const q = query(collection(db, "orders"), where("userId", "==", clientId), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);

        els.ordersList.innerHTML = "";
        els.pendingList.innerHTML = "";
        
        let realTotal = 0;
        let totalDebt = 0;
        pendingOrders = [];

        if(snap.empty) {
            els.ordersList.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-xs text-gray-400 font-bold uppercase">Sin historial.</td></tr>`;
            els.pendingList.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-xs text-gray-400 font-bold uppercase">No hay deudas pendientes.</td></tr>`;
            return;
        }

        snap.forEach(d => {
            const o = { id: d.id, ...d.data() };
            
            // Stats Generales
            if(o.status !== 'CANCELADO') realTotal += (o.total || 0);

            // Cálculo de Deuda
            const paid = o.amountPaid || 0;
            const total = o.total || 0;
            const balance = total - paid;
            
            // Si está pendiente de pago (y no cancelado)
            // Consideramos deuda si paymentStatus no es PAID, o si hay balance positivo
            if (o.status !== 'CANCELADO' && balance > 0) {
                totalDebt += balance;
                pendingOrders.push({ ...o, balance }); // Guardar para procesar pago FIFO
                
                // Render en Lista de Pendientes
                els.pendingList.innerHTML += `
                    <tr class="border-b border-gray-50 hover:bg-red-50/30 transition">
                        <td class="px-6 py-4 font-mono text-gray-500">#${o.id.slice(0,6)}</td>
                        <td class="px-6 py-4 font-bold text-gray-600">${o.createdAt?.toDate().toLocaleDateString('es-CO')}</td>
                        <td class="px-6 py-4 text-right font-black">$${total.toLocaleString('es-CO')}</td>
                        <td class="px-6 py-4 text-right text-green-600">$${paid.toLocaleString('es-CO')}</td>
                        <td class="px-6 py-4 text-right text-red-500 font-black">$${balance.toLocaleString('es-CO')}</td>
                    </tr>
                `;
            }

            // Render en Historial General
            let payBadge = `<span class="text-[9px] font-black uppercase text-red-500 bg-red-50 px-2 py-1 rounded border border-red-100">Pendiente</span>`;
            if (o.paymentStatus === 'PAID' || balance <= 0) payBadge = `<span class="text-[9px] font-black uppercase text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Pagado</span>`;
            else if (paid > 0) payBadge = `<span class="text-[9px] font-black uppercase text-orange-500 bg-orange-50 px-2 py-1 rounded border border-orange-100">Parcial</span>`;

            els.ordersList.innerHTML += `
                <tr class="hover:bg-slate-50 transition border-b border-gray-50 group">
                    <td class="px-8 py-6 font-mono text-xs text-gray-500">#${o.id.slice(0,6)}</td>
                    <td class="px-8 py-6 text-xs font-bold">${o.createdAt?.toDate().toLocaleDateString('es-CO')}</td>
                    <td class="px-8 py-6 text-center"><span class="px-3 py-1 rounded-full text-[9px] font-black uppercase border border-gray-200 bg-gray-50 text-gray-500">${o.status}</span></td>
                    <td class="px-8 py-6 text-center">${payBadge}</td>
                    <td class="px-8 py-6 text-right font-black text-brand-black text-sm">$${total.toLocaleString('es-CO')}</td>
                    <td class="px-8 py-6 text-center">
                        <button onclick="window.openOrderModal('${o.id}')" class="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm"><i class="fa-solid fa-eye text-xs"></i></button>
                    </td>
                </tr>
            `;
            
            // Extract Serials
            if(o.items) {
                o.items.forEach(item => {
                    if(item.sns && item.sns.length > 0) {
                        item.sns.forEach(sn => {
                            if(!sn) return;
                            els.snList.innerHTML += `<div class="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between"><div><p class="text-[8px] font-black text-gray-300 uppercase tracking-widest">Serial</p><p class="text-xs font-mono font-bold text-brand-black">${sn}</p><p class="text-[9px] font-bold text-brand-cyan mt-0.5 uppercase truncate max-w-[150px]">${item.name}</p></div><i class="fa-solid fa-barcode text-gray-200 text-xl"></i></div>`;
                        });
                    }
                });
            }
        });

        // Actualizar UI Deuda
        els.ltv.textContent = `$${realTotal.toLocaleString('es-CO')}`;
        els.balance.textContent = `$${totalDebt.toLocaleString('es-CO')}`;
        els.debtAmount.textContent = `$${totalDebt.toLocaleString('es-CO')}`;
        els.modalDebt.textContent = `$${totalDebt.toLocaleString('es-CO')}`;

        // Ordenar pendientes FIFO (La más vieja primero para pagar esa)
        pendingOrders.sort((a, b) => a.createdAt.seconds - b.createdAt.seconds);

    } catch (e) { console.error("Error orders:", e); }
}

// --- 4. PROCESAR PAGO (LÓGICA FIFO) ---
els.payForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = els.payForm.querySelector('button');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

    const amount = getCleanVal(els.payAmount.value);
    const accountId = els.payAccount.value;
    const note = els.payNote.value || "Abono Cliente";

    if (!accountId) { alert("Seleccione cuenta destino"); btn.disabled=false; return; }
    if (amount <= 0) { alert("Monto inválido"); btn.disabled=false; return; }
    
    // Validación básica visual
    const totalDebt = getCleanVal(els.debtAmount.textContent);
    if (amount > totalDebt) { 
        if(!confirm(`El pago ($${amount.toLocaleString()}) supera la deuda total. ¿Desea continuar?`)) {
            btn.disabled = false; btn.innerHTML = "Confirmar Ingreso"; return; 
        }
    }

try {
        await runTransaction(db, async (transaction) => {
            // 1. Leer Cuenta
            const accRef = doc(db, "accounts", accountId);
            const accDoc = await transaction.get(accRef);
            if (!accDoc.exists()) throw "Cuenta no existe";
            const accData = accDoc.data();

            // 2. Leer Órdenes Pendientes
            const ordersToUpdate = [];
            for (const order of pendingOrders) {
                const orderRef = doc(db, "orders", order.id);
                const orderDoc = await transaction.get(orderRef);
                if (orderDoc.exists()) {
                    ordersToUpdate.push({ ref: orderRef, data: orderDoc.data() });
                }
            }

            // --- FASE ESCRITURA ---

            // A. Actualizar Saldo Cuenta
            const newBalance = (accData.balance || 0) + amount;
            transaction.update(accRef, { balance: newBalance });

            // B. REGISTRAR MOVIMIENTO EN EXPENSES (PARA QUE SALGA EN TREASURY)
            // Usamos monto negativo o categoría 'Ingreso' para diferenciar, 
            // pero para que salga en el extracto de esa cuenta, paymentMethod debe ser el nombre de la cuenta.
            const incomeRef = doc(collection(db, "expenses"));
            transaction.set(incomeRef, {
                description: `Pago Cliente: ${clientData.name || 'Cliente'}`, // Info clara
                amount: -amount, // Truco: Guardamos negativo para indicar Ingreso en un log de gastos, o lo manejamos visualmente
                // O mejor: Lo guardamos positivo pero con categoría 'Ingreso' y ajustamos treasury para leerlo
                category: "Ingreso Ventas", 
                paymentMethod: accData.name, // CLAVE: Esto vincula con el filtro de treasury.html
                date: Timestamp.now(),
                createdAt: Timestamp.now(),
                supplierName: clientData.name || "Cliente Final"
            });

            // C. Distribuir Pago en Órdenes (FIFO)
            let remaining = amount;
            for (const { ref, data } of ordersToUpdate) {
                if (remaining <= 0) break;

const currentPaid = data.amountPaid || 0;
                 const total = data.total || 0;
                 const currentBalance = total - currentPaid;
                 if (currentBalance <= 0) continue;
                 const paymentForThis = Math.min(remaining, currentBalance);
                 const newPaid = currentPaid + paymentForThis;
                 const updates = { amountPaid: newPaid, lastPaymentDate: Timestamp.now() };
                 if (newPaid >= total) updates.paymentStatus = 'PAID';
                 else updates.paymentStatus = 'PARTIAL';
                 transaction.update(ref, updates);
                 remaining -= paymentForThis;
            }
        });

        alert("✅ Pago registrado exitosamente");
        els.paymentModal.classList.add('hidden');
        els.payForm.reset();
        loadClientOrders(); // Recargar datos de la interfaz

    } catch (e) {
        console.error("Transaction failed: ", e);
        alert("Error al procesar el pago: " + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = "Confirmar Ingreso";
    }
};

// --- MODAL DETALLE PEDIDO ---
window.openOrderModal = async (orderId) => {
    try {
        const snap = await getDoc(doc(db, "orders", orderId));
        if(!snap.exists()) return;
        const o = snap.data();
        
        const el = (id) => document.getElementById(id);
        el('modal-order-id').textContent = `#${snap.id.slice(0,8).toUpperCase()}`;
        el('modal-order-date').textContent = o.createdAt?.toDate().toLocaleString();
        el('modal-total').textContent = `$${(o.total || 0).toLocaleString('es-CO')}`;
        el('modal-status-badge').textContent = o.status;
        
        const itemsDiv = el('modal-items-list');
        itemsDiv.innerHTML = "";
        o.items.forEach(i => {
            itemsDiv.innerHTML += `<div class="flex justify-between p-2 bg-gray-50 rounded mb-2"><span class="text-xs font-bold">${i.quantity}x ${i.name}</span><span class="text-xs text-brand-cyan">$${(i.price || 0).toLocaleString()}</span></div>`;
        });
        
        el('order-modal').classList.remove('hidden');
    } catch(e) { console.error(e); }
};

// --- INIT ---
init();