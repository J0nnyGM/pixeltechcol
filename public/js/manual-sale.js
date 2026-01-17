import { db, collection, getDocs, doc, runTransaction, addDoc, query, orderBy } from './firebase-init.js';
import { adjustStock } from './inventory-core.js';

// --- HTML DEL MODAL (PLANTILLA) ---
const MODAL_HTML = `
<div id="manual-modal" class="fixed inset-0 z-[80] hidden flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-md" id="btn-close-overlay"></div>
    <div class="relative bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div class="p-8 border-b border-gray-100 flex justify-between items-center bg-slate-50/50">
            <h3 class="text-2xl font-black tracking-tighter uppercase text-brand-black">Nueva <span class="text-brand-cyan">Venta Directa</span></h3>
            <button class="w-10 h-10 rounded-full bg-white border border-gray-200 text-gray-400 hover:bg-brand-red hover:text-white transition flex items-center justify-center" id="btn-close-x"><i class="fa-solid fa-xmark"></i></button>
        </div>
        
        <div class="p-8 overflow-y-auto space-y-8 custom-scroll bg-white">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="relative">
                    <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Buscar Cliente</label>
                    <input type="text" id="m-cust-search" placeholder="Nombre..." class="w-full bg-slate-50 border border-gray-100 p-4 rounded-2xl text-sm font-bold outline-none focus:border-brand-cyan transition-colors text-brand-black">
                    <div id="m-cust-results" class="absolute z-50 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl hidden max-h-48 overflow-y-auto p-2 custom-scroll"></div>
                </div>
                <div>
                    <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Contacto</label>
                    <input type="text" id="m-cust-phone" class="w-full bg-slate-50 border border-gray-100 p-4 rounded-2xl text-sm font-bold outline-none text-brand-black" readonly>
                </div>
            </div>

            <div class="bg-gray-50 p-6 rounded-[2rem] border border-gray-100 space-y-4 relative group">
                <div class="absolute -top-3 left-6 bg-white px-2 text-[9px] font-black uppercase text-brand-cyan tracking-widest">Datos de Entrega</div>
                
                <div class="grid grid-cols-1 gap-4">
                    <label class="text-[9px] font-black uppercase text-brand-black tracking-widest block">Tipo de Entrega</label>
                    <select id="m-shipping-mode" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black">
                        <option value="pickup">📍 Recogida en Local / Contraentrega</option>
                        <option value="new" selected>🚚 Nueva Dirección</option>
                        <option value="saved" disabled id="opt-saved-addr">🏠 Dirección Guardada (Seleccione Cliente)</option>
                    </select>
                </div>

                <div id="container-saved-addr" class="hidden">
                    <select id="m-saved-addr-select" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black">
                        <option value="">Seleccione...</option>
                    </select>
                </div>

                <div id="container-new-addr">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                        <div>
                            <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Departamento</label>
                            <select id="m-dept-manual" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black"><option value="">Seleccionar...</option></select>
                        </div>
                        <div>
                            <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Ciudad</label>
                            <select id="m-city-manual" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black" disabled><option value="">Seleccione Depto primero</option></select>
                        </div>
                    </div>
                    <div>
                        <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Dirección Exacta</label>
                        <input type="text" id="m-address-manual" placeholder="Ej: Calle 123 # 45 - 67, Barrio..." class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-sm font-bold outline-none focus:border-brand-cyan text-brand-black">
                    </div>
                </div>
            </div>

            <div class="bg-brand-cyan/5 border border-brand-cyan/10 p-4 rounded-2xl flex items-center justify-between">
                <div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-brand-cyan text-white flex items-center justify-center text-sm"><i class="fa-solid fa-file-invoice"></i></div><p class="text-xs font-black uppercase text-brand-black">¿Factura Electrónica?</p></div>
                <label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" id="m-requires-invoice" class="sr-only peer"><div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-cyan"></div></label>
            </div>

            <div class="space-y-4">
                <div class="flex justify-between items-center border-b border-gray-100 pb-2"><h4 class="text-[10px] font-black text-brand-black uppercase tracking-widest">Productos</h4><button id="btn-add-item-row" class="text-brand-cyan hover:text-brand-black text-[10px] font-black uppercase tracking-widest transition flex items-center gap-2"><i class="fa-solid fa-circle-plus text-lg"></i> Añadir</button></div>
                <div id="manual-items-container" class="space-y-4"></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                <div>
                    <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Método de Pago</label>
                    <div class="relative"><select id="m-payment-account" class="w-full bg-slate-50 border border-gray-200 p-4 rounded-2xl text-sm font-bold outline-none focus:border-green-500 transition-all appearance-none cursor-pointer text-brand-black"><option value="credit">⏳ Cartera (Pendiente)</option></select><i class="fa-solid fa-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-brand-black pointer-events-none"></i></div>
                </div>
            </div>
        </div>
        
        <div class="p-8 border-t border-gray-100 bg-slate-50 grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
             <div>
                <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Costo de Envío</label>
                <input type="text" id="m-shipping-cost" value="$0" class="currency-input w-full bg-white border border-gray-200 p-4 rounded-2xl text-lg font-black outline-none focus:border-brand-cyan text-brand-black text-right">
            </div>
            <div class="text-right md:col-span-1">
                <p class="text-[9px] font-black text-brand-black uppercase tracking-widest">Total a Pagar</p>
                <h4 id="manual-total-display" class="text-3xl font-black text-brand-black">$0</h4>
            </div>
            <button id="btn-save-manual" class="bg-brand-black text-white font-black px-10 py-4 rounded-xl shadow-xl uppercase text-xs tracking-widest hover:bg-brand-cyan transition transform active:scale-95 h-full">Generar Venta</button>
        </div>
    </div>
</div>
`;

// --- VARIABLES GLOBALES DEL MODULO ---
let allProducts = [];
let selectedUserId = null;
let currentUserAddresses = [];
let onSuccessCallback = null;

// --- INICIALIZAR ---
export function initManualSale(onSuccess) {
    // 1. Inyectar HTML si no existe
    if (!document.getElementById('manual-modal')) {
        document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
        setupEventListeners();
    }
    onSuccessCallback = onSuccess;
}

// --- UTILIDADES MONEDA ---
function formatCurrency(num) {
    return '$ ' + num.toLocaleString('es-CO');
}

function parseCurrency(str) {
    return Number(str.replace(/[^0-9-]/g, '')) || 0;
}

function setupCurrencyInput(input) {
    input.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = formatCurrency(val);
        calculateManualTotal();
    });
    input.addEventListener('focus', (e) => e.target.select());
}

// --- OPEN MODAL ---
export async function openManualSaleModal() {
    const modal = document.getElementById('manual-modal');
    const container = document.getElementById('manual-items-container');
    
    // Resetear formulario
    selectedUserId = null;
    currentUserAddresses = [];
    document.getElementById('m-cust-search').value = "";
    document.getElementById('m-cust-phone').value = "";
    document.getElementById('manual-total-display').textContent = "$ 0";
    document.getElementById('m-shipping-cost').value = "$ 0";
    document.getElementById('m-dept-manual').value = "";
    document.getElementById('m-city-manual').value = "";
    document.getElementById('m-address-manual').value = "";
    container.innerHTML = "";

    // Cargar dependencias
    await Promise.all([loadPaymentAccounts(), loadManualDepartments(), loadProducts()]);
    
    // Añadir primera fila
    addManualItemRow();
    
    // Activar input envío
    setupCurrencyInput(document.getElementById('m-shipping-cost'));

    modal.classList.remove('hidden');
}

function setupEventListeners() {
    // Cerrar
    document.getElementById('btn-close-x').onclick = () => document.getElementById('manual-modal').classList.add('hidden');
    document.getElementById('btn-close-overlay').onclick = () => document.getElementById('manual-modal').classList.add('hidden');

    // Añadir Item
    document.getElementById('btn-add-item-row').onclick = addManualItemRow;

    // Guardar
    document.getElementById('btn-save-manual').onclick = saveOrder;

    // Buscador Cliente
    setupCustomerSearch();

    // Toggle Envío
    const shipSelect = document.getElementById('m-shipping-mode');
    shipSelect.onchange = (e) => {
        const val = e.target.value;
        document.getElementById('container-saved-addr').classList.toggle('hidden', val !== 'saved');
        document.getElementById('container-new-addr').classList.toggle('hidden', val !== 'new');
    };

    // Depto -> Ciudad
    const mDept = document.getElementById('m-dept-manual');
    const mCity = document.getElementById('m-city-manual');
    mDept.onchange = async (e) => {
        if(!e.target.value) return;
        mCity.disabled = true; mCity.innerHTML = '<option>Cargando...</option>';
        try {
            const res = await fetch(`https://api-colombia.com/api/v1/Department/${e.target.value}/cities`);
            const cities = await res.json();
            mCity.innerHTML = '<option value="">Ciudad...</option>';
            cities.forEach(c => mCity.innerHTML += `<option value="${c.name}">${c.name}</option>`);
            mCity.disabled = false;
        } catch(e) { console.error(e); }
    };
}

// --- LOGICA PRODUCTOS ---
async function loadProducts() {
    if (allProducts.length > 0) return;
    const snap = await getDocs(collection(db, "products"));
    snap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
}

function addManualItemRow() {
    const div = document.createElement('div');
    div.className = "item-row-container bg-slate-50 p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3 animate-fadeIn";
    div.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div class="md:col-span-4 relative">
                <label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Producto</label>
                <input type="text" placeholder="Buscar..." class="p-search w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-bold outline-none focus:border-brand-cyan text-brand-black">
                <div class="p-results absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl hidden max-h-40 overflow-y-auto custom-scroll"></div>
            </div>
            <div class="md:col-span-3 flex gap-2 p-variants-container"></div>
             <div class="md:col-span-3">
                <label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Precio Unit.</label>
                <input type="text" class="p-price-display currency-input w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-bold text-center outline-none focus:border-brand-cyan text-brand-black">
            </div>
            <div class="md:col-span-2 flex items-center gap-2">
                <div class="w-full"><label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Cant.</label><input type="number" value="1" min="1" class="p-qty w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-black text-center outline-none focus:border-brand-cyan text-brand-black"></div>
                <button class="mb-0.5 w-10 h-10 rounded-xl bg-white border border-gray-200 text-brand-black hover:bg-brand-red hover:text-white transition flex items-center justify-center shrink-0 btn-remove-row"><i class="fa-solid fa-trash-can text-xs"></i></button>
            </div>
        </div>
        <input type="hidden" class="p-id"><input type="hidden" class="p-img">`;
    
    document.getElementById('manual-items-container').appendChild(div);
    
    // Setup listeners for this row
    const priceInput = div.querySelector('.p-price-display');
    setupCurrencyInput(priceInput);
    div.querySelector('.p-qty').onchange = calculateManualTotal;
    div.querySelector('.btn-remove-row').onclick = () => { div.remove(); calculateManualTotal(); };
    setupProductSearch(div);
}

function setupProductSearch(row) {
    const searchInput = row.querySelector('.p-search');
    const resultsDiv = row.querySelector('.p-results');

    searchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        resultsDiv.innerHTML = "";
        if (term.length < 1) { resultsDiv.classList.add('hidden'); return; }
        const filtered = allProducts.filter(p => p.name.toLowerCase().includes(term));
        filtered.forEach(p => {
            const d = document.createElement('div');
            d.className = "p-3 hover:bg-slate-50 cursor-pointer border-b border-gray-50 last:border-0";
            d.innerHTML = `<p class="text-[10px] font-black uppercase text-brand-black line-clamp-1">${p.name}</p><p class="text-[9px] font-bold text-brand-cyan">${formatCurrency(p.price)}</p>`;
            d.onclick = () => {
                searchInput.value = p.name;
                row.querySelector('.p-id').value = p.id;
                row.querySelector('.p-price-display').value = formatCurrency(p.price);
                row.querySelector('.p-img').value = p.mainImage || p.image;
                resultsDiv.classList.add('hidden');
                renderVariants(row, p);
                calculateManualTotal();
            };
            resultsDiv.appendChild(d);
        });
        resultsDiv.classList.remove('hidden');
    };
}

function renderVariants(row, product) {
    const container = row.querySelector('.p-variants-container');
    container.innerHTML = "";
    if (product.variants?.length > 0) {
        const wrap = document.createElement('div'); wrap.className = "flex-1";
        wrap.innerHTML = `<label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Color</label>`;
        const sel = document.createElement('select'); sel.className = "p-color w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-bold outline-none text-brand-black";
        sel.innerHTML = product.variants.map(v => `<option value="${v.color}">${v.color}</option>`).join('');
        wrap.appendChild(sel); container.appendChild(wrap);
    }
    if (product.capacities?.length > 0) {
        const wrap = document.createElement('div'); wrap.className = "flex-1";
        wrap.innerHTML = `<label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Capacidad</label>`;
        const sel = document.createElement('select'); sel.className = "p-capacity w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-bold outline-none text-brand-black";
        sel.innerHTML = product.capacities.map(c => `<option value="${c.label}" data-price="${c.price}">${c.label}</option>`).join('');
        sel.onchange = (e) => {
            const opt = e.target.options[e.target.selectedIndex];
            if(opt.dataset.price) {
                row.querySelector('.p-price-display').value = formatCurrency(parseFloat(opt.dataset.price));
            }
            calculateManualTotal();
        };
        sel.dispatchEvent(new Event('change'));
        wrap.appendChild(sel); container.appendChild(wrap);
    }
}

function calculateManualTotal() {
    let subtotal = 0;
    document.querySelectorAll('.item-row-container').forEach(row => {
        const price = parseCurrency(row.querySelector('.p-price-display').value);
        const qty = parseInt(row.querySelector('.p-qty').value) || 0;
        subtotal += price * qty;
    });
    
    const shipping = parseCurrency(document.getElementById('m-shipping-cost').value);
    const total = subtotal + shipping;
    
    document.getElementById('manual-total-display').textContent = formatCurrency(total);
}

// --- LOGICA CLIENTES Y DIRECCIONES ---
async function setupCustomerSearch() {
    const search = document.getElementById('m-cust-search');
    const results = document.getElementById('m-cust-results');
    const phone = document.getElementById('m-cust-phone');
    const optSaved = document.getElementById('opt-saved-addr');
    const savedSelect = document.getElementById('m-saved-addr-select');
    const modeSelect = document.getElementById('m-shipping-mode');

    search.oninput = async (e) => {
        const term = e.target.value.toLowerCase();
        results.innerHTML = "";
        if (term.length < 2) { results.classList.add('hidden'); return; }
        
        const snap = await getDocs(collection(db, "users"));
        let found = false;
        
        snap.forEach(d => {
            const u = d.data();
            if ((u.name || "").toLowerCase().includes(term)) {
                found = true;
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-slate-50 cursor-pointer text-xs font-bold rounded-xl transition flex justify-between items-center border-b border-gray-50 last:border-0";
                div.innerHTML = `<span class="uppercase text-brand-black">${u.name}</span>`;
                div.onclick = () => {
                    search.value = u.name;
                    phone.value = u.phone || "";
                    selectedUserId = d.id;
                    currentUserAddresses = u.addresses || [];
                    
                    // Manejar direcciones
                    if (currentUserAddresses.length > 0) {
                        optSaved.disabled = false;
                        optSaved.textContent = "🏠 Dirección Guardada";
                        savedSelect.innerHTML = '<option value="">Seleccione...</option>';
                        currentUserAddresses.forEach((a, i) => savedSelect.innerHTML += `<option value="${i}">${a.alias} - ${a.address}</option>`);
                        modeSelect.value = 'saved';
                    } else {
                        optSaved.disabled = true;
                        optSaved.textContent = "🏠 Sin direcciones guardadas";
                        modeSelect.value = 'new';
                    }
                    modeSelect.dispatchEvent(new Event('change')); // Trigger toggle
                    results.classList.add('hidden');
                };
                results.appendChild(div);
            }
        });
        if(found) results.classList.remove('hidden');
    };
}

async function loadPaymentAccounts() {
    const sel = document.getElementById('m-payment-account');
    sel.innerHTML = `<option value="credit">⏳ Cartera (Pendiente)</option>`;
    try {
        const q = query(collection(db, "accounts"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        snap.forEach(d => sel.innerHTML += `<option value="${d.id}">🏦 ${d.data().name}</option>`);
    } catch(e) { console.error(e); }
}

async function loadManualDepartments() {
    const sel = document.getElementById('m-dept-manual');
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const data = await res.json();
        sel.innerHTML = '<option value="">Seleccionar...</option>';
        data.forEach(d => sel.innerHTML += `<option value="${d.id}">${d.name}</option>`);
    } catch(e) { console.error(e); }
}

// --- GUARDAR ---
async function saveOrder() {
    const btn = document.getElementById('btn-save-manual');
    const custName = document.getElementById('m-cust-search').value;
    const items = [];
    
    document.querySelectorAll('.item-row-container').forEach(row => {
        const id = row.querySelector('.p-id').value;
        if(id) items.push({
            id,
            name: row.querySelector('.p-search').value,
            price: parseCurrency(row.querySelector('.p-price-display').value),
            quantity: parseInt(row.querySelector('.p-qty').value),
            image: row.querySelector('.p-img').value,
            color: row.querySelector('.p-color')?.value || null,
            capacity: row.querySelector('.p-capacity')?.value || null
        });
    });

    if (!custName || items.length === 0) return alert("🚨 Datos incompletos");

    btn.disabled = true; btn.innerHTML = 'Procesando...';

    const shippingMode = document.getElementById('m-shipping-mode').value;
    let shippingData = {};
    
    if (shippingMode === 'pickup') {
        shippingData = { address: "📍 Recogida en Local" };
    } else if (shippingMode === 'saved') {
        const idx = document.getElementById('m-saved-addr-select').value;
        if (idx === "") { alert("Seleccione dirección"); btn.disabled=false; btn.innerText="Generar"; return; }
        const a = currentUserAddresses[idx];
        shippingData = { department: a.dept, city: a.city, address: `${a.address} (${a.alias})` };
    } else {
        const dSelect = document.getElementById('m-dept-manual');
        shippingData = {
            department: dSelect.options[dSelect.selectedIndex]?.text || "",
            city: document.getElementById('m-city-manual').value || "",
            address: document.getElementById('m-address-manual').value || ""
        };
    }

    const shippingCost = parseCurrency(document.getElementById('m-shipping-cost').value);
    
    try {
        const subtotal = items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        const total = subtotal + shippingCost;
        const accountId = document.getElementById('m-payment-account').value;

        // 1. Stock
        for (const item of items) { await adjustStock(item.id, -(item.quantity), item.color, item.capacity); }

        // 2. Pago
        let paymentStatus = 'PENDING';
        let paymentMethodName = 'Crédito / Cartera';
        if (accountId !== 'credit') {
             await runTransaction(db, async (t) => {
                 const ref = doc(db, "accounts", accountId);
                 const d = await t.get(ref);
                 if(!d.exists()) throw "Error cuenta";
                 t.update(ref, { balance: (d.data().balance || 0) + total });
                 paymentMethodName = d.data().name;
             });
             paymentStatus = 'PAID';
        }

        // 3. Crear
        const orderData = {
            userId: selectedUserId || "DIRECTA", userName: custName, 
            phone: document.getElementById('m-cust-phone').value,
            items, total, subtotal, shippingCost,
            status: 'PENDIENTE', source: 'DIRECTA',
            requiresInvoice: document.getElementById('m-requires-invoice').checked,
            paymentStatus, paymentAccountId: accountId === 'credit' ? null : accountId, paymentMethodName,
            createdAt: new Date(), shippingData
        };

        const orderRef = await addDoc(collection(db, "orders"), orderData);
        await addDoc(collection(db, "remissions"), { ...orderData, orderId: orderRef.id, status: 'PENDIENTE_ALISTAMIENTO', type: 'DIRECTA' });

        alert("✅ Venta Creada");
        document.getElementById('manual-modal').classList.add('hidden');
        if (onSuccessCallback) onSuccessCallback();

    } catch (e) {
        console.error(e);
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false; btn.innerText = "Generar Venta";
    }
}