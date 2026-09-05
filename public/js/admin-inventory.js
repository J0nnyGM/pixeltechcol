import { db, doc, updateDoc, collection, onSnapshot } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO CENTRAL

loadAdminSidebar();

// --- DOM ---
const tableBody = document.getElementById('products-table-body');
const searchInput = document.getElementById('inventory-search');
const searchForm = document.getElementById('search-form');
const noResultsMsg = document.getElementById('no-results');
const rangeSpan = document.getElementById('view-range');
const totalSpan = document.getElementById('total-count');
const btnNext = document.getElementById('btn-next-page');
const btnPrev = document.getElementById('btn-prev-page');

// --- FILTROS DOM ---
const filterCategorySelect = document.getElementById('filter-category');
const filterSubcategorySelect = document.getElementById('filter-subcategory');
const filterBrandSelect = document.getElementById('filter-brand');
const filterTypeSelect = document.getElementById('filter-type');
const sortBySelect = document.getElementById('sort-by');
const pageSizeSelect = document.getElementById('page-size-select');
const btnResetFilters = document.getElementById('btn-reset-filters');
const btnClearSearch = document.getElementById('btn-clear-search');

// --- MODAL DOM ---
const discountModal = document.getElementById('discount-modal');
const discountForm = document.getElementById('discount-form');
const dInputDays = document.getElementById('input-days-container');
const dInputDate = document.getElementById('input-date-container');
const btnTypeDays = document.getElementById('btn-type-days');
const btnTypeDate = document.getElementById('btn-type-date');
const dNewPriceInput = document.getElementById('d-new-price');

// --- ESTADO ---
let PAGE_SIZE = 20;
let currentPage = 1;
let totalDocs = 0;
let currentFilterType = 'all'; // 'all', 'active', 'draft', 'lowstock', 'out_of_stock', 'discount'
let selectedCategory = '';
let selectedSubcategory = '';
let selectedBrand = '';
let selectedType = 'all'; // 'all', 'with_variants', 'simple', 'no_image'
let currentSort = 'recent'; // 'recent', 'name_asc', 'name_desc', 'stock_asc', 'stock_desc', 'price_desc', 'price_asc'
let currentEditingId = null;
let currentEditingProduct = null; 
let currentDurationType = 'days';
let adminProductsCache = []; // Aquí vivirá la copia de los datos
let currentFilteredProducts = []; // Para almacenar el inventario filtrado actual

const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
const formatCurrency = (val) => (val === "" || val == null) ? "" : "$ " + Number(val).toLocaleString("es-CO");
const parseCurrency = (val) => Number(val.toString().replace(/[^0-9]/g, '')) || 0;
const formatDateForInput = (timestamp) => {
    if (!timestamp) return "";
    try {
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        if (isNaN(d.getTime())) return "";
        const tzOffset = d.getTimezoneOffset() * 60000; 
        return (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
    } catch (e) {
        console.error("Error formatting date:", e);
        return "";
    }
};

function getRealStock(p) {
    if (p.combinations && Array.isArray(p.combinations) && p.combinations.length > 0) {
        return p.combinations.reduce((sum, c) => sum + (Number(c.stock) || 0), 0);
    }
    return Number(p.stock) || 0;
}

if (dNewPriceInput) {
    dNewPriceInput.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = val > 0 ? formatCurrency(val) : "";
    });
    dNewPriceInput.addEventListener('focus', (e) => e.target.select());
}

// =============================================================================
// 🔥 INICIALIZACIÓN CON EL STORE CENTRALIZADO
// =============================================================================

// Nos suscribimos al cerebro central. Cada vez que haya un cambio, nos enviará el array actualizado.
AdminStore.subscribeToProducts((productsArray) => {
    adminProductsCache = productsArray || [];
    populateFilterDropdowns();
    renderViewFromMemory();
});

// =============================================================================
// 1. SINCRONIZACIÓN DE CATEGORÍAS Y SUBCATEGORÍAS OFICIALES DESDE FIRESTORE
// =============================================================================

const CATEGORIES_STORAGE_KEY = 'pixeltech_categories_smart_admin';
let definedCategoriesMap = {}; // normCat -> { displayName: string, subcategories: string[] }

function loadCategoriesDefinitions() {
    // 1. Carga inmediata desde caché si existe
    try {
        const cachedRaw = localStorage.getItem(CATEGORIES_STORAGE_KEY);
        if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);
            if (parsed.map) processCategoriesData(parsed.map);
        }
    } catch (e) {}

    // 2. Suscribirse a la colección oficial de categorías en Firestore
    try {
        onSnapshot(collection(db, "categories"), (snapshot) => {
            if (!snapshot.empty) {
                const map = {};
                snapshot.forEach(docSnap => {
                    map[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
                });
                processCategoriesData(map);
                populateFilterDropdowns();
            }
        });
    } catch (err) {
        console.warn("⚠️ Error suscribiendo a categorías:", err);
    }
}

function processCategoriesData(catMap) {
    definedCategoriesMap = {};
    Object.values(catMap).forEach(cat => {
        const catName = (cat.name || "").trim();
        if (!catName) return;
        const normCat = normalizeText(catName);
        const subList = [];
        if (cat.subcategories && Array.isArray(cat.subcategories)) {
            cat.subcategories.forEach(sub => {
                let subName = '';
                if (typeof sub === 'string') subName = sub.trim();
                else if (typeof sub === 'object' && sub !== null) subName = (sub.name || sub.label || sub.value || '').trim();
                if (subName && !subList.some(s => normalizeText(s) === normalizeText(subName))) {
                    subList.push(subName);
                }
            });
        }
        definedCategoriesMap[normCat] = {
            displayName: catName,
            subcategories: subList
        };
    });
}

loadCategoriesDefinitions();

// =============================================================================
// 2. HELPERS DE EXTRACCIÓN Y POBLADO DE SELECTORES INTERACTIVOS
// =============================================================================

function getCategoryName(p) {
    if (!p) return '';
    if (typeof p.category === 'string') return p.category.trim();
    if (typeof p.category === 'object' && p.category !== null) return (p.category.name || p.category.label || '').trim();
    return '';
}

function getSubcategoryName(p) {
    if (!p) return '';
    if (typeof p.subcategory === 'string') return p.subcategory.trim();
    if (typeof p.subcategory === 'object' && p.subcategory !== null) return (p.subcategory.name || p.subcategory.label || '').trim();
    return '';
}

function getBrandName(p) {
    if (!p) return '';
    if (typeof p.brand === 'string') return p.brand.trim();
    if (typeof p.brand === 'object' && p.brand !== null) return (p.brand.name || '').trim();
    return '';
}

let categoriesList = [];
let subcategoriesList = [];
let brandsList = [];

function extractCategories() {
    const map = new Map();

    // 1. Categorías presentes en los productos
    adminProductsCache.forEach(p => {
        const cat = getCategoryName(p);
        if (!cat) return;
        const norm = normalizeText(cat);
        if (!map.has(norm)) {
            map.set(norm, { name: cat, count: 0, normalized: norm });
        }
    });

    // 2. Categorías oficiales definidas en Firestore
    Object.values(definedCategoriesMap).forEach(def => {
        const norm = normalizeText(def.displayName);
        if (!map.has(norm)) {
            map.set(norm, { name: def.displayName, count: 0, normalized: norm });
        }
    });

    // 3. Contar productos por categoría
    map.forEach((item, normCat) => {
        item.count = adminProductsCache.filter(p => normalizeText(getCategoryName(p)) === normCat).length;
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function extractSubcategories() {
    const map = new Map();
    let pool = adminProductsCache;
    if (selectedCategory) {
        pool = pool.filter(p => normalizeText(getCategoryName(p)) === normalizeText(selectedCategory));
    }

    // 1. Tomar subcategorías oficiales definidas en la base de datos
    if (selectedCategory) {
        const normCat = normalizeText(selectedCategory);
        const def = definedCategoriesMap[normCat];
        if (def && def.subcategories && def.subcategories.length > 0) {
            def.subcategories.forEach(sub => {
                const norm = normalizeText(sub);
                if (!map.has(norm)) {
                    map.set(norm, { name: sub, count: 0, normalized: norm });
                }
            });
        }
    } else {
        Object.values(definedCategoriesMap).forEach(def => {
            if (def.subcategories) {
                def.subcategories.forEach(sub => {
                    const norm = normalizeText(sub);
                    if (!map.has(norm)) {
                        map.set(norm, { name: sub, count: 0, normalized: norm });
                    }
                });
            }
        });
    }

    // 2. Incorporar subcategorías que vengan directamente en los productos
    pool.forEach(p => {
        const sub = getSubcategoryName(p);
        if (sub) {
            const norm = normalizeText(sub);
            if (!map.has(norm)) {
                map.set(norm, { name: sub, count: 0, normalized: norm });
            }
        }
    });

    // 3. Contar cuántos productos coinciden con cada subcategoría
    map.forEach((item, normSub) => {
        item.count = pool.filter(p => {
            const prodSub = getSubcategoryName(p);
            if (prodSub && normalizeText(prodSub) === normSub) return true;
            // Fallback inteligente para productos con subcategoría en el nombre o búsqueda
            const pName = normalizeText(p.name || '');
            const searchStr = p.searchStr || '';
            return pName.includes(normSub) || searchStr.includes(normSub);
        }).length;
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function extractBrands() {
    const map = new Map();
    adminProductsCache.forEach(p => {
        const br = getBrandName(p);
        if (!br) return;
        const norm = normalizeText(br);
        if (!map.has(norm)) {
            map.set(norm, { name: br, count: 1, normalized: norm });
        } else {
            map.get(norm).count++;
        }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function populateFilterDropdowns() {
    if (!adminProductsCache || adminProductsCache.length === 0) return;

    categoriesList = extractCategories();
    subcategoriesList = extractSubcategories();
    brandsList = extractBrands();

    updateDropdownButtonLabel('category');
    updateDropdownButtonLabel('subcategory');
    updateDropdownButtonLabel('brand');

    renderDropdownOptions('category');
    renderDropdownOptions('subcategory');
    renderDropdownOptions('brand');
}

function updateDropdownButtonLabel(type) {
    const labelEl = document.getElementById(`selected-${type}-label`);
    if (!labelEl) return;

    if (type === 'category') {
        labelEl.textContent = selectedCategory ? selectedCategory : `Todas (${categoriesList.length})`;
    } else if (type === 'subcategory') {
        labelEl.textContent = selectedSubcategory ? selectedSubcategory : `Todas (${subcategoriesList.length})`;
    } else if (type === 'brand') {
        labelEl.textContent = selectedBrand ? selectedBrand : `Todas (${brandsList.length})`;
    }
}

function renderDropdownOptions(type, searchFilter = '') {
    const container = document.getElementById(`options-dropdown-${type}`);
    if (!container) return;

    let items = [];
    let currentSelected = '';
    let totalAll = adminProductsCache.length;

    if (type === 'category') {
        items = categoriesList;
        currentSelected = selectedCategory;
    } else if (type === 'subcategory') {
        items = subcategoriesList;
        currentSelected = selectedSubcategory;
        if (selectedCategory) {
            totalAll = adminProductsCache.filter(p => normalizeText(getCategoryName(p)) === normalizeText(selectedCategory)).length;
        }
    } else if (type === 'brand') {
        items = brandsList;
        currentSelected = selectedBrand;
    }

    const normSearch = normalizeText(searchFilter.trim());
    const filteredItems = normSearch 
        ? items.filter(item => item.normalized.includes(normSearch))
        : items;

    let html = '';

    // Opción "Todas" (si no se está filtrando texto activamente)
    if (!normSearch) {
        const isAllSelected = !currentSelected;
        html += `
            <div onclick="window.selectDropdownOption('${type}', '')" class="px-3 py-2 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${isAllSelected ? 'bg-brand-cyan/10 text-brand-cyan font-black' : 'hover:bg-slate-50 text-brand-black font-bold'}">
                <span class="flex items-center gap-2">
                    ${isAllSelected ? '<i class="fa-solid fa-check text-xs"></i>' : ''}
                    <span>Todas</span>
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isAllSelected ? 'bg-brand-cyan/20 text-brand-cyan' : 'bg-slate-100 text-gray-400'}">${totalAll}</span>
            </div>
        `;
    }

    if (filteredItems.length === 0) {
        html += `
            <div class="p-4 text-center text-xs font-bold text-gray-400">
                <i class="fa-solid fa-magnifying-glass text-gray-300 text-sm mb-1 block"></i>
                No se encontraron opciones
            </div>
        `;
    } else {
        filteredItems.forEach(item => {
            const isSelected = currentSelected && normalizeText(currentSelected) === item.normalized;
            const safeName = item.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            html += `
                <div onclick="window.selectDropdownOption('${type}', '${safeName}')" class="px-3 py-2 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${isSelected ? 'bg-brand-cyan/10 text-brand-cyan font-black' : 'hover:bg-slate-50 text-brand-black font-bold'}">
                    <span class="flex items-center gap-2 min-w-0 pr-2">
                        ${isSelected ? '<i class="fa-solid fa-check text-xs shrink-0"></i>' : ''}
                        <span class="truncate">${item.name}</span>
                    </span>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${isSelected ? 'bg-brand-cyan/20 text-brand-cyan' : 'bg-slate-100 text-gray-400'}">${item.count}</span>
                </div>
            `;
        });
    }

    container.innerHTML = html;
}

// Control interactivo de Dropdowns
window.toggleFilterDropdown = (type) => {
    const panel = document.getElementById(`panel-dropdown-${type}`);
    const arrow = document.getElementById(`arrow-dropdown-${type}`);
    const wrapper = document.getElementById(`dropdown-${type}-wrapper`);
    if (!panel) return;

    const isHidden = panel.classList.contains('hidden');
    window.closeAllDropdowns();

    if (isHidden) {
        panel.classList.remove('hidden');
        if (arrow) arrow.classList.add('rotate-180');
        if (wrapper) wrapper.classList.add('z-30');

        // Prevenir desbordamiento horizontal a la derecha en pantallas pequeñas/medianas
        const rect = panel.getBoundingClientRect();
        if (rect.right > (window.innerWidth - 12)) {
            panel.classList.remove('left-0');
            panel.classList.add('right-0');
        } else {
            panel.classList.remove('right-0');
            panel.classList.add('left-0');
        }

        const searchInp = document.getElementById(`search-dropdown-${type}`);
        if (searchInp) {
            searchInp.value = '';
            renderDropdownOptions(type, '');
            setTimeout(() => searchInp.focus(), 50);
        }
    }
};

window.closeAllDropdowns = () => {
    document.querySelectorAll('.filter-dropdown-panel').forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('right-0');
        p.classList.add('left-0');
    });
    document.querySelectorAll('[id^="arrow-dropdown-"]').forEach(a => a.classList.remove('rotate-180'));
    document.querySelectorAll('.dropdown-container').forEach(c => c.classList.remove('z-30'));
};

window.filterDropdownList = (type, query) => {
    renderDropdownOptions(type, query);
};

window.selectDropdownOption = (type, value) => {
    if (type === 'category') {
        selectedCategory = value;
        updateDropdownButtonLabel('category');
        
        // Al cambiar categoría, reiniciamos y recalculamos subcategorías dependientes
        selectedSubcategory = '';
        subcategoriesList = extractSubcategories();
        updateDropdownButtonLabel('subcategory');
        renderDropdownOptions('subcategory');
    } else if (type === 'subcategory') {
        selectedSubcategory = value;
        updateDropdownButtonLabel('subcategory');
    } else if (type === 'brand') {
        selectedBrand = value;
        updateDropdownButtonLabel('brand');
    }

    window.closeAllDropdowns();
    currentPage = 1;
    renderViewFromMemory();
};

// Cierre global al hacer clic fuera o presionar escape
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-container')) {
        window.closeAllDropdowns();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.closeAllDropdowns();
    }
});

// Cierre inmediato al hacer scroll en la página o en cualquier contenedor (excepto dentro de la lista de opciones)
document.addEventListener('scroll', (e) => {
    if (e.target && e.target.closest && e.target.closest('.filter-dropdown-panel')) {
        return; // Permitir scroll interno de la lista de opciones
    }
    window.closeAllDropdowns();
}, { capture: true, passive: true });

// =============================================================================
// 2. FILTRADO, BÚSQUEDA Y PAGINACIÓN 100% COMBINADA EN RAM
// =============================================================================

function renderViewFromMemory() {
    if (!tableBody) return;
    
    const rawSearch = searchInput ? searchInput.value.trim() : "";
    const cleanSearch = normalizeText(rawSearch);

    // Botón de limpiar texto de búsqueda
    if (btnClearSearch) {
        if (rawSearch.length > 0) btnClearSearch.classList.remove('hidden');
        else btnClearSearch.classList.add('hidden');
    }

    // Botón de restablecer todos los filtros
    const hasActiveFilters = (
        rawSearch.length > 0 ||
        currentFilterType !== 'all' ||
        selectedCategory !== '' ||
        selectedSubcategory !== '' ||
        selectedBrand !== '' ||
        selectedType !== 'all' ||
        currentSort !== 'recent'
    );
    if (btnResetFilters) {
        if (hasActiveFilters) btnResetFilters.classList.remove('hidden');
        else btnResetFilters.classList.add('hidden');
    }

    const searchWords = cleanSearch.split(/\s+/).filter(Boolean);

    let filtered = adminProductsCache.filter(p => {
        const realStock = getRealStock(p);
        const hasVariants = !!(p.combinations && Array.isArray(p.combinations) && p.combinations.length > 0);
        const hasImage = !!(p.mainImage || p.image || (p.images && p.images.length > 0));
        const hasDiscount = (p.originalPrice && p.price < p.originalPrice) || !!p.promoEndsAt;

        const prodCategory = getCategoryName(p);
        const prodSubcategory = getSubcategoryName(p);
        const prodBrand = getBrandName(p);

        // 1. Buscador inteligente (Nombre, SKU, Marca, Categoría, Subcategoría, Descripción)
        if (searchWords.length > 0) {
            const searchable = normalizeText(`${p.name || ''} ${prodBrand} ${p.sku || ''} ${prodCategory} ${prodSubcategory} ${p.description || ''} ${p.searchStr || ''}`);
            const matchesAll = searchWords.every(w => searchable.includes(w));
            if (!matchesAll) return false;
        }

        // 2. Pestañas de estado rápido
        if (currentFilterType === 'active' && p.status !== 'active') return false;
        if (currentFilterType === 'draft' && p.status === 'active') return false;
        if (currentFilterType === 'lowstock' && (realStock <= 0 || realStock > 5)) return false;
        if (currentFilterType === 'out_of_stock' && realStock > 0) return false;
        if (currentFilterType === 'discount' && !hasDiscount) return false;

        // 3. Categoría (Comparación normalizada e insensible a mayúsculas y acentos)
        if (selectedCategory && normalizeText(prodCategory) !== normalizeText(selectedCategory)) return false;

        // 4. Subcategoría
        if (selectedSubcategory) {
            const normSelectedSub = normalizeText(selectedSubcategory);
            if (prodSubcategory) {
                if (normalizeText(prodSubcategory) !== normSelectedSub) return false;
            } else {
                const pName = normalizeText(p.name || '');
                const pSearch = p.searchStr || '';
                if (!pName.includes(normSelectedSub) && !pSearch.includes(normSelectedSub)) return false;
            }
        }

        // 5. Marca
        if (selectedBrand && normalizeText(prodBrand) !== normalizeText(selectedBrand)) return false;

        // 6. Tipo de Producto / Auditoría
        if (selectedType === 'with_variants' && !hasVariants) return false;
        if (selectedType === 'simple' && hasVariants) return false;
        if (selectedType === 'no_image' && hasImage) return false;

        return true;
    });

    // 7. Ordenamiento
    if (currentSort === 'name_asc') {
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
    } else if (currentSort === 'name_desc') {
        filtered.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'es', { sensitivity: 'base' }));
    } else if (currentSort === 'stock_asc') {
        filtered.sort((a, b) => getRealStock(a) - getRealStock(b));
    } else if (currentSort === 'stock_desc') {
        filtered.sort((a, b) => getRealStock(b) - getRealStock(a));
    } else if (currentSort === 'price_desc') {
        filtered.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    } else if (currentSort === 'price_asc') {
        filtered.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    } else {
        // 'recent' (más recientes primero)
        filtered.sort((a, b) => {
            const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (new Date(a.createdAt || 0)).getTime();
            const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (new Date(b.createdAt || 0)).getTime();
            return timeB - timeA;
        });
    }

    totalDocs = filtered.length;
    currentFilteredProducts = [...filtered];
    const totalPages = Math.max(1, Math.ceil(totalDocs / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, totalDocs);
    const pageProducts = filtered.slice(startIdx, endIdx);

    tableBody.innerHTML = "";

    if (totalDocs === 0) {
        tableBody.classList.add('hidden');
        if (noResultsMsg) {
            noResultsMsg.classList.remove('hidden');
            noResultsMsg.innerHTML = `
                <div class="py-12 text-center">
                    <i class="fa-solid fa-box-open text-gray-300 text-4xl mb-3"></i>
                    <p class="text-xs font-black uppercase text-gray-400 tracking-widest">No se encontraron productos con los filtros seleccionados</p>
                    <button onclick="window.resetAllFilters()" class="mt-4 px-5 py-2.5 bg-brand-black text-white text-[10px] font-black uppercase tracking-wider rounded-xl hover:bg-brand-cyan hover:text-black transition">
                        Limpiar Filtros
                    </button>
                </div>
            `;
        }
        updatePaginationUI(0, 0, 0, totalPages);
        return;
    }
    
    tableBody.classList.remove('hidden');
    if (noResultsMsg) noResultsMsg.classList.add('hidden');

    pageProducts.forEach((product, index) => renderRowHTML(product, index));
    updatePaginationUI(startIdx + 1, endIdx, totalDocs, totalPages);
}

function updatePaginationUI(start, end, total, totalPages) {
    if (rangeSpan) rangeSpan.textContent = total > 0 ? `${start}-${end}` : "0-0";
    if (totalSpan) totalSpan.textContent = total;
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

window.changePage = (dir) => {
    currentPage += dir;
    renderViewFromMemory();
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
};

window.filterByTab = (status) => {
    currentFilterType = status;
    currentPage = 1;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-brand-black', 'text-white', 'shadow-md', 'border-transparent', 'active');
        btn.classList.add('bg-white', 'text-gray-500', 'border-gray-200');
    });
    
    const activeBtn = document.getElementById(`tab-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
        activeBtn.classList.add('bg-brand-black', 'text-white', 'shadow-md', 'border-transparent', 'active');
    }
    
    renderViewFromMemory();
};

window.resetAllFilters = () => {
    currentPage = 1;
    currentFilterType = 'all';
    selectedCategory = '';
    selectedSubcategory = '';
    selectedBrand = '';
    selectedType = 'all';
    currentSort = 'recent';

    if (searchInput) searchInput.value = '';
    if (filterTypeSelect) filterTypeSelect.value = 'all';
    if (sortBySelect) sortBySelect.value = 'recent';

    updateDropdownButtonLabel('category');
    subcategoriesList = extractSubcategories();
    updateDropdownButtonLabel('subcategory');
    updateDropdownButtonLabel('brand');

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-brand-black', 'text-white', 'shadow-md', 'border-transparent', 'active');
        btn.classList.add('bg-white', 'text-gray-500', 'border-gray-200');
    });
    const activeBtn = document.getElementById('tab-all');
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
        activeBtn.classList.add('bg-brand-black', 'text-white', 'shadow-md', 'border-transparent', 'active');
    }

    window.closeAllDropdowns();
    renderViewFromMemory();
};

// --- LISTENERS DE FILTROS ---

if (filterTypeSelect) {
    filterTypeSelect.addEventListener('change', (e) => {
        selectedType = e.target.value;
        currentPage = 1;
        renderViewFromMemory();
    });
}

if (sortBySelect) {
    sortBySelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        renderViewFromMemory();
    });
}

if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
        PAGE_SIZE = parseInt(e.target.value) || 20;
        currentPage = 1;
        renderViewFromMemory();
    });
}

if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        currentPage = 1;
        renderViewFromMemory();
    });
}

let debounceTimeout = null;
if (searchInput) {
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => { 
            currentPage = 1; 
            renderViewFromMemory(); 
        }, 150);
    });
}
if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault(); 
        clearTimeout(debounceTimeout); 
        currentPage = 1; 
        renderViewFromMemory();
    });
}

// =============================================================================
// 🔥 RENDERIZADO VISUAL
// =============================================================================

function renderRowHTML(product, index) {
    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition-colors group fade-in border-b border-gray-50 last:border-0";
    row.style.animationDelay = `${index * 15}ms`;

    const role = sessionStorage.getItem('pixeltech_user_role') || 'customer';
    const canEdit = (role === 'admin');

    const hasCombinations = product.combinations && Array.isArray(product.combinations) && product.combinations.length > 0;
    const realStock = hasCombinations 
        ? product.combinations.reduce((sum, c) => sum + (Number(c.stock) || 0), 0)
        : (Number(product.stock) || 0);

    const img = product.mainImage || product.image || (product.images ? product.images[0] : 'https://placehold.co/100?text=Sin+Foto');
    const isActive = product.status === 'active';
    
    let statusBadge = isActive 
        ? `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-100"><div class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.4)]"></div> Activo</span>`
        : `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-600 border border-amber-100"><div class="w-2 h-2 rounded-full bg-amber-500"></div> Borrador</span>`;
    
    let priceDisplay = `<span class="text-base font-black text-gray-800">$${(product.price || 0).toLocaleString('es-CO')}</span>`;
    if (product.originalPrice && product.price < product.originalPrice) {
        const discountPercent = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
        statusBadge += `<span class="ml-2 px-2 py-1 rounded-md text-[9px] font-black uppercase bg-purple-50 text-purple-600 border border-purple-100" title="Oferta activa">-${discountPercent}%</span>`;
        priceDisplay = `<div class="flex flex-col"><span class="text-[10px] text-gray-300 line-through font-bold">$${product.originalPrice.toLocaleString('es-CO')}</span><span class="text-base font-black text-brand-red">$${product.price.toLocaleString('es-CO')}</span></div>`;
    }

    const toggleIcon = isActive ? 'fa-eye-slash' : 'fa-eye';
    const toggleColor = isActive ? 'hover:text-amber-500 hover:border-amber-500' : 'hover:text-emerald-500 hover:border-emerald-500';

    const nameHtml = canEdit
        ? `<p class="font-black text-brand-black text-sm mb-1 leading-tight group-hover:text-brand-cyan transition-colors cursor-pointer" onclick="window.location.href='edit-product.html?id=${product.id}'">${product.name}</p>`
        : `<p class="font-black text-brand-black text-sm mb-1 leading-tight">${product.name}</p>`;

    const actionButtonsHtml = `
        <div class="flex items-center justify-end gap-2 opacity-70 group-hover:opacity-100 transition-opacity">
            <a href="product-serials.html?productId=${product.id}" title="Control de Seriales (SN)" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm flex items-center justify-center hover:-translate-y-1">
                <i class="fa-solid fa-barcode"></i>
            </a>
            ${canEdit ? `
                <button onclick="openDiscountModal('${product.id}')" title="Descuentos" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-500 transition shadow-sm flex items-center justify-center hover:-translate-y-1"><i class="fa-solid fa-tags"></i></button>
                <button onclick="window.location.href='edit-product.html?id=${product.id}'" title="Editar Producto" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm flex items-center justify-center hover:-translate-y-1"><i class="fa-solid fa-pen"></i></button>
                <button onclick="toggleProductStatus('${product.id}', '${product.status}')" title="Cambiar Estado" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 ${toggleColor} transition shadow-sm flex items-center justify-center hover:-translate-y-1">
                    <i class="fa-solid ${toggleIcon}"></i>
                </button>
            ` : ''}
        </div>
    `;

    const categoryName = (product.category || 'General').trim();
    const subcategoryName = (product.subcategory || '').trim();
    const subcategoryHtml = subcategoryName ? `<span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1 pl-1">${subcategoryName}</span>` : '';

    row.innerHTML = `
        <td class="p-6 pl-8 text-center align-middle">
            <div class="w-20 h-20 rounded-2xl bg-white border border-gray-100 p-2 shadow-sm mx-auto group-hover:scale-105 transition-transform duration-300 ${!isActive ? 'opacity-50 grayscale' : ''}">
                <img src="${img}" loading="lazy" class="w-full h-full object-contain rounded-lg">
            </div>
        </td>
        <td class="p-6 align-middle">
            ${nameHtml}
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">SKU: ${product.sku || '---'}</p>
        </td>
        <td class="p-6 align-middle whitespace-nowrap">
            <div class="flex flex-col items-start">
                <span class="inline-flex items-center px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-slate-100 text-brand-black border border-gray-200/80 whitespace-nowrap shadow-xs">
                    ${categoryName}
                </span>
                ${subcategoryHtml}
            </div>
        </td>
        <td class="p-6 align-middle whitespace-nowrap">
            <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">${product.brand || '---'}</p>
        </td>
        <td class="p-6 align-middle whitespace-nowrap">
            <div class="flex flex-col gap-1">
                ${priceDisplay}
                <p class="text-[10px] font-bold uppercase ${ realStock < 5 ? 'text-red-400' : 'text-emerald-500' } flex items-center gap-1">
                    <i class="fa-solid fa-layer-group"></i> ${realStock} unid.
                </p>
            </div>
        </td>
        <td class="p-6 text-center align-middle whitespace-nowrap">
            <div class="flex flex-col items-center justify-center gap-2">${statusBadge}</div>
        </td>
        <td class="p-6 pr-8 text-right align-middle whitespace-nowrap">
            ${actionButtonsHtml}
        </td>
    `;
    tableBody.appendChild(row);
}

// =============================================================================
// 🔥 ACCIONES (OCULTAR Y DESCUENTOS)
// =============================================================================

window.toggleProductStatus = async (id, currentStatus) => {
    const isActivating = currentStatus !== 'active';
    const newStatus = isActivating ? 'active' : 'draft';
    
    if (confirm(`¿Deseas ${isActivating ? 'publicar' : 'ocultar'} este producto?`)) {
        try {
            await updateDoc(doc(db, "products", id), { status: newStatus, updatedAt: new Date() });
        } catch (error) { alert("Error al cambiar estado."); }
    }
};

window.openDiscountModal = async (id) => {
    try {
        const product = adminProductsCache.find(p => p.id === id);
        if(!product) return;
        
        currentEditingProduct = product; currentEditingId = id;
        document.getElementById('d-prod-name').textContent = product.name;
        document.getElementById('d-original-price').value = formatCurrency(product.originalPrice || product.price);
        
        const btnRemove = document.getElementById('btn-remove-discount');
        if (product.originalPrice && product.originalPrice > product.price) btnRemove.classList.remove('hidden');
        else btnRemove.classList.add('hidden');

        if (product.promoEndsAt) {
            document.getElementById('d-duration-date').value = formatDateForInput(product.promoEndsAt);
            document.getElementById('d-duration-days').value = "";
            toggleDurationType('date');
        } else {
            document.getElementById('d-duration-date').value = "";
            document.getElementById('d-duration-days').value = "";
            toggleDurationType('days');
        }

        const singlePriceContainer = document.getElementById('single-price-container');
        const variantsContainer = document.getElementById('variants-discount-container');
        
        if (product.combinations && product.combinations.length > 0) {
            singlePriceContainer.classList.add('hidden'); variantsContainer.classList.remove('hidden'); dNewPriceInput.required = false;

            let html = '<p class="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 pb-2 mb-2">Ajusta el precio por variante</p>';
            product.combinations.forEach((c, index) => {
                const label = `${c.color || ''} ${c.capacity ? '- ' + c.capacity : ''}`.trim();
                const cCurrent = (c.originalPrice && c.originalPrice > c.price) ? c.price : "";
                html += `
                    <div class="flex justify-between items-center gap-3 p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                        <div class="w-1/2 overflow-hidden"><p class="text-[10px] font-black text-brand-black truncate" title="${label}">${label}</p><p class="text-[9px] text-gray-400 font-bold">Antes: <span class="line-through decoration-red-300">${formatCurrency(c.originalPrice || c.price)}</span></p></div>
                        <div class="w-1/2"><input type="text" class="var-discount-input w-full bg-slate-50 border border-gray-200 rounded-md p-2 text-xs font-bold text-brand-cyan outline-none focus:border-brand-cyan focus:bg-white transition" data-index="${index}" value="${formatCurrency(cCurrent)}" placeholder="$ 0"></div>
                    </div>`;
            });
            variantsContainer.innerHTML = html;

            variantsContainer.querySelectorAll('.var-discount-input').forEach(inp => {
                inp.addEventListener('input', (e) => { const val = parseCurrency(e.target.value); e.target.value = val > 0 ? formatCurrency(val) : ""; });
                inp.addEventListener('focus', (e) => e.target.select());
            });
        } else {
            singlePriceContainer.classList.remove('hidden'); variantsContainer.classList.add('hidden'); variantsContainer.innerHTML = ""; dNewPriceInput.required = true;
            dNewPriceInput.value = (product.originalPrice && product.originalPrice > product.price) ? formatCurrency(product.price) : "";
        }

        discountModal.classList.remove('hidden'); discountModal.classList.add('flex');
    } catch(e) { console.error(e); }
};

window.closeDiscountModal = () => {
    discountModal.classList.add('hidden'); discountModal.classList.remove('flex');
    currentEditingId = null; currentEditingProduct = null;
};

window.toggleDurationType = (type) => {
    currentDurationType = type;
    if (type === 'days') {
        dInputDays.classList.remove('hidden'); dInputDate.classList.add('hidden');
        btnTypeDays.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); btnTypeDays.classList.remove('text-gray-400');
        btnTypeDate.classList.add('text-gray-400'); btnTypeDate.classList.remove('bg-white', 'shadow-sm', 'text-brand-black');
    } else {
        dInputDays.classList.add('hidden'); dInputDate.classList.remove('hidden');
        btnTypeDate.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); btnTypeDate.classList.remove('text-gray-400');
        btnTypeDays.classList.add('text-gray-400'); btnTypeDays.classList.remove('bg-white', 'shadow-sm', 'text-brand-black');
    }
};

if(discountForm) {
    discountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = discountForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

        try {
            const product = currentEditingProduct;
            let minPrice = Infinity;
            let rootOriginalPrice = product.originalPrice || product.price;
            let updatedCombinations = product.combinations || [];
            let updatedCapacities = product.capacities || [];

            if (updatedCombinations.length > 0) {
                document.querySelectorAll('.var-discount-input').forEach(inp => {
                    const idx = inp.dataset.index; const newPriceRaw = parseCurrency(inp.value); const comb = updatedCombinations[idx];
                    if (!comb.originalPrice) comb.originalPrice = comb.price;
                    comb.price = (newPriceRaw > 0 && newPriceRaw < comb.originalPrice) ? newPriceRaw : comb.originalPrice;
                    if (comb.price < minPrice) minPrice = comb.price;
                });
                updatedCapacities = updatedCapacities.map(cap => {
                    const matchingComb = updatedCombinations.find(c => c.capacity === cap.label);
                    return (matchingComb && matchingComb.price < (cap.originalPrice || cap.price)) ? { ...cap, originalPrice: cap.originalPrice || cap.price, price: matchingComb.price } : cap;
                });
            } else {
                const newPriceRaw = parseCurrency(dNewPriceInput.value);
                if (newPriceRaw <= 0 || newPriceRaw >= rootOriginalPrice) throw new Error("Precio inválido.");
                minPrice = newPriceRaw;
            }

            let endDate = new Date();
            if (currentDurationType === 'days') {
                const days = parseInt(document.getElementById('d-duration-days').value);
                if (!days) throw new Error("Ingresa días."); endDate.setDate(endDate.getDate() + days);
            } else {
                const dateVal = document.getElementById('d-duration-date').value;
                if (!dateVal) throw new Error("Selecciona fecha."); endDate = new Date(dateVal);
            }

            await updateDoc(doc(db, "products", currentEditingId), { originalPrice: rootOriginalPrice, price: minPrice, promoEndsAt: endDate, updatedAt: new Date(), combinations: updatedCombinations, capacities: updatedCapacities });
            alert("✅ Oferta aplicada."); closeDiscountModal();
        } catch (e) { alert("Error: " + e.message); } finally { btn.disabled = false; btn.innerHTML = originalText; }
    });
}

window.removeDiscount = async () => {
    if (!confirm("¿Restaurar precios originales?")) return;
    try {
        const product = currentEditingProduct;
        if (!product.originalPrice) return;

        let updatedCombinations = (product.combinations || []).map(c => ({ ...c, price: c.originalPrice || c.price, originalPrice: 0 }));
        let updatedCapacities = (product.capacities || []).map(c => ({ ...c, price: c.originalPrice || c.price, originalPrice: 0 }));

        await updateDoc(doc(db, "products", currentEditingId), { price: product.originalPrice, originalPrice: 0, promoEndsAt: null, updatedAt: new Date(), combinations: updatedCombinations, capacities: updatedCapacities });
        alert("✅ Oferta removida."); closeDiscountModal();
    } catch (e) { console.error(e); }
};

// =============================================================================
// 📊 EXPORTAR INVENTARIO COMPLETO A XLSX NATIVO (HOJA DE EXCEL BINARIA)
// =============================================================================
window.exportInventoryToExcel = () => {
    if (!adminProductsCache || adminProductsCache.length === 0) {
        alert("⚠️ No hay productos cargados en el inventario para exportar.");
        return;
    }

    // Si ya está cargada la librería, exportamos de inmediato
    if (window.XLSX) {
        generateNativeXlsx();
        return;
    }

    // Si no está cargada, inyectamos la biblioteca SheetJS dinámicamente (Lazy Loading)
    console.log("📦 Cargando SheetJS bajo demanda para exportar XLSX...");
    const btn = document.querySelector('button[onclick="exportInventoryToExcel()"]');
    const originalText = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-emerald-600 text-sm"></i> Generando...';
    }

    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
        generateNativeXlsx();
    };
    script.onerror = () => {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
        alert("⚠️ No se pudo cargar el motor de exportación. Verifica tu conexión a internet.");
    };
    document.head.appendChild(script);
};

function generateNativeXlsx() {
    try {
        const data = [];
        
        // Fila de Encabezados con Categoría y Subcategoría
        data.push(["Categoría", "Subcategoría", "Nombre", "Referencia", "Variable Color", "Variable Capacidad", "SKU", "Cantidad"]);

        const rawList = (currentFilteredProducts && currentFilteredProducts.length > 0) 
            ? currentFilteredProducts 
            : adminProductsCache;

        // Copiar y ordenar alfabéticamente por Categoría (A-Z), luego Subcategoría (A-Z), luego Nombre (A-Z)
        const sourceList = [...rawList].sort((a, b) => {
            const catA = getCategoryName(a) || "Sin Categoría";
            const catB = getCategoryName(b) || "Sin Categoría";
            const compCat = catA.localeCompare(catB, 'es', { sensitivity: 'base' });
            if (compCat !== 0) return compCat;

            const subA = getSubcategoryName(a) || "General";
            const subB = getSubcategoryName(b) || "General";
            const compSub = subA.localeCompare(subB, 'es', { sensitivity: 'base' });
            if (compSub !== 0) return compSub;

            const nameA = (a.name || "").trim();
            const nameB = (b.name || "").trim();
            return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
        });

        sourceList.forEach(product => {
            const category = getCategoryName(product) || "Sin Categoría";
            const subcategory = getSubcategoryName(product) || "General";
            const hasCombinations = product.combinations && Array.isArray(product.combinations) && product.combinations.length > 0;

            if (!hasCombinations) {
                // Producto Simple - Solo con stock > 0
                const stock = Number(product.stock) || 0;
                if (stock > 0) {
                    data.push([
                        category,
                        subcategory,
                        product.name || "Sin Nombre",
                        product.sku || "Sin Referencia",
                        "---",
                        "---",
                        product.sku || "Sin Referencia",
                        stock
                    ]);
                }
            } else {
                // Ordenar variantes alfabéticamente por Color y Capacidad
                const sortedCombinations = [...product.combinations].sort((a, b) => {
                    const colorA = (a.color || "").trim();
                    const colorB = (b.color || "").trim();
                    const compColor = colorA.localeCompare(colorB, 'es', { sensitivity: 'base' });
                    if (compColor !== 0) return compColor;

                    const capA = (a.capacity || "").trim();
                    const capB = (b.capacity || "").trim();
                    return capA.localeCompare(capB, 'es', { sensitivity: 'base' });
                });

                // Producto con Variantes de Combinación - Solo variantes con stock > 0
                sortedCombinations.forEach(comb => {
                    const stock = Number(comb.stock) || 0;
                    if (stock > 0) {
                        data.push([
                            category,
                            subcategory,
                            product.name || "Sin Nombre",
                            product.sku || "Sin Referencia",
                            comb.color || "---",
                            comb.capacity || "---",
                            comb.sku || product.sku || "Sin Referencia",
                            stock
                        ]);
                    }
                });
            }
        });

        // Crear Libro de Trabajo (workbook) y Hoja de Cálculo (worksheet) de SheetJS
        const ws = XLSX.utils.aoa_to_sheet(data);
        
        // Auto-ajuste de columnas para un aspecto premium
        const colsWidth = data[0].map((_, colIndex) => {
            const maxLen = data.reduce((max, row) => {
                const val = row[colIndex] ? String(row[colIndex]) : "";
                return val.length > max ? val.length : max;
            }, 10);
            return { wch: maxLen + 3 };
        });
        ws['!cols'] = colsWidth;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Inventario");

        // Formatear la fecha para el nombre del archivo
        const today = new Date();
        const dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-" + String(today.getDate()).padStart(2, '0');
        const filename = `Inventario_PixelTech_${dateStr}.xlsx`;

        // Generar descarga binaria nativa (.xlsx)
        XLSX.writeFile(wb, filename);

    } catch (error) {
        console.error("Error al generar el archivo XLSX:", error);
        alert("Ocurrió un error al generar el archivo de inventario XLSX: " + error.message);
    }
}