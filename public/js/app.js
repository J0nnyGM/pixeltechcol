import { auth, db, onAuthStateChanged, collection, getDocs, query, where, limit, doc, getDoc, orderBy } from "./firebase-init.js";
import { addToCart, updateCartCount, getProductQtyInCart, removeFromCart, removeOneUnit } from "./cart.js";

console.log("🚀 PixelTech Store Iniciada");

let runtimeProductsMap = {};
let allProductsCache = []; // Cache para filtrado rápido sin recargar DB

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
function getActionButtonsHTML(product, isSmall = false) {
    const qtyInCart = getProductQtyInCart(product.id);
    const containerClass = isSmall ? "h-8 px-1 rounded-lg" : "h-12 px-2 rounded-2xl"; 
    const btnClass = isSmall ? "w-6 text-xs" : "w-8 text-lg";
    const textClass = isSmall ? "w-4 text-xs" : "w-6 text-sm";
    const addBtnClass = isSmall ? "w-8 h-8 rounded-lg text-xs" : "w-12 h-12 rounded-2xl";

    if (qtyInCart > 0) {
        return `
            <div class="flex items-center bg-brand-black text-white shadow-xl shadow-cyan-500/10 gap-1 ${containerClass}" onclick="event.stopPropagation()">
                <button onclick="window.updateCardQty('${product.id}', -1)" class="${btnClass} h-full flex items-center justify-center hover:text-brand-cyan transition font-bold active:scale-90">-</button>
                <span class="${textClass} text-center font-black">${qtyInCart}</span>
                <button onclick="window.updateCardQty('${product.id}', 1)" class="${btnClass} h-full flex items-center justify-center hover:text-brand-cyan transition font-bold active:scale-90">+</button>
            </div>
        `;
    } else {
        return `
            <button class="add-btn ${addBtnClass} bg-brand-black text-white hover:bg-brand-cyan hover:text-brand-black transition-all shadow-xl flex items-center justify-center group-btn active:scale-95" onclick="window.quickAdd('${product.id}')">
                <i class="fa-solid fa-cart-plus transition-transform group-hover:scale-110"></i>
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
    // Refrescar secciones superiores
    renderWeeklyHTML();
    renderPromosHTML();
    
    // Refrescar secciones nuevas si existen
    if (document.getElementById('featured-grid')) loadFeatured();
    
    // Refrescar grid dinámico manteniendo el filtro actual
    const activeCatBtn = document.querySelector('.cat-btn.active');
    if(activeCatBtn && activeCatBtn.innerText !== "TODAS") {
        if (window.filterBy) window.filterBy(activeCatBtn.dataset.cat, activeCatBtn);
    } else {
        loadBestSellers();
    }
}

/* ==========================================================================
   CARGADORES DE DATOS (SECCIONES SUPERIORES)
   ========================================================================== */
let weeklyData = [];
let promoData = [];

// --- 2. SLIDER PROMO ---
async function loadPromoSlider() {
    const container = document.getElementById('promo-slider-container');
    if (!container) return;
    
    try {
        const q = query(
            collection(db, "products"), 
            where("status", "==", "active"),
            where("isHeroPromo", "==", true), 
            limit(5)
        );
        const snap = await getDocs(q);
        let promos = [];
        
        snap.forEach(doc => {
            const p = { id: doc.id, ...doc.data() };
            promos.push(p);
            runtimeProductsMap[p.id] = p;
        });
        
        if (promos.length === 0) {
            const fallbackQ = query(
                collection(db, "products"), 
                where("status", "==", "active"),
                limit(3)
            );
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

// --- 3. LANZAMIENTO ---
async function loadNewLaunch() {
    const container = document.getElementById('new-launch-banner');
    if (!container) return;

    try {
        const q = query(
            collection(db, "products"), 
            where("status", "==", "active"),
            where("isNewLaunch", "==", true), 
            limit(1)
        );
        const snap = await getDocs(q);
        
        let p = null;
        if (!snap.empty) {
            p = { id: snap.docs[0].id, ...snap.docs[0].data() };
            runtimeProductsMap[p.id] = p;
        } else {
            const fallbackQ = query(
                collection(db, "products"), 
                where("status", "==", "active"),
                limit(1)
            ); 
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

// --- 4. HISTORIAL ---
function loadViewHistory() {
    const container = document.getElementById('view-history-list');
    const btnLeft = document.getElementById('hist-btn-left');
    const btnRight = document.getElementById('hist-btn-right');

    if (!container) return;

    const history = JSON.parse(localStorage.getItem('pixeltech_view_history')) || [];
    
    if (history.length === 0) {
        container.innerHTML = `<p class="text-[9px] text-gray-400 font-bold uppercase w-full text-center py-4">Explora productos para ver tu historial</p>`;
        return;
    }

    container.innerHTML = "";
    const itemsToShow = history.slice(0, 10).reverse();

    itemsToShow.forEach(p => {
        container.innerHTML += `
            <a href="/shop/product.html?id=${p.id}" class="relative flex items-center gap-3 shrink-0 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-brand-cyan hover:-translate-y-1 transition-all duration-300 w-60 group h-full overflow-hidden">
                <div class="w-14 h-14 bg-slate-50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-white transition-colors border border-slate-100">
                    <img src="${p.mainImage || p.image || 'https://placehold.co/60'}" class="max-w-full max-h-full p-1 object-contain group-hover:scale-110 transition-transform duration-500">
                </div>
                <div class="flex flex-col justify-center min-w-0 flex-grow pr-4">
                    <p class="text-[8px] text-gray-400 font-bold uppercase tracking-wider mb-0.5 truncate">${p.category || 'Tech'}</p>
                    <h4 class="text-[10px] font-black text-brand-black leading-tight line-clamp-2 group-hover:text-brand-cyan transition-colors mb-1 h-6 flex items-center">${p.name}</h4>
                    <p class="text-brand-black font-black text-xs group-hover:text-brand-red transition-colors">$${(p.price || 0).toLocaleString('es-CO')}</p>
                </div>
                <div class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                    <i class="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
                </div>
            </a>`;
    });

    setTimeout(() => { container.scrollLeft = container.scrollWidth; }, 100);
    if(btnLeft) btnLeft.onclick = () => container.scrollBy({ left: -256, behavior: 'smooth' });
    if(btnRight) btnRight.onclick = () => container.scrollBy({ left: 256, behavior: 'smooth' });
}

// --- 5. ELECCIÓN SEMANAL ---
async function loadWeeklyChoices() {
    try {
        const q = query(collection(db, "products"), where("status", "==", "active"));
        const snap = await getDocs(q);
        let allProducts = [];
        snap.forEach(d => {
            const p = {id: d.id, ...d.data()};
            allProducts.push(p);
            runtimeProductsMap[p.id] = p;
        });

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
        const actionButtons = getActionButtonsHTML(p, true); 
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
                <div>${actionButtons}</div>
            </div>`;
    });
}

// --- 6. PRECIOS ESPECIALES ---
async function loadPromotionsGrid() {
    try {
        const q = query(
            collection(db, "products"), 
            where("status", "==", "active"),
            where("originalPrice", ">", 0), 
            limit(50)
        );
        const snap = await getDocs(q);
        let tempPromos = [];
        
        snap.forEach(docSnap => {
            const p = { id: docSnap.id, ...docSnap.data() };
            if (p.price < p.originalPrice) {
                tempPromos.push(p);
                runtimeProductsMap[p.id] = p;
            }
        });
        
        tempPromos.sort(() => 0.5 - Math.random());
        promoData = tempPromos.slice(0, 15);
        renderPromosHTML();
    } catch (e) { console.error("Promos Grid Error:", e); }
}

function renderPromosHTML() {
    const track = document.getElementById('promo-track');
    if (!track) return;
    track.innerHTML = "";
    
    if(promoData.length === 0) {
        track.parentElement.innerHTML = `<p class="text-center text-gray-300 text-xs font-bold uppercase py-10 w-full">No hay ofertas especiales.</p>`;
        return;
    }

    const cardsHTML = promoData.map(p => {
        const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
        const actionButtons = getActionButtonsHTML(p);
        return `
        <div class="w-[280px] h-[400px] bg-white rounded-[2rem] p-5 border border-gray-100 shadow-sm hover:shadow-2xl transition-all group relative flex flex-col shrink-0 cursor-pointer" onclick="window.location.href='/shop/product.html?id=${p.id}'">
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
                <div>${actionButtons}</div>
            </div>
        </div>`;
    }).join('');

    track.innerHTML = cardsHTML + cardsHTML;
}

// =========================================================================
// NUEVAS FUNCIONES PARA SECCIÓN INFERIOR
// =========================================================================

// --- A. DESTACADOS (RANDOM 10) ---
async function loadFeatured() {
    const grid = document.getElementById('featured-grid');
    if (!grid) return;

    try {
        // 1. Intentar cargar desde sessionStorage
        const storedIds = JSON.parse(sessionStorage.getItem('pixeltech_featured_ids'));
        let productsToShow = [];

        // Si ya tenemos IDs guardados, intentamos usarlos del cache global si ya cargó
        if (storedIds && storedIds.length > 0) {
            // Verificar si los productos están en cache (si allProductsCache ya tiene datos)
            // Si no, igual haremos el query, pero priorizamos el orden guardado
            productsToShow = allProductsCache.filter(p => storedIds.includes(p.id));
            
            // Si encontramos todos en cache, renderizamos directo
            if (productsToShow.length === storedIds.length) {
                // Reordenar según el orden guardado
                productsToShow.sort((a, b) => storedIds.indexOf(a.id) - storedIds.indexOf(b.id));
                grid.innerHTML = productsToShow.map(p => createProductCard(p, "compact")).join('');
                return;
            }
        }

        // 2. Si no hay guardados o faltan datos, hacemos query
        // Pedimos más productos para tener variedad al hacer el random inicial
        const q = query(collection(db, "products"), where("status", "==", "active"), limit(50));
        const snap = await getDocs(q);
        
        snap.forEach(d => {
            const p = { id: d.id, ...d.data() };
            runtimeProductsMap[p.id] = p;
            if(!allProductsCache.find(x => x.id === p.id)) allProductsCache.push(p);
        });

        // 3. Generar Random SOLO SI no existían en session
        if (!storedIds || storedIds.length === 0) {
            let pool = [...allProductsCache];
            pool.sort(() => 0.5 - Math.random());
            const newFeatured = pool.slice(0, 10);
            
            // Guardar IDs en sesión para la próxima vez
            const newIds = newFeatured.map(p => p.id);
            sessionStorage.setItem('pixeltech_featured_ids', JSON.stringify(newIds));
            
            productsToShow = newFeatured;
        } else {
            // Si existían IDs pero no estaban en cache al principio, ahora ya los tenemos del query
            productsToShow = allProductsCache.filter(p => storedIds.includes(p.id));
            productsToShow.sort((a, b) => storedIds.indexOf(a.id) - storedIds.indexOf(b.id));
        }

        grid.innerHTML = productsToShow.map(p => createProductCard(p, "compact")).join('');

    } catch (e) { console.error("Featured Error:", e); }
}

// --- B. BARRA DE CATEGORÍAS ---
async function loadCategoriesBar() {
    const bar = document.getElementById('categories-bar');
    if (!bar) return;

    try {
        const q = query(collection(db, "categories"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        
        let html = `
            <button onclick="window.resetBestSellers(this)" class="cat-btn active bg-brand-black text-white border border-brand-black px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap hover:shadow-lg transition-all transform hover:-translate-y-1">
                Todas
            </button>`;

        snap.forEach(d => {
            const cat = d.data();
            html += `
                <button onclick="window.filterBy('${cat.name}', this)" data-cat="${cat.name}" class="cat-btn bg-white text-gray-500 border border-gray-200 px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap hover:border-brand-cyan hover:text-brand-cyan hover:shadow-md transition-all transform hover:-translate-y-1">
                    ${cat.name}
                </button>`;
        });

        bar.innerHTML = html;
    } catch (e) { console.error("Categories Bar Error:", e); }
}

// --- C. MÁS VENDIDOS / GRID DINÁMICO ---
async function loadBestSellers() {
    const grid = document.getElementById('dynamic-grid');
    const title = document.getElementById('section-title');
    if (!grid) return;

    if (title) title.innerHTML = `<i class="fa-solid fa-fire text-brand-red"></i> Los Más Vendidos`;

    // Asegurar que tenemos datos
    if (allProductsCache.length < 5) {
        const q = query(collection(db, "products"), where("status", "==", "active"), limit(50));
        const snap = await getDocs(q);
        allProductsCache = [];
        snap.forEach(d => {
            const p = { id: d.id, ...d.data() };
            allProductsCache.push(p);
            runtimeProductsMap[p.id] = p;
        });
    }

    // Filtrar ofertas y weekly choices
    let best = allProductsCache.filter(p => (p.originalPrice > p.price) || p.isWeeklyChoice);
    if (best.length < 8) {
        const others = allProductsCache.filter(p => !best.includes(p));
        others.sort(() => 0.5 - Math.random());
        best = [...best, ...others.slice(0, 8 - best.length)];
    }

    grid.innerHTML = best.slice(0, 8).map(p => createProductCard(p)).join('');
}

// --- FUNCIONES FILTRADO ---
window.filterBy = (categoryName, btn) => {
    // Reset buttons
    document.querySelectorAll('.cat-btn').forEach(b => {
        b.classList.remove('bg-brand-black', 'text-white', 'active');
        b.classList.add('bg-white', 'text-gray-500', 'border-gray-200');
    });
    // Active button
    if(btn) {
        btn.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
        btn.classList.add('bg-brand-black', 'text-white', 'border-brand-black', 'active');
    } else {
        const target = document.querySelector(`.cat-btn[data-cat="${categoryName}"]`);
        if(target) {
            target.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
            target.classList.add('bg-brand-black', 'text-white', 'border-brand-black', 'active');
        }
    }

    // Update Title
    const title = document.getElementById('section-title');
    if (title) title.innerHTML = `<i class="fa-solid fa-layer-group text-brand-cyan"></i> ${categoryName}`;

    // Filter
    const filtered = allProductsCache.filter(p => p.category === categoryName);
    const grid = document.getElementById('dynamic-grid');
    
    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-10 text-center text-gray-400 text-xs uppercase font-bold">No hay productos en esta categoría por ahora.</div>`;
    } else {
        grid.innerHTML = filtered.slice(0, 8).map(p => createProductCard(p)).join('');
    }
};

window.resetBestSellers = (btn) => {
    document.querySelectorAll('.cat-btn').forEach(b => {
        b.classList.remove('bg-brand-black', 'text-white', 'active');
        b.classList.add('bg-white', 'text-gray-500', 'border-gray-200');
    });
    if(btn) {
        btn.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
        btn.classList.add('bg-brand-black', 'text-white', 'border-brand-black', 'active');
    }
    loadBestSellers();
};

// --- D. CINTA DE MARCAS ---
async function loadBrandsMarquee() {
    const track = document.getElementById('brands-track');
    if (!track) return;

    try {
        const q = query(collection(db, "brands"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        let brands = [];
        snap.forEach(d => brands.push(d.data()));

        if (brands.length === 0) return;

        const createBrandCard = (b) => `
            <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="block w-32 h-20 bg-white border border-gray-100 rounded-2xl flex items-center justify-center p-4 grayscale hover:grayscale-0 hover:border-brand-cyan hover:shadow-lg transition-all duration-300 shrink-0">
                <img src="${b.image || 'https://placehold.co/100'}" class="max-w-full max-h-full object-contain" alt="${b.name}">
            </a>
        `;

        const content = brands.map(createBrandCard).join('');
        track.innerHTML = content + content + content + content; // Repetir 4 veces para loop

    } catch (e) { console.error("Brands Error:", e); }
}

// --- HELPER: CREADOR DE TARJETAS ---
function createProductCard(p, style = "normal") {
    const actionButtons = getActionButtonsHTML(p);
    const hasDiscount = p.originalPrice && p.originalPrice > p.price;
    
    let priceDisplay = `<span class="text-brand-black font-black text-lg">$${p.price.toLocaleString('es-CO')}</span>`;
    let badge = "";

    if (hasDiscount) {
        const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
        badge = `<span class="absolute top-3 right-3 z-10 bg-brand-red text-white text-[8px] font-black px-2 py-1 rounded-lg uppercase shadow-sm">-${disc}%</span>`;
        priceDisplay = `
            <div class="flex flex-col items-start leading-none">
                <span class="text-[9px] text-gray-300 line-through font-bold">$${p.originalPrice.toLocaleString('es-CO')}</span>
                <span class="text-brand-red font-black text-lg">$${p.price.toLocaleString('es-CO')}</span>
            </div>`;
    }

    if (style === "compact") {
        return `
        <div class="bg-white rounded-[2rem] border border-gray-100 hover:shadow-xl transition-all duration-300 group flex flex-col overflow-hidden p-4 relative cursor-pointer h-full" onclick="window.location.href='/shop/product.html?id=${p.id}'">
            ${badge}
            <div class="h-32 bg-slate-50 rounded-2xl overflow-hidden mb-3 flex items-center justify-center p-2 relative">
                <img src="${p.mainImage || p.image || 'https://placehold.co/150'}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-500">
            </div>
            <div class="flex flex-col flex-grow">
                <p class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1 truncate">${p.category || 'Tech'}</p>
                <h3 class="font-bold text-xs text-brand-black mb-2 line-clamp-2 uppercase group-hover:text-brand-cyan transition leading-tight">${p.name}</h3>
                <div class="mt-auto flex justify-between items-end">
                    ${priceDisplay}
                    ${getActionButtonsHTML(p, true)} 
                </div>
            </div>
        </div>`;
    }

    // Estilo Normal
    return `
        <div class="bg-white rounded-[2.5rem] border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-500 group flex flex-col overflow-hidden p-6 relative cursor-pointer" onclick="window.location.href='/shop/product.html?id=${p.id}'">
            ${badge}
            <div class="h-48 bg-brand-surface rounded-3xl overflow-hidden mb-5 flex items-center justify-center p-4 relative">
                <div class="absolute inset-0 bg-brand-cyan/0 group-hover:bg-brand-cyan/5 transition-colors duration-500"></div>
                <img src="${p.mainImage || p.image || 'https://placehold.co/200'}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-700 relative z-10">
            </div>
            <div class="flex flex-col flex-grow">
                <div class="flex justify-between items-start mb-2">
                    <p class="text-[9px] font-black text-brand-cyan uppercase tracking-widest bg-cyan-50 px-2 py-1 rounded-lg">${p.category || 'Tech'}</p>
                </div>
                <h3 class="font-black text-sm text-brand-black mb-4 line-clamp-2 min-h-[40px] uppercase group-hover:text-brand-cyan transition">${p.name}</h3>
                <div class="mt-auto flex justify-between items-center pt-4 border-t border-dashed border-gray-100">
                    ${priceDisplay}
                    <div>${actionButtons}</div>
                </div>
            </div>
        </div>`;
}

// --- 8. INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    loadPromoSlider();
    loadNewLaunch();
    loadViewHistory();
    loadWeeklyChoices();
    loadPromotionsGrid();
    
    // NUEVOS CARGADORES
    loadFeatured();      
    loadCategoriesBar(); 
    loadBestSellers();   
    loadBrandsMarquee(); 

    updateCartCount();
});