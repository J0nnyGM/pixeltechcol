import { auth, db, onAuthStateChanged, doc, getDoc, updateDoc, collection, getDocs, query, where, orderBy, limit, startAfter, signOut} from "./firebase-init.js";

let currentUserId = null;
let allDepartments = [];
let allCities = [];
let editingAddressIndex = -1;

// Estado Local para Pedidos
let ordersCache = []; 
let lastVisibleOrder = null; 
const ORDERS_PER_PAGE = 10;
const STORAGE_KEY_ORDERS = 'pixeltech_user_orders';
const SYNC_KEY_ORDERS = 'pixeltech_orders_last_sync';

// Referencias DOM
const addrModal = document.getElementById('address-modal');
const addrForm = document.getElementById('address-form');
const deptInput = document.getElementById('modal-dept-search');
const deptResults = document.getElementById('dept-results');
const cityInput = document.getElementById('modal-city-search');
const cityResults = document.getElementById('city-results');
const cityContainer = document.getElementById('city-input-container');

// --- 1. SESIÓN & INIT ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        updateUserUI(user);
        initYearSelect(); 
        
        await Promise.all([
            loadUserDataSmart(),
            loadAddressesSmart(),
            loadOrdersSmart() // <--- Aquí está la nueva lógica
        ]);
        
        initColombiaAPI();
    } else {
        window.location.href = "/auth/login.html";
    }
});

// ==========================================================================
// 🧠 SMART SYNC: PEDIDOS (DOBLE VALIDACIÓN)
// ==========================================================================
async function loadOrdersSmart() {
    const container = document.getElementById('orders-container');
    
    // 1. CARGA DE CACHÉ
    const cachedRaw = localStorage.getItem(STORAGE_KEY_ORDERS);
    let lastSyncTime = parseInt(localStorage.getItem(SYNC_KEY_ORDERS) || '0');

    if (cachedRaw) {
        try {
            ordersCache = JSON.parse(cachedRaw);
            // Validación de integridad: si el primer elemento no tiene ID, la caché es inválida
            if (ordersCache.length > 0 && !ordersCache[0].id) ordersCache = []; 
        } catch (e) { ordersCache = []; }
    } else {
        ordersCache = [];
    }

    // 🚀 CORRECCIÓN CRÍTICA: 
    // Si la caché está vacía, FORZAMOS la fecha a 0 para descargar TODO el historial.
    // Esto evita el bug donde solo se ve el último pedido si se borró la caché.
    if (ordersCache.length === 0) {
        lastSyncTime = 0;
    }

    // Mostrar inmediato si hay datos viejos mientras buscamos nuevos
    if (ordersCache.length > 0) {
        renderOrdersList(ordersCache);
    } else {
        container.innerHTML = `<div class="text-center py-10 text-gray-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando historial de pedidos...</div>`;
    }

    // 2. BUSCAR EN FIREBASE
    try {
        const colRef = collection(db, "orders");
        const syncDate = new Date(lastSyncTime);
        let newDocs = [];

        if (lastSyncTime === 0) {
            // CASO A: DESCARGA TOTAL (Historial completo)
            // Usamos solo createdAt para la carga inicial, es más eficiente y seguro.
            console.log("☁️ [Orders] Descargando historial completo...");
            
            const q = query(
                colRef, 
                where("userId", "==", currentUserId), 
                orderBy("createdAt", "desc") // Requiere índice: userId ASC, createdAt DESC
            );
            
            const snap = await getDocs(q);
            snap.forEach(d => newDocs.push({ id: d.id, ...d.data() }));
        
        } else {
            // CASO B: INCREMENTAL (Solo nuevos o modificados)
            console.log("🔄 [Orders] Buscando actualizaciones...");
            
            // Consulta 1: Pedidos NUEVOS creados después de la última visita
            const qCreated = query(colRef, 
                where("userId", "==", currentUserId), 
                where("createdAt", ">", syncDate)
            );

            // Consulta 2: Pedidos VIEJOS que cambiaron de estado (updatedAt)
            const qUpdated = query(colRef, 
                where("userId", "==", currentUserId), 
                where("updatedAt", ">", syncDate)
            );

            const [snapCreated, snapUpdated] = await Promise.all([
                getDocs(qCreated),
                getDocs(qUpdated)
            ]);

            // Unificar resultados eliminando duplicados
            const mergedMap = new Map();
            snapCreated.forEach(d => mergedMap.set(d.id, { id: d.id, ...d.data() }));
            snapUpdated.forEach(d => mergedMap.set(d.id, { id: d.id, ...d.data() }));

            newDocs = Array.from(mergedMap.values());
            console.log(`🔥 [Orders] ${newDocs.length} cambios encontrados.`);
        }

        // Si no hay cambios y ya teníamos datos, no hacemos nada
        if (newDocs.length === 0 && ordersCache.length > 0) {
            console.log("✅ [Orders] Todo al día.");
            localStorage.setItem(SYNC_KEY_ORDERS, Date.now().toString());
            return;
        }

        // 3. FUSIÓN (MERGE)
        newDocs.forEach(newData => {
            // Normalizar fechas a texto ISO para que se guarden bien en localStorage
            if (newData.createdAt?.toDate) newData.createdAt = newData.createdAt.toDate().toISOString();
            if (newData.updatedAt?.toDate) newData.updatedAt = newData.updatedAt.toDate().toISOString();

            const index = ordersCache.findIndex(o => o.id === newData.id);
            if (index > -1) {
                ordersCache[index] = newData; // Actualizamos el existente
            } else {
                ordersCache.push(newData); // Agregamos el nuevo
            }
        });

        // 4. ORDENAR FINAL
        // Ordenamos por fecha de creación descendente (lo más nuevo primero)
        ordersCache.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // 5. GUARDAR
        localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(ordersCache));
        localStorage.setItem(SYNC_KEY_ORDERS, Date.now().toString());

        // 6. RENDERIZAR
        renderOrdersList(ordersCache);

    } catch (e) {
        console.error("Error cargando pedidos:", e);
        // Si falla por falta de índices, intenta mostrar lo que hay en caché
        if (e.message.includes("indexes")) {
            console.warn("⚠️ Faltan índices en Firebase. Revisa la consola.");
        }
        if(ordersCache.length === 0) {
             container.innerHTML = `<div class="text-center py-10 text-red-400 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation"></i> No se pudo cargar el historial. Revisa tu conexión.</div>`;
        }
    }
}

// Función Helper de Renderizado (Paginación Visual Local)
function renderOrdersList(orders) {
    const container = document.getElementById('orders-container');
    container.innerHTML = "";
    
    // Mostramos los primeros 10 visualmente
    const pageOrders = orders.slice(0, ORDERS_PER_PAGE); 
    
    if (pageOrders.length === 0) {
        container.innerHTML = `
            <div class="bg-white p-10 rounded-[2rem] text-center border-2 border-dashed border-gray-200">
                <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300"><i class="fa-solid fa-box-open text-2xl"></i></div>
                <p class="text-gray-400 font-black uppercase text-[10px] tracking-widest">Aún no tienes pedidos.</p>
                <a href="/shop/catalog.html" class="inline-block mt-4 text-brand-cyan font-bold text-xs hover:underline">Ir a la tienda</a>
            </div>`;
        return;
    }

    pageOrders.forEach(order => {
        const dateObj = new Date(order.createdAt);
        const dateStr = dateObj.toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'});
        let statusConfig = getStatusConfig(order.status);
        const totalItems = order.items ? order.items.length : 0;

        const card = document.createElement('div');
        card.className = "bg-white rounded-[1.5rem] p-5 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition-all cursor-pointer group relative overflow-hidden mb-4";
        card.onclick = () => window.location.href = `/shop/order-detail.html?id=${order.id}`;

        const borderColorClass = statusConfig.color.split(' ')[0].replace('bg-', 'bg-'); 

        card.innerHTML = `
            <div class="absolute top-0 left-0 w-1.5 h-full ${borderColorClass}"></div>
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pl-4">
                <div class="flex items-center gap-4">
                    <div class="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-brand-black font-black text-xs border border-gray-100 group-hover:bg-brand-black group-hover:text-brand-cyan transition-colors shadow-sm">
                        <div class="text-center leading-none"><span class="block text-[8px] opacity-60">ORDEN</span>#${order.id.slice(0, 4)}</div>
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-1.5">
                            <span class="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border ${statusConfig.color} flex items-center gap-1.5 shadow-sm"><i class="fa-solid ${statusConfig.icon}"></i> ${statusConfig.label}</span>
                            <span class="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                        </div>
                        <p class="text-xs font-bold text-gray-600 group-hover:text-brand-cyan transition-colors">${totalItems} producto(s)</p>
                    </div>
                </div>
                <div class="flex items-center justify-between w-full md:w-auto gap-8 mt-2 md:mt-0 pl-16 md:pl-0 border-t md:border-0 border-gray-50 pt-3 md:pt-0">
                    <div class="text-right">
                        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total</p>
                        <p class="text-xl font-black text-brand-black tracking-tight">$${(order.total || 0).toLocaleString('es-CO')}</p>
                    </div>
                    <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-gray-300 group-hover:bg-brand-cyan group-hover:text-white transition shadow-sm"><i class="fa-solid fa-chevron-right text-xs"></i></div>
                </div>
            </div>`;
        container.appendChild(card);
    });

    const loadMoreBox = document.getElementById('load-more-container');
    if (orders.length > ORDERS_PER_PAGE) {
        loadMoreBox.classList.remove('hidden');
        loadMoreBox.querySelector('button').onclick = () => {
            renderOrdersListFull(orders); 
            loadMoreBox.classList.add('hidden');
        };
    } else {
        loadMoreBox.classList.add('hidden');
    }
}

function renderOrdersListFull(orders) {
    const container = document.getElementById('orders-container');
    container.innerHTML = "";
    orders.forEach(order => { 
        // Reutilizamos lógica de renderizado manual para no duplicar código
        const dateObj = new Date(order.createdAt);
        const dateStr = dateObj.toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'});
        let statusConfig = getStatusConfig(order.status);
        const totalItems = order.items ? order.items.length : 0;
        const card = document.createElement('div');
        card.className = "bg-white rounded-[1.5rem] p-5 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition-all cursor-pointer group relative overflow-hidden mb-4";
        card.onclick = () => window.location.href = `/shop/order-detail.html?id=${order.id}`;
        const borderColorClass = statusConfig.color.split(' ')[0].replace('bg-', 'bg-'); 
        card.innerHTML = `
            <div class="absolute top-0 left-0 w-1.5 h-full ${borderColorClass}"></div>
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pl-4">
                <div class="flex items-center gap-4">
                    <div class="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-brand-black font-black text-xs border border-gray-100 group-hover:bg-brand-black group-hover:text-brand-cyan transition-colors shadow-sm">
                        <div class="text-center leading-none"><span class="block text-[8px] opacity-60">ORDEN</span>#${order.id.slice(0, 4)}</div>
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-1.5">
                            <span class="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border ${statusConfig.color} flex items-center gap-1.5 shadow-sm"><i class="fa-solid ${statusConfig.icon}"></i> ${statusConfig.label}</span>
                            <span class="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                        </div>
                        <p class="text-xs font-bold text-gray-600 group-hover:text-brand-cyan transition-colors">${totalItems} producto(s)</p>
                    </div>
                </div>
                <div class="flex items-center justify-between w-full md:w-auto gap-8 mt-2 md:mt-0 pl-16 md:pl-0 border-t md:border-0 border-gray-50 pt-3 md:pt-0">
                    <div class="text-right">
                        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total</p>
                        <p class="text-xl font-black text-brand-black tracking-tight">$${(order.total || 0).toLocaleString('es-CO')}</p>
                    </div>
                    <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-gray-300 group-hover:bg-brand-cyan group-hover:text-white transition shadow-sm"><i class="fa-solid fa-chevron-right text-xs"></i></div>
                </div>
            </div>`;
        container.appendChild(card);
    });
}

function getStatusConfig(status) {
    if(status === 'PENDIENTE_PAGO') return { color: "bg-yellow-50 text-yellow-600 border-yellow-200", icon: "fa-clock", label: "Pendiente Pago" };
    if(['PAGADO', 'PENDIENTE', 'CONFIRMADO'].includes(status)) return { color: "bg-blue-50 text-blue-600 border-blue-200", icon: "fa-check-circle", label: "Confirmado" };
    if(['ALISTADO', 'ALISTAMIENTO'].includes(status)) return { color: "bg-purple-50 text-purple-600 border-purple-200", icon: "fa-box-open", label: "Preparando" };
    if(['DESPACHADO', 'EN_RUTA'].includes(status)) return { color: "bg-cyan-50 text-cyan-700 border-cyan-200", icon: "fa-truck-fast", label: "En Camino" };
    if(status === 'ENTREGADO') return { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "fa-house-circle-check", label: "Entregado" };
    if(['CANCELADO', 'RECHAZADO'].includes(status)) return { color: "bg-red-50 text-red-600 border-red-200", icon: "fa-ban", label: "Cancelado" };
    return { color: "bg-gray-100 text-gray-500", icon: "fa-circle", label: status || "Pendiente" };
}

// --- 5. PERFIL Y DIRECCIONES (CACHE SIMPLE) ---
async function loadUserDataSmart() {
    const cachedProfile = sessionStorage.getItem('pixeltech_user_profile');
    if (cachedProfile) {
        fillProfileForm(JSON.parse(cachedProfile));
        return;
    }
    try {
        const userSnap = await getDoc(doc(db, "users", currentUserId));
        if (userSnap.exists()) {
            const data = userSnap.data();
            sessionStorage.setItem('pixeltech_user_profile', JSON.stringify(data));
            fillProfileForm(data);
        }
    } catch (e) { console.error(e); }
}

function fillProfileForm(data) {
    if (document.getElementById('form-name')) document.getElementById('form-name').value = data.name || "";
    if (document.getElementById('form-id')) document.getElementById('form-id').value = data.document || "";
    if (document.getElementById('form-phone')) document.getElementById('form-phone').value = data.phone || "";
    if (document.getElementById('form-birth')) document.getElementById('form-birth').value = data.birthdate || "";
}

async function loadAddressesSmart() {
    const list = document.getElementById('addresses-list');
    if (!list) return;
    
    const cachedAddrs = sessionStorage.getItem('pixeltech_user_addresses');
    if (cachedAddrs) {
        renderAddresses(JSON.parse(cachedAddrs));
        return;
    }

    try {
        const userSnap = await getDoc(doc(db, "users", currentUserId));
        const addresses = userSnap.data()?.addresses || [];
        sessionStorage.setItem('pixeltech_user_addresses', JSON.stringify(addresses));
        renderAddresses(addresses);
    } catch (e) { console.error(e); }
}

function renderAddresses(addresses) {
    const list = document.getElementById('addresses-list');
    if (addresses.length === 0) {
        list.innerHTML = `<div class="col-span-full py-10 border-2 border-dashed border-gray-200 rounded-[2rem] text-center"><p class="text-gray-400 text-xs font-bold uppercase">No hay direcciones guardadas</p></div>`;
        return;
    }
    list.innerHTML = "";
    addresses.forEach((addr, index) => {
        const isDef = addr.isDefault;
        const div = document.createElement('div');
        div.className = `bg-white p-6 rounded-[2rem] border ${isDef ? 'border-brand-cyan shadow-md shadow-cyan-500/10' : 'border-gray-100 hover:border-gray-200'} shadow-sm relative group transition-all`;
        div.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl ${isDef ? 'bg-brand-cyan text-brand-black' : 'bg-slate-100 text-gray-400'} flex items-center justify-center transition-colors"><i class="fa-solid ${isDef ? 'fa-star' : 'fa-location-dot'}"></i></div>
                    <div><h4 class="font-black text-xs uppercase tracking-tight text-brand-black">${addr.alias}</h4>${isDef ? '<span class="text-[8px] font-black uppercase text-brand-cyan">Principal</span>' : ''}</div>
                </div>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="window.editAddress(${index})" class="w-8 h-8 rounded-full hover:bg-slate-100 text-gray-400 flex items-center justify-center transition"><i class="fa-solid fa-pen text-xs"></i></button>
                    <button onclick="window.deleteAddress(${index})" class="w-8 h-8 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center transition"><i class="fa-solid fa-trash text-xs"></i></button>
                </div>
            </div>
            <div class="space-y-1 mb-4">
                <p class="text-sm font-bold text-gray-800 leading-tight">${addr.address}</p>
                <p class="text-[10px] text-gray-500 font-bold uppercase">${addr.city}, ${addr.dept}</p>
                ${addr.notes ? `<p class="text-[9px] text-gray-400 italic mt-2 line-clamp-1">"${addr.notes}"</p>` : ''}
            </div>`;
        list.appendChild(div);
    });
}

function updateUserUI(user) {
    const nameSide = document.getElementById('user-name-side');
    const emailSide = document.getElementById('user-email-side');
    const avatar = document.getElementById('user-avatar');
    const name = user.displayName || "Usuario";
    if (nameSide) nameSide.textContent = name;
    if (emailSide) emailSide.textContent = user.email;
    if (avatar) avatar.innerHTML = `<span class="font-black">${name.substring(0, 2).toUpperCase()}</span>`;
    const emailInput = document.getElementById('form-email-readonly');
    if(emailInput) emailInput.value = user.email;
}

function initYearSelect() {
    const yearSelect = document.getElementById('filter-year');
    const currentYear = new Date().getFullYear();
    if(yearSelect) {
        yearSelect.innerHTML = "";
        for (let i = 0; i < 5; i++) {
            const y = currentYear - i;
            yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
        }
    }
}

window.toggleDateFilters = () => {
    const mode = document.getElementById('filter-mode').value;
    const dateSelectors = document.getElementById('date-selectors');
    if (mode === 'custom') { dateSelectors.classList.remove('hidden'); dateSelectors.classList.add('flex'); } 
    else { dateSelectors.classList.add('hidden'); dateSelectors.classList.remove('flex'); }
    window.applyOrderFilters();
};

window.applyOrderFilters = () => {
    const mode = document.getElementById('filter-mode').value;
    let filtered = [...ordersCache];
    const now = new Date();

    if (mode === 'last3') {
        const dateLimit = new Date();
        dateLimit.setDate(now.getDate() - 90);
        filtered = filtered.filter(o => new Date(o.createdAt) >= dateLimit);
    } else if (mode === 'this_year') {
        const dateLimit = new Date(now.getFullYear(), 0, 1);
        filtered = filtered.filter(o => new Date(o.createdAt) >= dateLimit);
    } else if (mode === 'custom') {
        const m = parseInt(document.getElementById('filter-month').value);
        const y = parseInt(document.getElementById('filter-year').value);
        const start = new Date(y, m, 1);
        const end = new Date(y, m + 1, 0, 23, 59, 59);
        filtered = filtered.filter(o => {
            const d = new Date(o.createdAt);
            return d >= start && d <= end;
        });
    }
    renderOrdersList(filtered);
};

window.loadMoreOrders = () => {
    renderOrdersListFull(ordersCache);
};

// --- GESTIÓN DIRECCIONES (CON INVALIDACIÓN DE CACHÉ) ---
window.toggleModal = (show) => {
    if (show) {
        addrModal.classList.add('active');
        document.getElementById('modal-addr-title').innerHTML = editingAddressIndex >= 0 ? 'Editar Dirección' : 'Nueva Dirección';
    } else {
        addrModal.classList.remove('active');
        addrForm.reset();
        cityContainer.classList.add('opacity-50');
        cityInput.disabled = true;
        editingAddressIndex = -1; 
    }
};

if(document.getElementById('btn-open-address-modal')) document.getElementById('btn-open-address-modal').onclick = () => {
    editingAddressIndex = -1;
    toggleModal(true);
};

addrForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = addrForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

    const newAddr = {
        alias: document.getElementById('modal-addr-alias').value,
        address: document.getElementById('modal-addr-value').value,
        dept: deptInput.value,
        city: cityInput.value,
        zip: document.getElementById('modal-addr-zip').value || "",
        notes: document.getElementById('modal-addr-notes').value || "",
        isDefault: document.getElementById('modal-addr-default').checked,
        updatedAt: new Date()
    };

    try {
        const userRef = doc(db, "users", currentUserId);
        const snap = await getDoc(userRef);
        let currentAddrs = snap.data()?.addresses || [];

        if (newAddr.isDefault) currentAddrs = currentAddrs.map(a => ({ ...a, isDefault: false }));
        if (currentAddrs.length === 0) newAddr.isDefault = true;

        if (editingAddressIndex >= 0) currentAddrs[editingAddressIndex] = newAddr;
        else currentAddrs.push(newAddr);

        await updateDoc(userRef, { addresses: currentAddrs });
        sessionStorage.removeItem('pixeltech_user_addresses');
        toggleModal(false);
        await loadAddressesSmart(); 
    } catch (error) { console.error(error); alert("Error al guardar"); } 
    finally { btn.disabled = false; btn.textContent = "Guardar"; }
};

window.editAddress = async (index) => {
    editingAddressIndex = index;
    const cachedAddrs = JSON.parse(sessionStorage.getItem('pixeltech_user_addresses') || '[]');
    if(cachedAddrs.length > index) {
        const addr = cachedAddrs[index];
        document.getElementById('modal-addr-alias').value = addr.alias;
        document.getElementById('modal-addr-value').value = addr.address;
        deptInput.value = addr.dept;
        cityInput.value = addr.city;
        cityInput.disabled = false;
        cityContainer.classList.remove('opacity-50');
        document.getElementById('modal-addr-zip').value = addr.zip || "";
        document.getElementById('modal-addr-notes').value = addr.notes || "";
        document.getElementById('modal-addr-default').checked = addr.isDefault || false;
        toggleModal(true);
    }
};

window.deleteAddress = async (index) => {
    if (!confirm("¿Eliminar esta ubicación?")) return;
    const userRef = doc(db, "users", currentUserId);
    const snap = await getDoc(userRef);
    const currentAddrs = snap.data().addresses;
    currentAddrs.splice(index, 1);
    await updateDoc(userRef, { addresses: currentAddrs });
    sessionStorage.removeItem('pixeltech_user_addresses');
    await loadAddressesSmart();
};

async function initColombiaAPI() {
    try {
        const response = await fetch('https://api-colombia.com/api/v1/Department');
        allDepartments = await response.json();

        deptInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            deptResults.innerHTML = "";
            if (term.length < 1) { deptResults.classList.add('hidden'); return; }
            allDepartments.filter(d => d.name.toLowerCase().includes(term)).forEach(dept => {
                const div = document.createElement('div');
                div.className = "p-2 hover:bg-slate-50 cursor-pointer text-xs font-bold rounded-lg transition uppercase text-gray-600 hover:text-brand-cyan";
                div.textContent = dept.name;
                div.onclick = () => {
                    deptInput.value = dept.name;
                    document.getElementById('modal-addr-dept-id').value = dept.id;
                    deptResults.classList.add('hidden');
                    loadCities(dept.id);
                };
                deptResults.appendChild(div);
            });
            deptResults.classList.remove('hidden');
        };

        cityInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            cityResults.innerHTML = "";
            if (term.length < 1) { cityResults.classList.add('hidden'); return; }
            allCities.filter(c => c.name.toLowerCase().includes(term)).forEach(city => {
                const div = document.createElement('div');
                div.className = "p-2 hover:bg-slate-50 cursor-pointer text-xs font-bold rounded-lg transition uppercase text-gray-600 hover:text-brand-cyan";
                div.textContent = city.name;
                div.onclick = () => {
                    cityInput.value = city.name;
                    cityResults.classList.add('hidden');
                };
                cityResults.appendChild(div);
            });
            cityResults.classList.remove('hidden');
        };
    } catch (e) { console.error(e); }
}

async function loadCities(deptId) {
    cityInput.disabled = true; cityInput.value = "Cargando...";
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        allCities = await res.json();
        cityInput.disabled = false; cityInput.value = ""; cityInput.placeholder = "Escribe ciudad...";
        cityContainer.classList.remove('opacity-50');
    } catch (e) { console.error(e); }
}

document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = "Guardando...";
    try {
        const newData = {
            name: document.getElementById('form-name').value,
            document: document.getElementById('form-id').value,
            phone: document.getElementById('form-phone').value,
            birthdate: document.getElementById('form-birth').value,
            updatedAt: new Date()
        };
        await updateDoc(doc(db, "users", currentUserId), newData);
        sessionStorage.removeItem('pixeltech_user_profile');
        alert("✅ Perfil actualizado");
    } catch (e) { alert("Error"); }
    finally { btn.disabled = false; btn.textContent = "Guardar Cambios"; }
});

const logoutBtn = document.getElementById('btn-logout-profile');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm("¿Cerrar sesión?")) {
            await signOut(auth);
            sessionStorage.clear();
            localStorage.removeItem(STORAGE_KEY_ORDERS);
            localStorage.removeItem(SYNC_KEY_ORDERS);
            window.location.href = "/index.html";
        }
    });
}

window.toggleModal = toggleModal;