// public/js/inventory-transfer.js
import { db, collection, getDocs, getDoc, doc, runTransaction, query, where, auth } from './firebase-init.js';

const ALLOWED_ROLES = ['admin', 'developer', 'ventas'];

export function isAuthorizedForTransfer() {
    const role = sessionStorage.getItem('pixeltech_user_role') || window.currentUserRole || 'customer';
    return ALLOWED_ROLES.includes(role);
}

let activeProduct = null;
let activeSerials = [];
let selectedSerialIds = new Set();
let transferDirection = 'BODEGA_TO_FULL'; // 'BODEGA_TO_FULL' | 'FULL_TO_BODEGA'
let selectedVariantIndex = 0;
let isSubmitting = false;

function ensureModalContainer() {
    if (document.getElementById('modal-transfer-full')) return;

    const modalHtml = `
    <div id="modal-transfer-full" class="fixed inset-0 z-50 bg-brand-black/80 backdrop-blur-md hidden flex items-center justify-center p-3 sm:p-6 overflow-y-auto no-scrollbar">
        <div class="bg-white w-full max-w-2xl rounded-[2.5rem] p-6 sm:p-8 shadow-2xl relative my-auto border border-gray-100 flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95">
            
            <!-- HEADER -->
            <div class="flex items-start justify-between gap-4 pb-4 border-b border-gray-100 shrink-0">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0 border border-amber-500/20">
                        <i class="fa-solid fa-truck-ramp-box text-xl"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2 mb-0.5">
                            <span class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                                MercadoLibre Full & Bodega
                            </span>
                            <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                                Control de Ubicaciones
                            </span>
                        </div>
                        <h2 class="text-lg sm:text-xl font-black text-brand-black uppercase tracking-tight">
                            Traslado de Inventario
                        </h2>
                    </div>
                </div>
                <button type="button" onclick="window.closeTransferFullModal()" class="w-10 h-10 rounded-full bg-slate-50 text-gray-400 hover:text-gray-700 hover:bg-slate-100 transition flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>

            <!-- CONTENIDO CON SCROLL -->
            <div class="overflow-y-auto custom-scroll py-4 space-y-5 flex-grow pr-1">
                
                <!-- BUSCADOR SI NO HAY PRODUCTO SELECCIONADO -->
                <div id="tr-product-search-box" class="hidden space-y-2">
                    <label class="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                        Buscar Producto a Trasladar
                    </label>
                    <div class="relative">
                        <i class="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input type="text" id="tr-product-search-input" placeholder="Nombre, SKU o marca del producto..."
                            class="w-full bg-slate-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 text-xs font-bold outline-none focus:border-brand-cyan focus:bg-white transition shadow-2xs">
                    </div>
                    <div id="tr-product-search-results" class="hidden max-h-48 overflow-y-auto border border-gray-100 rounded-xl bg-white shadow-lg p-2 space-y-1"></div>
                </div>

                <!-- CARD RESUMEN PRODUCTO -->
                <div id="tr-product-card" class="bg-slate-50 border border-gray-200/80 rounded-2xl p-4 flex items-center gap-4">
                    <img id="tr-p-img" src="/img/logo.webp" alt="Producto" class="w-16 h-16 object-contain rounded-xl bg-white border border-gray-200 p-1 shrink-0">
                    <div class="min-w-0 flex-grow">
                        <span id="tr-p-brand" class="text-[9px] font-black text-gray-400 uppercase tracking-widest block">PixelTech</span>
                        <h3 id="tr-p-name" class="text-xs sm:text-sm font-black text-brand-black uppercase truncate leading-tight">Cargando producto...</h3>
                        <div class="flex items-center gap-2 mt-1 text-[10px] font-mono text-gray-500 font-bold flex-wrap">
                            <span id="tr-p-sku">SKU: ---</span>
                            <span class="text-gray-300">|</span>
                            <span id="tr-p-cat">General</span>
                        </div>
                    </div>
                    <button type="button" id="tr-btn-change-product" onclick="window.resetTransferProductSelection()"
                        class="text-[10px] font-black text-brand-cyan hover:underline uppercase tracking-wider shrink-0 hidden">
                        Cambiar
                    </button>
                </div>

                <!-- SELECTOR DE DIRECCION DEL TRASLADO -->
                <div class="space-y-2">
                    <label class="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                        Dirección del Traslado
                    </label>
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" id="tr-dir-to-full" onclick="window.setTransferDirection('BODEGA_TO_FULL')"
                            class="p-3.5 rounded-2xl border-2 transition-all flex flex-col items-center justify-center text-center gap-1.5 cursor-pointer bg-brand-black text-white border-brand-black shadow-sm">
                            <div class="flex items-center gap-2 text-xs font-black uppercase tracking-wider">
                                <i class="fa-solid fa-arrow-right text-amber-400"></i>
                                <span>Envío a Full</span>
                            </div>
                            <span class="text-[9px] opacity-75 font-bold">Bodega Propia -> ML Full</span>
                        </button>
                        <button type="button" id="tr-dir-to-bodega" onclick="window.setTransferDirection('FULL_TO_BODEGA')"
                            class="p-3.5 rounded-2xl border-2 transition-all flex flex-col items-center justify-center text-center gap-1.5 cursor-pointer bg-white text-gray-600 border-gray-200 hover:border-gray-400">
                            <div class="flex items-center gap-2 text-xs font-black uppercase tracking-wider">
                                <i class="fa-solid fa-arrow-left text-blue-500"></i>
                                <span>Retorno a Bodega</span>
                            </div>
                            <span class="text-[9px] text-gray-400 font-bold">ML Full -> Bodega Propia</span>
                        </button>
                    </div>
                </div>

                <!-- SELECTOR DE VARIANTE (SI APLICA) -->
                <div id="tr-variant-box" class="hidden space-y-1.5">
                    <label class="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                        Selecciona Variante
                    </label>
                    <select id="tr-variant-select" onchange="window.onTransferVariantChange(this.value)"
                        class="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-black text-brand-black outline-none focus:border-brand-cyan transition shadow-2xs">
                    </select>
                </div>

                <!-- STOCK ACTUAL POR UBICACION -->
                <div class="grid grid-cols-3 gap-2 bg-slate-50 border border-gray-200 rounded-2xl p-3 text-center">
                    <div>
                        <span class="text-[9px] font-black uppercase tracking-widest text-gray-400 block mb-0.5">En Bodega</span>
                        <span id="tr-stock-bodega" class="text-base sm:text-lg font-black text-brand-black">0</span>
                    </div>
                    <div>
                        <span class="text-[9px] font-black uppercase tracking-widest text-amber-600 block mb-0.5">En Full ML</span>
                        <span id="tr-stock-full" class="text-base sm:text-lg font-black text-amber-600">0</span>
                    </div>
                    <div>
                        <span class="text-[9px] font-black uppercase tracking-widest text-gray-400 block mb-0.5">Total Global</span>
                        <span id="tr-stock-total" class="text-base sm:text-lg font-black text-gray-700">0</span>
                    </div>
                </div>

                <!-- CANTIDAD A TRASLADAR -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                            Cantidad a Trasladar
                        </label>
                        <span id="tr-max-available-lbl" class="text-[10px] font-black uppercase text-gray-400">
                            Máximo transferible: <strong class="text-brand-black" id="tr-max-available-val">0</strong>
                        </span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="window.stepTransferQty(-1)" class="w-11 h-11 rounded-xl bg-slate-100 text-gray-600 hover:bg-slate-200 font-black text-base transition flex items-center justify-center shrink-0">
                            -
                        </button>
                        <input type="number" id="tr-qty-input" min="1" value="1" oninput="window.onTransferQtyChange(this.value)"
                            class="w-full h-11 bg-white border border-gray-200 rounded-xl text-center text-sm font-black text-brand-black outline-none focus:border-brand-cyan transition shadow-2xs">
                        <button type="button" onclick="window.stepTransferQty(1)" class="w-11 h-11 rounded-xl bg-slate-100 text-gray-600 hover:bg-slate-200 font-black text-base transition flex items-center justify-center shrink-0">
                            +
                        </button>
                    </div>
                    <!-- CHIPS RAPIDOS -->
                    <div class="flex items-center gap-1.5 pt-1">
                        <button type="button" onclick="window.setTransferQty(1)" class="px-2.5 py-1 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-gray-600">1</button>
                        <button type="button" onclick="window.setTransferQty(2)" class="px-2.5 py-1 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-gray-600">2</button>
                        <button type="button" onclick="window.setTransferQty(5)" class="px-2.5 py-1 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-gray-600">5</button>
                        <button type="button" onclick="window.setTransferQty(10)" class="px-2.5 py-1 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-gray-600">10</button>
                        <button type="button" onclick="window.setTransferQtyMax()" class="px-2.5 py-1 rounded-lg text-[10px] font-black bg-amber-100 hover:bg-amber-200 text-amber-800 ml-auto">Todo el Stock</button>
                    </div>
                </div>

                <!-- SELECCION DE SERIALES (SI APLICA) -->
                <div id="tr-serials-section" class="space-y-2 pt-2 border-t border-gray-100">
                    <div class="flex items-center justify-between flex-wrap gap-2">
                        <div>
                            <label class="block text-[10px] font-black uppercase tracking-wider text-gray-600">
                                Asignación de Seriales (IMEI / SN)
                            </label>
                            <p class="text-[9px] text-gray-400 font-bold">
                                Selecciona los seriales que viajan en este paquete
                            </p>
                        </div>
                        <span id="tr-serials-counter-badge" class="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-100 text-gray-600 border border-gray-200">
                            0 / 1 Seleccionados
                        </span>
                    </div>

                    <!-- BUSCADOR RAPIDO DE SERIAL / PISTOLA SCANNER -->
                    <div class="relative">
                        <i class="fa-solid fa-barcode absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input type="text" id="tr-serial-scanner-input" placeholder="Escanear con pistola o escribir serial..."
                            onkeydown="window.handleTransferSerialScan(event)"
                            class="w-full bg-slate-50 border border-gray-200 rounded-xl py-2 pl-9 pr-3 text-xs font-mono font-bold uppercase outline-none focus:border-brand-cyan focus:bg-white transition">
                    </div>

                    <!-- LISTA DE SERIALES DISPONIBLES EN ORIGEN -->
                    <div id="tr-serials-list" class="max-h-40 overflow-y-auto custom-scroll border border-gray-200 rounded-2xl p-2 bg-slate-50 space-y-1.5">
                        <p class="text-[10px] text-gray-400 text-center py-4 font-bold">Consultando seriales...</p>
                    </div>

                    <div class="flex items-center justify-between text-[9px] text-gray-400 font-bold px-1">
                        <button type="button" onclick="window.autoSelectFirstSerials()" class="text-brand-cyan hover:underline font-black uppercase tracking-wider">
                            Seleccionar primeros requeridos
                        </button>
                        <button type="button" onclick="window.clearSerialSelection()" class="text-gray-400 hover:text-red-500 uppercase tracking-wider">
                            Limpiar selección
                        </button>
                    </div>
                </div>

                <!-- MENSAJE INFORMATIVO PRODUCTO SIN SERIALES -->
                <div id="tr-no-serials-note" class="hidden p-3 bg-blue-50 border border-blue-200 rounded-2xl text-[10px] font-bold text-blue-800 flex items-center gap-2">
                    <i class="fa-solid fa-circle-info text-blue-500 shrink-0"></i>
                    <span>Este producto no tiene seriales individuales registrados. El traslado se realizará únicamente a nivel de conteo de existencias.</span>
                </div>

                <!-- OBSERVACIONES / REFERENCIA -->
                <div class="space-y-1.5">
                    <label class="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                        Referencia o Guía de Envío (Opcional)
                    </label>
                    <input type="text" id="tr-notes-input" placeholder="Ej: Envío ML Full #987654 / Colecta del día"
                        class="w-full bg-slate-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-bold text-brand-black outline-none focus:border-brand-cyan focus:bg-white transition shadow-2xs">
                </div>

            </div>

            <!-- FOOTER -->
            <div class="pt-4 border-t border-gray-100 flex items-center justify-end gap-3 shrink-0">
                <button type="button" onclick="window.closeTransferFullModal()"
                    class="px-5 py-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-slate-100 font-black text-xs uppercase tracking-wider transition">
                    Cancelar
                </button>
                <button type="button" id="tr-btn-submit" onclick="window.submitInventoryTransfer()"
                    class="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    <i class="fa-solid fa-truck-ramp-box"></i>
                    <span id="tr-btn-submit-text">Confirmar Traslado</span>
                </button>
            </div>

        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function computeProductBranchStock(product, comboIndex = -1) {
    let bodega = 0;
    let full = 0;

    const hasCombos = Array.isArray(product.combinations) && product.combinations.length > 0;

    if (hasCombos && comboIndex >= 0 && product.combinations[comboIndex]) {
        const combo = product.combinations[comboIndex];
        if (combo.branchStock) {
            bodega = Number(combo.branchStock.bodega) || 0;
            full = Number(combo.branchStock.full) || 0;
        } else {
            bodega = Number(combo.stock) || 0;
            full = 0;
        }
    } else if (hasCombos) {
        product.combinations.forEach(c => {
            if (c.branchStock) {
                bodega += Number(c.branchStock.bodega) || 0;
                full += Number(c.branchStock.full) || 0;
            } else {
                bodega += Number(c.stock) || 0;
            }
        });
    } else if (product.branchStock) {
        bodega = Number(product.branchStock.bodega) || 0;
        full = Number(product.branchStock.full) || 0;
    } else {
        bodega = Number(product.stock) || 0;
        full = 0;
    }

    return { bodega, full, total: bodega + full };
}

export async function openTransferFullModal(productId = null) {
    if (!isAuthorizedForTransfer()) {
        alert("Acceso denegado: Esta función de traslado a MercadoLibre Full está restringida a los roles Administrador, Desarrollador y Ventas.");
        return;
    }

    ensureModalContainer();
    const modal = document.getElementById('modal-transfer-full');
    if (!modal) return;

    modal.classList.remove('hidden');

    transferDirection = 'BODEGA_TO_FULL';
    selectedVariantIndex = 0;
    selectedSerialIds.clear();
    activeSerials = [];
    isSubmitting = false;

    updateDirectionButtonsUI();

    const searchBox = document.getElementById('tr-product-search-box');
    const changeBtn = document.getElementById('tr-btn-change-product');

    if (productId) {
        searchBox.classList.add('hidden');
        changeBtn.classList.remove('hidden');
        await loadAndRenderProduct(productId);
    } else {
        searchBox.classList.remove('hidden');
        changeBtn.classList.add('hidden');
        setupProductSearch();
        resetProductCardPlaceholder();
    }
}

export function closeTransferFullModal() {
    const modal = document.getElementById('modal-transfer-full');
    if (modal) modal.classList.add('hidden');
    activeProduct = null;
    activeSerials = [];
    selectedSerialIds.clear();
}

window.openTransferFullModal = openTransferFullModal;
window.closeTransferFullModal = closeTransferFullModal;

function resetProductCardPlaceholder() {
    activeProduct = null;
    document.getElementById('tr-p-img').src = '/img/logo.webp';
    document.getElementById('tr-p-brand').textContent = 'PixelTech';
    document.getElementById('tr-p-name').textContent = 'Selecciona un producto arriba';
    document.getElementById('tr-p-sku').textContent = 'SKU: ---';
    document.getElementById('tr-p-cat').textContent = 'General';

    document.getElementById('tr-stock-bodega').textContent = '0';
    document.getElementById('tr-stock-full').textContent = '0';
    document.getElementById('tr-stock-total').textContent = '0';
    document.getElementById('tr-max-available-val').textContent = '0';

    document.getElementById('tr-variant-box').classList.add('hidden');
    document.getElementById('tr-serials-section').classList.add('hidden');
    document.getElementById('tr-no-serials-note').classList.add('hidden');

    const submitBtn = document.getElementById('tr-btn-submit');
    if (submitBtn) submitBtn.disabled = true;
}

window.resetTransferProductSelection = () => {
    resetProductCardPlaceholder();
    const searchBox = document.getElementById('tr-product-search-box');
    if (searchBox) searchBox.classList.remove('hidden');
    const input = document.getElementById('tr-product-search-input');
    if (input) {
        input.value = '';
        input.focus();
    }
};

async function loadAndRenderProduct(productId) {
    try {
        const snap = await getDoc(doc(db, "products", productId));
        if (!snap.exists()) {
            alert("El producto seleccionado no existe.");
            closeTransferFullModal();
            return;
        }

        activeProduct = { id: snap.id, ...snap.data() };
        renderProductData();
    } catch (err) {
        console.error("Error al cargar producto para traslado:", err);
        alert("No se pudo cargar la información del producto.");
    }
}

function renderProductData() {
    if (!activeProduct) return;

    const img = activeProduct.mainImage || (Array.isArray(activeProduct.images) && activeProduct.images[0]) || '/img/logo.webp';
    document.getElementById('tr-p-img').src = img;
    document.getElementById('tr-p-brand').textContent = activeProduct.brand || 'PixelTech';
    document.getElementById('tr-p-name').textContent = activeProduct.name;
    document.getElementById('tr-p-sku').textContent = `SKU: ${activeProduct.sku || 'SIN-SKU'}`;
    document.getElementById('tr-p-cat').textContent = activeProduct.category || 'General';

    const hasCombos = Array.isArray(activeProduct.combinations) && activeProduct.combinations.length > 0;
    const variantBox = document.getElementById('tr-variant-box');
    const variantSelect = document.getElementById('tr-variant-select');

    if (hasCombos) {
        variantBox.classList.remove('hidden');
        variantSelect.innerHTML = activeProduct.combinations.map((c, idx) => {
            const stockInfo = computeProductBranchStock(activeProduct, idx);
            const label = `${c.color || 'Estándar'} ${c.capacity ? `/ ${c.capacity}` : ''}`;
            return `<option value="${idx}">${label} (Bodega: ${stockInfo.bodega} | Full: ${stockInfo.full})</option>`;
        }).join('');
        selectedVariantIndex = 0;
        variantSelect.value = "0";
    } else {
        variantBox.classList.add('hidden');
        selectedVariantIndex = -1;
    }

    refreshStockDisplays();
    loadSerialsForActiveSelection();
}

function refreshStockDisplays() {
    if (!activeProduct) return;

    const stockInfo = computeProductBranchStock(activeProduct, selectedVariantIndex);
    document.getElementById('tr-stock-bodega').textContent = stockInfo.bodega;
    document.getElementById('tr-stock-full').textContent = stockInfo.full;
    document.getElementById('tr-stock-total').textContent = stockInfo.total;

    const maxStock = transferDirection === 'BODEGA_TO_FULL' ? stockInfo.bodega : stockInfo.full;
    document.getElementById('tr-max-available-val').textContent = `${maxStock} ud(s)`;

    const qtyInput = document.getElementById('tr-qty-input');
    let currentQty = parseInt(qtyInput.value) || 1;
    if (currentQty > maxStock) currentQty = Math.max(1, maxStock);
    if (maxStock <= 0) currentQty = 0;
    qtyInput.value = currentQty;
    qtyInput.max = maxStock;

    validateSubmitState();
}

window.setTransferDirection = (dir) => {
    transferDirection = dir;
    updateDirectionButtonsUI();
    refreshStockDisplays();
    loadSerialsForActiveSelection();
};

function updateDirectionButtonsUI() {
    const btnToFull = document.getElementById('tr-dir-to-full');
    const btnToBodega = document.getElementById('tr-dir-to-bodega');

    if (transferDirection === 'BODEGA_TO_FULL') {
        btnToFull.className = "p-3.5 rounded-2xl border-2 transition-all flex flex-col items-center justify-center text-center gap-1.5 cursor-pointer bg-brand-black text-white border-brand-black shadow-sm";
        btnToBodega.className = "p-3.5 rounded-2xl border-2 transition-all flex flex-col items-center justify-center text-center gap-1.5 cursor-pointer bg-white text-gray-600 border-gray-200 hover:border-gray-400";
    } else {
        btnToFull.className = "p-3.5 rounded-2xl border-2 transition-all flex flex-col items-center justify-center text-center gap-1.5 cursor-pointer bg-white text-gray-600 border-gray-200 hover:border-gray-400";
        btnToBodega.className = "p-3.5 rounded-2xl border-2 transition-all flex flex-col items-center justify-center text-center gap-1.5 cursor-pointer bg-brand-black text-white border-brand-black shadow-sm";
    }
}

window.onTransferVariantChange = (val) => {
    selectedVariantIndex = parseInt(val);
    refreshStockDisplays();
    loadSerialsForActiveSelection();
};

window.onTransferQtyChange = (val) => {
    const stockInfo = computeProductBranchStock(activeProduct, selectedVariantIndex);
    const maxStock = transferDirection === 'BODEGA_TO_FULL' ? stockInfo.bodega : stockInfo.full;
    let num = parseInt(val) || 0;
    if (num < 0) num = 0;
    if (num > maxStock) num = maxStock;
    document.getElementById('tr-qty-input').value = num;

    updateSerialsCounterBadge();
    validateSubmitState();
};

window.stepTransferQty = (step) => {
    const input = document.getElementById('tr-qty-input');
    const cur = parseInt(input.value) || 0;
    window.onTransferQtyChange(cur + step);
};

window.setTransferQty = (val) => {
    window.onTransferQtyChange(val);
};

window.setTransferQtyMax = () => {
    const stockInfo = computeProductBranchStock(activeProduct, selectedVariantIndex);
    const maxStock = transferDirection === 'BODEGA_TO_FULL' ? stockInfo.bodega : stockInfo.full;
    window.onTransferQtyChange(maxStock);
};

async function loadSerialsForActiveSelection() {
    if (!activeProduct) return;

    selectedSerialIds.clear();
    const serialsSection = document.getElementById('tr-serials-section');
    const noSerialsNote = document.getElementById('tr-no-serials-note');
    const listContainer = document.getElementById('tr-serials-list');

    listContainer.innerHTML = '<p class="text-[10px] text-gray-400 text-center py-4 font-bold">Consultando seriales...</p>';

    try {
        const requiredStatus = transferDirection === 'BODEGA_TO_FULL' ? 'AVAILABLE' : 'IN_FULL_ML';

        const q = query(
            collection(db, "product_serials"),
            where("productId", "==", activeProduct.id),
            where("status", "==", requiredStatus)
        );

        const snap = await getDocs(q);
        let docsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Filtrar por variante si aplica
        if (selectedVariantIndex >= 0 && activeProduct.combinations && activeProduct.combinations[selectedVariantIndex]) {
            const combo = activeProduct.combinations[selectedVariantIndex];
            const selColor = (combo.color || '').trim().toLowerCase();
            const selCap = (combo.capacity || '').trim().toLowerCase();

            docsList = docsList.filter(s => {
                const sColor = (s.color || '').trim().toLowerCase();
                const sCap = (s.capacity || '').trim().toLowerCase();
                const matchColor = !selColor || sColor === selColor;
                const matchCap = !selCap || sCap === selCap;
                return matchColor && matchCap;
            });
        }

        activeSerials = docsList;

        if (activeSerials.length === 0) {
            // Verificar si el producto maneja seriales en absoluto
            const anySerialSnap = await getDocs(query(collection(db, "product_serials"), where("productId", "==", activeProduct.id)));
            if (anySerialSnap.empty) {
                serialsSection.classList.add('hidden');
                noSerialsNote.classList.remove('hidden');
            } else {
                serialsSection.classList.remove('hidden');
                noSerialsNote.classList.add('hidden');
                listContainer.innerHTML = `
                    <div class="py-4 text-center">
                        <p class="text-[10px] text-amber-700 font-bold">
                            No hay seriales registrados en estado "${requiredStatus}" para esta ubicación.
                        </p>
                    </div>
                `;
            }
        } else {
            serialsSection.classList.remove('hidden');
            noSerialsNote.classList.add('hidden');
            renderSerialsList();
        }

        updateSerialsCounterBadge();
        validateSubmitState();
    } catch (err) {
        console.error("Error al cargar seriales para traslado:", err);
        listContainer.innerHTML = '<p class="text-[10px] text-red-500 text-center py-4 font-bold">Error al consultar seriales.</p>';
    }
}

function renderSerialsList() {
    const listContainer = document.getElementById('tr-serials-list');
    if (!listContainer) return;

    if (activeSerials.length === 0) {
        listContainer.innerHTML = '<p class="text-[10px] text-gray-400 text-center py-4 font-bold">No hay seriales disponibles.</p>';
        return;
    }

    listContainer.innerHTML = activeSerials.map(s => {
        const isChecked = selectedSerialIds.has(s.id);
        const sn = s.serialNumber || s.sn || 'SIN-SN';
        const variantText = [s.color, s.capacity].filter(Boolean).join(' - ');

        return `
            <label class="flex items-center justify-between p-2 rounded-xl bg-white border ${isChecked ? 'border-amber-400 bg-amber-50/40' : 'border-gray-200'} hover:border-amber-300 transition cursor-pointer select-none">
                <div class="flex items-center gap-2.5 min-w-0">
                    <input type="checkbox" value="${s.id}" ${isChecked ? 'checked' : ''}
                        onchange="window.toggleTransferSerialSelection('${s.id}')"
                        class="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500 cursor-pointer">
                    <span class="font-mono text-xs font-black text-brand-black tracking-wider truncate">${sn}</span>
                </div>
                ${variantText ? `<span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest shrink-0 ml-2">${variantText}</span>` : ''}
            </label>
        `;
    }).join('');
}

window.toggleTransferSerialSelection = (serialDocId) => {
    if (selectedSerialIds.has(serialDocId)) {
        selectedSerialIds.delete(serialDocId);
    } else {
        const targetQty = parseInt(document.getElementById('tr-qty-input').value) || 0;
        if (selectedSerialIds.size >= targetQty) {
            // Reemplaza o expande la cantidad automáticamente si es razonable
            const stockInfo = computeProductBranchStock(activeProduct, selectedVariantIndex);
            const maxStock = transferDirection === 'BODEGA_TO_FULL' ? stockInfo.bodega : stockInfo.full;
            if (targetQty < maxStock) {
                document.getElementById('tr-qty-input').value = targetQty + 1;
            }
        }
        selectedSerialIds.add(serialDocId);
    }
    renderSerialsList();
    updateSerialsCounterBadge();
    validateSubmitState();
};

window.autoSelectFirstSerials = () => {
    const targetQty = parseInt(document.getElementById('tr-qty-input').value) || 0;
    selectedSerialIds.clear();
    const toSelect = activeSerials.slice(0, targetQty);
    toSelect.forEach(s => selectedSerialIds.add(s.id));
    renderSerialsList();
    updateSerialsCounterBadge();
    validateSubmitState();
};

window.clearSerialSelection = () => {
    selectedSerialIds.clear();
    renderSerialsList();
    updateSerialsCounterBadge();
    validateSubmitState();
};

window.handleTransferSerialScan = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const input = document.getElementById('tr-serial-scanner-input');
    const rawVal = (input.value || '').trim().toUpperCase();
    if (!rawVal) return;

    const found = activeSerials.find(s => (s.serialNumber || s.sn || '').toUpperCase() === rawVal);
    if (!found) {
        alert(`El serial "${rawVal}" no se encuentra disponible en la ubicación origen seleccionada.`);
        input.value = '';
        return;
    }

    selectedSerialIds.add(found.id);
    input.value = '';
    renderSerialsList();
    updateSerialsCounterBadge();
    validateSubmitState();
};

function updateSerialsCounterBadge() {
    const badge = document.getElementById('tr-serials-counter-badge');
    const targetQty = parseInt(document.getElementById('tr-qty-input')?.value) || 0;
    const selectedCount = selectedSerialIds.size;

    if (!badge) return;

    badge.textContent = `${selectedCount} / ${targetQty} Seleccionados`;
    if (selectedCount === targetQty && targetQty > 0) {
        badge.className = "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200";
    } else if (selectedCount > targetQty) {
        badge.className = "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200";
    } else {
        badge.className = "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-100 text-gray-600 border border-gray-200";
    }
}

function validateSubmitState() {
    const submitBtn = document.getElementById('tr-btn-submit');
    if (!submitBtn) return;

    if (!activeProduct || isSubmitting) {
        submitBtn.disabled = true;
        return;
    }

    const qty = parseInt(document.getElementById('tr-qty-input')?.value) || 0;
    const stockInfo = computeProductBranchStock(activeProduct, selectedVariantIndex);
    const maxStock = transferDirection === 'BODEGA_TO_FULL' ? stockInfo.bodega : stockInfo.full;

    if (qty <= 0 || qty > maxStock) {
        submitBtn.disabled = true;
        return;
    }

    // Si el producto maneja seriales y hay seriales registrados
    if (activeSerials.length > 0) {
        if (selectedSerialIds.size !== qty) {
            submitBtn.disabled = true;
            return;
        }
    }

    submitBtn.disabled = false;
}

window.submitInventoryTransfer = async () => {
    if (!isAuthorizedForTransfer()) {
        alert("Acceso denegado.");
        return;
    }

    if (!activeProduct || isSubmitting) return;

    const qty = parseInt(document.getElementById('tr-qty-input').value) || 0;
    const stockInfo = computeProductBranchStock(activeProduct, selectedVariantIndex);
    const maxStock = transferDirection === 'BODEGA_TO_FULL' ? stockInfo.bodega : stockInfo.full;

    if (qty <= 0) {
        alert("Ingresa una cantidad mayor a cero.");
        return;
    }

    if (qty > maxStock) {
        alert(`La cantidad no puede superar el stock disponible (${maxStock} uds).`);
        return;
    }

    if (activeSerials.length > 0 && selectedSerialIds.size !== qty) {
        alert(`Debes seleccionar exactamente ${qty} serial(es). Actualmente tienes ${selectedSerialIds.size}.`);
        return;
    }

    const directionLabel = transferDirection === 'BODEGA_TO_FULL'
        ? 'Bodega Propia -> MercadoLibre Full'
        : 'MercadoLibre Full -> Bodega Propia';

    const notes = (document.getElementById('tr-notes-input')?.value || '').trim();

    const confirmMsg = `¿Confirmas el traslado de ${qty} unidad(es) de "${activeProduct.name}"?\n\nDirección: ${directionLabel}\n${notes ? `Referencia: ${notes}\n` : ''}`;
    if (!confirm(confirmMsg)) return;

    isSubmitting = true;
    const submitBtn = document.getElementById('tr-btn-submit');
    const submitText = document.getElementById('tr-btn-submit-text');
    submitBtn.disabled = true;
    submitText.textContent = "Procesando...";

    try {
        const fromBranch = transferDirection === 'BODEGA_TO_FULL' ? 'bodega' : 'full';
        const toBranch = transferDirection === 'BODEGA_TO_FULL' ? 'full' : 'bodega';
        const now = new Date();
        const nowISO = now.toISOString();

        const selectedSerialsObjects = activeSerials.filter(s => selectedSerialIds.has(s.id));

        await runTransaction(db, async (transaction) => {
            const pRef = doc(db, "products", activeProduct.id);
            const pSnap = await transaction.get(pRef);
            if (!pSnap.exists()) throw new Error("El producto ya no existe en la base de datos.");

            const pData = pSnap.data();
            let rootBranchStock = pData.branchStock ? { ...pData.branchStock } : null;
            let combinations = Array.isArray(pData.combinations) ? JSON.parse(JSON.stringify(pData.combinations)) : [];

            if (!rootBranchStock) {
                rootBranchStock = { bodega: Number(pData.stock) || 0, full: 0 };
            }
            if (rootBranchStock.bodega === undefined) rootBranchStock.bodega = 0;
            if (rootBranchStock.full === undefined) rootBranchStock.full = 0;

            let variantLabel = null;

            if (combinations.length > 0 && selectedVariantIndex >= 0 && combinations[selectedVariantIndex]) {
                const combo = combinations[selectedVariantIndex];
                if (!combo.branchStock) {
                    combo.branchStock = { bodega: Number(combo.stock) || 0, full: 0 };
                }
                if (combo.branchStock.bodega === undefined) combo.branchStock.bodega = 0;
                if (combo.branchStock.full === undefined) combo.branchStock.full = 0;

                const curFrom = Number(combo.branchStock[fromBranch]) || 0;
                if (curFrom < qty) {
                    throw new Error(`Stock insuficiente en ${fromBranch} para la variante.`);
                }

                combo.branchStock[fromBranch] = curFrom - qty;
                combo.branchStock[toBranch] = (Number(combo.branchStock[toBranch]) || 0) + qty;
                combo.stock = (Number(combo.branchStock.bodega) || 0) + (Number(combo.branchStock.full) || 0);

                variantLabel = `${combo.color || 'Estándar'} ${combo.capacity ? `/ ${combo.capacity}` : ''}`;

                // Recalcular rootBranchStock sumando todas las combinaciones
                rootBranchStock = { bodega: 0, full: 0 };
                combinations.forEach(c => {
                    if (c.branchStock) {
                        rootBranchStock.bodega += Number(c.branchStock.bodega) || 0;
                        rootBranchStock.full += Number(c.branchStock.full) || 0;
                    }
                });
            } else {
                const curFrom = Number(rootBranchStock[fromBranch]) || 0;
                if (curFrom < qty) {
                    throw new Error(`Stock insuficiente en ${fromBranch}.`);
                }
                rootBranchStock[fromBranch] = curFrom - qty;
                rootBranchStock[toBranch] = (Number(rootBranchStock[toBranch]) || 0) + qty;
            }

            const finalGlobalStock = (Number(rootBranchStock.bodega) || 0) + (Number(rootBranchStock.full) || 0);

            const updateProductPayload = {
                branchStock: rootBranchStock,
                stock: finalGlobalStock,
                updatedAt: now
            };
            if (combinations.length > 0) {
                updateProductPayload.combinations = combinations;
            }
            transaction.update(pRef, updateProductPayload);

            // Actualizar seriales individuales
            if (selectedSerialsObjects.length > 0) {
                const newStatus = transferDirection === 'BODEGA_TO_FULL' ? 'IN_FULL_ML' : 'AVAILABLE';
                const newLocation = transferDirection === 'BODEGA_TO_FULL' ? 'FULL_ML' : 'BODEGA';

                selectedSerialsObjects.forEach(s => {
                    const sRef = doc(db, "product_serials", s.id);
                    const sUpdate = {
                        status: newStatus,
                        location: newLocation,
                        updatedAt: now
                    };
                    if (transferDirection === 'BODEGA_TO_FULL') {
                        sUpdate.transferredToFullAt = now;
                        sUpdate.transferShipmentRef = notes || null;
                    } else {
                        sUpdate.returnedFromFullAt = now;
                        sUpdate.returnReason = notes || null;
                    }
                    transaction.update(sRef, sUpdate);
                });
            }

            // Registrar log de auditoría
            const auditRef = doc(collection(db, "inventory_audit_logs"));
            transaction.set(auditRef, {
                productId: activeProduct.id,
                productName: pData.name || activeProduct.name,
                image: activeProduct.mainImage || '',
                sku: pData.sku || activeProduct.sku || '',
                brand: pData.brand || activeProduct.brand || '',
                category: pData.category || activeProduct.category || '',
                type: 'TRASLADO_FULL',
                reason: transferDirection === 'BODEGA_TO_FULL' ? 'ENVIO_A_MERCADOLIBRE_FULL' : 'RETORNO_A_BODEGA_PROPIA',
                fromBranch: fromBranch,
                toBranch: toBranch,
                qtyChange: qty,
                variant: variantLabel,
                serials: selectedSerialsObjects.map(s => s.serialNumber || s.sn),
                notes: notes || '',
                adminEmail: auth.currentUser?.email || sessionStorage.getItem('pixeltech_user_email') || 'admin@pixeltechcol.com',
                adminName: auth.currentUser?.displayName || 'Administrador',
                timestamp: now,
                createdAtISO: nowISO
            });
        });

        alert(`Traslado completado con éxito.\nSe trasladaron ${qty} unidad(es) de "${activeProduct.name}" a ${toBranch === 'full' ? 'MercadoLibre Full' : 'Bodega Propia'}.`);

        window.dispatchEvent(new CustomEvent('inventoryTransferCompleted', {
            detail: {
                productId: activeProduct.id,
                qty,
                fromBranch,
                toBranch
            }
        }));

        closeTransferFullModal();

    } catch (err) {
        console.error("Error al procesar traslado de inventario:", err);
        alert(`Error al procesar el traslado: ${err.message || err}`);
    } finally {
        isSubmitting = false;
        if (submitBtn) submitBtn.disabled = false;
        if (submitText) submitText.textContent = "Confirmar Traslado";
    }
};

function setupProductSearch() {
    const input = document.getElementById('tr-product-search-input');
    const resultsBox = document.getElementById('tr-product-search-results');
    if (!input || !resultsBox) return;

    let debounceTimer = null;

    input.oninput = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const queryText = (input.value || '').trim().toLowerCase();
            if (queryText.length < 2) {
                resultsBox.classList.add('hidden');
                resultsBox.innerHTML = '';
                return;
            }

            try {
                // Consulta productos activos o borradores
                const snap = await getDocs(collection(db, "products"));
                const matches = [];

                snap.forEach(d => {
                    const p = d.data();
                    const name = (p.name || '').toLowerCase();
                    const sku = (p.sku || '').toLowerCase();
                    const brand = (p.brand || '').toLowerCase();

                    if (name.includes(queryText) || sku.includes(queryText) || brand.includes(queryText)) {
                        matches.push({ id: d.id, ...p });
                    }
                });

                if (matches.length === 0) {
                    resultsBox.innerHTML = '<p class="text-xs text-gray-400 p-3 text-center font-bold">No se encontraron productos coincidentes.</p>';
                } else {
                    resultsBox.innerHTML = matches.slice(0, 8).map(p => {
                        const img = p.mainImage || (Array.isArray(p.images) && p.images[0]) || '/img/logo.webp';
                        const stockInfo = computeProductBranchStock(p);
                        return `
                            <div onclick="window.selectTransferSearchedProduct('${p.id}')"
                                class="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition cursor-pointer border border-transparent hover:border-gray-200">
                                <img src="${img}" class="w-10 h-10 object-contain rounded-lg bg-white border border-gray-100 p-0.5 shrink-0">
                                <div class="min-w-0 flex-grow">
                                    <h4 class="text-xs font-black text-brand-black truncate uppercase leading-tight">${p.name}</h4>
                                    <div class="flex items-center gap-2 text-[9px] font-bold text-gray-400">
                                        <span>SKU: ${p.sku || '---'}</span>
                                        <span>|</span>
                                        <span>Bodega: <strong class="text-brand-black">${stockInfo.bodega}</strong></span>
                                        <span>Full: <strong class="text-amber-600">${stockInfo.full}</strong></span>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
                resultsBox.classList.remove('hidden');
            } catch (err) {
                console.error("Error en búsqueda de producto:", err);
            }
        }, 250);
    };
}

window.selectTransferSearchedProduct = async (productId) => {
    const resultsBox = document.getElementById('tr-product-search-results');
    const searchBox = document.getElementById('tr-product-search-box');
    const changeBtn = document.getElementById('tr-btn-change-product');

    if (resultsBox) resultsBox.classList.add('hidden');
    if (searchBox) searchBox.classList.add('hidden');
    if (changeBtn) changeBtn.classList.remove('hidden');

    await loadAndRenderProduct(productId);
};
