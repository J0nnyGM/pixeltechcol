import { auth, db, onAuthStateChanged, doc, getDoc, updateDoc, collection, getDocs, query, where, orderBy, signOut } from "./firebase-init.js";

// --- VARIABLES DE ESTADO ---
let currentUserId = null;
let allDepartments = [];
let allCities = [];

// ELEMENTOS DEL DOM
const addrModal = document.getElementById('address-modal');
const addrForm = document.getElementById('address-form');
const deptInput = document.getElementById('modal-dept-search');
const deptResults = document.getElementById('dept-results');
const cityInput = document.getElementById('modal-city-search');
const cityResults = document.getElementById('city-results');
const cityContainer = document.getElementById('city-input-container');

/**
 * 1. CONTROL DE SESIÓN
 */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        updateUserUI(user);
        await loadUserData();
        await loadUserOrders();
        await loadAddresses();
        updateCartCounter();
        initColombiaAPI(); // Inicializa la API una sola vez
    } else {
        window.location.href = "/auth/login.html";
    }
});

function updateUserUI(user) {
    const nameSide = document.getElementById('user-name-side');
    const emailSide = document.getElementById('user-email-side');
    const avatar = document.getElementById('user-avatar');
    const name = user.displayName || "Usuario PixelTech";

    if (nameSide) nameSide.textContent = name;
    if (emailSide) emailSide.textContent = user.email;
    if (avatar) avatar.textContent = name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
}

/**
 * 2. GESTIÓN DE API COLOMBIA (BUSCADOR INTERACTIVO)
 */
async function initColombiaAPI() {
    try {
        const response = await fetch('https://api-colombia.com/api/v1/Department');
        allDepartments = await response.json();

        // Búsqueda de Departamentos
        deptInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            deptResults.innerHTML = "";
            if (term.length < 1) { deptResults.classList.add('hidden'); return; }

            const filtered = allDepartments.filter(d => d.name.toLowerCase().includes(term));
            filtered.forEach(dept => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-brand-cyan/10 cursor-pointer text-xs font-bold rounded-xl transition uppercase";
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

        // Búsqueda de Ciudades
        cityInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            cityResults.innerHTML = "";
            if (term.length < 1) { cityResults.classList.add('hidden'); return; }

            const filtered = allCities.filter(c => c.name.toLowerCase().includes(term));
            filtered.forEach(city => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-brand-cyan/10 cursor-pointer text-xs font-bold rounded-xl transition uppercase";
                div.textContent = city.name;
                div.onclick = () => {
                    cityInput.value = city.name;
                    cityResults.classList.add('hidden');
                };
                cityResults.appendChild(div);
            });
            cityResults.classList.remove('hidden');
        };

    } catch (e) { console.error("Error API Colombia:", e); }
}

async function loadCities(deptId) {
    cityInput.disabled = true;
    cityInput.value = "Cargando...";
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        allCities = await res.json();
        cityInput.disabled = false;
        cityInput.value = "";
        cityInput.placeholder = "Busca tu ciudad...";
        cityContainer.classList.remove('opacity-50');
    } catch (e) { console.error(e); }
}

/**
 * 3. MODAL DE DIRECCIONES
 */
const btnOpenModal = document.getElementById('btn-open-address-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');

const toggleModal = (show) => {
    if (show) addrModal.classList.add('active');
    else {
        addrModal.classList.remove('active');
        addrForm.reset();
        cityContainer.classList.add('opacity-50');
        cityInput.disabled = true;
    }
};

if (btnOpenModal) btnOpenModal.onclick = () => toggleModal(true);
if (btnCloseModal) btnCloseModal.onclick = () => toggleModal(false);
if (btnCancelModal) btnCancelModal.onclick = () => toggleModal(false);

addrForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = addrForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

    const newAddr = {
        alias: document.getElementById('modal-addr-alias').value,
        address: document.getElementById('modal-addr-value').value,
        dept: deptInput.value,
        city: cityInput.value,
        createdAt: new Date()
    };

    try {
        const userRef = doc(db, "users", currentUserId);
        const snap = await getDoc(userRef);
        const currentAddrs = snap.data()?.addresses || [];
        currentAddrs.push(newAddr);
        await updateDoc(userRef, { addresses: currentAddrs });
        toggleModal(false);
        await loadAddresses();
    } catch (error) {
        alert("Error al guardar");
    } finally {
        btn.disabled = false;
        btn.textContent = "Guardar Dirección";
    }
};

async function loadAddresses() {
    const list = document.getElementById('addresses-list');
    if (!list) return;
    try {
        const userSnap = await getDoc(doc(db, "users", currentUserId));
        const addresses = userSnap.data()?.addresses || [];
        list.innerHTML = addresses.length === 0 ? `<p class="col-span-full text-center text-gray-400 py-10 uppercase text-[10px] font-black tracking-widest border-2 border-dashed border-gray-100 rounded-[2rem]">Sin direcciones guardadas.</p>` : "";

        addresses.forEach((addr, index) => {
            const div = document.createElement('div');
            div.className = "bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm relative group hover:border-brand-cyan transition-all";
            div.innerHTML = `
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-8 h-8 rounded-lg bg-brand-cyan/10 flex items-center justify-center"><i class="fa-solid fa-location-dot text-brand-cyan text-xs"></i></div>
                    <h4 class="font-black text-[11px] uppercase tracking-tighter">${addr.alias}</h4>
                </div>
                <p class="text-sm font-bold text-brand-black mb-1">${addr.address}</p>
                <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">${addr.city}, ${addr.dept}</p>
                <button onclick="deleteAddress(${index})" class="absolute top-6 right-6 text-gray-300 hover:text-brand-red transition p-2"><i class="fa-solid fa-trash-can"></i></button>`;
            list.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

window.deleteAddress = async (index) => {
    if (!confirm("¿Eliminar esta ubicación?")) return;
    const userRef = doc(db, "users", currentUserId);
    const snap = await getDoc(userRef);
    const currentAddrs = snap.data().addresses;
    currentAddrs.splice(index, 1);
    await updateDoc(userRef, { addresses: currentAddrs });
    await loadAddresses();
};

/**
 * 4. OTROS FORMULARIOS Y UTILIDADES
 */
async function loadUserData() {
    try {
        const userSnap = await getDoc(doc(db, "users", currentUserId));
        if (userSnap.exists()) {
            const data = userSnap.data();
            if (document.getElementById('form-name')) document.getElementById('form-name').value = data.name || auth.currentUser.displayName || "";
            if (document.getElementById('form-id')) document.getElementById('form-id').value = data.document || "";
            if (document.getElementById('form-phone')) document.getElementById('form-phone').value = data.phone || "";
            if (document.getElementById('form-birth')) document.getElementById('form-birth').value = data.birthdate || "";
        }
    } catch (e) { console.error(e); }
}

async function loadUserOrders() {
    const container = document.getElementById('orders-container');
    if (!container) return;
    try {
        const q = query(collection(db, "orders"), where("userId", "==", currentUserId), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        container.innerHTML = snap.empty ? `<div class="bg-white p-12 rounded-[2.5rem] text-center border border-dashed border-gray-200"><i class="fa-solid fa-box-open text-4xl text-gray-100 mb-4"></i><p class="text-gray-400 font-black uppercase text-[10px] tracking-widest">Sin compras registradas.</p></div>` : "";
        snap.forEach(docSnap => {
            const order = docSnap.data();
            const date = order.createdAt.toDate().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
            const card = document.createElement('div');
            card.className = "bg-white rounded-[2.5rem] border border-gray-100 shadow-sm mb-6 overflow-hidden";
            card.innerHTML = `
                <div class="p-8">
                    <div class="flex justify-between items-center mb-6">
                        <div><p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Orden #${docSnap.id.slice(0, 8).toUpperCase()}</p><h3 class="text-xl font-black">${date}</h3></div>
                        <span class="bg-brand-black text-white px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest">${order.status}</span>
                    </div>
                    <div class="space-y-4">
                        ${order.items.map(item => `
                            <div class="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                                <img src="${item.mainImage || item.image}" class="w-12 h-12 rounded-xl object-contain bg-white p-1 border">
                                <div class="flex-grow"><p class="font-bold text-xs uppercase">${item.name}</p>
                                <div class="flex gap-2 mt-1">
                                    ${item.color ? `<span class="text-[7px] font-black uppercase text-gray-400">Color: ${item.color}</span>` : ''}
                                    ${item.capacity ? `<span class="text-[7px] font-black uppercase text-brand-cyan">Cap: ${item.capacity}</span>` : ''}
                                </div></div>
                                <span class="font-black text-sm">$${(item.price * item.quantity).toLocaleString('es-CO')}</span>
                            </div>`).join('')}
                    </div>
                </div>`;
            container.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await updateDoc(doc(db, "users", currentUserId), {
            name: document.getElementById('form-name').value,
            document: document.getElementById('form-id').value,
            phone: document.getElementById('form-phone').value,
            birthdate: document.getElementById('form-birth').value,
            updatedAt: new Date()
        });
        alert("Perfil actualizado ✨");
    } catch (e) { alert("Error"); }
});

document.querySelectorAll('.nav-link').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active', 'bg-brand-cyan', 'text-brand-black'));
        btn.classList.add('active');
        const targetId = btn.dataset.target;
        document.querySelectorAll('.page-section').forEach(sec => sec.classList.remove('active'));
        document.getElementById(targetId)?.classList.add('active');
    };
});

// CORRECCIÓN AQUÍ: Usamos una constante para el botón y verificamos su existencia
const logoutBtn = document.getElementById('btn-logout-profile');

if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        // Evitamos cualquier comportamiento por defecto
        e.preventDefault();
        
        const confirmacion = confirm("¿Deseas cerrar tu sesión técnica en PixelTech?");
        
        if (confirmacion) {
            try {
                // Importante: signOut viene de tu firebase-init
                await signOut(auth);
                console.log("Sesión finalizada correctamente");
                window.location.href = "/index.html";
            } catch (error) {
                console.error("Error al cerrar sesión:", error);
                alert("No se pudo cerrar la sesión. Intenta de nuevo.");
            }
        }
    });
}

function updateCartCounter() {
    const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
    const countEl = document.getElementById('cart-count');
    if (countEl) countEl.textContent = cart.reduce((acc, item) => acc + (item.quantity || 1), 0);
}

// Cierra las listas de resultados si se hace click fuera
document.addEventListener('click', (e) => {
    if (!deptInput.contains(e.target)) deptResults.classList.add('hidden');
    if (!cityInput.contains(e.target)) cityResults.classList.add('hidden');
});

