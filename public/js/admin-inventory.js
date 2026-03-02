import { db, collection, query, orderBy, doc, updateDoc, where, limit, startAfter, getAggregateFromServer, count, getDoc, onSnapshot, getDocs } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

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

// --- MODAL DOM ---
const discountModal = document.getElementById('discount-modal');
const discountForm = document.getElementById('discount-form');
const dInputDays = document.getElementById('input-days-container');
const dInputDate = document.getElementById('input-date-container');
const btnTypeDays = document.getElementById('btn-type-days');
const btnTypeDate = document.getElementById('btn-type-date');
const dNewPriceInput = document.getElementById('d-new-price');

// --- ESTADO ---
const PAGE_SIZE = 20;
let currentPage = 1;
let totalDocs = 0;
let currentFilterType = 'all'; 
let currentEditingId = null;
let currentEditingProduct = null; 
let currentDurationType = 'days';

// --- ESTADO SMART CACHE ---
let adminProductsCache = []; // Base de datos en RAM
let unsubscribeProducts = null;

const normalizeText = (str) => {
    if (!str) return "";
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
};

const formatCurrency = (val) => {
    if (val === "" || val === null || val === undefined) return "";
    return "$ " + Number(val).toLocaleString("es-CO");
};

const parseCurrency = (val) => {
    return Number(val.toString().replace(/[^0-9]/g, '')) || 0;
};

const formatDateForInput = (timestamp) => {
    if (!timestamp) return "";
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const tzOffset = d.getTimezoneOffset() * 60000; 
    return (new Date(d - tzOffset)).toISOString().slice(0, 16);
};

if (dNewPriceInput) {
    dNewPriceInput.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = val > 0 ? formatCurrency(val) : "";
    });
    dNewPriceInput.addEventListener('focus', (e) => e.target.select());
}

// =============================================================================
// 🧠 SMART REAL-TIME CACHE: MOTOR CENTRAL DE PRODUCTOS (ANTI-QUOTA)
// =============================================================================
const SmartAdminInventorySync = {
    STORAGE_KEY: 'pixeltech_admin_master_inventory',
    runtimeMap: {},
    lastSyncTime: 0,

    async init() {
        // 1. CARGA INICIAL DESDE CACHÉ (Instantánea)
        const cachedRaw = localStorage.getItem(this.STORAGE_KEY);
        if (cachedRaw) {
            try {
                const parsed = JSON.parse(cachedRaw);
                if (parsed.map && parsed.lastSync) {
                    this.runtimeMap = parsed.map;
                    this.lastSyncTime = parsed.lastSync;
                    
                    this.updateGlobalArray();
                    if (adminProductsCache.length > 0) {
                        console.log(`⚡ [Inventario] Cargados ${adminProductsCache.length} productos de caché local.`);
                        renderViewFromMemory();
                    }
                }
            } catch (e) {
                console.warn("Caché corrupto, limpiando...");
                localStorage.removeItem(this.STORAGE_KEY);
            }
        }

        // 2. CONEXIÓN EN TIEMPO REAL (Solo Deltas)
        this.listenForUpdates();
    },

    updateGlobalArray() {
        // Mantenemos el array en memoria siempre ordenado desde el más nuevo al más viejo
        adminProductsCache = Object.values(this.runtimeMap).sort((a, b) => {
            const dateA = a.createdAt?.seconds || new Date(a.createdAt).getTime();
            const dateB = b.createdAt?.seconds || new Date(b.createdAt).getTime();
            return dateB - dateA;
        });
    },

    saveStateSafe() {
        try {
            // 🧹 COMPRESIÓN: Creamos una versión ligera de los datos para no saturar los 5MB de LocalStorage
            const lightweightMap = {};
            
            for (const key in this.runtimeMap) {
                const p = this.runtimeMap[key];
                lightweightMap[key] = {
                    id: p.id,
                    name: p.name,
                    price: p.price,
                    originalPrice: p.originalPrice || 0,
                    stock: p.stock || 0,
                    status: p.status,
                    sku: p.sku || '',
                    category: p.category || '',
                    brand: p.brand || '',
                    // Solo guardamos la imagen principal, descartamos el array completo de galería
                    mainImage: p.mainImage || p.image || (p.images && p.images.length > 0 ? p.images[0] : ''),
                    combinations: p.combinations || [],
                    capacities: p.capacities || [],
                    promoEndsAt: p.promoEndsAt || null,
                    searchStr: p.searchStr || '',
                    createdAt: p.createdAt,
                    updatedAt: p.updatedAt
                    // ❌ ELIMINAMOS 'description' intencionalmente porque ocupa mucho texto HTML
                };
            }

            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                map: lightweightMap,
                lastSync: Date.now()
            }));
            
        } catch (e) {
            // Si el catálogo es verdaderamente inmenso y aún así falla, evitamos que la app se rompa.
            // Los datos seguirán existiendo en RAM (this.runtimeMap) y la sesión actual funcionará perfecto.
            console.warn("⚠️ LocalStorage lleno. El inventario operará desde la RAM por esta sesión.", e);
            // Limpiamos basura antigua para hacer espacio la próxima vez
            localStorage.removeItem('admin_search_index_v2'); 
        }
    },

    listenForUpdates() {
        if (unsubscribeProducts) unsubscribeProducts();

        const colRef = collection(db, "products");
        let q;

        if (this.lastSyncTime === 0 || Object.keys(this.runtimeMap).length === 0) {
            console.log("☁️ [Inventario] Descarga inicial del catálogo completo para el Admin...");
            q = query(colRef); 
        } else {
            console.log("🔄 [Inventario] Buscando cambios desde:", new Date(this.lastSyncTime).toLocaleString());
            q = query(colRef, where("updatedAt", ">", new Date(this.lastSyncTime)));
        }

        unsubscribeProducts = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                if (this.lastSyncTime !== 0) console.log("✅ [Inventario] Caché al día. (1 lectura de validación)");
                return;
            }

            let hasChanges = false;

            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                const id = change.doc.id;

                if (!data.updatedAt) data.updatedAt = data.createdAt;
                
                data.searchStr = normalizeText(`${data.name} ${data.brand || ''} ${data.sku || ''} ${data.category || ''}`);

                if (change.type === 'added' || change.type === 'modified') {
                    this.runtimeMap[id] = { id, ...data };
                    hasChanges = true;
                } else if (change.type === 'removed') {
                    if (this.runtimeMap[id]) {
                        delete this.runtimeMap[id];
                        hasChanges = true;
                    }
                }
            });

            if (hasChanges) {
                console.log(`🔥 [Inventario] Cambios en vivo procesados: ${snapshot.docChanges().length} documentos.`);
                
                this.updateGlobalArray();
                this.saveStateSafe(); // <-- Llamamos a la función segura
                renderViewFromMemory();
            }
        }, (error) => {
            console.error("Error Live Inventory:", error);
            if (adminProductsCache.length === 0) {
                document.getElementById('products-table-body').innerHTML = `<tr><td colspan="7" class="text-center text-red-500 py-4">Error de conexión.</td></tr>`;
            }
        });
    }
};

// =============================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN 100% EN RAM
// =============================================================================

function renderViewFromMemory() {
    if (!tableBody) return;
    
    let filtered = [];
    const rawSearch = searchInput.value.trim();

    // A. BÚSQUEDA (Prioridad Máxima)
    if (rawSearch.length > 0) {
        const term = normalizeText(rawSearch);
        filtered = adminProductsCache.filter(p => p.searchStr && p.searchStr.includes(term));
    } 
    // B. FILTROS DE TABS
    else {
        if (currentFilterType === 'active') {
            filtered = adminProductsCache.filter(p => p.status === 'active');
        } else if (currentFilterType === 'draft') {
            filtered = adminProductsCache.filter(p => p.status !== 'active');
        } else if (currentFilterType === 'lowstock') {
            filtered = adminProductsCache.filter(p => (p.stock || 0) <= 5);
            // Ordenar de menor stock a mayor stock en esta vista
            filtered.sort((a,b) => (a.stock || 0) - (b.stock || 0));
        } else {
            // 'all'
            filtered = [...adminProductsCache];
        }
    }

    totalDocs = filtered.length;

    // PAGINACIÓN MATEMÁTICA LOCAL
    const totalPages = Math.ceil(totalDocs / PAGE_SIZE);
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = startIdx + PAGE_SIZE;
    const pageProducts = filtered.slice(startIdx, endIdx);

    // RENDER UI
    tableBody.innerHTML = "";

    if (pageProducts.length === 0) {
        tableBody.classList.add('hidden');
        if(noResultsMsg) noResultsMsg.classList.remove('hidden');
        updatePaginationUI(0, 0);
        return;
    }
    
    tableBody.classList.remove('hidden');
    if(noResultsMsg) noResultsMsg.classList.add('hidden');

    pageProducts.forEach((product, index) => {
        renderRowHTML(product, index);
    });

    updatePaginationUI(startIdx + 1, Math.min(endIdx, totalDocs));
}

function updatePaginationUI(start, end) {
    if(rangeSpan) rangeSpan.textContent = totalDocs > 0 ? `${start}-${end}` : "0-0";
    if(totalSpan) totalSpan.textContent = totalDocs;
    
    if(btnPrev) btnPrev.disabled = currentPage === 1;
    if(btnNext) btnNext.disabled = (currentPage * PAGE_SIZE) >= totalDocs;
}

window.changePage = (dir) => {
    currentPage += dir;
    renderViewFromMemory();
    document.querySelector('main').scrollTo({ top: 0, behavior: 'smooth' });
};

window.filterByTab = (status) => {
    currentFilterType = status;
    currentPage = 1;
    if(searchInput) searchInput.value = ""; // Limpiar busqueda al cambiar de tab

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-brand-black', 'text-white', 'shadow-lg', 'border-transparent', 'active');
        btn.classList.add('bg-white', 'text-gray-400', 'border-gray-100');
    });
    
    const activeBtn = document.getElementById(`tab-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-400', 'border-gray-100');
        activeBtn.classList.add('bg-brand-black', 'text-white', 'shadow-lg', 'border-transparent', 'active');
    }
    
    renderViewFromMemory();
};

// Listener del Buscador (Debounce ligero)
let debounceTimeout = null;
if(searchInput) {
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => { 
            currentPage = 1; // Reiniciar página al buscar
            renderViewFromMemory(); 
        }, 200);
    });
}
if(searchForm) {
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
    row.style.animationDelay = `${index * 15}ms`; // Animación más rápida

    const img = product.mainImage || product.image || (product.images ? product.images[0] : 'https://placehold.co/100?text=Sin+Foto');

    const isActive = product.status === 'active';
    let statusBadge = '';
    
    if (isActive) {
        statusBadge = `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-100"><div class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.4)]"></div> Activo</span>`;
    } else {
        statusBadge = `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-600 border border-amber-100"><div class="w-2 h-2 rounded-full bg-amber-500"></div> Borrador</span>`;
    }
    
    let priceDisplay = `<span class="text-base font-black text-gray-800">$${(product.price || 0).toLocaleString('es-CO')}</span>`;
    if (product.originalPrice && product.price < product.originalPrice) {
        const discountPercent = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
        statusBadge += `<span class="ml-2 px-2 py-1 rounded-md text-[9px] font-black uppercase bg-purple-50 text-purple-600 border border-purple-100" title="Oferta activa">-${discountPercent}%</span>`;
        priceDisplay = `
            <div class="flex flex-col">
                <span class="text-[10px] text-gray-300 line-through font-bold">$${product.originalPrice.toLocaleString('es-CO')}</span>
                <span class="text-base font-black text-brand-red">$${product.price.toLocaleString('es-CO')}</span>
            </div>`;
    }

    const toggleIcon = isActive ? 'fa-eye-slash' : 'fa-eye';
    const toggleColor = isActive ? 'hover:text-amber-500 hover:border-amber-500' : 'hover:text-emerald-500 hover:border-emerald-500';
    const toggleTooltip = isActive ? 'Ocultar producto (Pasar a Borrador)' : 'Publicar producto (Hacer visible)';

    row.innerHTML = `
        <td class="p-6 pl-8 text-center align-middle">
            <div class="w-20 h-20 rounded-2xl bg-white border border-gray-100 p-2 shadow-sm mx-auto group-hover:scale-105 transition-transform duration-300 ${!isActive ? 'opacity-50 grayscale' : ''}">
                <img src="${img}" loading="lazy" class="w-full h-full object-contain rounded-lg">
            </div>
        </td>
        <td class="p-6 align-middle">
            <p class="font-black text-brand-black text-sm mb-1 leading-tight group-hover:text-brand-cyan transition-colors cursor-pointer" onclick="window.location.href='edit-product.html?id=${product.id}'">${product.name}</p>
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">SKU: ${product.sku || '---'}</p>
        </td>
        <td class="p-6 align-middle">
            <span class="text-[10px] font-bold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100 uppercase tracking-wide">${product.category || 'General'}</span>
        </td>
        <td class="p-6 align-middle">
            <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">${product.brand || '---'}</p>
        </td>
        <td class="p-6 align-middle">
            <div class="flex flex-col gap-1">
                ${priceDisplay}
                <p class="text-[10px] font-bold uppercase ${ (product.stock || 0) < 5 ? 'text-red-400' : 'text-emerald-500' } flex items-center gap-1">
                    <i class="fa-solid fa-layer-group"></i> ${product.stock || 0} unid.
                </p>
            </div>
        </td>
        <td class="p-6 text-center align-middle">
            <div class="flex flex-col items-center justify-center gap-2">${statusBadge}</div>
        </td>
        <td class="p-6 pr-8 text-right align-middle">
            <div class="flex items-center justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity">
                <button onclick="openDiscountModal('${product.id}')" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-500 transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="Aplicar Oferta"><i class="fa-solid fa-tags"></i></button>
                <button onclick="window.location.href='edit-product.html?id=${product.id}'" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="Editar"><i class="fa-solid fa-pen"></i></button>
                
                <button onclick="toggleProductStatus('${product.id}', '${product.status}')" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 ${toggleColor} transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="${toggleTooltip}">
                    <i class="fa-solid ${toggleIcon}"></i>
                </button>
            </div>
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
    const actionWord = isActivating ? 'publicar' : 'ocultar (pasar a borrador)';
    
    if (confirm(`¿Deseas ${actionWord} este producto?`)) {
        try {
            await updateDoc(doc(db, "products", id), {
                status: newStatus,
                updatedAt: new Date()
            });
            // El onSnapshot repintará automáticamente y de forma inteligente la tabla
        } catch (error) {
            alert("Hubo un error al cambiar el estado del producto.");
        }
    }
};

window.openDiscountModal = async (id) => {
    try {
        // Leemos desde el caché para que el modal abra INSTANTÁNEAMENTE (0 lecturas)
        const product = adminProductsCache.find(p => p.id === id);
        if(!product) return;
        
        currentEditingProduct = product; 
        currentEditingId = id;
        
        document.getElementById('d-prod-name').textContent = product.name;
        
        const originalPrice = product.originalPrice || product.price;
        document.getElementById('d-original-price').value = formatCurrency(originalPrice);
        
        const btnRemove = document.getElementById('btn-remove-discount');
        if (product.originalPrice && product.originalPrice > product.price) {
            btnRemove.classList.remove('hidden');
        } else {
            btnRemove.classList.add('hidden');
        }

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
            singlePriceContainer.classList.add('hidden');
            variantsContainer.classList.remove('hidden');
            dNewPriceInput.required = false;

            let html = '<p class="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 pb-2 mb-2">Ajusta el precio por variante</p>';
            
            product.combinations.forEach((c, index) => {
                const label = `${c.color || ''} ${c.capacity ? '- ' + c.capacity : ''}`.trim();
                const cOrig = c.originalPrice || c.price;
                const cCurrent = (c.originalPrice && c.originalPrice > c.price) ? c.price : "";

                html += `
                    <div class="flex justify-between items-center gap-3 p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                        <div class="w-1/2 overflow-hidden">
                            <p class="text-[10px] font-black text-brand-black truncate" title="${label}">${label}</p>
                            <p class="text-[9px] text-gray-400 font-bold">Antes: <span class="line-through decoration-red-300">${formatCurrency(cOrig)}</span></p>
                        </div>
                        <div class="w-1/2">
                            <input type="text" class="var-discount-input w-full bg-slate-50 border border-gray-200 rounded-md p-2 text-xs font-bold text-brand-cyan outline-none focus:border-brand-cyan focus:bg-white transition"
                            data-index="${index}" value="${formatCurrency(cCurrent)}" placeholder="$ 0">
                        </div>
                    </div>
                `;
            });
            variantsContainer.innerHTML = html;

            variantsContainer.querySelectorAll('.var-discount-input').forEach(inp => {
                inp.addEventListener('input', (e) => {
                    const val = parseCurrency(e.target.value);
                    e.target.value = val > 0 ? formatCurrency(val) : "";
                });
                inp.addEventListener('focus', (e) => e.target.select());
            });

        } else {
            singlePriceContainer.classList.remove('hidden');
            variantsContainer.classList.add('hidden');
            variantsContainer.innerHTML = "";
            dNewPriceInput.required = true;
            
            if (product.originalPrice && product.originalPrice > product.price) {
                dNewPriceInput.value = formatCurrency(product.price);
            } else {
                dNewPriceInput.value = "";
            }
        }

        discountModal.classList.remove('hidden');
        discountModal.classList.add('flex');
    } catch(e) { console.error(e); }
};

window.closeDiscountModal = () => {
    discountModal.classList.add('hidden');
    discountModal.classList.remove('flex');
    currentEditingId = null;
    currentEditingProduct = null;
};

window.toggleDurationType = (type) => {
    currentDurationType = type;
    if (type === 'days') {
        dInputDays.classList.remove('hidden');
        dInputDate.classList.add('hidden');
        btnTypeDays.classList.replace('text-gray-400', 'text-brand-black');
        btnTypeDays.classList.add('bg-white', 'shadow-sm');
        btnTypeDate.classList.replace('text-brand-black', 'text-gray-400');
        btnTypeDate.classList.remove('bg-white', 'shadow-sm');
    } else {
        dInputDays.classList.add('hidden');
        dInputDate.classList.remove('hidden');
        btnTypeDate.classList.replace('text-gray-400', 'text-brand-black');
        btnTypeDate.classList.add('bg-white', 'shadow-sm');
        btnTypeDays.classList.replace('text-brand-black', 'text-gray-400');
        btnTypeDays.classList.remove('bg-white', 'shadow-sm');
    }
};

if(discountForm) {
    discountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = discountForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

        try {
            const product = currentEditingProduct;
            let minPrice = Infinity;
            let rootOriginalPrice = product.originalPrice || product.price;
            
            let updatedCombinations = product.combinations || [];
            let updatedCapacities = product.capacities || [];

            if (updatedCombinations.length > 0) {
                const inputs = document.querySelectorAll('.var-discount-input');
                
                inputs.forEach(inp => {
                    const idx = inp.dataset.index;
                    const newPriceRaw = parseCurrency(inp.value);
                    const comb = updatedCombinations[idx];

                    if (!comb.originalPrice) comb.originalPrice = comb.price;

                    if (newPriceRaw > 0 && newPriceRaw < comb.originalPrice) {
                        comb.price = newPriceRaw;
                    } else {
                        comb.price = comb.originalPrice;
                    }

                    if (comb.price < minPrice) minPrice = comb.price;
                });

                updatedCapacities = updatedCapacities.map(cap => {
                    const matchingComb = updatedCombinations.find(c => c.capacity === cap.label);
                    if (matchingComb && matchingComb.price < (cap.originalPrice || cap.price)) {
                        return { ...cap, originalPrice: cap.originalPrice || cap.price, price: matchingComb.price };
                    }
                    return cap;
                });

            } else {
                const newPriceRaw = parseCurrency(dNewPriceInput.value);
                if (newPriceRaw <= 0 || newPriceRaw >= rootOriginalPrice) {
                    throw new Error("El precio de oferta debe ser válido y menor al original.");
                }
                minPrice = newPriceRaw;
            }

            let endDate = new Date();
            if (currentDurationType === 'days') {
                const days = parseInt(document.getElementById('d-duration-days').value);
                if (!days) throw new Error("Ingresa la cantidad de días.");
                endDate.setDate(endDate.getDate() + days);
            } else {
                const dateVal = document.getElementById('d-duration-date').value;
                if (!dateVal) throw new Error("Selecciona una fecha válida.");
                endDate = new Date(dateVal);
            }

            // Actualizamos Firebase
            await updateDoc(doc(db, "products", currentEditingId), {
                originalPrice: rootOriginalPrice,
                price: minPrice, 
                promoEndsAt: endDate,
                updatedAt: new Date(),
                combinations: updatedCombinations,
                capacities: updatedCapacities
            });

            alert("✅ Oferta aplicada correctamente.");
            closeDiscountModal();
            // onSnapshot repintará automáticamente.

        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });
}

window.removeDiscount = async () => {
    if (!confirm("¿Restaurar precios originales de este producto y sus variantes?")) return;
    try {
        const product = currentEditingProduct;
        if (!product.originalPrice) return;

        let updatedCombinations = product.combinations || [];
        updatedCombinations = updatedCombinations.map(c => {
            return { ...c, price: c.originalPrice || c.price, originalPrice: 0 };
        });

        let updatedCapacities = product.capacities || [];
        updatedCapacities = updatedCapacities.map(c => {
            return { ...c, price: c.originalPrice || c.price, originalPrice: 0 };
        });

        await updateDoc(doc(db, "products", currentEditingId), {
            price: product.originalPrice, 
            originalPrice: 0,
            promoEndsAt: null,
            updatedAt: new Date(),
            combinations: updatedCombinations,
            capacities: updatedCapacities
        });

        alert("✅ Oferta removida correctamente.");
        closeDiscountModal();

    } catch (e) { console.error(e); }
};

// --- Iniciar la magia ---
SmartAdminInventorySync.init();