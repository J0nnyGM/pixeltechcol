import { db, doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy } from './firebase-init.js';
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
    ordersCount: document.getElementById('stat-orders-count'),
    
    // Formulario Edición
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
    snList: document.getElementById('client-sn-list'),

    // Modal Orden
    modal: document.getElementById('order-modal'),
    mId: document.getElementById('modal-order-id'),
    mDate: document.getElementById('modal-order-date'),
    mStatus: document.getElementById('modal-status-badge'),
    mShipping: document.getElementById('modal-shipping-info'),
    mItems: document.getElementById('modal-items-list'),
    mTotal: document.getElementById('modal-total'),
    mIcon: document.getElementById('modal-icon')
};

let clientData = null;

// --- 1. API COLOMBIA (Departamentos y Ciudades) ---
async function loadDepartmentsAPI() {
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        depts.sort((a, b) => a.name.localeCompare(b.name));

        els.inpDept.innerHTML = '<option value="">Seleccione...</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; 
            opt.textContent = d.name;
            opt.dataset.name = d.name; 
            els.inpDept.appendChild(opt);
        });
    } catch (e) { console.error("Error API Colombia:", e); }
}

els.inpDept.addEventListener('change', (e) => loadCitiesAPI(e.target.value));

async function loadCitiesAPI(deptId, cityToSelect = null) {
    els.inpCity.innerHTML = '<option value="">Cargando...</option>';
    els.inpCity.disabled = true;
    
    if (!deptId) {
        els.inpCity.innerHTML = '<option value="">Seleccione Depto...</option>';
        return;
    }

    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        const cities = await res.json();
        cities.sort((a, b) => a.name.localeCompare(b.name));

        els.inpCity.innerHTML = '<option value="">Seleccione Ciudad...</option>';
        cities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name; 
            opt.textContent = c.name;
            els.inpCity.appendChild(opt);
        });
        els.inpCity.disabled = false;

        if (cityToSelect) els.inpCity.value = cityToSelect;

    } catch (e) { console.error("Error API Ciudades:", e); }
}

// --- 2. CARGAR DATOS DEL CLIENTE ---
async function loadClientData() {
    await loadDepartmentsAPI();

    try {
        const snap = await getDoc(doc(db, "users", clientId));
        if (!snap.exists()) { alert("Cliente no encontrado"); return; }
        
        clientData = snap.data();
        
        // Header
        const fullName = clientData.name || clientData.fullName || "Sin Nombre";
        els.initials.textContent = fullName.charAt(0).toUpperCase();
        els.nameBig.textContent = fullName;
        els.emailBig.textContent = clientData.email || "Sin Correo";
        
        // Formulario
        els.inpName.value = fullName;
        els.inpPhone.value = clientData.phone || clientData.contactPhone || "";
        els.inpDoc.value = clientData.document || clientData.cedula || clientData.nit || "";
        els.inpNotes.value = clientData.adminNotes || "";

        // Dirección
        let targetAddr = null;
        if (clientData.addresses && Array.isArray(clientData.addresses) && clientData.addresses.length > 0) {
            targetAddr = clientData.addresses.find(a => a.isDefault) || clientData.addresses[0];
        } else if (clientData.address) {
            targetAddr = {
                address: clientData.address,
                dept: clientData.department || clientData.dept,
                city: clientData.city
            };
        }

        if (targetAddr) {
            els.inpAddress.value = targetAddr.address || "";
            if (targetAddr.dept) {
                const options = Array.from(els.inpDept.options);
                const foundOpt = options.find(o => o.dataset.name && o.dataset.name.toLowerCase() === targetAddr.dept.toLowerCase());
                if (foundOpt) {
                    els.inpDept.value = foundOpt.value; 
                    await loadCitiesAPI(foundOpt.value, targetAddr.city); 
                }
            }
        }

        loadClientOrders();

    } catch (e) { console.error("Error cargando cliente:", e); }
}

// --- 3. ACTUALIZAR CLIENTE ---
els.btnUpdate.onclick = async () => {
    if(!els.inpName.value || !els.inpPhone.value) return alert("Nombre y Teléfono son obligatorios.");

    const btn = els.btnUpdate;
    btn.disabled = true; 
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    try {
        const deptName = els.inpDept.options[els.inpDept.selectedIndex]?.dataset.name || "";
        
        const updates = {
            name: els.inpName.value,
            phone: els.inpPhone.value,
            document: els.inpDoc.value, 
            adminNotes: els.inpNotes.value,
            lastUpdated: new Date()
        };

        let addresses = clientData.addresses || [];
        const formAddr = {
            alias: "Principal (Admin)",
            address: els.inpAddress.value,
            dept: deptName, 
            city: els.inpCity.value,
            isDefault: true
        };

        if (addresses.length > 0) {
            const defIdx = addresses.findIndex(a => a.isDefault);
            if (defIdx >= 0) addresses[defIdx] = { ...addresses[defIdx], ...formAddr };
            else addresses[0] = { ...addresses[0], ...formAddr, isDefault: true };
        } else {
            addresses = [formAddr];
        }
        
        updates.addresses = addresses;

        await updateDoc(doc(db, "users", clientId), updates);
        els.nameBig.textContent = els.inpName.value;
        clientData = { ...clientData, ...updates }; 
        alert("✅ Expediente actualizado correctamente");

    } catch(e) { 
        console.error(e);
        alert("Error al guardar: " + e.message); 
    } finally { 
        btn.disabled = false; btn.innerText = "Guardar Cambios"; 
    }
};

// --- 4. CARGAR PEDIDOS ---
async function loadClientOrders() {
    els.ordersList.innerHTML = `<tr><td colspan="5" class="p-8 text-center"><i class="fa-solid fa-spinner fa-spin text-brand-cyan"></i></td></tr>`;
    
    try {
        const q = query(collection(db, "orders"), where("userId", "==", clientId), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);

        els.ordersList.innerHTML = "";
        let realTotal = 0;
        let realCount = 0;

        if(snap.empty) {
            els.ordersList.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-xs text-gray-400 font-bold uppercase">Sin historial de compras.</td></tr>`;
            return;
        }

        snap.forEach(d => {
            const o = d.data();
            if(o.status !== 'CANCELADO' && o.status !== 'RECHAZADO') {
                realTotal += (o.total || 0);
                realCount++;
            }
            renderOrderRow(d.id, o);
            extractSerialNumbers(o);
        });

        els.ltv.textContent = `$${realTotal.toLocaleString('es-CO')}`;
        els.ordersCount.textContent = realCount;
        renderTags(realTotal, realCount);

    } catch (e) { console.error("Error orders:", e); }
}

function renderTags(total, count) {
    els.tagsContainer.innerHTML = "";
    if (clientData.role === 'admin') els.tagsContainer.innerHTML += `<span class="px-2 py-1 rounded bg-purple-100 text-purple-600 text-[9px] font-black uppercase border border-purple-200">Admin</span>`;
    
    let statusTag = '<span class="px-2 py-1 rounded bg-slate-100 text-slate-500 text-[9px] font-black uppercase border border-gray-200">Nuevo</span>';
    if (total > 5000000) statusTag = '<span class="px-2 py-1 rounded bg-amber-100 text-amber-600 text-[9px] font-black uppercase border border-amber-200">VIP</span>';
    else if (count > 0) statusTag = '<span class="px-2 py-1 rounded bg-blue-100 text-blue-600 text-[9px] font-black uppercase border border-blue-200">Cliente</span>';

    els.tagsContainer.innerHTML += statusTag;
}

function renderOrderRow(id, order) {
    let badgeClass = "bg-yellow-50 text-yellow-600 border-yellow-200";
    if(order.status === 'DESPACHADO' || order.status === 'COMPLETADO') badgeClass = "bg-green-50 text-green-600 border-green-200";
    if(order.status === 'CANCELADO') badgeClass = "bg-red-50 text-red-600 border-red-200";
    
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 transition border-b border-gray-50 last:border-0";
    tr.innerHTML = `
        <td class="px-8 py-6">
            <p class="font-black text-xs uppercase text-brand-black">#${id.slice(0,6)}</p>
            <p class="text-[9px] text-gray-400 font-bold">${order.items?.length || 0} items</p>
        </td>
        <td class="px-8 py-6 text-xs font-bold text-gray-500">${order.createdAt?.toDate().toLocaleDateString('es-CO')}</td>
        <td class="px-8 py-6 text-center"><span class="px-3 py-1 rounded-full text-[9px] font-black uppercase border ${badgeClass}">${order.status || 'Pendiente'}</span></td>
        <td class="px-8 py-6 text-right font-black text-brand-black text-sm">$${(order.total || 0).toLocaleString('es-CO')}</td>
        <td class="px-8 py-6 text-center">
            <button onclick="window.openOrderModal('${id}')" class="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition flex items-center justify-center mx-auto shadow-sm">
                <i class="fa-solid fa-eye text-xs"></i>
            </button>
        </td>
    `;
    els.ordersList.appendChild(tr);
}

function extractSerialNumbers(order) {
    if(!order.items) return;
    order.items.forEach(item => {
        if(item.sns && item.sns.length > 0) {
            item.sns.forEach(sn => {
                if(!sn) return;
                els.snList.innerHTML += `
                    <div class="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p class="text-[8px] font-black text-gray-300 uppercase tracking-widest">Serial</p>
                            <p class="text-xs font-mono font-bold text-brand-black">${sn}</p>
                            <p class="text-[9px] font-bold text-brand-cyan mt-0.5 uppercase truncate max-w-[150px]">${item.name}</p>
                        </div>
                        <i class="fa-solid fa-barcode text-gray-200 text-xl"></i>
                    </div>`;
            });
        }
    });
}

// --- 5. MODAL DETALLE PEDIDO ---
window.openOrderModal = async (orderId) => {
    try {
        const snap = await getDoc(doc(db, "orders", orderId));
        if(!snap.exists()) return;
        const o = snap.data();

        els.mIcon.innerHTML = o.source === 'TIENDA' ? '<i class="fa-solid fa-globe text-brand-cyan"></i>' : '<i class="fa-solid fa-store text-brand-black"></i>';
        els.mId.textContent = `#${snap.id.slice(0,8).toUpperCase()}`;
        els.mDate.textContent = o.createdAt?.toDate().toLocaleString('es-CO');
        
        els.mStatus.textContent = o.status || 'PENDIENTE';
        let bClass = "bg-yellow-50 text-yellow-600 border-yellow-200";
        if (o.status === 'DESPACHADO') bClass = "bg-green-50 text-green-600 border-green-200";
        els.mStatus.className = `text-xs font-black uppercase px-3 py-1 rounded-full border ${bClass}`;

        // --- LÓGICA DE VISUALIZACIÓN DE ENVÍO RESTAURADA ---
        // Prioridad: Guía -> Dirección
        const sData = o.shippingData || {};
        const addressStr = sData.address || o.address || "Retiro en Tienda";
        const cityStr = sData.city || o.city || "";
        
        const shipInfo = o.shippingTracking 
            ? `${o.shippingCarrier || 'Envío'} - ${o.shippingTracking}` 
            : (cityStr ? `${addressStr} (${cityStr})` : addressStr);

        els.mShipping.textContent = shipInfo;
        // ----------------------------------------------------

        els.mItems.innerHTML = "";
        o.items.forEach(i => {
            els.mItems.innerHTML += `
                <div class="flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-gray-100">
                    <div class="w-8 h-8 bg-white rounded-lg flex items-center justify-center font-black text-xs shadow-sm text-gray-400">${i.quantity}x</div>
                    <div class="flex-grow">
                        <p class="text-xs font-black uppercase text-brand-black line-clamp-1">${i.name || i.productName}</p>
                    </div>
                    <p class="text-xs font-bold text-brand-cyan">$${(i.price || 0).toLocaleString('es-CO')}</p>
                </div>
            `;
        });

        els.mTotal.textContent = `$${(o.total || 0).toLocaleString('es-CO')}`;
        els.modal.classList.remove('hidden');
    } catch(e) { console.error(e); }
};

// Iniciar Carga
loadClientData();