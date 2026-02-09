import { auth, db, onAuthStateChanged, collection, getDocs, query, where, limit, doc, getDoc, orderBy } from "./firebase-init.js";
import { addToCart, updateCartCount, getProductQtyInCart, removeFromCart, removeOneUnit } from "./cart.js";

console.log("🚀 PixelTech Store Iniciada - Modo SmartSync Dual");

let runtimeProductsMap = {};
let allProductsCache = []; 

/* ==========================================================================
   ⚙️ MOTOR DE SINCRONIZACIÓN INTELIGENTE (SMART SYNC DUAL)
   ========================================================================== */
const SmartProductSync = {
    STORAGE_KEY: 'pixeltech_master_catalog',
    
    // Iniciar el motor
    async init() {
        // 1. Cargar lo que tengamos en memoria local (rápido)
        const localData = localStorage.getItem(this.STORAGE_KEY);
        let lastSyncTime = 0;
        
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                // Restauramos el mapa y el array global
                runtimeProductsMap = parsed.map || {};
                lastSyncTime = parsed.lastSync || 0;
                console.log(`📂 Cargados ${Object.keys(runtimeProductsMap).length} productos de caché local.`);
            } catch (e) {
                console.warn("Error leyendo caché local, reiniciando...");
            }
        }

        // 2. Preguntar a Firebase por CAMBIOS (Deltas) en ambos campos
        await this.fetchUpdates(lastSyncTime);

        // 3. Actualizar el Array global para los filtros
        allProductsCache = Object.values(runtimeProductsMap);
        
        // 4. Guardar el estado actualizado
        this.saveState();

        return true;
    },

    async fetchUpdates(lastSyncTime) {
        try {
            const collectionRef = collection(db, "products");

            // CASO 1: Primera carga (Caché vacío o corrupto)
            if (lastSyncTime === 0) {
                console.log("⬇️ Descargando catálogo completo por primera vez...");
                const q = query(collectionRef, where("status", "==", "active"));
                const snap = await getDocs(q);
                snap.forEach(docSnap => {
                    const data = docSnap.data();
                    runtimeProductsMap[docSnap.id] = { id: docSnap.id, ...data };
                });
                return;
            }

            // CASO 2: Actualización Incremental (Doble Validación)
            console.log("🔄 Buscando actualizaciones (Producto o Promo) desde:", new Date(lastSyncTime).toLocaleString());
            const dateQuery = new Date(lastSyncTime);

            // Ejecutamos ambas consultas en paralelo para mayor velocidad
            const [updatesSnap, promosSnap] = await Promise.all([
                getDocs(query(collectionRef, where("updatedAt", ">", dateQuery))),
                getDocs(query(collectionRef, where("last_updated", ">", dateQuery)))
            ]);

            if (updatesSnap.empty && promosSnap.empty) {
                console.log("✅ Todo está al día. 0 lecturas consumidas en cambios.");
                return;
            }

            console.log(`🔥 Cambios detectados: ${updatesSnap.size} ediciones, ${promosSnap.size} promos.`);

            // Función helper para procesar los snapshots y evitar duplicados
            const processChanges = (snap) => {
                snap.forEach(docSnap => {
                    const data = docSnap.data();
                    const id = docSnap.id;

                    if (data.status === 'active') {
                        // Agregar o Actualizar (Sobrescribe si ya existe)
                        runtimeProductsMap[id] = { id, ...data };
                    } else {
                        // Si cambió a inactivo/borrado, lo sacamos de nuestra caché local
                        if (runtimeProductsMap[id]) {
                            delete runtimeProductsMap[id];
                            console.log(`🗑️ Producto eliminado de caché local: ${data.name}`);
                        }
                    }
                });
            };

            // Procesamos ambos resultados
            processChanges(updatesSnap);
            processChanges(promosSnap);

        } catch (e) {
            console.error("Error en SmartSync Dual:", e);
            // Fallback de seguridad
            if (Object.keys(runtimeProductsMap).length === 0) {
                const fallbackQ = query(collection(db, "products"), where("status", "==", "active"), limit(50));
                const snap = await getDocs(fallbackQ);
                snap.forEach(d => runtimeProductsMap[d.id] = { id: d.id, ...d.data() });
            }
        }
    },

    saveState() {
        try {
            const state = {
                map: runtimeProductsMap,
                lastSync: Date.now() // Guardamos el momento exacto de esta sync
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("⚠️ Quota de LocalStorage excedida. La caché no persistirá al cerrar.");
        }
    }
};

/**
 * --- 1. MANEJO DE USUARIO (Header) ---
 */
onAuthStateChanged(auth, async (user) => {
    const userInfo = document.getElementById("user-info-global");
    if (!userInfo) return;

    if (user) {
        // Cache simple para rol de usuario
        const cachedRole = sessionStorage.getItem(`role_${user.uid}`);
        if (cachedRole) {
            renderUserButton(cachedRole === 'admin');
        } else {
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                const isAdmin = userDoc.exists() && userDoc.data().role === 'admin';
                sessionStorage.setItem(`role_${user.uid}`, isAdmin ? 'admin' : 'customer');
                renderUserButton(isAdmin);
            } catch (e) { console.error("Error auth:", e); }
        }
    } else {
        userInfo.innerHTML = `
            <a href="auth/login.html" class="flex flex-col items-center gap-1 group w-14">
                <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-brand-cyan transition duration-300 shadow-lg">
                    <i class="fa-regular fa-user text-lg text-white group-hover:text-brand-black"></i>
                </div>
                <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-brand-cyan text-center">Ingresar</span>
            </a>`;
    }

    function renderUserButton(isAdmin) {
        const targetPath = isAdmin ? '/admin/products.html' : '/profile.html';
        const label = isAdmin ? 'Admin' : 'Cuenta';
        userInfo.innerHTML = `
            <a href="${targetPath}" class="flex flex-col items-center gap-1 group w-14">
                <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-brand-cyan text-brand-black flex items-center justify-center shadow-lg transition duration-300">
                    <i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-user-check'} text-lg"></i>
                </div>
                <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-brand-cyan text-center">${label}</span>
            </a>`;
    }
});

/* ==========================================================================
   LÓGICA HÍBRIDA: MODAL GLOBAL + OVERLAY EN TARJETA
   ========================================================================== */
const colorMap = {
    "negro": "#171717", "black": "#171717", "blanco": "#F9FAFB", "white": "#F9FAFB",
    "azul": "#2563EB", "blue": "#2563EB", "rojo": "#DC2626", "red": "#DC2626",
    "verde": "#16A34A", "green": "#16A34A", "gris": "#4B5563", "gray": "#4B5563",
    "plateado": "#E5E7EB", "silver": "#E5E7EB", "dorado": "#FCD34D", "gold": "#FCD34D",
    "morado": "#9333EA", "purple": "#9333EA", "rosa": "#EC4899", "pink": "#EC4899",
    "titanio": "#9CA3AF", "natural": "#D4D4D8"
};

function getColorHex(name) {
    if (!name) return '#E5E7EB';
    return colorMap[name.toLowerCase()] || name;
}

function getGlobalModal() {
    let modal = document.getElementById('global-variant-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'global-variant-modal';
        modal.className = "fixed inset-0 z-[100] hidden items-center justify-center p-4 bg-brand-black/60 backdrop-blur-sm transition-all duration-300 opacity-0";
        modal.onclick = (e) => { if (e.target === modal) window.closeGlobalModal(); };
        modal.innerHTML = `<div id="global-modal-content" class="bg-white w-full max-w-[320px] rounded-[2rem] shadow-2xl overflow-hidden transform scale-95 transition-all duration-300 relative flex flex-col max-h-[90vh]"></div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

window.openGlobalModal = (id) => {
    event.stopPropagation();
    const p = runtimeProductsMap[id];
    if (!p) return;

    const modal = getGlobalModal();
    const content = modal.querySelector('#global-modal-content');
    const img = p.mainImage || p.image || 'https://placehold.co/150';

    let html = `
    <div class="p-6 pb-2 text-center bg-slate-50 border-b border-gray-100 relative">
        <button onclick="window.closeGlobalModal()" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-gray-400 hover:text-brand-red transition"><i class="fa-solid fa-xmark"></i></button>
        <div class="w-24 h-24 mx-auto bg-white rounded-xl p-2 shadow-sm mb-3 flex items-center justify-center"><img src="${img}" class="max-w-full max-h-full object-contain" id="modal-product-img"></div>
        <h3 class="font-black text-sm uppercase text-brand-black leading-tight mb-1">${p.name}</h3>
        <p class="text-lg font-black text-brand-cyan mt-2" id="modal-price-display">$${(p.price || 0).toLocaleString('es-CO')}</p>
    </div>
    <div class="p-6 overflow-y-auto no-scrollbar space-y-5" id="modal-options-container" data-id="${id}">`;

    if (p.hasVariants && p.variants?.length > 0) {
        html += `<div><p class="text-[10px] font-black text-brand-black uppercase tracking-widest mb-3">Color</p><div class="flex flex-wrap justify-center gap-3">`;
        p.variants.forEach((v, idx) => {
            html += `<button onclick="window.selectVariantOption('modal', 'color', '${v.color}', this)" class="w-10 h-10 rounded-full shadow-sm hover:scale-110 transition-all var-btn-color relative ring-2 ${idx === 0 ? '!ring-brand-cyan scale-110' : 'ring-gray-100'}" style="background-color: ${getColorHex(v.color)}" data-val="${v.color}" data-img="${v.images?.[0] || ''}"></button>`;
        });
        html += `</div></div>`;
    }
    if (p.hasCapacities && p.capacities?.length > 0) {
        html += `<div><p class="text-[10px] font-black text-brand-black uppercase tracking-widest mb-3">Capacidad</p><div class="flex flex-wrap justify-center gap-2">`;
        p.capacities.forEach((c, idx) => {
            html += `<button onclick="window.selectVariantOption('modal', 'capacity', '${c.label}', this)" class="px-4 py-2 rounded-xl border-2 text-[10px] font-black uppercase transition-all var-btn-cap ${idx === 0 ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-gray-400 border-gray-100 hover:border-brand-cyan hover:text-brand-cyan'}" data-val="${c.label}" data-price="${c.price}">${c.label}</button>`;
        });
        html += `</div></div>`;
    }

    html += `</div>
    <div class="p-6 pt-0 mt-auto"><button onclick="window.confirmAdd('modal')" class="w-full bg-brand-cyan text-brand-black font-black py-4 rounded-2xl uppercase text-xs tracking-[0.25em] shadow-lg hover:-translate-y-1 transition-all active:scale-95 flex items-center justify-center gap-3"><span>Agregar</span> <i class="fa-solid fa-cart-plus"></i></button></div>`;

    content.innerHTML = html;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => { modal.classList.remove('opacity-0'); modal.classList.add('flex'); content.classList.remove('scale-95'); content.classList.add('scale-100'); });

    const container = document.getElementById('modal-options-container');
    container.dataset.selColor = p.variants?.[0]?.color || "";
    container.dataset.selCap = p.capacities?.[0]?.label || "";
};

window.closeGlobalModal = () => {
    const modal = document.getElementById('global-variant-modal');
    if (!modal) return;
    const content = modal.querySelector('#global-modal-content');
    modal.classList.add('opacity-0'); content.classList.remove('scale-100'); content.classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); }, 300);
};

window.openCardOverlay = (id, prefix) => {
    event.stopPropagation();
    const p = runtimeProductsMap[id];
    const uniqueId = prefix + '-' + id;
    const overlay = document.getElementById(`overlay-${uniqueId}`);
    
    if (!p || !overlay) return;

    let html = `
    <div class="absolute inset-0 z-50 bg-white flex flex-col h-full w-full p-4" onclick="event.stopPropagation()">
        
        <div class="flex justify-between items-center border-b-2 border-gray-100 pb-2 mb-2 shrink-0">
            <h4 class="text-xs font-black uppercase text-black tracking-widest">
                Personalizar
            </h4>
            <button onclick="window.closeCardOverlay('${uniqueId}')" class="w-6 h-6 flex items-center justify-center text-black hover:text-white hover:bg-black transition rounded-full bg-gray-100">
                <i class="fa-solid fa-xmark text-xs"></i>
            </button>
        </div>
        
        <div class="flex-grow flex flex-col justify-center gap-4 overflow-y-auto no-scrollbar py-2" id="overlay-opts-${uniqueId}" data-id="${id}">`;

    if (p.hasVariants && p.variants?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[10px] font-black text-black uppercase mb-2 text-center">Selecciona Color</p>
            <div class="flex flex-wrap gap-3 justify-center">`;
        p.variants.forEach((v, idx) => {
            const isLight = ['blanco', 'white', 'plateado', 'silver'].includes(v.color.toLowerCase());
            html += `
                <button onclick="window.selectVariantOption('${uniqueId}', 'color', '${v.color}', this)" 
                    class="w-8 h-8 rounded-full shadow-sm hover:scale-110 transition-all var-btn-color ring-2 ${idx===0 ? 'ring-brand-cyan scale-110' : 'ring-gray-200'} ${isLight ? 'border border-gray-300' : ''}" 
                    style="background-color: ${getColorHex(v.color)}" 
                    data-val="${v.color}">
                </button>`;
        });
        html += `</div></div>`;
    }

    if (p.hasCapacities && p.capacities?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[10px] font-black text-black uppercase mb-2 text-center">Selecciona Capacidad</p>
            <div class="flex flex-wrap gap-2 justify-center">`;
        p.capacities.forEach((c, idx) => {
            html += `
                <button onclick="window.selectVariantOption('${uniqueId}', 'capacity', '${c.label}', this)" 
                    class="px-3 py-2 rounded-lg border-2 text-[9px] font-black uppercase transition-all var-btn-cap ${idx===0 ? 'bg-black text-white border-black' : 'bg-white text-black border-gray-200 hover:border-brand-cyan'}" 
                    data-val="${c.label}" 
                    data-price="${c.price}">
                    ${c.label}
                </button>`;
        });
        html += `</div></div>`;
    }

    html += `</div>
        
        <div class="mt-auto shrink-0 pt-2">
            <button onclick="window.confirmAdd('${uniqueId}')" class="w-full bg-brand-cyan text-black font-black py-3 rounded-xl uppercase text-[10px] tracking-[0.2em] hover:bg-cyan-400 transition shadow-lg active:scale-95 flex items-center justify-center gap-2">
                <span>Agregar al Carrito</span> <i class="fa-solid fa-check"></i>
            </button>
        </div>
    </div>`;

    overlay.innerHTML = html;
    
    overlay.classList.remove('hidden');
    overlay.classList.add('flex'); 
    
    requestAnimationFrame(() => { 
        overlay.classList.remove('opacity-0', 'scale-95', 'pointer-events-none'); 
        overlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto'); 
    });

    const container = document.getElementById(`overlay-opts-${uniqueId}`);
    container.dataset.selColor = p.variants?.[0]?.color || "";
    container.dataset.selCap = p.capacities?.[0]?.label || "";
};

window.closeCardOverlay = (uniqueId) => {
    event.stopPropagation();
    const overlay = document.getElementById(`overlay-${uniqueId}`);
    if (!overlay) return;
    overlay.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
    overlay.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    setTimeout(() => { overlay.classList.add('hidden'); overlay.innerHTML = ''; }, 300);
};

window.selectVariantOption = (context, type, val, btn) => {
    event.stopPropagation();
    const container = context === 'modal' ? document.getElementById('modal-options-container') : document.getElementById(`overlay-opts-${context}`);
    if (!container) return;

    if (type === 'color') {
        container.dataset.selColor = val;
        const parent = btn.parentElement;
        parent.querySelectorAll('.var-btn-color').forEach(b => b.classList.remove('!ring-brand-cyan', 'ring-brand-cyan', 'scale-110'));
        parent.querySelectorAll('.var-btn-color').forEach(b => b.classList.add('ring-gray-100', 'ring-gray-200')); 
        btn.classList.remove('ring-gray-100', 'ring-gray-200');
        btn.classList.add(context === 'modal' ? '!ring-brand-cyan' : 'ring-brand-cyan', 'scale-110');

        if (context === 'modal' && btn.dataset.img) document.getElementById('modal-product-img').src = btn.dataset.img;
    }
    if (type === 'capacity') {
        container.dataset.selCap = val;
        const parent = btn.parentElement;
        parent.querySelectorAll('.var-btn-cap').forEach(b => {
            b.className = context === 'modal'
                ? "px-4 py-2 rounded-xl border-2 border-gray-100 text-gray-400 text-[10px] font-black uppercase transition-all var-btn-cap hover:border-brand-cyan hover:text-brand-cyan"
                : "px-2 py-1 rounded border border-gray-200 text-gray-500 text-[8px] font-black uppercase transition-all var-btn-cap hover:border-brand-cyan";
        });
        btn.className = context === 'modal'
            ? "px-4 py-2 rounded-xl border-2 border-brand-black bg-brand-black text-white text-[10px] font-black uppercase transition-all var-btn-cap shadow-lg"
            : "px-2 py-1 rounded border border-brand-black bg-brand-black text-white text-[8px] font-black uppercase transition-all var-btn-cap shadow-sm";

        if (context === 'modal' && btn.dataset.price) document.getElementById('modal-price-display').textContent = `$${parseInt(btn.dataset.price).toLocaleString('es-CO')}`;
    }
};

window.confirmAdd = (context) => {
    event.stopPropagation();
    const container = context === 'modal' ? document.getElementById('modal-options-container') : document.getElementById(`overlay-opts-${context}`);
    const id = container.dataset.id;
    const p = runtimeProductsMap[id];

    const selColor = container.dataset.selColor || null;
    const selCap = container.dataset.selCap || null;

    let finalPrice = p.price;
    if (selCap && p.capacities) {
        const c = p.capacities.find(x => x.label === selCap);
        if (c) finalPrice = c.price;
    }

    let finalImage = p.mainImage || p.image;
    if (selColor && p.variants) {
        const v = p.variants.find(x => x.color === selColor);
        if (v && v.images?.[0]) finalImage = v.images[0];
    }

    addToCart({
        id: p.id,
        name: p.name,
        price: finalPrice,
        originalPrice: p.originalPrice || 0,
        image: finalImage,
        color: selColor,
        capacity: selCap,
        quantity: 1
    });

    if (context === 'modal') window.closeGlobalModal();
    else window.closeCardOverlay(context);

    updateCartCount();
    refreshAllGrids();
};

function getActionButtonsHTML(product, isSmall = false, mode = 'overlay', prefix = 'grid', isFullWidth = false) {
    const qtyInCart = getProductQtyInCart(product.id);
    
    const containerClass = isFullWidth 
        ? "w-full h-10 rounded-xl" 
        : (isSmall ? "h-8 px-1 rounded-lg" : "h-12 px-2 rounded-2xl");
        
    const btnClass = isFullWidth 
        ? "w-1/3 h-full flex items-center justify-center hover:bg-white/10 transition" 
        : (isSmall ? "w-6 text-xs" : "w-8 text-lg");
        
    const textClass = isFullWidth
        ? "w-1/3 text-center font-black text-sm" 
        : (isSmall ? "w-4 text-xs" : "w-6 text-sm");
        
    const addBtnClass = isFullWidth
        ? "w-full h-10 rounded-xl text-xs tracking-widest" 
        : (isSmall ? "w-8 h-8 rounded-lg text-xs" : "w-12 h-12 rounded-2xl");

    const hasVariants = (product.hasVariants && product.variants?.length > 0) || (product.hasCapacities && product.capacities?.length > 0);

    let onClickAction = `window.quickAdd('${product.id}')`; 
    let content = isFullWidth 
        ? `<span class="mr-2">AGREGAR</span> <i class="fa-solid fa-cart-plus"></i>`
        : `<i class="fa-solid fa-cart-plus transition-transform group-hover:scale-110"></i>`;

    if (hasVariants) {
        if (isFullWidth) content = `<span class="mr-2">OPCIONES</span> <i class="fa-solid fa-list-ul"></i>`;
        else content = `<i class="fa-solid fa-list-ul transition-transform group-hover:scale-110"></i>`;
        
        if (mode === 'modal') {
            onClickAction = `window.openGlobalModal('${product.id}')`;
        } else {
            onClickAction = `window.openCardOverlay('${product.id}', '${prefix}')`;
        }
    }

    if (qtyInCart > 0) {
        return `
            <div class="flex items-center justify-between bg-brand-black text-white shadow-lg ${containerClass}" onclick="event.stopPropagation()">
                <button onclick="window.updateCardQty('${product.id}', -1)" class="${btnClass} font-bold active:scale-90"><i class="fa-solid fa-minus"></i></button>
                <span class="${textClass}">${qtyInCart}</span>
                <button onclick="window.updateCardQty('${product.id}', 1)" class="${btnClass} font-bold active:scale-90"><i class="fa-solid fa-plus"></i></button>
            </div>
        `;
    } else {
        return `
            <button class="add-btn ${addBtnClass} bg-brand-black text-white hover:bg-brand-cyan hover:text-brand-black transition-all shadow-lg flex items-center justify-center group-btn active:scale-95 font-black uppercase" onclick="${onClickAction}">
                ${content}
            </button>
        `;
    }
}

window.quickAdd = (id) => {
    event.stopPropagation();
    const p = runtimeProductsMap[id];
    if (!p) return;

    let finalPrice = p.price;
    let finalImage = p.mainImage || p.image;
    let selectedColor = null;
    let selectedCapacity = null;

    if (p.hasCapacities && p.capacities && p.capacities.length > 0) {
        selectedCapacity = p.capacities[0].label;
        finalPrice = p.capacities[0].price;
    }

    if (p.hasVariants && p.variants && p.variants.length > 0) {
        selectedColor = p.variants[0].color;
        if (p.variants[0].images && p.variants[0].images.length > 0) {
            finalImage = p.variants[0].images[0];
        }
    }

    addToCart({
        id: p.id,
        name: p.name,
        price: finalPrice,
        originalPrice: p.originalPrice || 0,
        image: finalImage,
        color: selectedColor,
        capacity: selectedCapacity,
        quantity: 1
    });

    updateCartCount();
    refreshAllGrids();
};

window.updateCardQty = (id, delta) => {
    event.stopPropagation();
    if (delta > 0) {
        window.quickAdd(id);
    } else {
        removeOneUnit(id);
    }
    updateCartCount();
    refreshAllGrids();
};

function refreshAllGrids() {
    renderWeeklyHTML();
    renderPromosHTML();
    if (document.getElementById('featured-grid')) loadFeatured();
    const activeCatBtn = document.querySelector('.cat-btn.active');
    if (activeCatBtn && activeCatBtn.innerText !== "TODAS") {
        if (window.filterBy) window.filterBy(activeCatBtn.dataset.cat, activeCatBtn);
    } else {
        loadBestSellers();
    }
}

let weeklyData = [];
let promoData = [];
let bestSellersData = []; 

/* ==========================================================================
   CARGADORES OPTIMIZADOS (USAN MEMORIA)
   ========================================================================== */

function loadPromoSlider() {
    const container = document.getElementById('promo-slider-container');
    if (!container) return;

    // Filtramos desde la caché local
    let promos = allProductsCache.filter(p => p.isHeroPromo === true && p.stock > 0);

    if (promos.length === 0) {
        promos = allProductsCache.slice(0, 3);
    }

    if (promos.length === 0) {
        container.innerHTML = `<div class="flex items-center justify-center h-full text-gray-500 text-xs font-bold uppercase">Sin promociones</div>`;
        return;
    }

    let currentIdx = 0;
    const renderSlide = (idx) => {
        const p = promos[idx];
        const isCustom = !!p.promoBannerUrl;
        const bgImage = p.promoBannerUrl || p.mainImage || p.image || 'https://placehold.co/600x800';

        if (isCustom) {
            container.innerHTML = `
                <div class="h-full w-full fade-in relative cursor-pointer group" onclick="location.href='/shop/product.html?id=${p.id}'">
                    <img src="${bgImage}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105">
                </div>`;
        } else {
            container.innerHTML = `
                <div class="h-full w-full fade-in relative cursor-pointer" onclick="location.href='/shop/product.html?id=${p.id}'">
                    <img src="${bgImage}" class="absolute inset-0 w-full h-full object-cover opacity-60 transition-transform duration-700 hover:scale-110">
                    <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>
                    <div class="relative z-10 p-8 h-full flex flex-col justify-end items-start">
                        <span class="bg-brand-red text-white text-[8px] font-black px-3 py-1 rounded-full mb-3 uppercase tracking-widest shadow-lg shadow-red-500/20">Oferta Destacada</span>
                        <h2 class="text-2xl font-black text-white uppercase tracking-tighter mb-2 line-clamp-2 leading-none">${p.name}</h2>
                        <p class="text-brand-cyan font-black text-xl">$${(p.price || 0).toLocaleString('es-CO')}</p>
                    </div>
                </div>`;
        }
    };

    renderSlide(0);
    if (promos.length > 1) {
        setInterval(() => {
            currentIdx = (currentIdx + 1) % promos.length;
            renderSlide(currentIdx);
        }, 5000);
    }
}

function loadNewLaunch() {
    const container = document.getElementById('new-launch-banner');
    if (!container) return;

    let p = allProductsCache.find(p => p.isNewLaunch === true && p.stock > 0);
    if (!p && allProductsCache.length > 0) p = allProductsCache[0];

    if (!p) {
        container.innerHTML = `<div class="flex items-center justify-center h-full bg-slate-900 text-gray-600 font-bold text-xs uppercase">Próximamente</div>`;
        return;
    }

    const isCustom = !!p.launchBannerUrl;
    const img = p.launchBannerUrl || p.mainImage || p.image || 'https://placehold.co/800x400';

    if (isCustom) {
        container.innerHTML = `
            <div class="relative h-full w-full group cursor-pointer overflow-hidden" onclick="location.href='/shop/product.html?id=${p.id}'">
                <img src="${img}" class="w-full h-full object-cover transition duration-1000 group-hover:scale-105">
            </div>`;
    } else {
        container.innerHTML = `
            <div class="relative h-full w-full group cursor-pointer overflow-hidden" onclick="location.href='/shop/product.html?id=${p.id}'">
                <img src="${img}" class="absolute inset-0 w-full h-full object-cover transition duration-1000 group-hover:scale-105 opacity-80">
                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"></div>
                <div class="absolute bottom-0 left-0 p-8 z-10 w-full">
                    <p class="text-brand-cyan font-black text-[9px] uppercase tracking-[0.4em] mb-2 bg-black/50 w-fit px-2 py-1 rounded backdrop-blur-sm">Novedad Exclusiva</p>
                    <h3 class="text-2xl md:text-3xl font-black text-white uppercase tracking-tighter leading-none mb-4 line-clamp-2">${p.name}</h3>
                    <div class="flex items-center gap-6">
                        <span class="text-2xl font-black text-white">$${(p.price || 0).toLocaleString('es-CO')}</span>
                        <span class="bg-white text-brand-black px-6 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-brand-cyan transition shadow-lg">Ver Detalles</span>
                    </div>
                </div>
            </div>`;
    }
}

// --- 4. HISTORIAL (CORREGIDO: PRECIO ACTUALIZADO) ---
function loadViewHistory() {
    const container = document.getElementById('view-history-list');
    const btnLeft = document.getElementById('hist-btn-left');
    const btnRight = document.getElementById('hist-btn-right');

    if (!container) return;

    // Obtenemos la lista guardada (puede tener precios viejos)
    const history = JSON.parse(localStorage.getItem('pixeltech_view_history')) || [];

    if (history.length === 0) {
        container.innerHTML = `<p class="text-[9px] text-gray-400 font-bold uppercase w-full text-center self-center">Explora productos para ver tu historial</p>`;
        return;
    }

    container.innerHTML = "";
    
    // Invertimos para ver lo más reciente y limitamos a 10
    const itemsToShow = history.slice().reverse().slice(0, 10);

    itemsToShow.forEach(item => {
        // 🚀 FIX CLAVE: Intentamos buscar el producto en la memoria sincronizada (runtimeProductsMap)
        // Si existe, usamos 'p' (datos frescos con precio nuevo). 
        // Si no existe (ej: borrado), usamos 'item' (datos viejos del historial) como fallback.
        const p = runtimeProductsMap[item.id] || item;

        // Validamos que tenga imagen
        const img = p.mainImage || p.image || 'https://placehold.co/100';
        
        const hasDiscount = p.originalPrice && p.originalPrice > p.price;
        let discountBadge = '';
        let priceDisplay;

        if (hasDiscount) {
            const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
            discountBadge = `<span class="absolute top-2 right-2 z-10 bg-brand-red text-white text-[7px] font-black px-1.5 py-0.5 rounded-md shadow-sm flex items-center justify-center tracking-tighter">-${disc}%</span>`;
            priceDisplay = `
                <div class="flex flex-col leading-none">
                    <span class="text-[8px] text-gray-400 line-through font-bold decoration-red-300 mb-0.5">$${p.originalPrice.toLocaleString('es-CO')}</span>
                    <span class="text-xs font-black text-brand-red group-hover:text-brand-black transition-colors">$${p.price.toLocaleString('es-CO')}</span>
                </div>`;
        } else {
            priceDisplay = `<p class="text-brand-black font-black text-xs group-hover:text-brand-red transition-colors">$${(p.price || 0).toLocaleString('es-CO')}</p>`;
        }

        container.innerHTML += `
            <a href="/shop/product.html?id=${p.id}" class="relative flex items-center gap-3 shrink-0 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-brand-cyan hover:-translate-y-1 transition-all duration-300 w-72 h-full group overflow-hidden">
                ${discountBadge}
                <div class="w-16 h-16 bg-slate-50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-white transition-colors border border-slate-100 p-1 relative">
                    <img src="${img}" class="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500 mix-blend-multiply">
                </div>
                <div class="flex flex-col justify-center min-w-0 flex-grow h-full py-1">
                    <p class="text-[7px] text-gray-400 font-bold uppercase tracking-wider mb-0.5 truncate">${p.category || 'Producto'}</p>
                    <h4 class="text-[10px] font-black text-brand-black leading-tight line-clamp-2 group-hover:text-brand-cyan transition-colors mb-1" title="${p.name}">${p.name}</h4>
                    <div class="flex justify-between items-end mt-auto">
                        ${priceDisplay}
                        <i class="fa-solid fa-arrow-right text-[10px] text-gray-300 group-hover:text-brand-cyan transition-colors mb-0.5"></i>
                    </div>
                </div>
            </a>`;
    });

    setTimeout(() => { container.scrollLeft = 0; }, 100);
    if (btnLeft) btnLeft.onclick = () => container.scrollBy({ left: -300, behavior: 'smooth' });
    if (btnRight) btnRight.onclick = () => container.scrollBy({ left: 300, behavior: 'smooth' });
}

function loadWeeklyChoices() {
    weeklyData = allProductsCache.filter(p => p.isWeeklyChoice === true && p.stock > 0);

    if (weeklyData.length < 3 && allProductsCache.length > 0) {
        const pool = allProductsCache.filter(p => !weeklyData.includes(p) && p.stock > 0);
        pool.sort(() => 0.5 - Math.random());
        const needed = 4 - weeklyData.length;
        weeklyData = [...weeklyData, ...pool.slice(0, needed)];
    }
    renderWeeklyHTML();
}

function loadPromotionsGrid() {
    const validPromos = allProductsCache.filter(p => p.stock > 0 && p.originalPrice > p.price);
    
    validPromos.sort(() => 0.5 - Math.random());
    promoData = validPromos.slice(0, 15);
    
    renderPromosHTML();
}

function loadFeatured() {
    const grid = document.getElementById('featured-grid');
    if (!grid) return;

    const storedIds = JSON.parse(sessionStorage.getItem('pixeltech_featured_ids'));
    let productsToShow = [];

    if (storedIds) {
        productsToShow = allProductsCache.filter(p => storedIds.includes(p.id));
    }

    if (productsToShow.length === 0 && allProductsCache.length > 0) {
        let pool = [...allProductsCache.filter(p => p.stock > 0)];
        pool.sort(() => 0.5 - Math.random());
        productsToShow = pool.slice(0, 10);
        sessionStorage.setItem('pixeltech_featured_ids', JSON.stringify(productsToShow.map(p => p.id)));
    }

    grid.innerHTML = productsToShow.map(p => createProductCard(p, "compact", "feat")).join('');
}

async function loadCategoriesBar() {
    const bar = document.getElementById('categories-bar');
    if (!bar) return;

    let categories = JSON.parse(localStorage.getItem('pixeltech_categories')) || [];

    if (categories.length === 0) {
        try {
            const q = query(collection(db, "categories"), orderBy("name", "asc"));
            const snap = await getDocs(q);
            snap.forEach(d => categories.push(d.data()));
            localStorage.setItem('pixeltech_categories', JSON.stringify(categories));
        } catch (e) { console.error("Categories Error:", e); }
    }

    let html = `
        <button onclick="window.resetBestSellers(this)" class="cat-btn active bg-brand-black text-white border border-brand-black px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap hover:shadow-lg transition-all transform hover:-translate-y-1">
            Todas
        </button>`;

    categories.forEach(cat => {
        html += `
            <button onclick="window.filterBy('${cat.name}', this)" data-cat="${cat.name}" class="cat-btn bg-white text-gray-500 border border-gray-200 px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap hover:border-brand-cyan hover:text-brand-cyan hover:shadow-md transition-all transform hover:-translate-y-1">
                ${cat.name}
            </button>`;
    });

    bar.innerHTML = html;
}

function loadBestSellers() {
    const grid = document.getElementById('dynamic-grid');
    const title = document.getElementById('section-title');
    if (!grid) return;

    if (title) title.innerHTML = `<i class="fa-solid fa-fire text-brand-red"></i> Los Más Vendidos`;

    if (bestSellersData.length > 0) {
        grid.innerHTML = bestSellersData.map(p => createProductCard(p, "normal", "best")).join('');
        return;
    }

    let best = allProductsCache.filter(p => (p.originalPrice > p.price || p.isWeeklyChoice) && p.stock > 0);
    
    if (best.length < 8) {
        const others = allProductsCache.filter(p => !best.includes(p) && p.stock > 0);
        others.sort(() => 0.5 - Math.random());
        best = [...best, ...others.slice(0, 8 - best.length)];
    }

    bestSellersData = best.slice(0, 8);
    grid.innerHTML = bestSellersData.map(p => createProductCard(p, "normal", "best")).join('');
}

window.filterBy = (categoryName, btn) => {
    document.querySelectorAll('.cat-btn').forEach(b => {
        b.classList.remove('bg-brand-black', 'text-white', 'active');
        b.classList.add('bg-white', 'text-gray-500', 'border-gray-200');
    });
    if (btn) {
        btn.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
        btn.classList.add('bg-brand-black', 'text-white', 'border-brand-black', 'active');
    } else {
        const target = document.querySelector(`.cat-btn[data-cat="${categoryName}"]`);
        if (target) {
            target.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
            target.classList.add('bg-brand-black', 'text-white', 'border-brand-black', 'active');
        }
    }

    const title = document.getElementById('section-title');
    if (title) title.innerHTML = `<i class="fa-solid fa-layer-group text-brand-cyan"></i> ${categoryName}`;

    const filtered = allProductsCache.filter(p => p.category === categoryName);
    const grid = document.getElementById('dynamic-grid');

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-10 text-center text-gray-400 text-xs uppercase font-bold">No hay productos en esta categoría por ahora.</div>`;
    } else {
        grid.innerHTML = filtered.slice(0, 8).map(p => createProductCard(p, "normal", "cat")).join('');
    }
};

window.resetBestSellers = (btn) => {
    document.querySelectorAll('.cat-btn').forEach(b => {
        b.classList.remove('bg-brand-black', 'text-white', 'active');
        b.classList.add('bg-white', 'text-gray-500', 'border-gray-200');
    });
    if (btn) {
        btn.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
        btn.classList.add('bg-brand-black', 'text-white', 'border-brand-black', 'active');
    }
    loadBestSellers();
};

async function loadBrandsMarquee() {
    const track = document.getElementById('brands-track');
    if (!track) return;

    let brands = JSON.parse(localStorage.getItem('pixeltech_brands')) || [];

    if (brands.length === 0) {
        try {
            const q = query(collection(db, "brands"), orderBy("name", "asc"));
            const snap = await getDocs(q);
            snap.forEach(d => brands.push(d.data()));
            localStorage.setItem('pixeltech_brands', JSON.stringify(brands));
        } catch (e) { console.error("Brands Error:", e); }
    }

    if (brands.length === 0) return;

    const createBrandCard = (b) => `
        <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="block w-32 h-20 bg-white border border-gray-100 rounded-2xl flex items-center justify-center p-4 hover:border-brand-cyan hover:shadow-xl hover:scale-110 transition-all duration-300 shrink-0">
            <img src="${b.image || 'https://placehold.co/100'}" class="max-w-full max-h-full object-contain" alt="${b.name}">
        </a>
    `;

    const content = brands.map(createBrandCard).join('');
    track.innerHTML = content + content + content + content; 
}

function createProductCard(p, style = "normal", prefix = "grid") {
    const isOutOfStock = (p.maxStock !== undefined && p.maxStock <= 0) || (p.stock || 0) <= 0;
    const hasDiscount = !isOutOfStock && (p.originalPrice && p.originalPrice > p.price);
    
    let actionButtons;
    if (isOutOfStock) {
        actionButtons = `
            <div class="w-full h-10 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-[10px] font-black uppercase tracking-widest cursor-not-allowed">
                Agotado
            </div>`;
    } else {
        actionButtons = getActionButtonsHTML(p, false, 'overlay', prefix, true);
    }

    let containerClasses = "bg-white border rounded-3xl flex flex-col overflow-hidden p-4 relative cursor-pointer transition-all duration-300 group ";
    if (isOutOfStock) containerClasses += "border-gray-100 opacity-70 grayscale";
    else if (hasDiscount) containerClasses += "border-gray-100 hover:border-red-100 hover:shadow-[0_10px_40px_-10px_rgba(220,38,38,0.15)] hover:-translate-y-1";
    else containerClasses += "border-gray-100 hover:shadow-2xl hover:border-brand-cyan/20 hover:-translate-y-1";

    let badge = "";
    if (isOutOfStock) badge = `<span class="absolute top-0 right-0 bg-gray-200 text-gray-500 text-[9px] font-black px-3 py-1.5 rounded-bl-2xl z-20">SIN STOCK</span>`;
    else if (hasDiscount) {
        const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
        badge = `<div class="absolute top-0 left-0 bg-gradient-to-r from-red-600 to-pink-600 text-white text-[9px] font-black px-3 py-1.5 rounded-br-2xl z-20 shadow-md flex items-center gap-1"><i class="fa-solid fa-tags text-[8px]"></i> -${disc}%</div>`;
    }

    let priceDisplay;
    if (hasDiscount) {
        priceDisplay = `
            <div class="flex flex-col items-center">
                <div class="flex items-center gap-2 mb-0.5"><span class="text-[10px] text-gray-400 line-through decoration-red-300 decoration-1">Antes: $${p.originalPrice.toLocaleString('es-CO')}</span></div>
                <div class="flex items-center gap-2"><span class="text-xl font-black text-brand-red tracking-tight">$${p.price.toLocaleString('es-CO')}</span></div>
            </div>`;
    } else {
        priceDisplay = `<span class="text-brand-black font-black text-lg">$${p.price.toLocaleString('es-CO')}</span>`;
    }

    const overlayHTML = `<div id="overlay-${prefix}-${p.id}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-3 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;
    const clickAction = isOutOfStock ? "" : `window.location.href='/shop/product.html?id=${p.id}'`;
    const imgHeight = style === "compact" ? "h-28" : "h-40 md:h-48";
    const titleSize = style === "compact" ? "text-xs" : "text-sm";

    return `
        <div class="${containerClasses}" onclick="${clickAction}">
            ${badge}
            ${overlayHTML}
            <div class="${imgHeight} bg-slate-50/50 rounded-2xl overflow-hidden mb-3 flex items-center justify-center p-4 relative">
                <img src="${p.mainImage || p.image || 'https://placehold.co/200'}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-700 relative z-10 mix-blend-multiply">
            </div>
            <div class="flex flex-col flex-grow text-center">
                <p class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1 truncate">${p.category || 'Tecnología'}</p>
                <h3 class="font-bold ${titleSize} text-brand-black mb-2 line-clamp-2 uppercase leading-tight h-10 flex items-center justify-center group-hover:text-brand-cyan transition">${p.name}</h3>
                <div class="mb-3 mt-auto">${priceDisplay}</div>
                <div class="w-full">${actionButtons}</div>
            </div>
        </div>`;
}

function renderWeeklyHTML() {
    const container = document.getElementById('weekly-choice-container');
    if (!container) return;
    container.innerHTML = "";
    if (weeklyData.length === 0) { container.innerHTML = `<p class="text-xs text-center text-gray-400 py-4 font-bold uppercase">Cargando selección...</p>`; return; }

    weeklyData.forEach(p => {
        const hasDiscount = p.originalPrice && p.originalPrice > p.price;
        const disc = hasDiscount ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100) : 0;
        const img = p.mainImage || p.image || 'https://placehold.co/100';
        const actionButtons = getActionButtonsHTML(p, true, 'modal');
        let priceDisplay;
        if (hasDiscount) {
            priceDisplay = `<div class="flex flex-wrap items-baseline gap-x-2 leading-none mt-1"><span class="text-[8px] text-gray-400 line-through font-bold decoration-red-300">$${p.originalPrice.toLocaleString('es-CO')}</span><span class="text-sm font-black text-brand-red tracking-tight">$${p.price.toLocaleString('es-CO')}</span></div>`;
        } else {
            priceDisplay = `<p class="text-xs font-black text-brand-black tracking-tight mt-1">$${p.price.toLocaleString('es-CO')}</p>`;
        }
        container.innerHTML += `
            <div class="relative flex items-center gap-3 p-2 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:border-brand-cyan/20 transition-all duration-300 cursor-pointer group overflow-hidden mb-2 last:mb-0 h-auto min-h-[80px]" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                ${hasDiscount ? `<div class="absolute top-0 right-0 z-20 bg-brand-red text-white text-[7px] font-black px-1.5 py-0.5 rounded-bl-lg shadow-sm">-${disc}%</div>` : ''}
                <div class="w-14 h-14 bg-slate-50 rounded-lg border border-gray-50 flex items-center justify-center shrink-0 p-1 group-hover:bg-white transition-colors relative overflow-hidden self-center"><img src="${img}" class="max-w-full max-h-full object-contain shrink-0 group-hover:scale-110 transition duration-500 mix-blend-multiply relative z-10"></div>
                <div class="flex-grow min-w-0 flex flex-col justify-center py-1"><p class="text-[7px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 truncate">${p.category || 'Tech'}</p><h4 class="text-[10px] font-black text-brand-black uppercase leading-tight line-clamp-2 group-hover:text-brand-cyan transition-colors w-full break-words">${p.name}</h4>${priceDisplay}</div>
                <div class="self-center shrink-0 pl-2 border-l border-dashed border-gray-100 flex flex-col justify-center h-10">${actionButtons}</div>
            </div>`;
    });
}

function renderPromosHTML() {
    const track = document.getElementById('promo-track');
    if (!track) return;
    track.innerHTML = "";
    const validPromos = promoData.filter(p => (p.stock > 0) && (p.originalPrice > p.price));
    if(validPromos.length === 0) { track.parentElement.style.display = 'none'; return; }

    const cardsHTML = validPromos.map(p => {
        const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
        const actionButtons = getActionButtonsHTML(p, false, 'overlay', 'promo', true); 
        const overlayHTML = `<div id="overlay-promo-${p.id}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-4 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;

        return `
        <div class="w-[280px] h-[400px] bg-white rounded-[2rem] p-5 border border-red-50 shadow-sm hover:shadow-xl hover:shadow-red-500/10 transition-all group relative flex flex-col shrink-0 cursor-pointer" onclick="window.location.href='/shop/product.html?id=${p.id}'">
            ${overlayHTML}
            <div class="absolute top-4 left-4 z-20 bg-brand-red text-white w-12 h-12 flex items-center justify-center rounded-full shadow-lg shadow-red-500/30 group-hover:scale-110 transition-transform"><div class="text-center leading-none"><span class="block text-[8px] font-bold opacity-80">DTO</span><span class="block text-xs font-black">${disc}%</span></div></div>
            <div class="h-44 bg-gradient-to-b from-slate-50 to-white rounded-2xl overflow-hidden mb-4 flex items-center justify-center p-4"><img src="${p.mainImage || p.image || 'https://placehold.co/150'}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-700 mix-blend-multiply"></div>
            <p class="text-[9px] font-black text-brand-cyan uppercase mb-1 tracking-widest text-center">OFERTA FLASH</p>
            <h3 class="font-bold text-sm text-brand-black mb-1 line-clamp-2 uppercase group-hover:text-brand-red transition text-center leading-tight h-10 flex items-center justify-center">${p.name}</h3>
            <div class="mt-auto w-full border-t border-dashed border-gray-100 pt-4"><div class="flex justify-between items-end mb-4 px-2"><div class="text-left"><p class="text-[9px] text-gray-400 font-bold uppercase">Antes</p><p class="text-xs text-gray-400 line-through decoration-red-300">$${p.originalPrice.toLocaleString('es-CO')}</p></div><div class="text-right"><p class="text-[9px] text-brand-red font-bold uppercase">Ahora</p><p class="text-2xl font-black text-brand-black leading-none">$${p.price.toLocaleString('es-CO')}</p></div></div>${actionButtons}</div>
        </div>`;
    }).join('');
    track.innerHTML = cardsHTML + (validPromos.length > 3 ? cardsHTML : '');
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Iniciar sincronización INTELIGENTE DUAL
    await SmartProductSync.init();

    // 2. Renderizar UI desde memoria (Rápido)
    loadPromoSlider();
    loadNewLaunch();
    loadViewHistory();
    loadWeeklyChoices();
    loadPromotionsGrid();
    loadFeatured();
    loadCategoriesBar();
    loadBestSellers();
    loadBrandsMarquee();

    updateCartCount();
});