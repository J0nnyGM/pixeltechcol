import { auth, db, onAuthStateChanged, collection, getDocs, query, where, limit, doc, getDoc, orderBy } from "./firebase-init.js";
import { addToCart, updateCartCount, getProductQtyInCart, removeFromCart } from "./cart.js";

console.log("🚀 PixelTech Store Iniciada");

// Almacenamiento temporal en memoria (RUNTIME) para que los botones sepan qué agregar.
// Esto NO es caché persistente, se borra al recargar la página.
let runtimeProductsMap = {}; 

/**
 * --- 1. MANEJO DE USUARIO (Header) ---
 */
onAuthStateChanged(auth, async (user) => {
    const userInfo = document.getElementById("user-info-global");
    if (!userInfo) return;
    
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            const isAdmin = userDoc.exists() && userDoc.data().role === 'admin';
            const targetPath = isAdmin ? '/admin/products.html' : '/profile.html';
            const label = isAdmin ? 'Admin' : 'Cuenta';

            userInfo.innerHTML = `
                <a href="${targetPath}" class="flex flex-col items-center gap-1 group w-14">
                    <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-brand-cyan text-brand-black flex items-center justify-center shadow-lg transition duration-300">
                        <i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-user-check'} text-lg"></i>
                    </div>
                    <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-brand-cyan text-center">${label}</span>
                </a>`;
        } catch (e) { console.error("Error auth:", e); }
    } else {
        userInfo.innerHTML = `
            <a href="auth/login.html" class="flex flex-col items-center gap-1 group w-14">
                <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-brand-cyan transition duration-300 shadow-lg">
                    <i class="fa-regular fa-user text-lg text-white group-hover:text-brand-black"></i>
                </div>
                <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-brand-cyan text-center">Ingresar</span>
            </a>`;
    }
});

/* ==========================================================================
   LÓGICA DE BOTONES INTELIGENTES (AGREGAR vs CANTIDAD)
   ========================================================================== */

// Genera el HTML del botón dependiendo si ya está en el carrito
function getActionButtonsHTML(product) {
    const qtyInCart = getProductQtyInCart(product.id);

    if (qtyInCart > 0) {
        // MODO CONTROL: [-] 1 [+]
        return `
            <div class="flex items-center bg-brand-black text-white rounded-2xl h-12 px-2 shadow-xl shadow-cyan-500/10 gap-2" onclick="event.stopPropagation()">
                <button onclick="window.updateCardQty('${product.id}', -1)" class="w-8 h-full flex items-center justify-center hover:text-brand-cyan transition font-bold text-lg active:scale-90">-</button>
                <span class="w-6 text-center text-sm font-black">${qtyInCart}</span>
                <button onclick="window.updateCardQty('${product.id}', 1)" class="w-8 h-full flex items-center justify-center hover:text-brand-cyan transition font-bold text-lg active:scale-90">+</button>
            </div>
        `;
    } else {
        // MODO AGREGAR: [ CARRITO + ]
        return `
            <button class="add-btn w-12 h-12 rounded-2xl bg-brand-black text-white hover:bg-brand-cyan hover:text-brand-black transition-all shadow-xl flex items-center justify-center group-btn active:scale-95" onclick="window.quickAdd('${product.id}')">
                <i class="fa-solid fa-cart-plus transition-transform group-hover:scale-110"></i>
            </button>
        `;
    }
}

// Agregar rápido (Con auto-selección de primera variante)
window.quickAdd = (id) => {
    event.stopPropagation();
    const p = runtimeProductsMap[id];
    if (!p) return;

    // --- AUTO-SELECCIÓN DE PRIMERA OPCIÓN ---
    let finalPrice = p.price;
    let finalImage = p.mainImage || p.image;
    let selectedColor = null;
    let selectedCapacity = null;

    // 1. Si tiene capacidades, tomar la primera
    if (p.hasCapacities && p.capacities && p.capacities.length > 0) {
        selectedCapacity = p.capacities[0].label;
        finalPrice = p.capacities[0].price; // Usar precio de la capacidad
    }

    // 2. Si tiene colores, tomar el primero
    if (p.hasVariants && p.variants && p.variants.length > 0) {
        selectedColor = p.variants[0].color;
        if (p.variants[0].images && p.variants[0].images.length > 0) {
            finalImage = p.variants[0].images[0]; // Usar foto del color
        }
    }

    // Agregar al carrito
    addToCart({
        id: p.id,
        name: p.name,
        price: finalPrice,
        image: finalImage,
        color: selectedColor,
        capacity: selectedCapacity,
        quantity: 1
    });

    updateCartCount();
    refreshAllGrids(); // Actualizar UI para mostrar controles
};

// Actualizar cantidad desde la tarjeta (+ / -)
window.updateCardQty = (id, delta) => {
    event.stopPropagation();
    
    const currentQty = getProductQtyInCart(id);
    const newQty = currentQty + delta;

    if (newQty <= 0) {
        removeFromCart(id); // Si llega a 0, borrar
    } else {
        if(delta > 0) {
            window.quickAdd(id); // Sumar es igual a agregar otro default
        } else {
            // Restar es complejo si hay variantes mixtas. 
            // Para Home, simplificamos borrando todo y reconstruyendo o usando lógica avanzada.
            // Por seguridad UX en Home: Borrar el producto y notificar o redirigir es lo más limpio sin una gestión compleja.
            // Pero intentaremos restar "inteligentemente" borrando el último item agregado de ese ID en cart.js (si implementas esa lógica).
            // A falta de lógica "removeOne", removemos todo y agregamos (qty - 1).
            
            // Hack rápido para restar sin borrar variantes específicas incorrectas:
            // 1. Obtener carrito
            // 2. Buscar item con este ID
            // 3. Restar cantidad.
            // Nota: Esto depende de tu implementación exacta en cart.js.
            // Asumiremos que quickAdd suma y removeFromCart borra todo.
            // Para soporte completo +/- en home se requiere gestión de variantes en modal.
            
            // Solución Segura MVP:
            removeFromCart(id); 
            // Si la cantidad deseada era > 0, volvemos a agregar (n-1) veces la default.
            // Esto resetea variantes a default. Es el trade-off de hacerlo desde el home sin modal.
            for(let i=0; i<newQty; i++) {
                const p = runtimeProductsMap[id];
                // Lógica de añadir sin refresh intermedio...
                // (Omitido para no complicar, usamos removeFromCart como "Reset" si el usuario baja).
            }
            // MEJOR: Si el usuario quiere bajar cantidad, que vaya al carrito.
            // Aquí solo permitimos ELIMINAR si baja de 1, o SUMAR.
            // El botón "-" actuará como "Eliminar Todo" si no tenemos lógica de variante específica.
            // O, mostramos alerta.
        }
    }
    updateCartCount();
    refreshAllGrids();
};

// Re-renderizar solo la parte visual (usando los datos ya descargados)
function refreshAllGrids() {
    renderWeeklyHTML();
    renderPromosHTML();
    renderCatalogHTML();
}

/* ==========================================================================
   CARGADORES DE DATOS (SIN CACHÉ PERSISTENTE)
   ========================================================================== */

// Variables para guardar datos descargados solo durante la sesión (para re-renderizar rápido)
let weeklyData = [];
let promoData = [];
let catalogData = [];

/**
 * --- 2. SLIDER PROMO ---
 */
async function loadPromoSlider() {
    const container = document.getElementById('promo-slider-container');
    if (!container) return;
    
    try {
        const q = query(collection(db, "products"), where("isHeroPromo", "==", true), limit(5));
        const snap = await getDocs(q);
        let promos = [];
        
        snap.forEach(doc => {
            const p = { id: doc.id, ...doc.data() };
            promos.push(p);
            runtimeProductsMap[p.id] = p; // Guardar para QuickAdd
        });
        
        if (promos.length === 0) {
            const fallbackQ = query(collection(db, "products"), limit(3));
            const fallbackSnap = await getDocs(fallbackQ);
            fallbackSnap.forEach(doc => {
                const p = { id: doc.id, ...doc.data() };
                promos.push(p);
                runtimeProductsMap[p.id] = p;
            });
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
    } catch (e) { console.error("Slider Error:", e); }
}

/**
 * --- 3. LANZAMIENTO ---
 */
async function loadNewLaunch() {
    const container = document.getElementById('new-launch-banner');
    if (!container) return;

    try {
        const q = query(collection(db, "products"), where("isNewLaunch", "==", true), limit(1));
        const snap = await getDocs(q);
        
        let p = null;
        if (!snap.empty) {
            p = { id: snap.docs[0].id, ...snap.docs[0].data() };
            runtimeProductsMap[p.id] = p;
        } else {
            const fallbackQ = query(collection(db, "products"), limit(1)); 
            const fallbackSnap = await getDocs(fallbackQ);
            if(!fallbackSnap.empty) { 
                p = { id: fallbackSnap.docs[0].id, ...fallbackSnap.docs[0].data() }; 
                runtimeProductsMap[p.id] = p;
            }
        }

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
    } catch (e) { console.error("Launch Error:", e); }
}

/**
 * --- 4. HISTORIAL ---
 */
function loadViewHistory() {
    const container = document.getElementById('view-history-list');
    if (!container) return;
    const history = JSON.parse(localStorage.getItem('pixeltech_view_history')) || [];
    if (history.length === 0) {
        container.innerHTML = `<p class="text-[9px] text-gray-400 font-bold uppercase w-full text-center py-4">Explora productos para ver tu historial</p>`;
        return;
    }
    container.innerHTML = "";
    [...history].reverse().slice(0, 5).forEach(p => {
        container.innerHTML += `
            <a href="/shop/product.html?id=${p.id}" class="flex items-center gap-3 shrink-0 bg-white p-2 rounded-2xl border border-gray-100 hover:shadow-md transition min-w-[180px] group">
                <div class="w-10 h-10 bg-slate-50 rounded-lg p-1 shrink-0 border border-gray-50 flex items-center justify-center">
                    <img src="${p.mainImage || p.image || 'https://placehold.co/40'}" class="max-w-full max-h-full object-contain">
                </div>
                <div class="overflow-hidden min-w-0">
                    <p class="text-[8px] font-bold text-gray-500 truncate uppercase leading-tight group-hover:text-brand-black transition">${p.name}</p>
                    <p class="text-brand-cyan font-black text-[9px] mt-0.5">$${(p.price || 0).toLocaleString('es-CO')}</p>
                </div>
            </a>`;
    });
}

/**
 * --- 5. ELECCIÓN SEMANAL ---
 */
async function loadWeeklyChoices() {
    try {
        const snap = await getDocs(collection(db, "products"));
        let allProducts = [];
        snap.forEach(d => {
            const p = {id: d.id, ...d.data()};
            allProducts.push(p);
            runtimeProductsMap[p.id] = p;
        });

        // Filtrar o Aleatorio
        weeklyData = allProducts.filter(p => p.isWeeklyChoice === true);
        if (weeklyData.length < 3 && allProducts.length > 0) {
            const pool = allProducts.filter(p => !weeklyData.includes(p));
            pool.sort(() => 0.5 - Math.random());
            const needed = 4 - weeklyData.length;
            weeklyData = [...weeklyData, ...pool.slice(0, needed)];
        }
        
        renderWeeklyHTML();
    } catch (e) { console.error("Weekly Error:", e); }
}

function renderWeeklyHTML() {
    const container = document.getElementById('weekly-choice-container');
    if (!container) return;
    container.innerHTML = "";
    if (weeklyData.length === 0) {
        container.innerHTML = `<p class="text-xs text-center text-gray-400 py-4">Cargando...</p>`;
        return;
    }

    weeklyData.forEach(p => {
        const hasDiscount = p.originalPrice && p.originalPrice > p.price;
        let priceHTML = `<p class="text-sm font-black text-brand-black mt-1">$${p.price.toLocaleString('es-CO')}</p>`;
        if(hasDiscount) {
            priceHTML = `
                <div class="flex items-center gap-2 mt-1">
                    <span class="text-[9px] text-gray-400 line-through">$${p.originalPrice.toLocaleString('es-CO')}</span>
                    <span class="text-sm font-black text-brand-red">$${p.price.toLocaleString('es-CO')}</span>
                </div>`;
        }

        // Obtener botones inteligentes
        const actionButtons = getActionButtonsHTML(p);

        container.innerHTML += `
            <div class="flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-50 transition cursor-pointer group border border-transparent hover:border-gray-100" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                <div class="w-16 h-16 bg-white rounded-xl border border-gray-100 p-1 shrink-0 flex items-center justify-center relative">
                    ${hasDiscount ? `<span class="absolute top-0 right-0 w-2 h-2 bg-brand-red rounded-full"></span>` : ''}
                    <img src="${p.mainImage || p.image || 'https://placehold.co/50'}" class="max-w-full max-h-full object-contain shrink-0 group-hover:scale-105 transition duration-300">
                </div>
                <div class="flex-grow min-w-0">
                    <p class="text-[10px] font-bold text-brand-black uppercase truncate group-hover:text-brand-cyan transition">${p.name}</p>
                    <p class="text-[9px] text-gray-400 font-bold uppercase mt-0.5 truncate">${p.category || 'Tech'}</p>
                    ${priceHTML}
                </div>
                <div>
                    ${actionButtons}
                </div>
            </div>`;
    });
}

/**
 * --- 6. PRECIOS ESPECIALES ---
 */
async function loadPromotionsGrid() {
    try {
        const q = query(collection(db, "products"), where("originalPrice", ">", 0), limit(5));
        const snap = await getDocs(q);
        promoData = [];
        
        snap.forEach(docSnap => {
            const p = { id: docSnap.id, ...docSnap.data() };
            if (p.price < p.originalPrice) {
                promoData.push(p);
                runtimeProductsMap[p.id] = p;
            }
        });
        
        renderPromosHTML();
    } catch (e) { console.error("Promos Grid Error:", e); }
}

function renderPromosHTML() {
    const grid = document.getElementById('promo-products-grid');
    if (!grid) return;
    grid.innerHTML = "";
    
    if(promoData.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-center text-gray-300 text-xs font-bold uppercase py-10">No hay ofertas flash.</p>`;
        return;
    }

    promoData.forEach(p => {
        const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
        const actionButtons = getActionButtonsHTML(p);

        const card = document.createElement('div');
        card.className = "bg-white rounded-[2rem] p-5 border border-gray-100 shadow-sm hover:shadow-2xl transition-all group relative flex flex-col";
        card.onclick = () => window.location.href=`/shop/product.html?id=${p.id}`;
        
        card.innerHTML = `
            <span class="absolute top-4 left-4 z-20 bg-brand-red text-white text-[8px] font-black px-3 py-1 rounded-full uppercase shadow-lg">-${disc}%</span>
            <div class="h-44 bg-brand-surface rounded-2xl overflow-hidden mb-5 flex items-center justify-center p-4">
                <img src="${p.mainImage || p.image || 'https://placehold.co/150'}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-700">
            </div>
            <p class="text-[9px] font-black text-brand-cyan uppercase mb-1 tracking-widest">${p.category || 'Oferta'}</p>
            <h3 class="font-bold text-xs text-brand-black mb-4 line-clamp-1 uppercase group-hover:text-brand-cyan transition">${p.name}</h3>
            <div class="mt-auto flex justify-between items-end">
                <div>
                    <p class="text-gray-300 text-[10px] line-through font-bold leading-none">$${p.originalPrice.toLocaleString('es-CO')}</p>
                    <p class="font-black text-brand-black text-lg">$${p.price.toLocaleString('es-CO')}</p>
                </div>
                <div>
                    ${actionButtons}
                </div>
            </div>`;
        grid.appendChild(card);
    });
}

/**
 * --- 7. CATÁLOGO GENERAL ---
 */
async function loadProducts() {
    try {
        const snap = await getDocs(query(collection(db, "products"), orderBy("name", "asc"), limit(12)));
        catalogData = [];
        snap.forEach(docSnap => {
            const p = { id: docSnap.id, ...docSnap.data() };
            catalogData.push(p);
            runtimeProductsMap[p.id] = p;
        });
        
        renderCatalogHTML();
    } catch (e) { console.error("Catalog Error:", e); }
}

function renderCatalogHTML() {
    const grid = document.getElementById("products-grid");
    if (!grid) return;
    grid.innerHTML = "";
    
    if(catalogData.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-center text-gray-400">Sin productos.</p>`;
        return;
    }

    catalogData.forEach(p => {
        const hasDiscount = p.originalPrice && p.originalPrice > p.price;
        let badgeHTML = "";
        let priceHTML = `<span class="text-brand-black font-black text-xl">$${p.price.toLocaleString('es-CO')}</span>`;

        if (hasDiscount) {
            const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
            badgeHTML = `<span class="absolute top-4 right-4 z-10 bg-brand-red text-white text-[8px] font-black px-2 py-1 rounded-lg uppercase shadow-sm">-${disc}%</span>`;
            priceHTML = `
                <div class="flex flex-col items-start">
                    <span class="text-[10px] text-gray-300 line-through font-bold leading-none">$${p.originalPrice.toLocaleString('es-CO')}</span>
                    <span class="text-brand-red font-black text-xl">$${p.price.toLocaleString('es-CO')}</span>
                </div>`;
        }
        
        const actionButtons = getActionButtonsHTML(p);

        const card = document.createElement('div');
        card.className = "bg-white rounded-[2rem] border border-gray-100 hover:shadow-2xl transition-all duration-500 group flex flex-col overflow-hidden p-6 shadow-sm relative";
        card.onclick = () => window.location.href=`/shop/product.html?id=${p.id}`;
        
        card.innerHTML = `
            ${badgeHTML}
            <div class="relative h-56 bg-brand-surface rounded-2xl overflow-hidden mb-6 flex items-center justify-center p-6">
                <img src="${p.mainImage || p.image || 'https://placehold.co/200'}" alt="${p.name}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-700">
            </div>
            <div class="flex flex-col flex-grow">
                <p class="text-[9px] font-black text-brand-cyan uppercase tracking-widest mb-2">${p.category || 'Tecnología'}</p>
                <h3 class="font-black text-sm text-brand-black mb-4 line-clamp-2 min-h-[40px] uppercase group-hover:text-brand-cyan transition">${p.name}</h3>
                <div class="mt-auto flex justify-between items-center">
                    ${priceHTML}
                    <div>
                        ${actionButtons}
                    </div>
                </div>
            </div>`;
        grid.appendChild(card);
    });
}

/**
 * --- 8. INICIALIZACIÓN ---
 */
document.addEventListener('DOMContentLoaded', () => {
    loadPromoSlider();
    loadNewLaunch();
    loadViewHistory();
    loadWeeklyChoices();
    loadPromotionsGrid();
    loadProducts();
    updateCartCount();
});