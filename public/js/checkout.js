import { auth, db, doc, getDoc, updateDoc, collection, runTransaction, serverTimestamp, onAuthStateChanged, arrayUnion, functions, httpsCallable } from "./firebase-init.js";
import { getCart, getCartTotal, updateCartCount } from "./cart.js";

// --- REFERENCIAS DOM ---
const els = {
    form: document.getElementById('checkout-form'),
    itemsContainer: document.getElementById('checkout-items'),
    subtotal: document.getElementById('check-subtotal'),
    shippingCost: document.getElementById('check-shipping'),
    total: document.getElementById('check-total'),
    freeShippingMsg: document.getElementById('free-shipping-msg'),
    dispatchMsg: document.getElementById('dispatch-time-msg'), 
    btnSubmit: document.getElementById('btn-complete-order'),
    
    // Inputs Envío
    savedAddrSelect: document.getElementById('saved-addresses-select'),
    idNumber: document.getElementById('cust-id-number'),
    name: document.getElementById('cust-name'),
    phone: document.getElementById('cust-phone'),
    address: document.getElementById('cust-address'),
    postal: document.getElementById('cust-postal'),
    deptSelect: document.getElementById('shipping-dept'),
    citySelect: document.getElementById('shipping-city'),
    notes: document.getElementById('cust-notes'),
    saveAddrCheck: document.getElementById('save-address-check'),

    // DOM Pagos
    codInput: document.getElementById('payment-cod'),
    codContainer: document.getElementById('cod-container'),
    codWarning: document.getElementById('cod-warning'),
    onlineInput: document.getElementById('payment-online'),

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
// Filtramos items agotados para no procesarlos
let cart = getCart().filter(item => item.maxStock === undefined || item.maxStock > 0);

let shippingConfig = null;
let currentShippingCost = 0;
let selectedPaymentMethod = 'MANUAL';
// --- 1. INICIALIZACIÓN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (cart.length === 0) {
            alert("Tu carrito no tiene productos disponibles para comprar.");
            window.location.href = '/shop/cart.html';
            return;
        }

        currentUser = user;
        
        // Carga Paralela Optimizada
        await Promise.all([ 
            loadShippingConfigSmart(), // <--- Optimizado
            loadDepartments()          // API Externa (0 lecturas)
        ]);
        
        await loadUserDataSmart(user.uid); // <--- Optimizado
        
        renderOrderSummary();
        setupPaymentListeners(); 
        validatePaymentMethods(); 
    } else {
        sessionStorage.setItem('redirect_after_login', '/shop/checkout.html');
        window.location.href = '/auth/login.html';
    }
});

// --- 2. LÓGICA DE MÉTODOS DE PAGO ---
function setupPaymentListeners() {
    const radios = document.querySelectorAll('input[name="payment_method"]');
    radios.forEach(r => {
        r.addEventListener('change', (e) => {
            selectedPaymentMethod = e.target.value;
            updateSubmitButtonText();
        });
    });
}

function validatePaymentMethods() {
    const city = els.citySelect.value || "";
    // Validación básica: Solo Bogotá permite contra entrega (ejemplo)
    const isBogota = city.toLowerCase().includes('bogot'); 

    if (isBogota) {
        els.codInput.disabled = false;
        els.codContainer.classList.remove('payment-disabled', 'opacity-50', 'grayscale', 'pointer-events-none');
        els.codWarning.classList.add('hidden');
    } else {
        els.codInput.disabled = true;
        els.codContainer.classList.add('payment-disabled', 'opacity-50', 'grayscale', 'pointer-events-none');
        els.codWarning.classList.remove('hidden');

        if (els.codInput.checked) {
            els.onlineInput.checked = true;
            selectedPaymentMethod = 'ONLINE';
            updateSubmitButtonText();
        }
    }
}

function updateSubmitButtonText() {
    const btn = els.btnSubmit;
    btn.className = "w-full mt-10 font-black py-5 rounded-2xl transition-all duration-300 uppercase text-xs tracking-[0.25em] flex items-center justify-center gap-3 cursor-pointer hover:shadow-lg";

    if (selectedPaymentMethod === 'MANUAL') {
        // NUEVO CASO
        btn.innerHTML = `Confirmar Transferencia Manual <i class="fa-solid fa-building-columns"></i>`;
        btn.classList.add('bg-gray-600', 'text-white');
    }
    else if (selectedPaymentMethod === 'COD') {
        btn.innerHTML = `Confirmar Contra Entrega <i class="fa-solid fa-truck-fast"></i>`;
        btn.classList.add('bg-brand-black', 'text-white');
    } 
    else if (selectedPaymentMethod === 'ONLINE') {
        btn.innerHTML = `Ir a Pagar con MercadoPago <i class="fa-solid fa-lock"></i>`;
        btn.classList.add('bg-blue-600', 'text-white');
    } 
    else if (selectedPaymentMethod === 'ADDI') {
        btn.innerHTML = `Pagar con ADDI <i class="fa-solid fa-arrow-right"></i>`;
        btn.classList.add('bg-[#00D6D6]', 'text-white');
    }
}

// ==========================================================================
// 🧠 CARGA INTELIGENTE (SMART LOAD)
// ==========================================================================

// A. Configuración de Envío
async function loadShippingConfigSmart() {
    // 1. Intentar leer de SessionStorage
    const cachedConfig = sessionStorage.getItem('pixeltech_shipping_config');
    
    if (cachedConfig) {
        console.log("⚡ [Checkout] Config envío desde caché.");
        shippingConfig = JSON.parse(cachedConfig);
    } else {
        // 2. Si no existe, leer de Firebase
        console.log("☁️ [Checkout] Descargando config envío...");
        try {
            const snap = await getDoc(doc(db, "config", "shipping"));
            shippingConfig = snap.exists() ? snap.data() : { freeThreshold: 0, defaultPrice: 0, groups: [] };
            
            // Guardar para el resto de la sesión
            sessionStorage.setItem('pixeltech_shipping_config', JSON.stringify(shippingConfig));
        } catch (e) { console.error("Config Error:", e); }
    }
    
    checkDispatchTime(shippingConfig.cutoffTime || "14:00");
}

// B. Datos del Usuario y Direcciones
async function loadUserDataSmart(uid) {
    try {
        // 1. Intentar reconstruir perfil desde SessionStorage (usado en profile.js y cart.js)
        const cachedProfile = sessionStorage.getItem('pixeltech_user_profile');
        const cachedAddr = sessionStorage.getItem('pixeltech_user_addresses');

        if (cachedProfile && cachedAddr) {
            console.log("⚡ [Checkout] Perfil cargado desde caché.");
            const profile = JSON.parse(cachedProfile);
            const addresses = JSON.parse(cachedAddr);
            
            // Reconstruimos el objeto completo que espera el checkout
            userProfileData = { ...profile, addresses: addresses };
        } else {
            // 2. Fallback a Firebase
            console.log("☁️ [Checkout] Descargando perfil completo...");
            const snap = await getDoc(doc(db, "users", uid));
            if (!snap.exists()) return;
            userProfileData = snap.data();

            // Guardamos en caché disgregado para que sirva también en profile.js
            const { addresses, ...profileData } = userProfileData;
            sessionStorage.setItem('pixeltech_user_profile', JSON.stringify(profileData));
            sessionStorage.setItem('pixeltech_user_addresses', JSON.stringify(addresses || []));
        }

        // Llenar Formulario
        if (!els.idNumber.value) els.idNumber.value = userProfileData.document || ""; 
        if (!els.name.value) els.name.value = userProfileData.name || currentUser.displayName || "";
        if (!els.phone.value) els.phone.value = userProfileData.phone || userProfileData.contactPhone || "";

        const addresses = userProfileData.addresses || [];
        els.savedAddrSelect.innerHTML = '<option value="">-- Mis Direcciones Guardadas --</option>';
        
        let defaultIndex = -1;
        addresses.forEach((addr, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${addr.alias} (${addr.city}) ${addr.isDefault ? '★' : ''}`;
            els.savedAddrSelect.appendChild(opt);
            if (addr.isDefault) defaultIndex = idx;
        });

        if (defaultIndex >= 0) {
            els.savedAddrSelect.value = defaultIndex;
            fillFormWithData(addresses[defaultIndex]);
        } 

    } catch (e) { console.error("Profile Error:", e); }
}

// --- UTILIDADES ---

function checkDispatchTime(cutoffTimeStr) {
    if(!els.dispatchMsg) return;
    const now = new Date();
    const [hours, minutes] = cutoffTimeStr.split(':').map(Number);
    const cutoffDate = new Date();
    cutoffDate.setHours(hours, minutes, 0, 0);

    const isBeforeCutoff = now < cutoffDate;
    const diffHrs = Math.floor((cutoffDate - now) / 3600000);
    const diffMins = Math.floor(((cutoffDate - now) % 3600000) / 60000);

    els.dispatchMsg.classList.remove('hidden');

    if (isBeforeCutoff) {
        let timeText = "";
        if(diffHrs > 0) timeText += `${diffHrs}h `;
        timeText += `${diffMins}m`;
        els.dispatchMsg.innerHTML = `<p class="text-[10px] font-black uppercase text-green-600 pulse-text"><i class="fa-solid fa-bolt text-yellow-500 mr-1"></i> Pide en <span class="underline">${timeText}</span> y despachamos HOY</p>`;
    } else {
        els.dispatchMsg.innerHTML = `<p class="text-[10px] font-black uppercase text-blue-500"><i class="fa-solid fa-calendar-check mr-1"></i> Tu pedido será despachado MAÑANA</p>`;
    }
}

async function loadDepartments() {
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        depts.sort((a, b) => a.name.localeCompare(b.name));
        els.deptSelect.innerHTML = '<option value="">Seleccione...</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; 
            opt.textContent = d.name;
            opt.dataset.name = d.name; 
            els.deptSelect.appendChild(opt);
        });
    } catch (e) { console.error("API Dept Error:", e); }
}

els.savedAddrSelect.addEventListener('change', (e) => {
    const idx = e.target.value;
    if (idx === "") {
        els.form.reset();
        els.name.value = userProfileData.name || "";
        els.phone.value = userProfileData.phone || "";
        els.idNumber.value = userProfileData.document || "";
        validatePaymentMethods(); 
        return;
    }
    const addresses = userProfileData.addresses || [];
    const selectedAddr = addresses[idx];
    if (selectedAddr) fillFormWithData(selectedAddr);
});

async function fillFormWithData(data) {
    els.address.value = data.address || "";
    els.postal.value = data.zip || "";
    els.notes.value = data.notes || "";

    if (data.dept) {
        const deptOptions = Array.from(els.deptSelect.options);
        const foundDeptOpt = deptOptions.find(opt => opt.dataset.name && opt.dataset.name.toLowerCase() === data.dept.toLowerCase());
        
        if (foundDeptOpt) {
            els.deptSelect.value = foundDeptOpt.value;
            await loadCitiesForDept(foundDeptOpt.value);
            
            if (data.city) {
                const cityOptions = Array.from(els.citySelect.options);
                const foundCityOpt = cityOptions.find(opt => opt.textContent.toLowerCase() === data.city.toLowerCase());
                if (foundCityOpt) {
                    els.citySelect.value = foundCityOpt.value;
                    calculateShipping(); 
                }
            }
        }
    }
    validatePaymentMethods(); 
}

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
            opt.value = c.name;
            opt.textContent = c.name;
            els.citySelect.appendChild(opt);
        });
        els.citySelect.disabled = false;
    } catch (e) { console.error(e); }
}

els.citySelect.addEventListener('change', () => { calculateShipping(); validatePaymentMethods(); });

// --- 4. CÁLCULOS Y UI ---
function calculateShipping() {
    const cartTotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    
    const city = els.citySelect.value;
    const deptOpt = els.deptSelect.options[els.deptSelect.selectedIndex];
    const dept = deptOpt ? deptOpt.dataset.name : "";

    if (!els.shippingCost) return;

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
                const match = group.cities.some(c => c.toLowerCase().includes(city.toLowerCase()));
                if (match) { foundPrice = group.price; break; }
            }
        }
        currentShippingCost = (foundPrice !== null) ? foundPrice : shippingConfig.defaultPrice;
    }

    els.shippingCost.textContent = currentShippingCost === 0 ? "GRATIS" : `$${currentShippingCost.toLocaleString('es-CO')}`;
    updateTotalDisplay();
    toggleSubmitBtn(true);
}

function updateTotalDisplay() {
    const cartTotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const t = cartTotal + currentShippingCost;
    
    els.subtotal.textContent = `$${cartTotal.toLocaleString('es-CO')}`;
    els.total.textContent = `$${t.toLocaleString('es-CO')}`;
}

function toggleSubmitBtn(enable) {
    if (enable) {
        els.btnSubmit.disabled = false;
        els.btnSubmit.classList.remove('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
        updateSubmitButtonText(); 
    } else {
        els.btnSubmit.disabled = true;
        els.btnSubmit.className = "w-full mt-10 bg-gray-200 text-gray-400 font-black py-5 rounded-2xl transition-all duration-300 uppercase text-xs tracking-[0.25em] flex items-center justify-center gap-3 cursor-not-allowed";
        els.btnSubmit.innerHTML = `Confirmar Pedido <div class="w-6 h-6 rounded-full bg-white/50 flex items-center justify-center"><i class="fa-solid fa-check"></i></div>`;
    }
}

// --- 5. LOGICA PRINCIPAL DE SUBMIT ---
els.btnSubmit.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!els.name.value || !els.phone.value || !els.idNumber.value || !els.citySelect.value || !els.address.value) {
        alert("⚠️ Completa todos los campos obligatorios."); 
        return;
    }

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
    if (selectedPaymentMethod === 'MANUAL') {
        // NUEVO CASO: Usamos la misma función de COD para crear la orden directa
        await processCODOrder(billData);
    }
    if (selectedPaymentMethod === 'COD') {
        await processCODOrder(billData);
    } 
    else if (selectedPaymentMethod === 'ONLINE') {
        if (!auth.currentUser) return window.location.href = '/auth/login.html';
        const btnHtml = els.btnSubmit.innerHTML;
        els.btnSubmit.disabled = true;
        els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando...`;

        try {
            const token = await auth.currentUser.getIdToken(true);
            const createPreference = httpsCallable(functions, 'createMercadoPagoPreference');
            const deptName = els.deptSelect.options[els.deptSelect.selectedIndex]?.dataset.name || "";
            const fullShippingData = {
                name: els.name.value,
                phone: els.phone.value,
                department: deptName,
                city: els.citySelect.value,
                address: els.address.value,
                postalCode: els.postal.value,
                notes: els.notes.value || ""
            };

            const payloadCompleto = {
                userToken: String(token),
                shippingCost: Number(currentShippingCost),
                items: cart.map(i => ({ id: i.id, quantity: i.quantity, color: i.color || "", capacity: i.capacity || "" })),
                extraData: {
                    userName: els.name.value,
                    clientDoc: els.idNumber.value, 
                    needsInvoice: els.checkInvoice.checked, 
                    billingData: billData, 
                    shippingData: fullShippingData, 
                    source: 'TIENDA' 
                },
                buyerInfo: {
                    name: els.name.value,
                    email: auth.currentUser.email,
                    phone: els.phone.value,
                    address: els.address.value,
                    postal: els.postal.value
                }
            };

            const response = await createPreference(payloadCompleto);
            const { initPoint } = response.data;
            if (initPoint) {
                localStorage.setItem('pending_order_data', JSON.stringify({ items: cart, shipping: els.address.value, buyerInfo: { name: els.name.value, email: auth.currentUser.email } }));
                window.location.href = initPoint; 
            } else throw new Error("No se recibió link de pago.");

        } catch (error) {
            console.error("❌ Error:", error);
            alert("Error: " + (error.message || "Desconocido"));
            els.btnSubmit.disabled = false;
            els.btnSubmit.innerHTML = btnHtml;
        }
    }
    else if (selectedPaymentMethod === 'ADDI') {
        if (!auth.currentUser) return window.location.href = '/auth/login.html';
        if (!els.idNumber.value || els.idNumber.value.length < 5) return alert("⚠️ Se requiere Documento válido para ADDI.");
        if (!els.phone.value || els.phone.value.length < 10) return alert("⚠️ Se requiere Celular válido para ADDI.");

        const btnHtml = els.btnSubmit.innerHTML;
        els.btnSubmit.disabled = true;
        els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando...`;

        try {
            const token = await auth.currentUser.getIdToken(true);
            const createAddi = httpsCallable(functions, 'createAddiCheckout');
            const deptName = els.deptSelect.options[els.deptSelect.selectedIndex]?.dataset.name || "";
            const fullShippingData = {
                name: els.name.value,
                phone: els.phone.value,
                department: deptName,
                city: els.citySelect.value,
                address: els.address.value,
                postalCode: els.postal.value,
                notes: els.notes.value || ""
            };

            const payloadCompleto = {
                userToken: String(token),
                shippingCost: Number(currentShippingCost),
                items: cart.map(i => ({ id: i.id, quantity: i.quantity, color: i.color || "", capacity: i.capacity || "" })),
                extraData: {
                    userName: els.name.value,
                    clientDoc: els.idNumber.value, 
                    phone: els.phone.value,        
                    needsInvoice: els.checkInvoice.checked, 
                    billingData: billData, 
                    shippingData: fullShippingData, 
                    source: 'TIENDA' 
                },
                buyerInfo: {
                    name: els.name.value,
                    email: auth.currentUser.email,
                    phone: els.phone.value,
                    address: els.address.value
                }
            };

            const response = await createAddi(payloadCompleto);
            const { initPoint } = response.data;
            if (initPoint) {
                localStorage.setItem('pending_order_data', JSON.stringify({ items: cart, method: 'ADDI' }));
                window.location.href = initPoint; 
            } else throw new Error("No se recibió link de ADDI.");

        } catch (error) {
            console.error("❌ Error ADDI:", error);
            alert("Error ADDI: " + (error.message || "Desconocido"));
            els.btnSubmit.disabled = false;
            els.btnSubmit.innerHTML = btnHtml;
        }
    }
});

// --- 6. PROCESAMIENTO CONTRA ENTREGA (COD) ---
async function processCODOrder(billData) {
    const btnHtml = els.btnSubmit.innerHTML;
    els.btnSubmit.disabled = true;
    els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Confirmando...`;

    try {
        if (!auth.currentUser) throw new Error("Debes iniciar sesión.");
        const userToken = await auth.currentUser.getIdToken(true); 
        const deptName = els.deptSelect.options[els.deptSelect.selectedIndex]?.dataset.name || "";
        const shippingData = {
            name: els.name.value,
            phone: els.phone.value,
            department: deptName,
            city: els.citySelect.value,
            address: els.address.value,
            postalCode: els.postal.value,
            notes: els.notes.value || ""
        };

        const payload = {
            userToken: String(userToken),
            items: cart.map(i => ({ id: i.id, quantity: i.quantity, color: i.color || "", capacity: i.capacity || "" })),
            shippingCost: currentShippingCost,
            extraData: {
                userName: els.name.value,
                clientDoc: els.idNumber.value,
                phone: els.phone.value,
                needsInvoice: els.checkInvoice.checked,
                billingData: billData,
                shippingData: shippingData,
                source: 'TIENDA_WEB'
            }
        };

        const createCOD = httpsCallable(functions, 'createCODOrder');
        const response = await createCOD(payload);
        const { orderId } = response.data;

        if (els.saveAddrCheck.checked) {
            const newAddr = {
                alias: `Envío ${new Date().toLocaleDateString()}`,
                address: els.address.value,
                dept: deptName,
                city: els.citySelect.value,
                zip: els.postal.value,
                notes: els.notes.value,
                isDefault: false
            };
            updateDoc(doc(db, "users", currentUser.uid), { addresses: arrayUnion(newAddr) }).catch(console.warn);
            // IMPORTANTE: Invalidar caché de direcciones para que profile.js la recargue fresca
            sessionStorage.removeItem('pixeltech_user_addresses');
        }

        localStorage.removeItem('pixeltech_cart');
        updateCartCount();
        window.location.href = `/shop/success.html?order=${orderId}`;

    } catch (error) {
        console.error("❌ Error COD:", error);
        alert("Error: " + (error.message || error));
        els.btnSubmit.disabled = false;
        els.btnSubmit.innerHTML = btnHtml;
    }
}

// --- 7. RENDERIZADO DEL RESUMEN ---
els.checkInvoice.addEventListener('change', (e) => {
    e.target.checked ? els.billingForm.classList.remove('hidden') : els.billingForm.classList.add('hidden');
});

function renderOrderSummary() {
    // Totales calculados en el inicio con items válidos
    const totalItems = cart.reduce((acc, item) => acc + (item.quantity || 1), 0);
    const qtyDisplay = document.getElementById('order-qty-display');
    if(qtyDisplay) qtyDisplay.textContent = `${totalItems} Ítems`;

    els.itemsContainer.innerHTML = cart.map(item => {
        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
        const discountPercent = hasDiscount ? Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100) : 0;
        const lineTotal = item.price * item.quantity;
        const lineOriginalTotal = item.originalPrice * item.quantity;

        return `
        <div class="flex items-center gap-4 py-3 border-b border-dashed border-gray-50 last:border-0">
            <div class="w-14 h-14 bg-white border border-gray-100 rounded-xl p-1 flex items-center justify-center shrink-0 relative">
                <img src="${item.image || item.mainImage || 'https://placehold.co/50'}" class="max-w-full max-h-full object-contain">
                ${hasDiscount ? `
                    <span class="absolute -top-2 -left-2 bg-brand-red text-white text-[7px] font-black px-1.5 py-0.5 rounded-full shadow-sm border border-white">-${discountPercent}%</span>
                ` : `
                    <span class="absolute -top-1.5 -right-1.5 bg-gray-100 text-gray-500 text-[9px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">${item.quantity}</span>
                `}
            </div>
            <div class="flex-grow min-w-0">
                <p class="text-[10px] font-black text-brand-black uppercase truncate leading-tight">${item.name}</p>
                <div class="flex flex-wrap gap-1 mt-1">
                    ${item.color ? `<span class="text-[8px] bg-slate-50 border border-slate-100 px-1.5 rounded text-gray-500 font-bold uppercase">${item.color}</span>` : ''}
                    ${item.capacity ? `<span class="text-[8px] bg-slate-50 border border-slate-100 px-1.5 rounded text-gray-500 font-bold uppercase">${item.capacity}</span>` : ''}
                </div>
            </div>
            <div class="text-right flex flex-col items-end justify-center">
                ${hasDiscount ? `
                    <span class="text-[9px] font-bold text-gray-300 line-through decoration-gray-300">$${lineOriginalTotal.toLocaleString('es-CO')}</span>
                    <span class="text-xs font-black text-brand-red">$${lineTotal.toLocaleString('es-CO')}</span>
                ` : `
                    <span class="text-xs font-black text-brand-black">$${lineTotal.toLocaleString('es-CO')}</span>
                `}
            </div>
        </div>
    `}).join('');
    
    updateTotalDisplay();
}