import { auth, db, onAuthStateChanged, doc, getDoc, updateDoc, collection, getDocs, query, where, orderBy, signOut } from "./firebase-init.js";

let currentUserId = null;
let allDepartments = [];
let allCities = [];
let editingAddressIndex = -1; // -1 significa "Creando nueva", >= 0 es el índice de la dirección en el array

// ELEMENTOS DOM
const addrModal = document.getElementById('address-modal');
const addrForm = document.getElementById('address-form');
const deptInput = document.getElementById('modal-dept-search');
const deptResults = document.getElementById('dept-results');
const cityInput = document.getElementById('modal-city-search');
const cityResults = document.getElementById('city-results');
const cityContainer = document.getElementById('city-input-container');

// --- 1. CONTROL DE SESIÓN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        updateUserUI(user);
        await loadUserData();
        await loadUserOrders();
        await loadAddresses();
        updateCartCounter();
        initColombiaAPI();
    } else {
        window.location.href = "/auth/login.html";
    }
});

function updateUserUI(user) {
    const nameSide = document.getElementById('user-name-side');
    const emailSide = document.getElementById('user-email-side');
    const avatar = document.getElementById('user-avatar');
    const name = user.displayName || "Usuario";

    if (nameSide) nameSide.textContent = name;
    if (emailSide) emailSide.textContent = user.email;
    if (avatar) avatar.innerHTML = `<span class="font-black">${name.substring(0, 2).toUpperCase()}</span>`;
}

// --- 2. API COLOMBIA ---
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

        cityInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            cityResults.innerHTML = "";
            if (term.length < 1) { cityResults.classList.add('hidden'); return; }

            allCities.filter(c => c.name.toLowerCase().includes(term)).forEach(city => {
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
    } catch (e) { console.error(e); }
}

async function loadCities(deptId) {
    cityInput.disabled = true; cityInput.value = "Cargando...";
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        allCities = await res.json();
        cityInput.disabled = false; cityInput.value = ""; cityInput.placeholder = "Selecciona ciudad...";
        cityContainer.classList.remove('opacity-50');
    } catch (e) { console.error(e); }
}

// --- 3. GESTIÓN DIRECCIONES (CREAR / EDITAR / ELIMINAR / DEFAULT) ---
const toggleModal = (show, isEdit = false) => {
    if (show) {
        addrModal.classList.add('active');
        document.getElementById('modal-addr-title').innerHTML = isEdit ? `Editar <span class="text-brand-cyan">Ubicación</span>` : `Nueva <span class="text-brand-cyan">Ubicación</span>`;
    } else {
        addrModal.classList.remove('active');
        addrForm.reset();
        cityContainer.classList.add('opacity-50');
        cityInput.disabled = true;
        editingAddressIndex = -1; 
    }
};

if(document.getElementById('btn-open-address-modal')) document.getElementById('btn-open-address-modal').onclick = () => toggleModal(true, false);
if(document.getElementById('btn-close-modal')) document.getElementById('btn-close-modal').onclick = () => toggleModal(false);
if(document.getElementById('btn-cancel-modal')) document.getElementById('btn-cancel-modal').onclick = () => toggleModal(false);

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

        // Si esta es default, quitamos default a las demás
        if (newAddr.isDefault) {
            currentAddrs = currentAddrs.map(a => ({ ...a, isDefault: false }));
        }
        // Si es la primera, forzamos default
        if (currentAddrs.length === 0) newAddr.isDefault = true;

        if (editingAddressIndex >= 0) {
            // Editar existente
            currentAddrs[editingAddressIndex] = newAddr;
        } else {
            // Agregar nueva
            currentAddrs.push(newAddr);
        }

        await updateDoc(userRef, { addresses: currentAddrs });
        toggleModal(false);
        await loadAddresses();
        alert(editingAddressIndex >= 0 ? "Dirección actualizada" : "Dirección guardada");

    } catch (error) {
        console.error(error);
        alert("Error al guardar");
    } finally {
        btn.disabled = false; btn.textContent = "Guardar";
    }
};

// Función global para editar (llamada desde el botón HTML)
window.editAddress = async (index) => {
    editingAddressIndex = index;
    try {
        const snap = await getDoc(doc(db, "users", currentUserId));
        const addr = snap.data().addresses[index];
        
        // Llenar formulario
        document.getElementById('modal-addr-alias').value = addr.alias;
        document.getElementById('modal-addr-value').value = addr.address;
        deptInput.value = addr.dept;
        cityInput.value = addr.city;
        cityInput.disabled = false; // Habilitar ciudad si ya existe
        cityContainer.classList.remove('opacity-50');
        
        document.getElementById('modal-addr-zip').value = addr.zip || "";
        document.getElementById('modal-addr-notes').value = addr.notes || "";
        document.getElementById('modal-addr-default').checked = addr.isDefault || false;

        toggleModal(true, true);
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

async function loadAddresses() {
    const list = document.getElementById('addresses-list');
    if (!list) return;
    try {
        const userSnap = await getDoc(doc(db, "users", currentUserId));
        const addresses = userSnap.data()?.addresses || [];
        list.innerHTML = addresses.length === 0 ? `<p class="col-span-full text-center text-gray-400 py-10 border-2 border-dashed border-gray-200 rounded-2xl text-xs font-bold uppercase">No tienes direcciones guardadas</p>` : "";

        addresses.forEach((addr, index) => {
            const isDef = addr.isDefault;
            const div = document.createElement('div');
            div.className = `bg-white p-6 rounded-[2rem] border ${isDef ? 'border-brand-cyan ring-1 ring-brand-cyan/20' : 'border-gray-100'} shadow-sm relative group hover:shadow-lg transition-all`;
            div.innerHTML = `
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg ${isDef ? 'bg-brand-cyan text-brand-black' : 'bg-slate-100 text-gray-400'} flex items-center justify-center">
                            <i class="fa-solid ${isDef ? 'fa-star' : 'fa-location-dot'} text-xs"></i>
                        </div>
                        <h4 class="font-black text-xs uppercase tracking-tight text-brand-black">${addr.alias}</h4>
                    </div>
                    ${isDef ? '<span class="text-[8px] font-black uppercase bg-brand-cyan/10 text-brand-cyan px-2 py-1 rounded">Principal</span>' : ''}
                </div>
                <p class="text-sm font-bold text-gray-700 mb-1">${addr.address}</p>
                <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-4">${addr.city}, ${addr.dept}</p>
                ${addr.zip ? `<p class="text-[9px] text-gray-400 font-bold mb-1">CP: ${addr.zip}</p>` : ''}
                ${addr.notes ? `<p class="text-[9px] text-gray-400 italic mb-4">"${addr.notes}"</p>` : ''}
                
                <div class="flex gap-2 border-t border-gray-50 pt-4">
                    <button onclick="window.editAddress(${index})" class="flex-1 bg-slate-50 py-2 rounded-xl text-[10px] font-black uppercase text-gray-500 hover:bg-brand-cyan hover:text-brand-black transition">Editar</button>
                    <button onclick="window.deleteAddress(${index})" class="w-10 h-10 flex items-center justify-center bg-slate-50 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500 transition"><i class="fa-solid fa-trash-can"></i></button>
                </div>`;
            list.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

// --- 4. LISTADO DE PEDIDOS (REDIRECCIÓN) ---
async function loadUserOrders() {
    const container = document.getElementById('orders-container');
    if (!container) return;
    try {
        const q = query(collection(db, "orders"), where("userId", "==", currentUserId), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        
        if(snap.empty) {
            container.innerHTML = `<div class="bg-white p-12 rounded-[2.5rem] text-center border border-dashed border-gray-200"><i class="fa-solid fa-box-open text-4xl text-gray-100 mb-4"></i><p class="text-gray-400 font-black uppercase text-[10px] tracking-widest">Aún no has realizado compras.</p></div>`;
            return;
        }

        container.innerHTML = "";
        snap.forEach(docSnap => {
            const order = docSnap.data();
            const date = order.createdAt.toDate().toLocaleDateString('es-CO');
            
            const card = document.createElement('div');
            // AQUÍ: Redirección al hacer clic
            card.className = "bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 hover:border-brand-cyan/30 hover:shadow-md transition cursor-pointer group";
            card.onclick = () => window.location.href = `/shop/order-detail.html?id=${docSnap.id}`;

            let statusColor = "bg-yellow-50 text-yellow-600";
            if(order.status === 'DESPACHADO') statusColor = "bg-green-50 text-green-600";
            if(order.status === 'CANCELADO') statusColor = "bg-red-50 text-red-600";

            card.innerHTML = `
                <div class="flex justify-between items-center mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-brand-black font-bold border border-gray-100 group-hover:bg-brand-cyan group-hover:border-transparent transition">
                            <i class="fa-solid fa-receipt"></i>
                        </div>
                        <div>
                            <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Orden #${docSnap.id.slice(0, 6)}</p>
                            <h4 class="text-sm font-black text-brand-black">${date}</h4>
                        </div>
                    </div>
                    <span class="${statusColor} px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">${order.status || 'Pendiente'}</span>
                </div>
                <div class="flex justify-between items-end border-t border-gray-50 pt-4">
                    <p class="text-[10px] font-bold text-gray-400 uppercase">${order.items.length} Productos</p>
                    <p class="text-lg font-black text-brand-black">$${(order.total || 0).toLocaleString('es-CO')}</p>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

// 5. OTROS DATOS DE PERFIL
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
        alert("Perfil actualizado correctamente");
    } catch (e) { alert("Error"); }
    finally { btn.disabled = false; btn.textContent = "Guardar Cambios"; }
});

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

function updateCartCounter() {
    const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
    const countEl = document.getElementById('cart-count');
    if (countEl) countEl.textContent = cart.reduce((acc, item) => acc + (item.quantity || 1), 0);
}

document.addEventListener('click', (e) => {
    if (!deptInput.contains(e.target)) deptResults.classList.add('hidden');
    if (!cityInput.contains(e.target)) cityResults.classList.add('hidden');
});