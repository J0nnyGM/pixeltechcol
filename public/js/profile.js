import { auth, db, onAuthStateChanged, doc, getDoc, updateDoc, collection, getDocs, query, where, orderBy, limit, startAfter, Timestamp, signOut} from "./firebase-init.js";
let currentUserId = null;
let allDepartments = [];
let allCities = [];
let editingAddressIndex = -1;

let lastVisibleOrder = null; // Cursor para paginación
const ORDERS_PER_PAGE = 10;
let isFiltering = false;

// Referencias DOM Globales
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
        initYearSelect(); // Inicializar dropdown de años
        
        // Carga inicial (Últimos 3 meses por defecto)
        await applyOrderFilters(); 
        
        await loadUserData();
        await loadAddresses();
        initColombiaAPI();
    } else {
        window.location.href = "/auth/login.html";
    }
});

// --- 2. LÓGICA DE FILTROS ---

// Rellenar el select de años dinámicamente (Año actual - 5 años)
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

// Mostrar/Ocultar selects de mes/año según el modo
window.toggleDateFilters = () => {
    const mode = document.getElementById('filter-mode').value;
    const dateSelectors = document.getElementById('date-selectors');
    if (mode === 'custom') {
        dateSelectors.classList.remove('hidden');
        dateSelectors.classList.add('flex');
    } else {
        dateSelectors.classList.add('hidden');
        dateSelectors.classList.remove('flex');
    }
};

// --- 3. MOTOR DE BÚSQUEDA Y PAGINACIÓN ---

window.applyOrderFilters = async () => {
    lastVisibleOrder = null; // Reset paginación
    const container = document.getElementById('orders-container');
    container.innerHTML = `<div class="text-center py-10 text-gray-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Buscando pedidos...</div>`;
    document.getElementById('load-more-container').classList.add('hidden');
    
    await fetchOrders(true); // true = reset lista
};

window.loadMoreOrders = async () => {
    const btn = document.querySelector('#load-more-container button');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...';
    btn.disabled = true;
    
    await fetchOrders(false); // false = append lista
    
    btn.innerHTML = 'CARGAR MÁS PEDIDOS';
    btn.disabled = false;
};

async function fetchOrders(isReset) {
    const container = document.getElementById('orders-container');
    const loadMoreBox = document.getElementById('load-more-container');
    
    try {
        let q = collection(db, "orders");
        
        // A. Filtros Básicos
        const constraints = [
            where("userId", "==", currentUserId),
            orderBy("createdAt", "desc")
        ];

        // B. Filtros de Fecha
        const mode = document.getElementById('filter-mode').value;
        const now = new Date();
        let startDate, endDate;

        if (mode === 'last3') {
            // Últimos 3 meses (90 días aprox)
            startDate = new Date();
            startDate.setDate(now.getDate() - 90);
            constraints.push(where("createdAt", ">=", startDate));
        } 
        else if (mode === 'this_year') {
            startDate = new Date(now.getFullYear(), 0, 1); // 1 Ene
            constraints.push(where("createdAt", ">=", startDate));
        }
        else if (mode === 'custom') {
            const m = parseInt(document.getElementById('filter-month').value);
            const y = parseInt(document.getElementById('filter-year').value);
            
            startDate = new Date(y, m, 1); // 1 del mes
            endDate = new Date(y, m + 1, 0, 23, 59, 59); // Último día del mes
            
            constraints.push(where("createdAt", ">=", startDate));
            constraints.push(where("createdAt", "<=", endDate));
        }
        // mode === 'all' no agrega filtros de fecha

        // C. Paginación
        constraints.push(limit(ORDERS_PER_PAGE));
        if (!isReset && lastVisibleOrder) {
            constraints.push(startAfter(lastVisibleOrder));
        }

        // D. Ejecutar Query
        const finalQuery = query(q, ...constraints);
        const snap = await getDocs(finalQuery);

        if (isReset) container.innerHTML = "";

        if (snap.empty) {
            if (isReset) {
                container.innerHTML = `
                    <div class="bg-white p-10 rounded-[2rem] text-center border-2 border-dashed border-gray-200">
                        <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                            <i class="fa-solid fa-calendar-xmark text-2xl"></i>
                        </div>
                        <p class="text-gray-400 font-black uppercase text-[10px] tracking-widest">No se encontraron pedidos en este periodo.</p>
                    </div>`;
            }
            loadMoreBox.classList.add('hidden');
            return;
        }

        // Actualizar cursor para la próxima página
        lastVisibleOrder = snap.docs[snap.docs.length - 1];

        // Mostrar botón "Cargar Más" solo si trajimos 10 items (significa que puede haber más)
        if (snap.docs.length < ORDERS_PER_PAGE) {
            loadMoreBox.classList.add('hidden');
        } else {
            loadMoreBox.classList.remove('hidden');
        }

        // E. Renderizar
        snap.forEach(docSnap => {
            const order = docSnap.data();
            renderOrderCard(docSnap.id, order, container);
        });

    } catch (e) {
        console.error("Error fetching orders:", e);
        // Manejo de error común de índice compuesto
        if (e.message.includes("indexes")) {
            console.warn("⚠️ FALTA ÍNDICE EN FIREBASE. Abre la consola para ver el link de creación.");
            alert("El sistema se está optimizando. Por favor intenta filtrar por 'Todo el Historial' mientras configuramos los índices de fecha.");
        }
        container.innerHTML = `<p class="text-center text-red-400 font-bold text-xs py-4">Error al cargar. Intenta recargar.</p>`;
    }
}

// --- 4. RENDERIZADO DE TARJETA (Helper) ---
function renderOrderCard(id, order, container) {
    const date = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'}) : "Fecha desc.";
    
    // Configuración Visual de Estados
    let statusConfig = { color: "bg-gray-100 text-gray-500", icon: "fa-circle", label: order.status || "Pendiente" };
    
    const s = order.status;
    if(s === 'PENDIENTE_PAGO') statusConfig = { color: "bg-yellow-50 text-yellow-600 border-yellow-200", icon: "fa-clock", label: "Pendiente Pago" };
    if(['PAGADO', 'PENDIENTE', 'CONFIRMADO'].includes(s)) statusConfig = { color: "bg-blue-50 text-blue-600 border-blue-200", icon: "fa-check-circle", label: "Confirmado" };
    if(['ALISTADO', 'ALISTAMIENTO'].includes(s)) statusConfig = { color: "bg-purple-50 text-purple-600 border-purple-200", icon: "fa-box-open", label: "Preparando" };
    if(['DESPACHADO', 'EN_RUTA'].includes(s)) statusConfig = { color: "bg-cyan-50 text-cyan-700 border-cyan-200", icon: "fa-truck-fast", label: "En Camino" };
    if(s === 'ENTREGADO') statusConfig = { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "fa-house-circle-check", label: "Entregado" };
    if(['CANCELADO', 'RECHAZADO'].includes(s)) statusConfig = { color: "bg-red-50 text-red-600 border-red-200", icon: "fa-ban", label: "Cancelado" };

    const totalItems = order.items ? order.items.length : 0;

    const card = document.createElement('div');
    card.className = "bg-white rounded-[1.5rem] p-5 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition-all cursor-pointer group relative overflow-hidden animate-in";
    card.onclick = () => window.location.href = `/shop/order-detail.html?id=${id}`;

    // Barra lateral de color estado
    const borderColorClass = statusConfig.color.split(' ')[0].replace('bg-', 'bg-'); 

    card.innerHTML = `
        <div class="absolute top-0 left-0 w-1.5 h-full ${borderColorClass}"></div>
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pl-4">
            
            <div class="flex items-center gap-4">
                <div class="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-brand-black font-black text-xs border border-gray-100 group-hover:bg-brand-black group-hover:text-brand-cyan transition-colors shadow-sm">
                    <div class="text-center leading-none">
                        <span class="block text-[8px] opacity-60">ORDEN</span>
                        #${id.slice(0, 4)}
                    </div>
                </div>
                <div>
                    <div class="flex flex-wrap items-center gap-2 mb-1.5">
                        <span class="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border ${statusConfig.color} flex items-center gap-1.5 shadow-sm">
                            <i class="fa-solid ${statusConfig.icon}"></i> ${statusConfig.label}
                        </span>
                        <span class="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1">
                            <i class="fa-regular fa-calendar"></i> ${date}
                        </span>
                    </div>
                    <p class="text-xs font-bold text-gray-600 group-hover:text-brand-cyan transition-colors">${totalItems} producto(s)</p>
                </div>
            </div>

            <div class="flex items-center justify-between w-full md:w-auto gap-8 mt-2 md:mt-0 pl-16 md:pl-0 border-t md:border-0 border-gray-50 pt-3 md:pt-0">
                <div class="text-right">
                    <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total</p>
                    <p class="text-xl font-black text-brand-black tracking-tight">$${(order.total || 0).toLocaleString('es-CO')}</p>
                </div>
                <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-gray-300 group-hover:bg-brand-cyan group-hover:text-white transition shadow-sm">
                    <i class="fa-solid fa-chevron-right text-xs"></i>
                </div>
            </div>
        </div>
    `;
    container.appendChild(card);
}

function updateUserUI(user) {
    const nameSide = document.getElementById('user-name-side');
    const emailSide = document.getElementById('user-email-side');
    const avatar = document.getElementById('user-avatar');
    const name = user.displayName || "Usuario";

    if (nameSide) nameSide.textContent = name;
    if (emailSide) emailSide.textContent = user.email;
    if (avatar) avatar.innerHTML = `<span class="font-black">${name.substring(0, 2).toUpperCase()}</span>`;
    
    // Campo email readonly en formulario
    const emailInput = document.getElementById('form-email-readonly');
    if(emailInput) emailInput.value = user.email;
}

// --- 2. PEDIDOS (DISEÑO ELITE) ---
async function loadUserOrders() {
    const container = document.getElementById('orders-container');
    if (!container) return;
    try {
        const q = query(collection(db, "orders"), where("userId", "==", currentUserId), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        
        if(snap.empty) {
            container.innerHTML = `
                <div class="bg-white p-10 rounded-[2rem] text-center border-2 border-dashed border-gray-200">
                    <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                        <i class="fa-solid fa-box-open text-2xl"></i>
                    </div>
                    <p class="text-gray-400 font-black uppercase text-[10px] tracking-widest">Aún no tienes pedidos registrados.</p>
                    <a href="/shop/catalog.html" class="inline-block mt-4 text-brand-cyan font-bold text-xs hover:underline">Ir a la tienda</a>
                </div>`;
            return;
        }

        container.innerHTML = "";
        snap.forEach(docSnap => {
            const order = docSnap.data();
            const date = order.createdAt?.toDate().toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'}) || "Fecha desc.";
            
            // Estado con Colores y Iconos
            let statusConfig = { color: "bg-gray-100 text-gray-500", icon: "fa-circle", label: order.status || "Pendiente" };
            
            if(['PENDIENTE_PAGO'].includes(order.status)) statusConfig = { color: "bg-yellow-50 text-yellow-600 border-yellow-200", icon: "fa-clock", label: "Pendiente Pago" };
            if(['PAGADO', 'PENDIENTE'].includes(order.status)) statusConfig = { color: "bg-blue-50 text-blue-600 border-blue-200", icon: "fa-check-circle", label: "Confirmado" };
            if(['ALISTADO', 'ALISTAMIENTO'].includes(order.status)) statusConfig = { color: "bg-purple-50 text-purple-600 border-purple-200", icon: "fa-box-open", label: "Preparando" };
            if(['DESPACHADO', 'EN_RUTA'].includes(order.status)) statusConfig = { color: "bg-cyan-50 text-cyan-700 border-cyan-200", icon: "fa-truck-fast", label: "En Camino" };
            if(['ENTREGADO'].includes(order.status)) statusConfig = { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "fa-house-circle-check", label: "Entregado" };
            if(['CANCELADO', 'RECHAZADO'].includes(order.status)) statusConfig = { color: "bg-red-50 text-red-600 border-red-200", icon: "fa-ban", label: "Cancelado" };

            const totalItems = order.items ? order.items.length : 0;

            const card = document.createElement('div');
            card.className = "bg-white rounded-[1.5rem] p-5 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition-all cursor-pointer group relative overflow-hidden";
            card.onclick = () => window.location.href = `/shop/order-detail.html?id=${docSnap.id}`;

            card.innerHTML = `
                <div class="absolute top-0 left-0 w-1 h-full ${statusConfig.color.split(' ')[0].replace('bg-','bg-')}"></div>
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pl-3">
                    
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-brand-black font-black text-xs border border-gray-100 group-hover:bg-brand-black group-hover:text-brand-cyan transition-colors">
                            #${docSnap.id.slice(0, 4)}
                        </div>
                        <div>
                            <div class="flex items-center gap-2 mb-1">
                                <span class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${statusConfig.color} flex items-center gap-1">
                                    <i class="fa-solid ${statusConfig.icon}"></i> ${statusConfig.label}
                                </span>
                                <span class="text-[9px] text-gray-400 font-bold uppercase">${date}</span>
                            </div>
                            <p class="text-xs font-medium text-gray-500">${totalItems} producto(s)</p>
                        </div>
                    </div>

                    <div class="flex items-center justify-between w-full md:w-auto gap-6 mt-2 md:mt-0">
                        <div class="text-right">
                            <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total</p>
                            <p class="text-lg font-black text-brand-black">$${(order.total || 0).toLocaleString('es-CO')}</p>
                        </div>
                        <div class="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-brand-cyan group-hover:text-brand-black transition">
                            <i class="fa-solid fa-chevron-right text-xs"></i>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

// --- 3. DIRECCIONES (DISEÑO ELITE) ---
async function loadAddresses() {
    const list = document.getElementById('addresses-list');
    if (!list) return;
    try {
        const userSnap = await getDoc(doc(db, "users", currentUserId));
        const addresses = userSnap.data()?.addresses || [];
        
        if (addresses.length === 0) {
            list.innerHTML = `<div class="col-span-full py-10 border-2 border-dashed border-gray-200 rounded-[2rem] text-center"><p class="text-gray-400 text-xs font-bold uppercase">No hay direcciones guardadas</p></div>`;
            return;
        }

        list.innerHTML = "";
        addresses.forEach((addr, index) => {
            const isDef = addr.isDefault;
            const div = document.createElement('div');
            // Tarjeta con borde sutil si no es default, borde cyan si es default
            div.className = `bg-white p-6 rounded-[2rem] border ${isDef ? 'border-brand-cyan shadow-md shadow-cyan-500/10' : 'border-gray-100 hover:border-gray-200'} shadow-sm relative group transition-all`;
            
            div.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl ${isDef ? 'bg-brand-cyan text-brand-black' : 'bg-slate-100 text-gray-400'} flex items-center justify-center transition-colors">
                            <i class="fa-solid ${isDef ? 'fa-star' : 'fa-location-dot'}"></i>
                        </div>
                        <div>
                            <h4 class="font-black text-xs uppercase tracking-tight text-brand-black">${addr.alias}</h4>
                            ${isDef ? '<span class="text-[8px] font-black uppercase text-brand-cyan">Principal</span>' : ''}
                        </div>
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
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

// --- 4. API COLOMBIA & FORMULARIOS (Igual lógica, solo referencias DOM actualizadas) ---
// (Mantenemos la lógica de API Colombia que ya tenías, funciona bien)
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

// --- 5. GESTIÓN DIRECCIONES ---
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
        toggleModal(false);
        await loadAddresses();
    } catch (error) { console.error(error); alert("Error al guardar"); } 
    finally { btn.disabled = false; btn.textContent = "Guardar"; }
};

window.editAddress = async (index) => {
    editingAddressIndex = index;
    try {
        const snap = await getDoc(doc(db, "users", currentUserId));
        const addr = snap.data().addresses[index];
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
    } catch(e) { console.error(e); }
};

window.deleteAddress = async (index) => {
    if (!confirm("¿Eliminar esta ubicación?")) return;
    const userRef = doc(db, "users", currentUserId);
    const snap = await getDoc(userRef);
    const currentAddrs = snap.data().addresses;
    currentAddrs.splice(index, 1);
    await updateDoc(userRef, { addresses: currentAddrs });
    await loadAddresses();
};

// --- 6. PERFIL Y LOGOUT ---
async function loadUserData() {
    try {
        const userSnap = await getDoc(doc(db, "users", currentUserId));
        if (userSnap.exists()) {
            const data = userSnap.data();
            if (document.getElementById('form-name')) document.getElementById('form-name').value = data.name || "";
            if (document.getElementById('form-id')) document.getElementById('form-id').value = data.document || "";
            if (document.getElementById('form-phone')) document.getElementById('form-phone').value = data.phone || "";
            if (document.getElementById('form-birth')) document.getElementById('form-birth').value = data.birthdate || "";
        }
    } catch (e) { console.error(e); }
}

document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = "Guardando...";
    try {
        await updateDoc(doc(db, "users", currentUserId), {
            name: document.getElementById('form-name').value,
            document: document.getElementById('form-id').value,
            phone: document.getElementById('form-phone').value,
            birthdate: document.getElementById('form-birth').value,
            updatedAt: new Date()
        });
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
            window.location.href = "/index.html";
        }
    });
}

// Cierre de dropdowns
document.addEventListener('click', (e) => {
    if (!deptInput.contains(e.target)) deptResults.classList.add('hidden');
    if (!cityInput.contains(e.target)) cityResults.classList.add('hidden');
});

// Exportar al window
window.toggleModal = toggleModal;