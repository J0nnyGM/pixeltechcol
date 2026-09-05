import { db, collection, doc, runTransaction, addDoc, setDoc, getDocs, query, orderBy, deleteDoc } from './firebase-init.js';
import { adjustStock } from './inventory-core.js';
import { AdminStore } from './admin-store.js';

// --- HTML DEL MODAL ---
const MODAL_HTML = `
<div id="manual-modal" class="fixed inset-0 z-[80] hidden flex items-center justify-center p-3 sm:p-4 md:p-6">
    <div class="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" id="btn-close-overlay"></div>
    <div class="relative bg-white w-full max-w-5xl rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden border border-slate-100">
        
        <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50/90 shrink-0">
            <div>
                <h3 class="text-xl md:text-2xl font-black tracking-tight uppercase text-brand-black leading-none">Nueva <span class="text-brand-cyan">Venta Directa</span></h3>
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Módulo de facturación manual</p>
            </div>
            <button class="w-9 h-9 rounded-full bg-white border border-gray-200 text-gray-400 hover:bg-brand-red hover:border-brand-red hover:text-white transition-colors flex items-center justify-center shadow-sm" id="btn-close-x" aria-label="Cerrar modal"><i class="fa-solid fa-xmark"></i></button>
        </div>
        
        <div class="p-5 md:p-6 overflow-y-auto space-y-5 custom-scroll bg-white flex-1">
            
            <div class="grid grid-cols-1 gap-3">
                
                <div id="m-search-section" class="relative group">
                    <label for="m-cust-search" class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1.5 block ml-1">Buscar Cliente Registrado *</label>
                    <div class="relative">
                        <i class="fa-solid fa-user absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
                        <input type="text" id="m-cust-search" autocomplete="off" placeholder="Buscar por nombre, teléfono o cédula..." class="w-full bg-slate-50 border border-gray-200 h-11 pl-10 pr-4 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan focus:bg-white transition-colors text-brand-black shadow-xs">
                    </div>
                    <div id="m-cust-results" class="absolute z-50 w-full mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-xl hidden max-h-56 overflow-y-auto p-1.5 custom-scroll"></div>
                </div>

                <div id="m-selected-client-section" class="hidden bg-slate-50/80 p-4 rounded-2xl border border-gray-100 flex justify-between items-center animate-in fade-in slide-in-from-top-2 shadow-xs">
                    <div>
                        <p class="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-0.5"><i class="fa-solid fa-check-circle mr-1"></i> Cliente Vinculado</p>
                        <p id="m-sel-cname" class="text-base font-black text-brand-black uppercase leading-tight"></p>
                        <p id="m-sel-cphone" class="text-xs font-bold text-gray-500"></p>
                    </div>
                    <button id="btn-clear-client" class="w-9 h-9 bg-white border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 rounded-full flex items-center justify-center transition shadow-sm shrink-0" title="Cambiar Cliente"><i class="fa-solid fa-rotate-right text-xs"></i></button>
                </div>

                <div id="m-new-client-section" class="hidden bg-cyan-50/30 p-4.5 rounded-2xl border border-cyan-100 relative animate-in fade-in slide-in-from-top-2 shadow-xs">
                    <button id="btn-cancel-new-client" class="absolute top-3.5 right-3.5 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-red-500 transition shadow-sm border border-transparent hover:border-gray-200" title="Cancelar"><i class="fa-solid fa-xmark text-xs"></i></button>
                    
                    <div class="mb-4">
                        <span class="bg-brand-cyan text-brand-black px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest shadow-xs">Registrar Nuevo Cliente</span>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <div class="md:col-span-2">
                            <label for="m-nc-name" class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Nombre Completo *</label>
                            <input type="text" id="m-nc-name" placeholder="Ej: Juan Pérez" class="w-full bg-white border border-cyan-100 h-10 px-3 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan shadow-xs">
                        </div>
                        <div>
                            <label for="m-nc-phone" class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Teléfono / WhatsApp *</label>
                            <input type="text" id="m-nc-phone" placeholder="Ej: 3001234567" class="w-full bg-white border border-cyan-100 h-10 px-3 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan shadow-xs">
                        </div>
                        <div>
                            <label for="m-nc-doc" class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Cédula / NIT</label>
                            <input type="text" id="m-nc-doc" placeholder="Opcional" class="w-full bg-white border border-cyan-100 h-10 px-3 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan shadow-xs">
                        </div>
                        <div class="md:col-span-2">
                            <label for="m-nc-email" class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Email</label>
                            <input type="email" id="m-nc-email" placeholder="cliente@correo.com" class="w-full bg-white border border-cyan-100 h-10 px-3 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan shadow-xs">
                        </div>
                    </div>
                </div>
            </div>

            <div class="bg-slate-50/70 p-4.5 rounded-2xl border border-gray-100 space-y-3.5 relative">
                <div class="flex items-center justify-between border-b border-gray-200/60 pb-2">
                    <div class="flex items-center gap-2">
                        <span class="w-6 h-6 rounded-lg bg-brand-cyan text-brand-black flex items-center justify-center text-[10px] font-black shadow-xs">
                            <i class="fa-solid fa-truck-fast"></i>
                        </span>
                        <span class="text-[10px] font-black uppercase text-brand-black tracking-widest">Datos de Entrega</span>
                    </div>
                </div>
                
                <div>
                    <select id="m-shipping-mode" class="w-full bg-white border border-gray-200 h-10 px-3.5 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black shadow-xs">
                        <option value="pickup">📍 Recogida en Local / Contraentrega</option>
                        <option value="new" selected>🚚 Nueva Dirección Nacional</option>
                        <option value="saved" disabled id="opt-saved-addr">🏠 Dirección Guardada (Seleccione Cliente)</option>
                    </select>
                </div>

                <div id="container-saved-addr" class="hidden animate-in fade-in slide-in-from-top-2">
                    <select id="m-saved-addr-select" class="w-full bg-white border border-gray-200 h-10 px-3.5 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black shadow-xs">
                        <option value="">Seleccione...</option>
                    </select>
                </div>

                <div id="container-new-addr" class="animate-in fade-in slide-in-from-top-2 space-y-3">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label for="m-dept-manual" class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1 block ml-1">Departamento</label>
                            <select id="m-dept-manual" class="w-full bg-white border border-gray-200 h-10 px-3.5 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black shadow-xs"><option value="">Seleccionar...</option></select>
                        </div>
                        <div>
                            <label for="m-city-manual" class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1 block ml-1">Ciudad</label>
                            <select id="m-city-manual" class="w-full bg-white border border-gray-200 h-10 px-3.5 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black shadow-xs" disabled><option value="">Seleccione Depto primero</option></select>
                        </div>
                    </div>
                    <div>
                        <label for="m-address-manual" class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1 block ml-1">Dirección Exacta</label>
                        <input type="text" id="m-address-manual" placeholder="Ej: Calle 123 # 45 - 67, Barrio..." class="w-full bg-white border border-gray-200 h-10 px-3.5 rounded-xl text-xs font-bold outline-none focus:border-brand-cyan text-brand-black shadow-xs">
                    </div>
                </div>
            </div>

            <div class="space-y-3">
                <div class="flex justify-between items-center border-b border-gray-100 pb-2">
                    <div class="flex items-center gap-2">
                        <span class="w-6 h-6 rounded-lg bg-slate-900 text-white flex items-center justify-center text-[10px] font-black shadow-xs">
                            <i class="fa-solid fa-boxes-stacked"></i>
                        </span>
                        <div>
                            <h4 class="text-xs font-black text-brand-black uppercase tracking-wider leading-none">Productos</h4>
                            <p class="text-[9px] text-gray-400 font-bold uppercase mt-0.5">Añade los items a vender</p>
                        </div>
                    </div>
                    <button id="btn-add-item-row" class="text-brand-black hover:text-white hover:bg-brand-cyan bg-cyan-50/80 px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-1.5 border border-brand-cyan/30 shadow-xs">
                        <i class="fa-solid fa-plus text-xs"></i> Añadir Línea
                    </button>
                </div>
                <div id="manual-items-container" class="space-y-2.5"></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                <div>
                    <label for="m-payment-account" class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1.5 block ml-1">Método de Pago</label>
                    <div class="relative">
                        <select id="m-payment-account" class="w-full bg-slate-50 border border-gray-200 h-11 px-3.5 rounded-xl text-xs font-bold outline-none focus:border-emerald-500 transition-all appearance-none cursor-pointer text-brand-black shadow-xs">
                            <option value="credit">⏳ Cartera (Pendiente por Cobrar)</option>
                        </select>
                        <i class="fa-solid fa-chevron-down absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none"></i>
                    </div>
                </div>
                
                <div>
                    <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1.5 block ml-1">Facturación Electrónica</label>
                    <div class="h-11 bg-cyan-50/40 border border-brand-cyan/20 px-4 rounded-xl flex items-center justify-between shadow-xs">
                        <div class="flex items-center gap-2.5">
                            <div class="w-7 h-7 rounded-lg bg-brand-cyan text-brand-black flex items-center justify-center text-xs shadow-xs">
                                <i class="fa-solid fa-file-invoice"></i>
                            </div>
                            <label for="m-requires-invoice" class="text-[10px] font-black uppercase tracking-wider text-brand-black cursor-pointer">¿Requiere Factura?</label>
                        </div>
                        <label for="m-requires-invoice" class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="m-requires-invoice" class="sr-only peer">
                            <div class="w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-cyan"></div>
                        </label>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="px-6 py-4 border-t border-gray-100 bg-slate-50/90 backdrop-blur-sm grid grid-cols-1 md:grid-cols-12 gap-4 items-center shrink-0 rounded-b-3xl">
             <div class="md:col-span-4 flex flex-col justify-center">
                <label for="m-shipping-cost" class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-1 block ml-1">Costo de Envío Extra</label>
                <div class="relative">
                    <i class="fa-solid fa-truck-fast absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
                    <input type="text" id="m-shipping-cost" value="$ 0" class="currency-input w-full bg-white border border-gray-200 h-10 pl-10 pr-3 rounded-xl text-xs font-black outline-none focus:border-brand-cyan text-brand-black transition-colors shadow-inner">
                </div>
                <!-- 🔥 Checkbox 4x1000 -->
                <label for="m-apply-4x1000" class="flex items-center gap-2 mt-1.5 cursor-pointer ml-1 select-none">
                    <input type="checkbox" id="m-apply-4x1000" class="w-3.5 h-3.5 rounded text-brand-cyan border-gray-300 focus:ring-brand-cyan">
                    <span class="text-[9px] font-black uppercase text-gray-500 tracking-wider">Cobrar 4x1000 Cliente</span>
                </label>
            </div>
            
            <div class="md:col-span-4 text-center md:text-right flex flex-col justify-center">
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Total de la Venta</p>
                <h4 id="manual-total-display" class="text-3xl md:text-4xl font-black text-brand-black tracking-tight leading-none">$ 0</h4>
            </div>
            
            <div class="md:col-span-4 h-full flex items-center">
                <button id="btn-save-manual" class="w-full h-11 bg-brand-black text-white font-black px-6 rounded-xl shadow-lg shadow-brand-black/20 uppercase text-xs tracking-widest hover:bg-brand-cyan hover:text-brand-black hover:shadow-brand-cyan/30 transition-all duration-200 transform active:scale-95 flex items-center justify-center gap-2">
                    <i class="fa-solid fa-check-double text-sm"></i> <span>Generar Venta</span>
                </button>
            </div>
        </div>
    </div>
</div>
`;

// --- VARIABLES GLOBALES ---
let manualProductsCache = []; 
let manualClientsCache = [];
let isCreatingNewClient = false;
let selectedUserId = null;
let selectedUserName = "";
let selectedUserPhone = "";
let selectedUserDoc = ""; 
let currentUserAddresses = [];
let onSuccessCallback = null;
let manualItemRowSeq = 0;

const formatCurrency = (num) => '$ ' + num.toLocaleString('es-CO');
const parseCurrency = (str) => Number(str.replace(/[^0-9-]/g, '')) || 0;
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

// Helper de tachado unicode para opciones agotadas en selectores nativos
function strikeText(text) {
    if (!text) return "";
    return text.toString().split('').map(char => char + '\u0336').join('');
}

function getProductTotalStock(product) {
    if (!product) return 0;
    if (product.combinations && Array.isArray(product.combinations) && product.combinations.length > 0) {
        return product.combinations.reduce((sum, c) => sum + (parseInt(c.stock) || 0), 0);
    }
    if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
        return product.variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0);
    }
    return parseInt(product.stock) || 0;
}

function getColorsForProduct(product) {
    if (!product) return [];
    let colors = [];
    if (Array.isArray(product.definedColors) && product.definedColors.length > 0) {
        colors = product.definedColors;
    } else if (Array.isArray(product.combinations) && product.combinations.length > 0) {
        colors = product.combinations.map(c => c.color).filter(Boolean);
    } else if (Array.isArray(product.variants) && product.variants.length > 0) {
        colors = product.variants.map(v => v.color).filter(Boolean);
    }
    return [...new Set(colors)];
}

function getCapacitiesForProduct(product) {
    if (!product) return [];
    let caps = [];
    if (Array.isArray(product.definedCapacities) && product.definedCapacities.length > 0) {
        caps = product.definedCapacities;
    } else if (Array.isArray(product.capacities) && product.capacities.length > 0) {
        caps = product.capacities.map(c => typeof c === 'object' ? c.label : c).filter(Boolean);
    } else if (Array.isArray(product.combinations) && product.combinations.length > 0) {
        caps = product.combinations.map(c => c.capacity).filter(Boolean);
    }
    return [...new Set(caps)];
}

function getStockForColor(product, colorName, selectedCap) {
    if (!product || !colorName) return 0;
    if (product.combinations && Array.isArray(product.combinations) && product.combinations.length > 0) {
        if (selectedCap) {
            const combo = product.combinations.find(c => c.color === colorName && c.capacity === selectedCap);
            return combo ? (parseInt(combo.stock) || 0) : 0;
        } else {
            return product.combinations
                .filter(c => c.color === colorName)
                .reduce((sum, c) => sum + (parseInt(c.stock) || 0), 0);
        }
    }
    if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
        const variant = product.variants.find(v => v.color === colorName);
        return variant ? (parseInt(variant.stock) || 0) : 0;
    }
    return parseInt(product.stock) || 0;
}

function getStockForCapacity(product, capName, selectedColor) {
    if (!product || !capName) return 0;
    if (product.combinations && Array.isArray(product.combinations) && product.combinations.length > 0) {
        if (selectedColor) {
            const combo = product.combinations.find(c => c.capacity === capName && c.color === selectedColor);
            return combo ? (parseInt(combo.stock) || 0) : 0;
        } else {
            return product.combinations
                .filter(c => c.capacity === capName)
                .reduce((sum, c) => sum + (parseInt(c.stock) || 0), 0);
        }
    }
    return parseInt(product.stock) || 0;
}

function getPriceForCombination(product, selectedColor, selectedCap) {
    if (!product) return 0;
    if (product.combinations && Array.isArray(product.combinations) && product.combinations.length > 0) {
        if (selectedColor && selectedCap) {
            const combo = product.combinations.find(c => c.color === selectedColor && c.capacity === selectedCap);
            if (combo && combo.price) return parseFloat(combo.price);
        } else if (selectedColor) {
            const combo = product.combinations.find(c => c.color === selectedColor && (!c.capacity || c.capacity === selectedCap) && c.price);
            if (combo && combo.price) return parseFloat(combo.price);
        } else if (selectedCap) {
            const combo = product.combinations.find(c => c.capacity === selectedCap && (!c.color || c.color === selectedColor) && c.price);
            if (combo && combo.price) return parseFloat(combo.price);
        }
    }
    if (selectedCap && product.capacities && Array.isArray(product.capacities)) {
        const capObj = product.capacities.find(x => (typeof x === 'object' ? x.label : x) === selectedCap);
        if (capObj && typeof capObj === 'object' && capObj.price) return parseFloat(capObj.price);
    }
    return parseFloat(product.price) || 0;
}

function populateColorOptions(colorSel, product, selectedCap, currentVal) {
    const colors = getColorsForProduct(product);
    colorSel.innerHTML = `<option value="">-- Color --</option>`;
    let isCurrentValValid = false;

    colors.forEach(c => {
        const stock = getStockForColor(product, c, selectedCap);
        const isOutOfStock = stock <= 0;
        const opt = document.createElement('option');
        opt.value = c;
        if (isOutOfStock) {
            opt.disabled = true;
            opt.textContent = `${strikeText(c)} (Agotado - 0)`;
            opt.className = "text-gray-400 bg-gray-50 line-through";
        } else {
            opt.textContent = `${c} (${stock} disp.)`;
            opt.className = "text-brand-black font-semibold";
            if (c === currentVal) isCurrentValValid = true;
        }
        colorSel.appendChild(opt);
    });

    if (currentVal && isCurrentValValid) {
        colorSel.value = currentVal;
    } else {
        colorSel.value = "";
    }
}

function populateCapacityOptions(capSel, product, selectedColor, currentVal) {
    const caps = getCapacitiesForProduct(product);
    capSel.innerHTML = `<option value="">-- Capacidad --</option>`;
    let isCurrentValValid = false;

    caps.forEach(c => {
        const stock = getStockForCapacity(product, c, selectedColor);
        const isOutOfStock = stock <= 0;
        const price = getPriceForCombination(product, selectedColor, c);
        const opt = document.createElement('option');
        opt.value = c;
        opt.dataset.price = price;
        if (isOutOfStock) {
            opt.disabled = true;
            opt.textContent = `${strikeText(c)} (Agotado - 0)`;
            opt.className = "text-gray-400 bg-gray-50 line-through";
        } else {
            opt.textContent = `${c} (${stock} disp.)`;
            opt.className = "text-brand-black font-semibold";
            if (c === currentVal) isCurrentValValid = true;
        }
        capSel.appendChild(opt);
    });

    if (currentVal && isCurrentValValid) {
        capSel.value = currentVal;
    } else {
        capSel.value = "";
    }
}

function setupCurrencyInput(input) {
    input.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = formatCurrency(val);
        calculateManualTotal();
    });
    input.addEventListener('focus', (e) => e.target.select());
}

AdminStore.subscribeToProducts((products) => {
    manualProductsCache = products;
    const modal = document.getElementById('manual-modal');
    if (modal && !modal.classList.contains('hidden')) {
        document.querySelectorAll('.item-row-container').forEach(row => {
            const pId = row.querySelector('.p-id').value;
            if (pId) {
                const updatedProd = manualProductsCache.find(p => p.id === pId);
                if (updatedProd) {
                    const totalStock = getProductTotalStock(updatedProd);
                    const badge = row.querySelector('.p-product-stock-badge');
                    if (badge) {
                        badge.classList.remove('hidden');
                        if (totalStock > 0) {
                            badge.className = "p-product-stock-badge text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 shadow-sm inline-flex items-center";
                            badge.innerHTML = `<i class="fa-solid fa-boxes-stacked text-[8px] mr-1"></i>Stock: ${totalStock}`;
                        } else {
                            badge.className = "p-product-stock-badge text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 shadow-sm inline-flex items-center";
                            badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-[8px] mr-1"></i>Agotado (0)`;
                        }
                    }
                    const colorSel = row.querySelector('.p-color');
                    const capSel = row.querySelector('.p-capacity');
                    if (colorSel) populateColorOptions(colorSel, updatedProd, capSel ? capSel.value : null, colorSel.value);
                    if (capSel) populateCapacityOptions(capSel, updatedProd, colorSel ? colorSel.value : null, capSel.value);
                    updateRowStock(row, updatedProd);
                }
            }
        });
    }
});

AdminStore.subscribeToClients((clients) => {
    manualClientsCache = clients;
    const searchInput = document.getElementById('m-cust-search');
    if (searchInput && searchInput.value.trim().length >= 2 && !isCreatingNewClient && !selectedUserId) {
        searchInput.dispatchEvent(new Event('input'));
    }
});

export function initManualSale(onSuccess) {
    if (!document.getElementById('manual-modal')) {
        document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
        setupEventListeners();
    }
    const styleId = 'manual-sale-custom-css';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            select.p-color option:disabled, 
            select.p-capacity option:disabled {
                color: #94a3b8 !important;
                background-color: #f8fafc !important;
                text-decoration: line-through !important;
                font-style: italic;
            }
            select.p-color:disabled,
            select.p-capacity:disabled {
                background-color: #f8fafc !important;
                opacity: 0.7;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }
    onSuccessCallback = onSuccess;
}

export async function openManualSaleModal() {
    const modal = document.getElementById('manual-modal');
    const container = document.getElementById('manual-items-container');
    
    isCreatingNewClient = false;
    selectedUserId = null;
    selectedUserName = "";
    selectedUserPhone = "";
    selectedUserDoc = "";
    currentUserAddresses = [];
    
    document.getElementById('m-search-section').classList.remove('hidden');
    document.getElementById('m-selected-client-section').classList.add('hidden');
    document.getElementById('m-new-client-section').classList.add('hidden');
    
    document.getElementById('m-cust-search').value = "";
    document.getElementById('m-nc-name').value = "";
    document.getElementById('m-nc-phone').value = "";
    document.getElementById('m-nc-doc').value = "";
    document.getElementById('m-nc-email').value = "";
    document.getElementById('m-apply-4x1000').checked = false; // Reiniciar check

    document.getElementById('manual-total-display').textContent = "$ 0";
    document.getElementById('m-shipping-cost').value = "$ 0";
    document.getElementById('m-dept-manual').value = "";
    document.getElementById('m-city-manual').value = "";
    document.getElementById('m-address-manual').value = "";
    container.innerHTML = "";

    await Promise.all([
        loadPaymentAccounts(), 
        loadManualDepartments()
    ]);
    
    addManualItemRow();
    setupCurrencyInput(document.getElementById('m-shipping-cost'));

    modal.classList.remove('hidden');
}

function setupEventListeners() {
    document.getElementById('btn-close-x').onclick = () => document.getElementById('manual-modal').classList.add('hidden');
    document.getElementById('btn-close-overlay').onclick = () => document.getElementById('manual-modal').classList.add('hidden');
    document.getElementById('btn-add-item-row').onclick = addManualItemRow;
    document.getElementById('btn-save-manual').onclick = saveOrder;
    document.getElementById('m-apply-4x1000').addEventListener('change', calculateManualTotal); // Evento 4x1000

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

function addManualItemRow() {
    manualItemRowSeq++;
    const rId = manualItemRowSeq;

    const div = document.createElement('div');
    div.className = "item-row-container relative focus-within:z-[60] bg-slate-50/70 hover:bg-slate-50/90 p-3.5 rounded-2xl border border-gray-100 shadow-xs transition-all";
    div.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end relative focus-within:z-[60]">
            <!-- Columna Producto -->
            <div class="p-col-product md:col-span-5 relative focus-within:z-[70]">
                <div class="flex items-center justify-between mb-1.5 h-4 px-0.5">
                    <label for="p-search-${rId}" class="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-0.5">Producto</label>
                    <span class="p-product-stock-badge text-[9px] font-black uppercase tracking-wider hidden"></span>
                </div>
                <div class="relative flex items-center gap-2">
                    <div class="p-img-preview w-11 h-11 rounded-xl bg-white border border-gray-200 shrink-0 overflow-hidden flex items-center justify-center shadow-xs">
                        <i class="fa-solid fa-box text-gray-300 text-sm"></i>
                    </div>
                    <div class="relative flex-1 min-w-0">
                        <input type="text" id="p-search-${rId}" autocomplete="off" placeholder="Buscar por nombre o SKU..." class="p-search h-11 w-full bg-white border border-gray-200 rounded-xl py-2 pl-3 pr-8 text-xs font-bold outline-none focus:border-brand-cyan text-brand-black shadow-xs transition-colors">
                        <i class="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs pointer-events-none"></i>
                    </div>
                </div>
                <div class="p-results absolute top-full left-0 z-[100] w-full mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-2xl hidden max-h-56 overflow-y-auto custom-scroll p-1.5"></div>
            </div>
            
            <!-- Columna Variantes (Color / Capacidad) -->
            <div class="p-variants-container md:col-span-3 flex gap-2"></div>
            
            <!-- Columna Precio Unitario -->
            <div class="md:col-span-2">
                <div class="flex items-center justify-center mb-1.5 h-4">
                    <label for="p-price-${rId}" class="text-[9px] font-black text-gray-400 uppercase tracking-widest block text-center">Precio Unitario</label>
                </div>
                <input type="text" id="p-price-${rId}" class="p-price-display currency-input h-11 w-full bg-white border border-gray-200 rounded-xl py-2 px-2 text-xs font-black text-center outline-none focus:border-brand-cyan text-brand-black shadow-xs transition-colors">
            </div>
            
            <!-- Columna Cantidad y Eliminar -->
            <div class="md:col-span-2 flex items-end gap-2">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-1.5 h-4 px-0.5">
                        <label for="p-qty-${rId}" class="text-[9px] font-black text-gray-400 uppercase tracking-widest truncate">Cant.</label>
                        <span class="stock-display text-[9px] font-black text-gray-400 tracking-wider shrink-0">---</span>
                    </div>
                    <input type="number" id="p-qty-${rId}" value="1" min="1" class="p-qty h-11 w-full bg-white border border-gray-200 rounded-xl py-2 px-1 text-sm font-black text-center outline-none focus:border-brand-cyan text-brand-black shadow-xs transition-colors">
                </div>
                <div class="shrink-0">
                    <button type="button" class="btn-remove-row h-11 w-11 rounded-xl bg-white border border-gray-200 text-gray-400 hover:bg-brand-red hover:border-brand-red hover:text-white transition-all flex items-center justify-center shadow-xs" title="Eliminar fila" aria-label="Eliminar fila">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </div>
        </div>
        <input type="hidden" class="p-id"><input type="hidden" class="p-img"><input type="hidden" class="p-max-stock">`;
    
    document.getElementById('manual-items-container').appendChild(div);
    
    const priceInput = div.querySelector('.p-price-display');
    setupCurrencyInput(priceInput);
    
    const qtyInput = div.querySelector('.p-qty');
    qtyInput.onchange = () => {
        const max = parseInt(div.querySelector('.p-max-stock').value) || 0;
        const current = parseInt(qtyInput.value) || 1;
        if (max > 0 && current > max) {
            alert(`⚠️ Solo quedan ${max} unidades disponibles de esta variante.`);
            qtyInput.value = max;
        } else if (max <= 0) {
            const hasVariants = div.querySelector('.p-color') || div.querySelector('.p-capacity');
            if (hasVariants) {
                alert(`⚠️ Debes seleccionar una variante disponible con stock.`);
            } else {
                alert(`⚠️ Este producto no tiene stock disponible.`);
            }
            qtyInput.value = 1;
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
    const preview = row.querySelector('.p-img-preview');

    searchInput.addEventListener('input', (e) => {
        row.querySelector('.p-id').value = "";
        const badge = row.querySelector('.p-product-stock-badge');
        if (badge) badge.classList.add('hidden');
        if (preview) preview.innerHTML = `<i class="fa-solid fa-box text-gray-300 text-sm"></i>`;

        const term = normalizeText(e.target.value);
        resultsDiv.innerHTML = "";
        if (term.length < 2) { resultsDiv.classList.add('hidden'); return; }

        const words = term.split(/\s+/).filter(Boolean);
        const matches = manualProductsCache.filter(p => {
            const cat = typeof p.category === 'object' && p.category ? (p.category.name || '') : (p.category || '');
            const brand = typeof p.brand === 'object' && p.brand ? (p.brand.name || '') : (p.brand || '');
            const searchStr = normalizeText(`${p.name || ''} ${p.sku || ''} ${cat} ${brand} ${p.searchStr || ''}`);
            return words.every(w => searchStr.includes(w));
        });

        if (matches.length === 0) {
            resultsDiv.innerHTML = `<div class="p-3 text-[10px] text-gray-400 text-center uppercase font-bold">No se encontraron productos</div>`;
            resultsDiv.classList.remove('hidden');
            return;
        }

        matches.slice(0, 20).forEach(prod => {
            const totalStock = getProductTotalStock(prod);
            const isOutOfStock = totalStock <= 0;
            const itemDiv = document.createElement('div');
            itemDiv.className = `p-2.5 flex items-center justify-between rounded-xl border-b border-gray-50 last:border-0 ${isOutOfStock ? 'bg-gray-50 opacity-60 cursor-not-allowed' : 'hover:bg-cyan-50 cursor-pointer transition'}`;
            
            const prodImg = prod.mainImage || prod.image || (prod.images && prod.images[0] ? prod.images[0] : 'https://placehold.co/50');
            itemDiv.innerHTML = `
                <div class="flex items-center gap-3 flex-1 min-w-0 pr-2">
                    <img src="${prodImg}" class="w-9 h-9 object-cover rounded-lg shrink-0 border border-gray-100 shadow-xs">
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-bold text-brand-black truncate ${isOutOfStock ? 'line-through text-gray-400' : ''}">${prod.name}</p>
                        <p class="text-[10px] text-gray-400 mt-0.5">${prod.sku ? 'SKU: ' + prod.sku : ''} | Stock Total: <span class="font-bold ${isOutOfStock ? 'text-red-500' : 'text-emerald-600'}">${totalStock}</span></p>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <p class="text-xs font-black text-brand-black">${formatCurrency(prod.price)}</p>
                </div>
            `;

            if (!isOutOfStock) {
                itemDiv.onmousedown = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    selectProductForRow(row, prod);
                    resultsDiv.classList.add('hidden');
                };
            } else {
                itemDiv.onmousedown = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    alert("⚠️ Este producto está completamente agotado (Stock: 0).");
                };
            }

            resultsDiv.appendChild(itemDiv);
        });

        resultsDiv.classList.remove('hidden');
    });

    document.addEventListener('mousedown', (e) => {
        if (!row.contains(e.target)) resultsDiv.classList.add('hidden');
    });
}

function selectProductForRow(row, product) {
    if (!product) return;
    row.querySelector('.p-id').value = product.id;
    row.querySelector('.p-search').value = product.name;
    const imgUrl = product.mainImage || product.image || (product.images && product.images[0] ? product.images[0] : "");
    row.querySelector('.p-img').value = imgUrl;
    row.querySelector('.p-price-display').value = formatCurrency(product.price);

    const preview = row.querySelector('.p-img-preview');
    if (preview) {
        if (imgUrl) preview.innerHTML = `<img src="${imgUrl}" class="w-full h-full object-cover">`;
        else preview.innerHTML = `<i class="fa-solid fa-box text-gray-300 text-sm"></i>`;
    }
    
    const totalStock = getProductTotalStock(product);
    const badge = row.querySelector('.p-product-stock-badge');
    if (badge) {
        badge.classList.remove('hidden');
        if (totalStock > 0) {
            badge.className = "p-product-stock-badge text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/80 shadow-none inline-flex items-center gap-1";
            badge.innerHTML = `<i class="fa-solid fa-boxes-stacked text-[8px]"></i>Stock: ${totalStock}`;
        } else {
            badge.className = "p-product-stock-badge text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200/80 shadow-none inline-flex items-center gap-1";
            badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-[8px]"></i>Agotado (0)`;
        }
    }

    renderVariantSelectors(row, product);
    calculateManualTotal();
}

function updateRowStock(row, product) {
    if (!product) return;
    const colorSel = row.querySelector('.p-color');
    const capSel = row.querySelector('.p-capacity');
    const hasColor = !!colorSel;
    const hasCap = !!capSel;
    const selectedColor = colorSel ? colorSel.value : null;
    const selectedCap = capSel ? capSel.value : null;

    let currentStock = 0;
    let isFullySelected = true;

    if (hasColor && !selectedColor) isFullySelected = false;
    if (hasCap && !selectedCap) isFullySelected = false;

    if (hasColor || hasCap) {
        if (isFullySelected) {
            if (hasColor && hasCap) {
                currentStock = getStockForColor(product, selectedColor, selectedCap);
            } else if (hasColor) {
                currentStock = getStockForColor(product, selectedColor, null);
            } else if (hasCap) {
                currentStock = getStockForCapacity(product, selectedCap, null);
            }

            const comboPrice = getPriceForCombination(product, selectedColor, selectedCap);
            if (comboPrice > 0) {
                row.querySelector('.p-price-display').value = formatCurrency(comboPrice);
            }

            if (selectedColor && product.variants && Array.isArray(product.variants)) {
                const colorVar = product.variants.find(v => v.color === selectedColor);
                if (colorVar && colorVar.images && colorVar.images.length > 0) {
                    row.querySelector('.p-img').value = colorVar.images[0];
                    const preview = row.querySelector('.p-img-preview');
                    if (preview) preview.innerHTML = `<img src="${colorVar.images[0]}" class="w-full h-full object-cover">`;
                }
            }
        } else {
            currentStock = 0;
        }
    } else {
        currentStock = parseInt(product.stock) || 0;
    }

    row.querySelector('.p-max-stock').value = currentStock;
    const display = row.querySelector('.stock-display');
    if (display) {
        if ((hasColor || hasCap) && !isFullySelected) {
            display.innerHTML = `<span class="text-amber-500 font-black text-[8px] uppercase">Elige var.</span>`;
        } else if (currentStock > 0) {
            display.innerHTML = `Disp: <span class="text-emerald-600 font-black">${currentStock}</span>`;
        } else {
            display.innerHTML = `<span class="text-red-500 font-black uppercase">Agotado</span>`;
        }
    }

    const qtyInput = row.querySelector('.p-qty');
    let currentQty = parseInt(qtyInput.value) || 1;
    if (currentStock > 0 && currentQty > currentStock) {
        qtyInput.value = currentStock;
    }
    calculateManualTotal();
}

function renderVariantSelectors(row, product) {
    if (!product) return;
    const container = row.querySelector('.p-variants-container');
    const prodCol = row.querySelector('.p-col-product');
    container.innerHTML = "";

    const searchInput = row.querySelector('.p-search');
    const rId = searchInput?.id ? searchInput.id.replace('p-search-', '') : Date.now();

    const colors = getColorsForProduct(product);
    const caps = getCapacitiesForProduct(product);

    const hasVariants = colors.length > 0 || caps.length > 0;

    if (!hasVariants) {
        container.classList.add('hidden');
        if (prodCol) {
            prodCol.className = "p-col-product md:col-span-8 relative focus-within:z-[70]";
        }
    } else {
        container.classList.remove('hidden');
        if (prodCol) {
            prodCol.className = "p-col-product md:col-span-5 relative focus-within:z-[70]";
        }
    }

    let colorSel = null;
    let capSel = null;

    if (colors.length > 0) {
        const wrap = document.createElement('div');
        wrap.className = "flex-1 min-w-0 relative";
        wrap.innerHTML = `
            <div class="flex items-center justify-between mb-1.5 h-4 px-0.5">
                <label for="p-color-${rId}" class="text-[9px] font-black text-gray-400 uppercase tracking-widest block truncate">Color</label>
            </div>
            <div class="relative">
                <select id="p-color-${rId}" class="p-color h-11 w-full bg-white border border-gray-200 rounded-xl py-2 pl-2.5 pr-7 text-xs font-bold outline-none focus:border-brand-cyan text-brand-black cursor-pointer shadow-xs appearance-none transition-colors truncate">
                </select>
                <i class="fa-solid fa-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none"></i>
            </div>
        `;
        colorSel = wrap.querySelector('.p-color');
        container.appendChild(wrap);
    }
    
    if (caps.length > 0) {
        const wrap = document.createElement('div');
        wrap.className = "flex-1 min-w-0 relative";
        wrap.innerHTML = `
            <div class="flex items-center justify-between mb-1.5 h-4 px-0.5">
                <label for="p-cap-${rId}" class="text-[9px] font-black text-gray-400 uppercase tracking-widest block truncate">Capacidad</label>
            </div>
            <div class="relative">
                <select id="p-cap-${rId}" class="p-capacity h-11 w-full bg-white border border-gray-200 rounded-xl py-2 pl-2.5 pr-7 text-xs font-bold outline-none focus:border-brand-cyan text-brand-black cursor-pointer shadow-xs appearance-none transition-colors truncate">
                </select>
                <i class="fa-solid fa-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none"></i>
            </div>
        `;
        capSel = wrap.querySelector('.p-capacity');
        container.appendChild(wrap);
    }

    if (colorSel) {
        populateColorOptions(colorSel, product, null, "");
        colorSel.onchange = () => {
            if (capSel) {
                populateCapacityOptions(capSel, product, colorSel.value, capSel.value);
            }
            updateRowStock(row, product);
        };
    }

    if (capSel) {
        populateCapacityOptions(capSel, product, null, "");
        capSel.onchange = () => {
            if (colorSel) {
                populateColorOptions(colorSel, product, capSel.value, colorSel.value);
            }
            updateRowStock(row, product);
        };
    }

    updateRowStock(row, product);
}

// 🔥 CÁLCULO TOTAL CON 4X1000
function calculateManualTotal() {
    let subtotal = 0;
    document.querySelectorAll('.item-row-container').forEach(row => {
        const price = parseCurrency(row.querySelector('.p-price-display').value);
        const qty = parseInt(row.querySelector('.p-qty').value) || 0;
        subtotal += price * qty;
    });
    
    const shipping = parseCurrency(document.getElementById('m-shipping-cost').value);
    let baseTotal = subtotal + shipping;
    
    let tax4x1000 = 0;
    const apply4x1000 = document.getElementById('m-apply-4x1000').checked;
    if (apply4x1000) {
        tax4x1000 = Math.round(baseTotal * 0.004); // 0.4%
    }
    
    const total = baseTotal + tax4x1000;
    
    const display = document.getElementById('manual-total-display');
    if (tax4x1000 > 0) {
        display.innerHTML = `${formatCurrency(total)} <span class="block text-[12px] font-bold text-purple-500 mt-2 tracking-widest">+ ${formatCurrency(tax4x1000)} (Impuesto 4x1000)</span>`;
    } else {
        display.textContent = formatCurrency(total);
    }
}

async function setupCustomerSearch() {
    const search = document.getElementById('m-cust-search');
    const results = document.getElementById('m-cust-results');
    
    const searchSection = document.getElementById('m-search-section');
    const selectedSection = document.getElementById('m-selected-client-section');
    const newClientSection = document.getElementById('m-new-client-section');
    
    const modeSelect = document.getElementById('m-shipping-mode');
    const optSaved = document.getElementById('opt-saved-addr');
    const savedSelect = document.getElementById('m-saved-addr-select');

    search.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        results.innerHTML = "";
        
        if (term.length < 2) { results.classList.add('hidden'); return; }
        
        const filtered = manualClientsCache.filter(u => {
            const clientNameRaw = u.name || u.userName || "";
            const clientPhoneRaw = u.phone || "";
            const clientDocRaw = u.document || "";
            return normalizeText(clientNameRaw).includes(term) || clientPhoneRaw.includes(term) || clientDocRaw.includes(term);
        });

        if (filtered.length === 0) {
            results.innerHTML = `<div class="p-4 text-[10px] text-gray-400 font-bold text-center uppercase border-b border-gray-100">Cliente no encontrado</div><div class="p-2 bg-gray-50 rounded-b-2xl"><button type="button" id="btn-m-inline-create" class="w-full bg-brand-cyan text-brand-black font-black text-[10px] py-3 rounded-xl uppercase tracking-widest hover:bg-cyan-400 transition shadow-sm flex items-center justify-center gap-2"><i class="fa-solid fa-user-plus"></i> Registrar Nuevo Cliente</button></div>`;
            document.getElementById('btn-m-inline-create').onmousedown = (ev) => {
                ev.preventDefault(); 
                isCreatingNewClient = true;
                searchSection.classList.add('hidden'); newClientSection.classList.remove('hidden');
                
                const rawTerm = search.value.trim();
                if (/^[\d\s\+]+$/.test(rawTerm)) {
                    document.getElementById('m-nc-phone').value = rawTerm.replace(/\s+/g, '');
                    document.getElementById('m-nc-name').focus();
                } else {
                    document.getElementById('m-nc-name').value = rawTerm;
                    document.getElementById('m-nc-phone').focus();
                }
                
                optSaved.disabled = true; optSaved.textContent = "🏠 Dirección Guardada (Seleccione Cliente)";
                modeSelect.value = 'new'; modeSelect.dispatchEvent(new Event('change'));
                results.classList.add('hidden');
            };
        } else {
            filtered.slice(0, 8).forEach(u => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-cyan-50 cursor-pointer rounded-xl transition flex justify-between items-center border-b border-gray-50 last:border-0 group";
                const displayName = u.name || u.userName || 'Cliente sin nombre';
                div.innerHTML = `<div><span class="block font-black text-xs uppercase text-brand-black">${displayName}</span><span class="text-[9px] font-bold text-gray-400">${u.phone || 'Sin teléfono'} ${u.document ? ` | Doc: ${u.document}` : ''}</span></div><button class="bg-white border border-gray-200 text-brand-cyan w-6 h-6 rounded-full flex items-center justify-center group-hover:bg-brand-cyan group-hover:text-white transition shadow-sm"><i class="fa-solid fa-check text-[10px]"></i></button>`;
                
                div.onmousedown = (ev) => {
                    ev.preventDefault(); 
                    isCreatingNewClient = false; selectedUserId = u.id; selectedUserName = displayName;
                    selectedUserPhone = u.phone || ""; selectedUserDoc = u.document || ""; 
                    currentUserAddresses = u.addresses || [];
                    
                    searchSection.classList.add('hidden'); selectedSection.classList.remove('hidden');
                    document.getElementById('m-sel-cname').textContent = selectedUserName;
                    document.getElementById('m-sel-cphone').textContent = selectedUserPhone || "Sin Teléfono";
                    
                    if (currentUserAddresses.length > 0) {
                        optSaved.disabled = false; optSaved.textContent = `🏠 Usar Guardada (${currentUserAddresses.length})`;
                        savedSelect.innerHTML = '<option value="">Seleccione Dirección...</option>';
                        currentUserAddresses.forEach((a, i) => savedSelect.innerHTML += `<option value="${i}">${a.alias} - ${a.address}</option>`);
                        modeSelect.value = 'saved';
                    } else {
                        optSaved.disabled = true; optSaved.textContent = "🏠 Sin direcciones guardadas";
                        modeSelect.value = 'new';
                    }
                    modeSelect.dispatchEvent(new Event('change')); results.classList.add('hidden');
                };
                results.appendChild(div);
            });
        }
        results.classList.remove('hidden');
    });

    const resetClientUI = () => {
        isCreatingNewClient = false; selectedUserId = null; selectedUserName = ""; selectedUserPhone = ""; selectedUserDoc = ""; currentUserAddresses = [];
        search.value = ""; document.getElementById('m-nc-name').value = ""; document.getElementById('m-nc-phone').value = ""; document.getElementById('m-nc-doc').value = ""; document.getElementById('m-nc-email').value = "";
        
        searchSection.classList.remove('hidden'); selectedSection.classList.add('hidden'); newClientSection.classList.add('hidden'); results.classList.add('hidden'); search.focus();
        
        optSaved.disabled = true; optSaved.textContent = "🏠 Dirección Guardada (Seleccione Cliente)";
        modeSelect.value = 'new'; modeSelect.dispatchEvent(new Event('change'));
    };

    document.getElementById('btn-clear-client').onclick = resetClientUI;
    document.getElementById('btn-cancel-new-client').onclick = resetClientUI;

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
    const selManual = document.getElementById('m-dept-manual');
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const data = await res.json();
        data.sort((a,b) => a.name.localeCompare(b.name));
        let options = '<option value="">Seleccionar Depto...</option>';
        data.forEach(d => options += `<option value="${d.id}">${d.name}</option>`);
        if (selManual) selManual.innerHTML = options;
    } catch(e) { console.error(e); }
}

// --- GUARDAR TRANSACCIÓN ---
async function saveOrder() {
    const btn = document.getElementById('btn-save-manual');
    
    if (!selectedUserId && !isCreatingNewClient) { return alert("🚨 Por favor, busca un cliente existente o registra uno nuevo."); }

    const items = [];
    let hasStockError = false;
    let hasVariantError = false;
    let variantErrorMessage = "";
    
    document.querySelectorAll('.item-row-container').forEach(row => {
        const id = row.querySelector('.p-id').value;
        const qty = parseInt(row.querySelector('.p-qty').value);
        const maxStock = parseInt(row.querySelector('.p-max-stock').value) || 0;
        
        if(id && qty > 0) {
            if (qty > maxStock || maxStock <= 0) hasStockError = true;
            
            const colorEl = row.querySelector('.p-color');
            const capEl = row.querySelector('.p-capacity');
            const prodName = row.querySelector('.p-search').value;

            if (colorEl && colorEl.value === "") {
                hasVariantError = true;
                if (!variantErrorMessage) variantErrorMessage = `🚨 Debes seleccionar un Color para el producto: ${prodName}`;
                colorEl.classList.add('border-red-500', 'ring-2', 'ring-red-200');
                
                // Letrero flotante sutil debajo
                let tooltip = colorEl.parentNode.querySelector('.error-tooltip');
                if (!tooltip) {
                    tooltip = document.createElement('div');
                    tooltip.className = "error-tooltip absolute left-1/2 -translate-x-1/2 top-[calc(100%+4px)] bg-brand-red text-white text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded shadow-md z-50 whitespace-nowrap pointer-events-none";
                    tooltip.innerHTML = 'Falta color';
                    colorEl.parentNode.appendChild(tooltip);
                }
                
                // Limpiar clase de error si cambia a opción válida
                colorEl.addEventListener('change', function handler() {
                    if (this.value !== "") {
                        this.classList.remove('border-red-500', 'ring-2', 'ring-red-200');
                        const t = colorEl.parentNode.querySelector('.error-tooltip');
                        if (t) t.remove();
                        colorEl.removeEventListener('change', handler);
                    }
                });
            }
            if (capEl && capEl.value === "") {
                hasVariantError = true;
                if (!variantErrorMessage) variantErrorMessage = `🚨 Debes seleccionar una Capacidad para el producto: ${prodName}`;
                capEl.classList.add('border-red-500', 'ring-2', 'ring-red-200');

                // Letrero flotante sutil debajo
                let tooltip = capEl.parentNode.querySelector('.error-tooltip');
                if (!tooltip) {
                    tooltip = document.createElement('div');
                    tooltip.className = "error-tooltip absolute left-1/2 -translate-x-1/2 top-[calc(100%+4px)] bg-brand-red text-white text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded shadow-md z-50 whitespace-nowrap pointer-events-none";
                    tooltip.innerHTML = 'Falta capacidad';
                    capEl.parentNode.appendChild(tooltip);
                }

                // Limpiar clase de error si cambia a opción válida
                capEl.addEventListener('change', function handler() {
                    if (this.value !== "") {
                        this.classList.remove('border-red-500', 'ring-2', 'ring-red-200');
                        const t = capEl.parentNode.querySelector('.error-tooltip');
                        if (t) t.remove();
                        capEl.removeEventListener('change', handler);
                    }
                });
            }

            items.push({
                id, name: prodName, price: parseCurrency(row.querySelector('.p-price-display').value),
                quantity: qty, image: row.querySelector('.p-img').value, color: colorEl?.value || null, capacity: capEl?.value || null
            });
        }
    });

    if (hasVariantError) {
        // Enfoque sutil y silencioso en el primer elemento con error
        const firstErrorEl = document.querySelector('.item-row-container select.border-red-500');
        if (firstErrorEl) firstErrorEl.focus();
        return;
    }
    if (hasStockError) return alert("🚨 Uno de los productos seleccionados excede o no tiene stock disponible.");
    if (items.length === 0) return alert("🚨 Debes agregar al menos un producto a la venta.");

    const shippingMode = document.getElementById('m-shipping-mode').value;
    let shippingData = {};
    let clientDept = ""; let clientCity = ""; let clientAddr = "";
    
    if (shippingMode === 'pickup') { shippingData = { address: "📍 Recogida en Local" }; } 
    else if (shippingMode === 'saved') {
        const idx = document.getElementById('m-saved-addr-select').value;
        if (idx === "") return alert("Seleccione la dirección guardada del cliente");
        const a = currentUserAddresses[idx];
        shippingData = { department: a.dept, city: a.city, address: `${a.address} (${a.alias})` };
    } else {
        const dSelect = document.getElementById('m-dept-manual');
        clientDept = dSelect.options[dSelect.selectedIndex]?.text || "";
        clientCity = document.getElementById('m-city-manual').value || "";
        clientAddr = document.getElementById('m-address-manual').value || "";
        shippingData = { department: clientDept, city: clientCity, address: clientAddr };
        if(!shippingData.department || !shippingData.address) return alert("Faltan datos de la nueva dirección de entrega.");
    }

    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando Venta...';

    try {
        let finalUserId = selectedUserId;
        let custName = selectedUserName;
        let custPhone = selectedUserPhone;
        let custDoc = selectedUserDoc; 
        let emailVal = "";

        if (isCreatingNewClient) {
            custName = document.getElementById('m-nc-name').value.trim();
            custPhone = document.getElementById('m-nc-phone').value.trim();
            custDoc = document.getElementById('m-nc-doc').value.trim(); 
            emailVal = document.getElementById('m-nc-email').value.trim();
            if (!custName || !custPhone) throw new Error("🚨 El Nombre y Teléfono del nuevo cliente son obligatorios.");

            const newClientData = {
                name: custName, phone: custPhone, email: emailVal, document: custDoc, source: 'MANUAL', role: 'client',
                createdAt: new Date(), updatedAt: new Date(), dept: clientDept, city: clientCity, address: clientAddr,
                addresses: clientAddr ? [{ alias: "Principal", address: clientAddr, dept: clientDept, city: clientCity, isDefault: true }] : []
            };
            const docRef = await addDoc(collection(db, "users"), newClientData);
            finalUserId = docRef.id;
        }

        // 🔥 LÓGICA DE 4X1000
        const shippingCost = parseCurrency(document.getElementById('m-shipping-cost').value);
        const subtotal = items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        let baseTotal = subtotal + shippingCost;
        let tax4x1000 = 0;
        
        if (document.getElementById('m-apply-4x1000').checked) {
            tax4x1000 = Math.round(baseTotal * 0.004);
        }
        
        const total = baseTotal + tax4x1000;
        const accountId = document.getElementById('m-payment-account').value;

        if (total <= 0) throw new Error("El total de la venta no puede ser cero.");

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
             await addDoc(collection(db, "expenses"), { amount: total, category: "Ingreso Ventas Manual", description: `Cobro Inmediato - Venta a ${custName || 'Cliente'}`, paymentMethod: paymentMethodName, supplierName: custName || "Cliente Directo", date: new Date(), createdAt: new Date(), type: 'INCOME' });
             paymentStatus = 'PAID'; amountPaid = total;
        }

        const orderData = {
            userId: finalUserId, userName: custName, phone: custPhone, clientDoc: custDoc, 
            items, 
            subtotal, shippingCost, tax4x1000, total,
            status: 'PENDIENTE', source: 'MANUAL', requiresInvoice: document.getElementById('m-requires-invoice').checked,
            paymentStatus, amountPaid, paymentAccountId: accountId === 'credit' ? null : accountId, paymentMethodName,
            isStockDeducted: true,
            createdAt: new Date(), updatedAt: new Date(), shippingData, buyerInfo: { name: custName, email: emailVal || "", phone: custPhone, document: custDoc }
        };
        
        // 1. Guardar la orden primero en Firestore
        const orderRef = await addDoc(collection(db, "orders"), orderData);

        // 2. Guardar la remisión correspondiente en Firestore
        await setDoc(doc(db, "remissions", orderRef.id), { ...orderData, orderId: orderRef.id, status: 'PENDIENTE_ALISTAMIENTO', type: 'DIRECTA' });

        // 3. SOLO AHORA QUE LA ORDEN Y REMISIÓN EXISTEN Y ESTÁN CONFIRMADAS, SE DESCUENTA EL STOCK
        let stockDeductedItems = [];
        const shortOrdId = orderRef.id.slice(0, 6);
        try {
            for (const item of items) { 
                await adjustStock(item.id, -(item.quantity), item.color, item.capacity, 'VENTA_PEDIDO', `Venta en pedido manual #${shortOrdId}`);
                stockDeductedItems.push(item);
            }
        } catch (stockErr) {
            console.error("🚨 Error aplicando descuento de stock tras crear la orden:", stockErr);
            // Rollback de stock devuelto para evitar inconsistencias
            for (const item of stockDeductedItems) {
                try {
                    await adjustStock(item.id, item.quantity, item.color, item.capacity, 'AJUSTE_MANUAL', 'Rollback por falla al procesar la venta');
                } catch (rbErr) { console.error("Error en rollback de stock:", rbErr); }
            }
            // Eliminar orden y remisión creadas si falla el inventario
            await deleteDoc(doc(db, "orders", orderRef.id));
            await deleteDoc(doc(db, "remissions", orderRef.id));
            const stockMsg = stockErr?.message || (typeof stockErr === 'string' ? stockErr : "Stock insuficiente");
            throw new Error(`🚨 No se pudo completar la venta por un problema de inventario: ${stockMsg}`);
        }

        alert(`✅ Venta Exitosa.\nLa orden #${orderRef.id.slice(0,6)} ha sido enviada al centro logístico.`);
        document.getElementById('manual-modal').classList.add('hidden');
        if (onSuccessCallback) onSuccessCallback();

    } catch (e) {
        console.error("Error en saveOrder:", e);
        const errMsg = e?.message || (typeof e === 'string' ? e : "Error inesperado al procesar la venta.");
        alert(`❌ ${errMsg}`);
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}