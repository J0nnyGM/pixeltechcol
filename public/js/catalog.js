import { db, collection, getDocs, query, where } from "./firebase-init.js";
import { addToCart, updateCartCount, getProductQtyInCart, removeOneUnit } from "./cart.js";
import { renderBrandCarousel } from "./global-components.js";

// --- ESTADO GLOBAL ---
let allProducts = [];
let filteredProducts = [];
const activeFilters = { category: [], brand: [], color: [], capacity: [] };

// CONFIGURACIÓN
const ITEMS_PER_PAGE = 30;
let currentPage = 1;
let currentSort = 'newest';
let isPromoMode = false;

// REFERENCIAS DOM
const grid = document.getElementById('products-grid');
const countLabel = document.getElementById('product-count');
const filtersContainer = document.getElementById('filters-container');
const emptyState = document.getElementById('empty-state');
const btnClear = document.getElementById('btn-clear-filters');
const paginationContainer = document.getElementById('pagination-controls');

// Header Elements
const pageTitle = document.querySelector('h1'); 
const pageSubtitle = document.querySelector('h1')?.previousElementSibling;

// Sort & Mobile
const sortTrigger = document.getElementById('sort-trigger');
const sortLabel = document.getElementById('sort-label');
const sortIcon = document.getElementById('sort-icon');
const sortDropdown = document.getElementById('sort-dropdown');
const drawer = document.getElementById('mobile-filters-drawer');
const mobileOverlay = document.getElementById('mobile-filters-overlay');
const mobileContent = document.getElementById('mobile-filters-content');

// --- 1. INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', async () => {
    
    // Detectar Modo Promos
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'promos') {
        isPromoMode = true;
        setupPromoView();
        currentSort = 'discount'; 
        if(sortLabel) sortLabel.textContent = "Mejores Ofertas";
    }

    // CARGA INTELIGENTE (SMART SYNC)
    await loadProductsSmart();
    
    const catParam = urlParams.get('category');
    const subParam = urlParams.get('subcategory');

    if (catParam) activeFilters.category.push(decodeURIComponent(catParam));
    if (subParam) activeFilters.brand.push(decodeURIComponent(subParam));

    syncCheckboxes();
    applySortAndFilter();
});

// --- FUNCIÓN AUXILIAR VISUAL ---
function setupPromoView() {
    if(pageTitle) pageTitle.innerHTML = `OFERTAS <span class="text-brand-red">ESPECIALES</span>`;
    if(pageSubtitle) {
        pageSubtitle.textContent = "Tiempo Limitado";
        pageSubtitle.classList.remove('text-gray-400');
        pageSubtitle.classList.add('text-brand-red', 'animate-pulse');
    }
    const carousel = document.getElementById('brands-carousel-area');
    if(carousel) carousel.classList.add('hidden');
}

// ==========================================================================
// 🧠 SMART PRODUCT SYNC (Lógica Delta para Catálogo)
// ==========================================================================
async function loadProductsSmart() {
    const STORAGE_KEY = 'pixeltech_master_catalog';
    let runtimeMap = {};
    let lastSyncTime = 0;

    // 1. CARGA DESDE CACHÉ (Memoria Local)
    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    if (cachedRaw) {
        try {
            const parsed = JSON.parse(cachedRaw);
            runtimeMap = parsed.map || {};
            lastSyncTime = parsed.lastSync || 0;
            console.log(`⚡ [Catalog] Cargados ${Object.keys(runtimeMap).length} productos de caché.`);
        } catch (e) {
            console.warn("Caché corrupto en catálogo");
        }
    }

    // Convertir mapa a array para uso inicial
    allProducts = Object.values(runtimeMap).filter(p => p.status === 'active');
    
    // Si tenemos datos, mostramos algo inmediatamente mientras verificamos
    if (allProducts.length > 0) {
        // Ejecutamos una primera renderización rápida
        applySortAndFilter();
        renderFiltersUI(); 
    }

    // 2. VERIFICACIÓN DE CAMBIOS (Deltas)
    // Usamos la misma lógica que en app.js para mantener consistencia
    try {
        const collectionRef = collection(db, "products");
        let q;

        if (lastSyncTime === 0 || allProducts.length === 0) {
            console.log("☁️ [Catalog] Descarga completa inicial...");
            q = query(collectionRef, where("status", "==", "active"));
        } else {
            console.log("🔄 [Catalog] Verificando cambios desde:", new Date(lastSyncTime).toLocaleString());
            // Nota: Se asume que 'updatedAt' existe. Si no, esto no traerá nada (seguro).
            q = query(collectionRef, where("updatedAt", ">", new Date(lastSyncTime)));
        }

        const snap = await getDocs(q);

        if (!snap.empty) {
            console.log(`🔥 [Catalog] Detectados ${snap.size} cambios.`);
            
            snap.forEach(docSnap => {
                const data = docSnap.data();
                const id = docSnap.id;

                if (data.status === 'active') {
                    runtimeMap[id] = { id, ...data };
                } else {
                    // Si cambió a inactivo, lo sacamos
                    if (runtimeMap[id]) delete runtimeMap[id];
                }
            });

            // Actualizamos la caché global compartida
            const newState = {
                map: runtimeMap,
                lastSync: Date.now()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));

            // Actualizamos la variable en memoria de este script
            allProducts = Object.values(runtimeMap).filter(p => p.status === 'active');
        } else {
            console.log("✅ [Catalog] Todo actualizado.");
        }

    } catch (e) {
        console.error("Error en SmartSync Catalog:", e);
        // Si falla la sync, nos quedamos con lo que había en caché
        if (allProducts.length === 0) {
             grid.innerHTML = `<p class="col-span-full text-center text-red-400 font-bold">Error cargando inventario.</p>`;
        }
    }

    // FILTRO DE PROMOS (Si aplica)
    if (isPromoMode) {
        allProducts = allProducts.filter(p => p.originalPrice && p.price < p.originalPrice);
    }

    // RENDER FINAL (Con datos frescos)
    filteredProducts = [...allProducts];
    renderFiltersUI(); 
    
    if (!isPromoMode) {
        const activeBrands = new Set();
        allProducts.forEach(p => {
            if(p.brand) activeBrands.add(p.brand);
            if(p.subcategory) activeBrands.add(p.subcategory);
        });
        renderBrandCarousel('brands-carousel-area', activeBrands);
    }
    
    // Forzamos un re-render final por si llegaron cambios
    applySortAndFilter();
}


// --- 3. UI FILTROS ---
function renderFiltersUI() {
    const extractCounts = (key, isVariantField = false) => {
        const counts = {};
        allProducts.forEach(p => {
            let values = [];
            if (isVariantField) {
                const fromRaiz = p[key] ? [p[key]] : [];
                const fromVar = p.combinations ? p.combinations.map(c => c[key]) : [];
                values = [...new Set([...fromRaiz, ...fromVar])];
            } else {
                if (p[key]) values = [p[key]];
                if (key === 'brand' && p.subcategory) values.push(p.subcategory);
            }
            values.forEach(val => {
                if (val && val.trim() !== '') {
                    const cleanVal = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase(); 
                    counts[cleanVal] = (counts[cleanVal] || 0) + 1;
                }
            });
        });
        return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
    };

    const sections = [
        { id: 'category', label: 'Categorías', items: extractCounts('category') },
        { id: 'brand', label: 'Marcas', items: extractCounts('brand') },
        { id: 'color', label: 'Color', items: extractCounts('color', true) },
        { id: 'capacity', label: 'Capacidad', items: extractCounts('capacity', true) },
    ];

    let html = '';
    sections.forEach(sec => {
        if (sec.items.length === 0) return;
        html += `
            <div class="border-b border-gray-50 pb-6 last:border-0">
                <h4 class="font-black text-xs uppercase text-brand-black mb-4">${sec.label}</h4>
                <div class="space-y-2 max-h-48 overflow-y-auto custom-scroll pr-2">
                    ${sec.items.map(item => `
                        <div class="flex items-center gap-3 group cursor-pointer hover:bg-slate-50 p-1.5 rounded-xl transition">
                            <input type="checkbox" id="${sec.id}-${item.label}" value="${item.label}" 
                                class="filter-checkbox appearance-none w-4 h-4 border-2 border-gray-200 rounded-md checked:bg-brand-cyan checked:border-brand-cyan transition cursor-pointer shrink-0"
                                onchange="window.toggleFilter('${sec.id}', '${item.label}')">
                            <label for="${sec.id}-${item.label}" class="flex-grow flex justify-between items-center cursor-pointer select-none">
                                <span class="text-[11px] font-bold text-gray-600 uppercase tracking-wide group-hover:text-brand-cyan transition truncate mr-2">${item.label}</span>
                                <span class="text-[10px] font-black text-brand-black bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md transition min-w-[24px] text-center">${item.count}</span>
                            </label>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });
    filtersContainer.innerHTML = html;
    mobileContent.innerHTML = html;
}

// --- 4. LOGICA FILTROS ---
window.toggleFilter = (type, value) => {
    const index = activeFilters[type].indexOf(value);
    if (index === -1) activeFilters[type].push(value);
    else activeFilters[type].splice(index, 1);
    syncCheckboxes();
    applySortAndFilter();
};

function syncCheckboxes() {
    Object.keys(activeFilters).forEach(key => {
        activeFilters[key].forEach(val => {
            const els = document.querySelectorAll(`input[id="${key}-${val}"]`);
            els.forEach(el => el.checked = true);
        });
    });
}

window.clearAllFilters = () => {
    Object.keys(activeFilters).forEach(key => activeFilters[key] = []);
    document.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false);
    applySortAndFilter();
    if(window.innerWidth < 1024) toggleDrawer(false);
};

// --- ORDENAMIENTO ---
window.setSort = (value, label) => {
    currentSort = value;
    sortLabel.textContent = label;
    sortDropdown.classList.add('hidden');
    sortIcon.classList.remove('rotate-180');
    applySortAndFilter();
};

if (sortTrigger) {
    sortTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = sortDropdown.classList.contains('hidden');
        if (isHidden) { sortDropdown.classList.remove('hidden'); sortIcon.classList.add('rotate-180'); }
        else { sortDropdown.classList.add('hidden'); sortIcon.classList.remove('rotate-180'); }
    });
}

document.addEventListener('click', (e) => {
    if (sortTrigger && !sortTrigger.contains(e.target) && !sortDropdown.contains(e.target)) {
        sortDropdown.classList.add('hidden');
        sortIcon.classList.remove('rotate-180');
    }
});

// --- 5. APLICAR FILTROS Y SORT ---
function applySortAndFilter() {
    filteredProducts = allProducts.filter(p => {
        const norm = (str) => str ? str.toLowerCase() : '';
        
        const matchCat = activeFilters.category.length === 0 || activeFilters.category.some(f => norm(p.category) === norm(f));
        const matchBrand = activeFilters.brand.length === 0 || activeFilters.brand.some(f => norm(p.brand) === norm(f) || norm(p.subcategory) === norm(f));
        
        const productColors = new Set();
        if (p.color) productColors.add(norm(p.color));
        if (p.combinations) p.combinations.forEach(c => { if(c.color) productColors.add(norm(c.color)); });
        const matchColor = activeFilters.color.length === 0 || activeFilters.color.some(f => productColors.has(norm(f)));

        const productCaps = new Set();
        if (p.capacity) productCaps.add(norm(p.capacity));
        if (p.combinations) p.combinations.forEach(c => { if(c.capacity) productCaps.add(norm(c.capacity)); });
        const matchCap = activeFilters.capacity.length === 0 || activeFilters.capacity.some(f => productCaps.has(norm(f)));

        return matchCat && matchBrand && matchColor && matchCap;
    });

    // Sort
    filteredProducts.sort((a, b) => {
        if (currentSort === 'price-asc') return a.price - b.price;
        if (currentSort === 'price-desc') return b.price - a.price;
        if (currentSort === 'alpha-asc') return a.name.localeCompare(b.name);
        if (currentSort === 'discount') {
            const discA = a.originalPrice ? (a.originalPrice - a.price) / a.originalPrice : 0;
            const discB = b.originalPrice ? (b.originalPrice - b.price) / b.originalPrice : 0;
            return discB - discA;
        }
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
    });

    // UI Updates
    currentPage = 1;
    if(countLabel) countLabel.textContent = filteredProducts.length;
    const hasActiveFilters = Object.values(activeFilters).some(arr => arr.length > 0);
    if (btnClear) {
        if (hasActiveFilters) { btnClear.classList.remove('hidden'); btnClear.classList.add('flex'); }
        else { btnClear.classList.add('hidden'); btnClear.classList.remove('flex'); }
    }
    renderGrid();
    renderPagination();
}

// --- 6. RENDER GRID (DISEÑO ELITE / PREMIUM) ---
function renderGrid() {
    if (filteredProducts.length === 0) {
        grid.classList.add('hidden');
        paginationContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    grid.classList.remove('hidden');
    paginationContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');

    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const productsToShow = filteredProducts.slice(start, end);

    grid.innerHTML = productsToShow.map(p => {
        // 1. Detectar Estados
        const isOutOfStock = (p.maxStock !== undefined && p.maxStock <= 0) || (p.stock || 0) <= 0;
        const hasDiscount = !isOutOfStock && (p.originalPrice && p.originalPrice > p.price);
        const qtyInCart = getProductQtyInCart(p.id);

        // 2. Definir Botones de Acción
        let actionBtnHTML;
        
        if (isOutOfStock) {
            actionBtnHTML = `
                <div class="w-full h-10 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-[10px] font-black uppercase tracking-widest cursor-not-allowed mt-auto">
                    Agotado
                </div>`;
        } else if (qtyInCart > 0) {
            actionBtnHTML = `
                <div onclick="event.stopPropagation()" class="mt-auto w-full h-10 bg-brand-black text-white rounded-xl shadow-lg flex items-center justify-between px-1">
                    <button onclick="window.handleCartAction('${p.id}', -1)" class="w-8 h-full flex items-center justify-center hover:text-brand-cyan transition active:scale-90"><i class="fa-solid fa-minus text-xs"></i></button>
                    <span class="text-xs font-bold w-6 text-center select-none">${qtyInCart}</span>
                    <button onclick="window.handleCartAction('${p.id}', 1)" class="w-8 h-full flex items-center justify-center hover:text-brand-cyan transition active:scale-90"><i class="fa-solid fa-plus text-xs"></i></button>
                </div>`;
        } else {
            actionBtnHTML = `
                <button onclick="event.stopPropagation(); window.handleCartAction('${p.id}', 1)" 
                    class="mt-auto w-full h-10 bg-brand-black text-white rounded-xl shadow-md hover:bg-brand-cyan hover:text-brand-black transition-all flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest group-btn active:scale-95">
                    <span>Agregar</span> <i class="fa-solid fa-cart-plus text-sm"></i>
                </button>`;
        }

        // 3. Estilos
        let containerClasses = "group bg-white rounded-[2rem] p-4 border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-300 flex flex-col cursor-pointer h-full relative overflow-hidden ";
        if (isOutOfStock) containerClasses += "opacity-70 grayscale";
        else if (hasDiscount) containerClasses += "hover:border-red-100 hover:shadow-red-500/10 hover:-translate-y-1";
        else containerClasses += "hover:border-brand-cyan/20 hover:-translate-y-1";

        const imageSrc = p.mainImage || p.image || 'https://placehold.co/300x300?text=Sin+Imagen';
        const clickAction = isOutOfStock ? "" : `window.location.href='/shop/product.html?id=${p.id}'`;

        // 4. Badge
        let badge = "";
        if (isOutOfStock) {
            badge = `<span class="absolute top-0 right-0 bg-gray-200 text-gray-500 text-[9px] font-black px-3 py-1.5 rounded-bl-2xl z-20">SIN STOCK</span>`;
        } else if (hasDiscount) {
            const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
            badge = `
                <div class="absolute top-0 left-0 bg-gradient-to-r from-red-600 to-pink-600 text-white text-[9px] font-black px-3 py-1.5 rounded-br-2xl z-20 shadow-md flex items-center gap-1">
                    <i class="fa-solid fa-tags text-[8px]"></i> -${disc}%
                </div>`;
        }

        // 5. Precio
        let priceDisplay;
        if (hasDiscount) {
            priceDisplay = `
                <div class="flex flex-col mb-3">
                    <span class="text-[10px] text-gray-400 line-through decoration-red-300 font-bold">Antes: $${p.originalPrice.toLocaleString('es-CO')}</span>
                    <span class="text-xl font-black text-brand-red tracking-tight">$${p.price.toLocaleString('es-CO')}</span>
                </div>`;
        } else {
            priceDisplay = `
                <div class="mb-3">
                    <span class="text-lg font-black text-brand-black tracking-tight">$${p.price.toLocaleString('es-CO')}</span>
                </div>`;
        }

        return `
        <div class="${containerClasses}" onclick="${clickAction}">
            ${badge}
            
            <div class="relative mb-3 overflow-hidden rounded-2xl bg-slate-50 h-48 md:h-56 flex items-center justify-center p-4">
                <img src="${imageSrc}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-700 mix-blend-multiply relative z-10">
            </div>
            
            <div class="flex flex-col flex-grow text-center">
                <p class="text-[8px] font-black text-brand-cyan uppercase tracking-widest mb-1 truncate">${p.subcategory || p.category || 'Tecnología'}</p>
                <h3 class="font-bold text-xs md:text-sm text-brand-black mb-2 line-clamp-2 uppercase leading-tight min-h-[2.5em] group-hover:text-brand-cyan transition-colors">${p.name}</h3>
                
                <div class="mt-auto w-full">
                    ${priceDisplay}
                    ${actionBtnHTML}
                </div>
            </div>
        </div>`;
    }).join('');
    
    if (currentPage > 1) {
        document.getElementById('global-header').scrollIntoView({ behavior: 'smooth' });
    }
}

// --- 7. ACCIONES CARRITO ---
window.handleCartAction = (productId, delta) => {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    if (delta > 0) addToCart(product);
    else removeOneUnit(productId);
    renderGrid();
    if (window.updateCartCountGlobal) window.updateCartCountGlobal();
    else updateCartCount();
};

// --- 8. RENDER PAGINACIÓN ---
function renderPagination() {
    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) { paginationContainer.innerHTML = ''; return; }

    let html = `
        <button onclick="window.changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} 
            class="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-30 disabled:pointer-events-none transition">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
    `;

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            html += `
                <button onclick="window.changePage(${i})" 
                    class="w-10 h-10 flex items-center justify-center rounded-xl font-bold text-xs transition ${i === currentPage ? 'bg-brand-black text-white shadow-lg' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}">
                    ${i}
                </button>
            `;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            html += `<span class="text-gray-300 font-bold text-xs">...</span>`;
        }
    }

    html += `
        <button onclick="window.changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} 
            class="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-30 disabled:pointer-events-none transition">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
    `;

    paginationContainer.innerHTML = html;
}

window.changePage = (page) => {
    currentPage = page;
    renderGrid();
    renderPagination();
};

// --- 9. MOBILE DRAWER ---
const openBtn = document.getElementById('btn-open-filters');
const closeBtn = document.getElementById('btn-close-filters');
const applyBtn = document.getElementById('btn-apply-mobile');

const toggleDrawer = (show) => {
    if (show) {
        drawer.classList.remove('translate-x-full');
        mobileOverlay.classList.remove('hidden');
        setTimeout(() => mobileOverlay.classList.remove('opacity-0'), 10);
    } else {
        drawer.classList.add('translate-x-full');
        mobileOverlay.classList.add('opacity-0');
        setTimeout(() => mobileOverlay.classList.add('hidden'), 300);
    }
};

if(openBtn) openBtn.onclick = () => toggleDrawer(true);
if(closeBtn) closeBtn.onclick = () => toggleDrawer(false);
if(mobileOverlay) mobileOverlay.onclick = () => toggleDrawer(false);
if(applyBtn) applyBtn.onclick = () => toggleDrawer(false);