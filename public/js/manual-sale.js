import { db, collection, doc, runTransaction, addDoc, setDoc, getDocs, query, orderBy } from './firebase-init.js';
import { adjustStock } from './inventory-core.js';

// --- HTML DEL MODAL (PLANTILLA) ---
const MODAL_HTML = `
<div id="manual-modal" class="fixed inset-0 z-[80] hidden flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-md" id="btn-close-overlay"></div>
    <div class="relative bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div class="p-8 border-b border-gray-100 flex justify-between items-center bg-slate-50/50 shrink-0">
            <h3 class="text-2xl font-black tracking-tighter uppercase text-brand-black">Nueva <span class="text-brand-cyan">Venta Directa</span></h3>
            <button class="w-10 h-10 rounded-full bg-white border border-gray-200 text-gray-400 hover:bg-brand-red hover:text-white transition flex items-center justify-center" id="btn-close-x"><i class="fa-solid fa-xmark"></i></button>
        </div>
        
        <div class="p-8 overflow-y-auto space-y-8 custom-scroll bg-white flex-1">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="relative group">
                    <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Buscar Cliente (Opcional)</label>
                    <input type="text" id="m-cust-search" autocomplete="off" placeholder="Escribe el nombre o teléfono..." class="w-full bg-slate-50 border border-gray-100 p-4 rounded-2xl text-sm font-bold outline-none focus:border-brand-cyan focus:bg-white transition-colors text-brand-black shadow-sm">
                    <div id="m-cust-results" class="absolute z-50 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl hidden max-h-48 overflow-y-auto p-2 custom-scroll"></div>
                </div>
                <div>
                    <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Contacto / Teléfono</label>
                    <input type="text" id="m-cust-phone" placeholder="Número del cliente" class="w-full bg-slate-50 border border-gray-100 p-4 rounded-2xl text-sm font-bold outline-none focus:border-brand-cyan transition-colors text-brand-black">
                </div>
            </div>

            <div class="bg-gray-50 p-6 rounded-[2rem] border border-gray-100 space-y-4 relative group">
                <div class="absolute -top-3 left-6 bg-white px-2 text-[9px] font-black uppercase text-brand-cyan tracking-widest">Datos de Entrega</div>
                
                <div class="grid grid-cols-1 gap-4">
                    <label class="text-[9px] font-black uppercase text-brand-black tracking-widest block">Tipo de Entrega</label>
                    <select id="m-shipping-mode" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black">
                        <option value="pickup">📍 Recogida en Local / Contraentrega</option>
                        <option value="new" selected>🚚 Nueva Dirección Nacional</option>
                        <option value="saved" disabled id="opt-saved-addr">🏠 Dirección Guardada (Seleccione Cliente)</option>
                    </select>
                </div>

                <div id="container-saved-addr" class="hidden animate-in fade-in slide-in-from-top-2">
                    <select id="m-saved-addr-select" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black">
                        <option value="">Seleccione...</option>
                    </select>
                </div>

                <div id="container-new-addr" class="animate-in fade-in slide-in-from-top-2">
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
                <div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-brand-cyan text-white flex items-center justify-center text-sm shadow-sm"><i class="fa-solid fa-file-invoice"></i></div><p class="text-xs font-black uppercase text-brand-black">¿Factura Electrónica?</p></div>
                <label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" id="m-requires-invoice" class="sr-only peer"><div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-cyan"></div></label>
            </div>

            <div class="space-y-4">
                <div class="flex justify-between items-center border-b border-gray-100 pb-2">
                    <h4 class="text-[10px] font-black text-brand-black uppercase tracking-widest">Productos</h4>
                    <button id="btn-add-item-row" class="text-brand-cyan hover:text-brand-black text-[10px] font-black uppercase tracking-widest transition flex items-center gap-2 bg-cyan-50 px-3 py-1.5 rounded-lg"><i class="fa-solid fa-circle-plus text-sm"></i> Añadir Línea</button>
                </div>
                <div id="manual-items-container" class="space-y-4"></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                <div>
                    <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Método de Pago</label>
                    <div class="relative"><select id="m-payment-account" class="w-full bg-slate-50 border border-gray-200 p-4 rounded-2xl text-sm font-bold outline-none focus:border-green-500 transition-all appearance-none cursor-pointer text-brand-black shadow-sm"><option value="credit">⏳ Cartera (Pendiente por Cobrar)</option></select><i class="fa-solid fa-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-brand-black pointer-events-none"></i></div>
                </div>
            </div>
        </div>
        
        <div class="p-8 border-t border-gray-100 bg-slate-50 grid grid-cols-1 md:grid-cols-3 gap-6 items-end shrink-0">
             <div>
                <label class="text-[9px] font-black uppercase text-brand-black tracking-widest mb-2 block">Costo de Envío Adicional</label>
                <input type="text" id="m-shipping-cost" value="$ 0" class="currency-input w-full bg-white border border-gray-200 p-4 rounded-2xl text-lg font-black outline-none focus:border-brand-cyan text-brand-black text-right shadow-sm">
            </div>
            <div class="text-right md:col-span-1">
                <p class="text-[9px] font-black text-brand-black uppercase tracking-widest">Total de la Venta</p>
                <h4 id="manual-total-display" class="text-4xl font-black text-brand-black tracking-tighter leading-none">$0</h4>
            </div>
            <button id="btn-save-manual" class="bg-brand-black text-white font-black px-10 py-5 rounded-2xl shadow-xl uppercase text-xs tracking-widest hover:bg-brand-cyan hover:text-brand-black transition-all duration-300 transform active:scale-95 h-full flex items-center justify-center gap-2">
                <i class="fa-solid fa-check-double"></i> Generar Venta
            </button>
        </div>
    </div>
</div>
`;

// --- VARIABLES GLOBALES DEL MÓDULO ---
let manualProductsCache = []; 
let manualClientsCache = [];
let selectedUserId = null;
let currentUserAddresses = [];
let onSuccessCallback = null;

// --- UTILIDADES ---
const formatCurrency = (num) => '$ ' + num.toLocaleString('es-CO');
const parseCurrency = (str) => Number(str.replace(/[^0-9-]/g, '')) || 0;
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

function setupCurrencyInput(input) {
    input.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = formatCurrency(val);
        calculateManualTotal();
    });
    input.addEventListener('focus', (e) => e.target.select());
}

// --- INICIALIZAR ---
export function initManualSale(onSuccess) {
    if (!document.getElementById('manual-modal')) {
        document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
        setupEventListeners();
    }
    onSuccessCallback = onSuccess;
}

// --- OPEN MODAL (Inteligente) ---
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

    // Cargas Paralelas y uso de Caché Global
    await Promise.all([
        loadPaymentAccounts(), 
        loadManualDepartments(), 
        loadCaches() // <- Magia 0 lecturas
    ]);
    
    addManualItemRow();
    setupCurrencyInput(document.getElementById('m-shipping-cost'));

    modal.classList.remove('hidden');
}

// --- 1. LÓGICA DE CACHÉ INTELIGENTE (0 LECTURAS) ---
async function loadCaches() {
    // A. Productos: Intentamos leer la llave maestra central
    try {
        const prodCacheStr = localStorage.getItem('pixeltech_admin_master_inventory');
        if (prodCacheStr) {
            const parsed = JSON.parse(prodCacheStr);
            if (parsed.map) {
                manualProductsCache = Object.values(parsed.map).filter(p => p.status === 'active');
                console.log(`⚡ [Venta Manual] ${manualProductsCache.length} productos cargados de la RAM central.`);
            }
        }
        
        // Si por alguna razón está vacío (el admin borró el caché)
        if (manualProductsCache.length === 0) {
            console.warn("☁️ [Venta Manual] Caché de productos vacío, forzando descarga...");
            const snap = await getDocs(query(collection(db, "products"), where("status", "==", "active")));
            manualProductsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
    } catch(e) { console.error("Error cacheando productos:", e); }

    // B. Clientes: Intentamos leer la llave que debió crearse si el admin visitó clients.html
    try {
        const clientCacheStr = sessionStorage.getItem('pixeltech_admin_clients_cache'); // Asegurarnos de usar la misma si existe
        // Como clients no usa localStorage persistente, lo leemos en background de Firebase 1 sola vez por recarga
        if (manualClientsCache.length === 0) {
            const cSnap = await getDocs(collection(db, "users"));
            manualClientsCache = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
    } catch(e) {}
}

function setupEventListeners() {
    document.getElementById('btn-close-x').onclick = () => document.getElementById('manual-modal').classList.add('hidden');
    document.getElementById('btn-close-overlay').onclick = () => document.getElementById('manual-modal').classList.add('hidden');
    document.getElementById('btn-add-item-row').onclick = addManualItemRow;
    document.getElementById('btn-save-manual').onclick = saveOrder;

    setupCustomerSearch();

    const shipSelect = document.getElementById('m-shipping-mode');
    shipSelect.onchange = (e) => {
        const val = e.target.value;
        document.getElementById('container-saved-addr').classList.toggle('hidden', val !== 'saved');
        document.getElementById('container-new-addr').classList.toggle('hidden', val !== 'new');
    };

    const mDept = document.getElementById('m-dept-manual');
    const mCity = document.getElementById('m-city-manual');
    mDept.onchange = async (e) => {
        if(!e.target.value) return;
        mCity.disabled = true; mCity.innerHTML = '<option>Cargando...</option>';
        try {
            const res = await fetch(`https://api-colombia.com/api/v1/Department/${e.target.value}/cities`);
            const cities = await res.json();
            cities.sort((a,b)=>a.name.localeCompare(b.name));
            mCity.innerHTML = '<option value="">Ciudad...</option>';
            cities.forEach(c => mCity.innerHTML += `<option value="${c.name}">${c.name}</option>`);
            mCity.disabled = false;
        } catch(e) { console.error(e); }
    };
}


// --- LÓGICA FILAS Y PRODUCTOS ---
function addManualItemRow() {
    const div = document.createElement('div');
    div.className = "item-row-container bg-slate-50 p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3 animate-in fade-in slide-in-from-top-2";
    div.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end relative">
            <div class="md:col-span-4 relative">
                <label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Producto</label>
                <div class="relative">
                    <input type="text" autocomplete="off" placeholder="Buscar por nombre o SKU..." class="p-search w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-bold outline-none focus:border-brand-cyan text-brand-black pr-8">
                    <i class="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs pointer-events-none"></i>
                </div>
                <div class="p-results absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl hidden max-h-48 overflow-y-auto custom-scroll"></div>
            </div>
            <div class="md:col-span-3 flex gap-2 p-variants-container"></div>
             <div class="md:col-span-3">
                <label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Precio Unit. (Editable)</label>
                <input type="text" class="p-price-display currency-input w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-bold text-center outline-none focus:border-brand-cyan text-brand-black shadow-sm">
            </div>
            <div class="md:col-span-2 flex items-center gap-2">
                <div class="w-full">
                    <label class="text-[8px] font-black text-brand-black uppercase mb-1 block text-center">Cant.</label>
                    <input type="number" value="1" min="1" class="p-qty w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-black text-center outline-none focus:border-brand-cyan text-brand-black shadow-sm">
                </div>
                <button class="mb-0.5 w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:bg-brand-red hover:text-white transition flex items-center justify-center shrink-0 btn-remove-row shadow-sm"><i class="fa-solid fa-trash-can text-xs"></i></button>
            </div>
        </div>
        <input type="hidden" class="p-id"><input type="hidden" class="p-img"><input type="hidden" class="p-max-stock">`;
    
    document.getElementById('manual-items-container').appendChild(div);
    
    const priceInput = div.querySelector('.p-price-display');
    setupCurrencyInput(priceInput);
    
    const qtyInput = div.querySelector('.p-qty');
    qtyInput.onchange = () => {
        // Validación en tiempo real del stock
        const max = parseInt(div.querySelector('.p-max-stock').value) || 999;
        const current = parseInt(qtyInput.value) || 1;
        if (current > max) {
            alert(`⚠️ Solo hay ${max} unidades disponibles en inventario.`);
            qtyInput.value = max;
        }
        if (current < 1) qtyInput.value = 1;
        calculateManualTotal();
    };

    div.querySelector('.btn-remove-row').onclick = () => { div.remove(); calculateManualTotal(); };
    setupProductSearch(div);
}

function setupProductSearch(row) {
    const searchInput = row.querySelector('.p-search');
    const resultsDiv = row.querySelector('.p-results');

    searchInput.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        resultsDiv.innerHTML = "";
        
        if (term.length < 2) { 
            resultsDiv.classList.add('hidden'); 
            return; 
        }
        
        // Búsqueda instantánea en RAM (0 lecturas)
        const filtered = manualProductsCache.filter(p => {
            const searchStr = p.searchStr || normalizeText(`${p.name} ${p.sku || ''}`);
            return searchStr.includes(term);
        });

        if (filtered.length === 0) {
            resultsDiv.innerHTML = `<div class="p-3 text-[10px] text-gray-400 text-center uppercase font-bold">No encontrado</div>`;
        } else {
            // Mostrar máximo 15 para no saturar
            filtered.slice(0, 15).forEach(p => {
                const isOutOfStock = p.stock <= 0;
                const d = document.createElement('div');
                d.className = `p-3 flex items-center justify-between border-b border-gray-50 last:border-0 ${isOutOfStock ? 'bg-gray-50 opacity-60 cursor-not-allowed' : 'hover:bg-cyan-50 cursor-pointer transition'}`;
                
                d.innerHTML = `
                    <div class="flex-1 min-w-0 pr-2">
                        <p class="text-[10px] font-black uppercase text-brand-black line-clamp-1 ${isOutOfStock ? 'line-through text-gray-400' : ''}">${p.name}</p>
                        <p class="text-[9px] font-bold text-gray-400">SKU: ${p.sku || '--'} | Stock: <span class="${isOutOfStock ? 'text-red-500' : 'text-brand-cyan'}">${p.stock || 0}</span></p>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-[10px] font-black text-brand-black">${formatCurrency(p.price)}</p>
                    </div>
                `;

                if (!isOutOfStock) {
                    d.onclick = () => {
                        searchInput.value = p.name;
                        row.querySelector('.p-id').value = p.id;
                        row.querySelector('.p-price-display').value = formatCurrency(p.price);
                        row.querySelector('.p-img').value = p.mainImage || p.image || (p.images ? p.images[0] : '');
                        row.querySelector('.p-max-stock').value = p.stock; // Guardamos el límite
                        
                        resultsDiv.classList.add('hidden');
                        renderVariants(row, p);
                        calculateManualTotal();
                    };
                } else {
                    d.onclick = () => alert("Producto agotado, no se puede vender.");
                }
                resultsDiv.appendChild(d);
            });
        }
        resultsDiv.classList.remove('hidden');
    });

    // Cerrar resultados si hace clic fuera
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
            resultsDiv.classList.add('hidden');
        }
    });
}

function renderVariants(row, product) {
    const container = row.querySelector('.p-variants-container');
    container.innerHTML = "";
    
    let colors = [];
    if (product.definedColors) colors = product.definedColors;
    else if (product.combinations) colors = product.combinations.map(v => v.color).filter(c => c);
    colors = [...new Set(colors)]; 

    let caps = [];
    if (product.definedCapacities) caps = product.definedCapacities;
    else if (product.capacities) caps = product.capacities.map(c => c.label);
    caps = [...new Set(caps)];

    if (colors.length > 0) {
        const wrap = document.createElement('div'); wrap.className = "flex-1";
        wrap.innerHTML = `<label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Color</label>`;
        const sel = document.createElement('select'); sel.className = "p-color w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-bold outline-none text-brand-black cursor-pointer";
        sel.innerHTML = `<option value="">--</option>` + colors.map(c => `<option value="${c}">${c}</option>`).join('');
        wrap.appendChild(sel); container.appendChild(wrap);
    }
    
    if (caps.length > 0) {
        const wrap = document.createElement('div'); wrap.className = "flex-1";
        wrap.innerHTML = `<label class="text-[8px] font-black text-brand-black uppercase mb-1 block">Capacidad</label>`;
        const sel = document.createElement('select'); sel.className = "p-capacity w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-bold outline-none text-brand-black cursor-pointer";
        sel.innerHTML = `<option value="">--</option>` + caps.map(c => {
            // Buscamos si tiene precio específico en array viejo (capacities) o nuevo (combinations)
            let cPrice = product.price;
            if (product.capacities) {
                const capObj = product.capacities.find(x => x.label === c);
                if (capObj && capObj.price) cPrice = capObj.price;
            }
            return `<option value="${c}" data-price="${cPrice}">${c}</option>`;
        }).join('');
        
        sel.onchange = (e) => {
            const opt = e.target.options[e.target.selectedIndex];
            if(opt && opt.dataset.price) {
                row.querySelector('.p-price-display').value = formatCurrency(parseFloat(opt.dataset.price));
            }
            calculateManualTotal();
        };
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

    search.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        results.innerHTML = "";
        if (term.length < 2) { results.classList.add('hidden'); return; }
        
        // Filtro instantáneo en RAM
        const filtered = manualClientsCache.filter(u => {
            const nameMatch = normalizeText(u.name || "").includes(term);
            const phoneMatch = (u.phone || "").includes(term);
            return nameMatch || phoneMatch;
        });

        if (filtered.length === 0) {
            results.innerHTML = `<div class="p-3 text-[10px] text-gray-400 font-bold text-center uppercase">Cliente no registrado</div>`;
        } else {
            filtered.slice(0, 8).forEach(u => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-cyan-50 cursor-pointer rounded-xl transition flex justify-between items-center border-b border-gray-50 last:border-0";
                div.innerHTML = `
                    <div>
                        <span class="block font-black text-xs uppercase text-brand-black">${u.name}</span>
                        <span class="text-[9px] font-bold text-gray-400">${u.phone || 'Sin teléfono'}</span>
                    </div>
                    <i class="fa-solid fa-arrow-right text-brand-cyan text-[10px]"></i>
                `;
                div.onclick = () => {
                    search.value = u.name;
                    phone.value = u.phone || "";
                    selectedUserId = u.id;
                    currentUserAddresses = u.addresses || [];
                    
                    if (currentUserAddresses.length > 0) {
                        optSaved.disabled = false;
                        optSaved.textContent = `🏠 Usar Guardada (${currentUserAddresses.length})`;
                        savedSelect.innerHTML = '<option value="">Seleccione Dirección...</option>';
                        currentUserAddresses.forEach((a, i) => savedSelect.innerHTML += `<option value="${i}">${a.alias} - ${a.address}</option>`);
                        modeSelect.value = 'saved';
                    } else {
                        optSaved.disabled = true;
                        optSaved.textContent = "🏠 Sin direcciones guardadas";
                        modeSelect.value = 'new';
                    }
                    modeSelect.dispatchEvent(new Event('change'));
                    results.classList.add('hidden');
                };
                results.appendChild(div);
            });
        }
        results.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!search.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
    });
}

async function loadPaymentAccounts() {
    const sel = document.getElementById('m-payment-account');
    sel.innerHTML = `<option value="credit">⏳ Cartera (Pendiente de Cobro)</option>`;
    try {
        const q = query(collection(db, "accounts"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        snap.forEach(d => sel.innerHTML += `<option value="${d.id}">🏦 PAGO RECIBIDO EN: ${d.data().name}</option>`);
    } catch(e) { console.error(e); }
}

async function loadManualDepartments() {
    const sel = document.getElementById('m-dept-manual');
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const data = await res.json();
        data.sort((a,b) => a.name.localeCompare(b.name));
        sel.innerHTML = '<option value="">Seleccionar Depto...</option>';
        data.forEach(d => sel.innerHTML += `<option value="${d.id}">${d.name}</option>`);
    } catch(e) { console.error(e); }
}

// --- GUARDAR TRANSACCIÓN ---
async function saveOrder() {
    const btn = document.getElementById('btn-save-manual');
    const custName = document.getElementById('m-cust-search').value.trim();
    const custPhone = document.getElementById('m-cust-phone').value.trim();
    const items = [];
    
    document.querySelectorAll('.item-row-container').forEach(row => {
        const id = row.querySelector('.p-id').value;
        const qty = parseInt(row.querySelector('.p-qty').value);
        if(id && qty > 0) {
            items.push({
                id,
                name: row.querySelector('.p-search').value,
                price: parseCurrency(row.querySelector('.p-price-display').value),
                quantity: qty,
                image: row.querySelector('.p-img').value,
                color: row.querySelector('.p-color')?.value || null,
                capacity: row.querySelector('.p-capacity')?.value || null
            });
        }
    });

    if (!custName || items.length === 0) return alert("🚨 Faltan datos (Cliente o Productos).");

    const shippingMode = document.getElementById('m-shipping-mode').value;
    let shippingData = {};
    
    if (shippingMode === 'pickup') {
        shippingData = { address: "📍 Recogida en Local" };
    } else if (shippingMode === 'saved') {
        const idx = document.getElementById('m-saved-addr-select').value;
        if (idx === "") return alert("Seleccione la dirección guardada del cliente");
        const a = currentUserAddresses[idx];
        shippingData = { department: a.dept, city: a.city, address: `${a.address} (${a.alias})` };
    } else {
        const dSelect = document.getElementById('m-dept-manual');
        shippingData = {
            department: dSelect.options[dSelect.selectedIndex]?.text || "",
            city: document.getElementById('m-city-manual').value || "",
            address: document.getElementById('m-address-manual').value || ""
        };
        if(!shippingData.department || !shippingData.address) return alert("Faltan datos de la nueva dirección de entrega.");
    }

    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando Venta...';

    const shippingCost = parseCurrency(document.getElementById('m-shipping-cost').value);
    
    try {
        const subtotal = items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        const total = subtotal + shippingCost;
        const accountId = document.getElementById('m-payment-account').value;

        // Validaciones Finales
        if (total <= 0) throw new Error("El total de la venta no puede ser cero.");

        // 1. Deducir Stock (Inventory Core)
        for (const item of items) { 
            await adjustStock(item.id, -(item.quantity), item.color, item.capacity); 
        }

        // 2. Lógica Financiera
        let paymentStatus = 'PENDING';
        let paymentMethodName = 'Crédito / Cartera';
        let amountPaid = 0;

        if (accountId !== 'credit') {
             await runTransaction(db, async (t) => {
                 const ref = doc(db, "accounts", accountId);
                 const d = await t.get(ref);
                 if(!d.exists()) throw new Error("La cuenta seleccionada ya no existe.");
                 t.update(ref, { balance: (d.data().balance || 0) + total });
                 paymentMethodName = d.data().name;
             });
             paymentStatus = 'PAID';
             amountPaid = total;
        }

        // 3. Crear Orden
        const orderData = {
            userId: selectedUserId || "DIRECTA", 
            userName: custName, 
            phone: custPhone,
            items, 
            total, 
            subtotal, 
            shippingCost,
            status: 'PENDIENTE', // Pasa a la pestaña "Por Atender" del centro logístico
            source: 'MANUAL',
            requiresInvoice: document.getElementById('m-requires-invoice').checked,
            paymentStatus, 
            amountPaid,
            paymentAccountId: accountId === 'credit' ? null : accountId, 
            paymentMethodName,
            createdAt: new Date(), 
            updatedAt: new Date(),
            shippingData
        };

        const orderRef = await addDoc(collection(db, "orders"), orderData);
        
        // Usar setDoc para forzar que la remisión comparta el MISMO ID de la orden
        await setDoc(doc(db, "remissions", orderRef.id), { 
            ...orderData, 
            orderId: orderRef.id, 
            status: 'PENDIENTE_ALISTAMIENTO', 
            type: 'DIRECTA' 
        });

        alert(`✅ Venta Exitosa.\nLa orden #${orderRef.id.slice(0,6)} ha sido enviada al centro logístico.`);
        document.getElementById('manual-modal').classList.add('hidden');
        
        if (onSuccessCallback) onSuccessCallback();

    } catch (e) {
        console.error(e);
        alert("Error crítico: " + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}