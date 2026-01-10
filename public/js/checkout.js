import { auth, db, doc, getDoc, updateDoc, collection, runTransaction, serverTimestamp, onAuthStateChanged, arrayUnion } from "./firebase-init.js";
import { getCart, getCartTotal, updateCartCount } from "./cart.js";

// DOM References
const els = {
    form: document.getElementById('checkout-form'),
    itemsContainer: document.getElementById('checkout-items'),
    subtotal: document.getElementById('check-subtotal'),
    shippingCost: document.getElementById('check-shipping-cost'),
    total: document.getElementById('check-total'),
    freeShippingMsg: document.getElementById('free-shipping-msg'),
    btnSubmit: document.getElementById('btn-complete-order'),
    
    // Inputs Envío
    savedAddrSelect: document.getElementById('saved-addresses-select'),
    name: document.getElementById('cust-name'),
    phone: document.getElementById('cust-phone'),
    address: document.getElementById('cust-address'),
    postal: document.getElementById('cust-postal'),
    deptSelect: document.getElementById('shipping-dept'),
    citySelect: document.getElementById('shipping-city'),
    notes: document.getElementById('cust-notes'),
    saveAddrCheck: document.getElementById('save-address-check'),

    // Facturación
    checkInvoice: document.getElementById('check-need-invoice'),
    billingForm: document.getElementById('billing-form-checkout'),
    billInputs: {
        name: document.getElementById('bill-name'),
        taxId: document.getElementById('bill-taxid'),
        address: document.getElementById('bill-address'),
        city: document.getElementById('bill-city'),
        email: document.getElementById('bill-email'),
        phone: document.getElementById('bill-phone')
    }
};

let currentUser = null;
let userProfileData = null;
const cart = getCart();
let shippingConfig = null;
let currentShippingCost = 0;

// --- 1. INICIALIZACIÓN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        
        // 1. Cargar Configuración Admin y API Colombia primero
        await Promise.all([ loadShippingConfig(), loadDepartments() ]);
        
        // 2. Luego cargar Datos del Usuario y sus direcciones
        await loadUserData(user.uid);
        
        renderOrderSummary();
    } else {
        sessionStorage.setItem('redirect_after_login', '/shop/checkout.html');
        window.location.href = '/auth/login.html';
    }
});

// --- 2. CARGAR DATOS ---
async function loadShippingConfig() {
    try {
        const snap = await getDoc(doc(db, "config", "shipping"));
        shippingConfig = snap.exists() ? snap.data() : { freeThreshold: 0, defaultPrice: 0, groups: [] };
    } catch (e) { console.error("Config Error:", e); }
}

async function loadDepartments() {
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        depts.sort((a, b) => a.name.localeCompare(b.name));

        els.deptSelect.innerHTML = '<option value="">Seleccione...</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; // La API necesita el ID para buscar ciudades
            opt.textContent = d.name;
            opt.dataset.name = d.name; // Guardamos el nombre para comparar con Firebase
            els.deptSelect.appendChild(opt);
        });
    } catch (e) { console.error("API Dept Error:", e); }
}

async function loadUserData(uid) {
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) return;
        userProfileData = snap.data();

        // Nombre y Teléfono por defecto del perfil principal
        if (!els.name.value) els.name.value = userProfileData.name || currentUser.displayName || "";
        if (!els.phone.value) els.phone.value = userProfileData.phone || userProfileData.contactPhone || "";

        // Llenar Select de Direcciones Guardadas (Desde el array 'addresses')
        const addresses = userProfileData.addresses || []; // CORRECCIÓN: Usar 'addresses' que es lo que usa profile.js
        
        els.savedAddrSelect.innerHTML = '<option value="">-- Seleccionar o Crear Nueva --</option>';
        
        let defaultIndex = -1;

        addresses.forEach((addr, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            // Mostramos Alias + Ciudad
            opt.textContent = `${addr.alias} (${addr.city}) ${addr.isDefault ? '★' : ''}`;
            els.savedAddrSelect.appendChild(opt);

            if (addr.isDefault) defaultIndex = idx;
        });

        // --- AUTO-CARGA DE DIRECCIÓN PREDETERMINADA ---
        if (defaultIndex >= 0) {
            els.savedAddrSelect.value = defaultIndex;
            fillFormWithData(addresses[defaultIndex]);
        } 

    } catch (e) { console.error("Profile Error:", e); }
}

// --- 3. LÓGICA DE FORMULARIO ---

// Evento: Cambio en "Mis Direcciones"
els.savedAddrSelect.addEventListener('change', (e) => {
    const idx = e.target.value;
    if (idx === "") {
        // Limpiar si selecciona la opción vacía
        els.form.reset();
        els.name.value = userProfileData.name || ""; // Restaurar nombre
        els.phone.value = userProfileData.phone || "";
        return;
    }

    const addresses = userProfileData.addresses || [];
    const selectedAddr = addresses[idx];
    
    if (selectedAddr) fillFormWithData(selectedAddr);
});

async function fillFormWithData(data) {
    // Llenar campos de texto simples
    els.address.value = data.address || "";
    els.postal.value = data.zip || ""; // En profile.js se llama 'zip'
    els.notes.value = data.notes || "";

    // Lógica para Depto y Ciudad (La parte difícil)
    // En profile.js guardas el NOMBRE (ej: "Antioquia"), pero el select del checkout usa ID (ej: 2)
    
    if (data.dept) {
        // 1. Buscar el <option> cuyo texto coincida con el nombre guardado
        const deptOptions = Array.from(els.deptSelect.options);
        const foundDeptOpt = deptOptions.find(opt => 
            opt.dataset.name && opt.dataset.name.toLowerCase() === data.dept.toLowerCase()
        );
        
        if (foundDeptOpt) {
            els.deptSelect.value = foundDeptOpt.value; // Seleccionar por ID
            
            // 2. Cargar ciudades de ese depto (esperar a que la API responda)
            await loadCitiesForDept(foundDeptOpt.value);
            
            // 3. Buscar la ciudad
            if (data.city) {
                const cityOptions = Array.from(els.citySelect.options);
                const foundCityOpt = cityOptions.find(opt => 
                    opt.textContent.toLowerCase() === data.city.toLowerCase()
                );
                
                if (foundCityOpt) {
                    els.citySelect.value = foundCityOpt.value;
                    calculateShipping(); // 4. ¡Calcular precio!
                }
            }
        }
    }
}

// Lógica de API (Cascada Depto -> Ciudad)
els.deptSelect.addEventListener('change', (e) => loadCitiesForDept(e.target.value));

async function loadCitiesForDept(deptId) {
    els.citySelect.innerHTML = '<option value="">Cargando...</option>';
    els.citySelect.disabled = true;
    
    if (!deptId) {
        els.citySelect.innerHTML = '<option value="">Seleccione Depto primero</option>';
        calculateShipping(); 
        return;
    }

    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        const cities = await res.json();
        cities.sort((a, b) => a.name.localeCompare(b.name));

        els.citySelect.innerHTML = '<option value="">Seleccione Ciudad...</option>';
        cities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name; // Aquí el valor SÍ es el nombre
            opt.textContent = c.name;
            els.citySelect.appendChild(opt);
        });
        els.citySelect.disabled = false;
    } catch (e) { console.error(e); }
}

els.citySelect.addEventListener('change', calculateShipping);

// --- 4. CÁLCULO DE ENVÍO ---
function calculateShipping() {
    const cartTotal = getCartTotal();
    const city = els.citySelect.value;
    const deptOpt = els.deptSelect.options[els.deptSelect.selectedIndex];
    const dept = deptOpt ? deptOpt.dataset.name : "";

    if (!city || !dept) {
        els.shippingCost.textContent = "--";
        toggleSubmitBtn(false);
        return;
    }

    if (shippingConfig.freeThreshold > 0 && cartTotal >= shippingConfig.freeThreshold) {
        currentShippingCost = 0;
        els.freeShippingMsg.classList.remove('hidden');
    } else {
        els.freeShippingMsg.classList.add('hidden');
        
        let foundPrice = null;
        if (shippingConfig.groups) {
            for (const group of shippingConfig.groups) {
                // Comparación flexible
                const match = group.cities.some(c => c.toLowerCase().includes(city.toLowerCase()));
                if (match) {
                    foundPrice = group.price;
                    break;
                }
            }
        }
        currentShippingCost = (foundPrice !== null) ? foundPrice : shippingConfig.defaultPrice;
    }

    els.shippingCost.textContent = currentShippingCost === 0 ? "GRATIS" : `$${currentShippingCost.toLocaleString('es-CO')}`;
    updateTotalDisplay();
    toggleSubmitBtn(true);
}

function updateTotalDisplay() {
    const t = getCartTotal() + currentShippingCost;
    els.subtotal.textContent = `$${getCartTotal().toLocaleString('es-CO')}`;
    els.total.textContent = `$${t.toLocaleString('es-CO')}`;
}

function toggleSubmitBtn(enable) {
    if (enable) {
        els.btnSubmit.disabled = false;
        els.btnSubmit.classList.remove('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
        els.btnSubmit.classList.add('bg-brand-cyan', 'text-brand-black', 'hover:bg-brand-black', 'hover:text-white');
    } else {
        els.btnSubmit.disabled = true;
        els.btnSubmit.classList.add('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
        els.btnSubmit.classList.remove('bg-brand-cyan', 'text-brand-black');
    }
}

// --- 5. SUBMIT Y GUARDADO ---
els.btnSubmit.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!els.name.value || !els.phone.value || !els.citySelect.value || !els.address.value) {
        alert("⚠️ Completa todos los campos obligatorios."); return;
    }

    // Datos Factura
    let billData = null;
    if(els.checkInvoice.checked) {
        if(!els.billInputs.name.value || !els.billInputs.taxId.value) return alert("⚠️ Faltan datos de facturación.");
        billData = {
            name: els.billInputs.name.value,
            taxId: els.billInputs.taxId.value,
            address: els.billInputs.address.value,
            city: els.billInputs.city.value,
            email: els.billInputs.email.value,
            phone: els.billInputs.phone.value
        };
    }

    const btnHtml = els.btnSubmit.innerHTML;
    els.btnSubmit.disabled = true;
    els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Confirmando...`;

    try {
        const orderTotal = getCartTotal();
        const deptName = els.deptSelect.options[els.deptSelect.selectedIndex].dataset.name;
        
        await runTransaction(db, async (transaction) => {
            // Stock Check
            for (const item of cart) {
                const pRef = doc(db, "products", item.id);
                const pSnap = await transaction.get(pRef);
                if (!pSnap.exists()) throw `Producto ${item.name} no existe.`;
                const stock = pSnap.data().stock || 0;
                if (stock < item.quantity) throw `Stock insuficiente: ${item.name}`;
                transaction.update(pRef, { stock: stock - item.quantity });
            }

            // Crear Orden
            const newOrderRef = doc(collection(db, "orders"));
            const orderData = {
                userId: currentUser.uid,
                userName: els.name.value,
                userEmail: currentUser.email,
                shippingData: {
                    name: els.name.value,
                    phone: els.phone.value,
                    department: deptName,
                    city: els.citySelect.value,
                    address: els.address.value,
                    postalCode: els.postal.value,
                    notes: els.notes.value || ""
                },
                billingData: billData,
                needsInvoice: els.checkInvoice.checked,
                items: cart,
                subtotal: orderTotal,
                shippingCost: currentShippingCost,
                total: orderTotal + currentShippingCost,
                status: 'PENDIENTE',
                paymentMethod: 'CONTRAENTREGA',
                createdAt: serverTimestamp()
            };
            transaction.set(newOrderRef, orderData);
        });

        // --- LÓGICA DE GUARDAR NUEVA DIRECCIÓN ---
        if (els.saveAddrCheck.checked) {
            const newAddr = {
                alias: `Envío ${new Date().toLocaleDateString()}`, // Alias automático
                address: els.address.value,
                dept: els.deptSelect.options[els.deptSelect.selectedIndex].dataset.name, // Nombre Texto
                city: els.citySelect.value, // Nombre Texto
                zip: els.postal.value,
                notes: els.notes.value,
                isDefault: false // No la hacemos default forzosamente
            };

            try {
                // Usamos arrayUnion para agregar a la lista 'addresses' que usa profile.js
                await updateDoc(doc(db, "users", currentUser.uid), {
                    addresses: arrayUnion(newAddr)
                });
            } catch (err) { console.warn("Error guardando dirección", err); }
        }

        // Finalizar
        localStorage.removeItem('pixeltech_cart');
        updateCartCount();
        alert("✅ ¡Pedido realizado con éxito!");
        window.location.href = '/profile.html';

    } catch (error) {
        console.error(error);
        alert("Error: " + error);
        els.btnSubmit.disabled = false;
        els.btnSubmit.innerHTML = btnHtml;
    }
});

els.checkInvoice.addEventListener('change', (e) => {
    e.target.checked ? els.billingForm.classList.remove('hidden') : els.billingForm.classList.add('hidden');
});

function renderOrderSummary() {
    if (cart.length === 0) return window.location.href = '/index.html';
    els.itemsContainer.innerHTML = cart.map(item => `
        <div class="flex items-center gap-4 py-4 border-b border-gray-50 last:border-0">
            <div class="w-14 h-14 bg-white border border-gray-100 rounded-xl p-1 flex items-center justify-center shrink-0">
                <img src="${item.image || item.mainImage || 'https://placehold.co/50'}" class="max-w-full max-h-full object-contain">
            </div>
            <div class="flex-grow min-w-0">
                <p class="text-[10px] font-black text-brand-black uppercase truncate">${item.name}</p>
                <p class="text-[9px] text-gray-400 font-bold">Cant: ${item.quantity}</p>
            </div>
            <div class="text-right">
                <p class="text-[10px] font-black text-brand-black">$${(item.price * item.quantity).toLocaleString('es-CO')}</p>
            </div>
        </div>
    `).join('');
    updateTotalDisplay();
}