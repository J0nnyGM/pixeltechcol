import { auth, db, onAuthStateChanged, collection, getDocs, query, where, orderBy, limit, doc, getDoc } from "./firebase-init.js";
import { addToCart, updateCartCount } from "./cart.js";

console.log("🚀 PixelTech Store Iniciada");

/**
 * --- 1. MANEJO DE USUARIO ---
 */
onAuthStateChanged(auth, async (user) => {
    const userInfo = document.getElementById("user-info-global");
    if (!userInfo) return;
    
    if (user) {
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
        snap.forEach(doc => promos.push({ id: doc.id, ...doc.data() }));
        
        if (promos.length === 0) {
            container.innerHTML = `<p class="p-10 text-center text-gray-500 text-xs">No hay promociones activas</p>`;
            return;
        }

        let currentIdx = 0;
        const renderSlide = (idx) => {
            const p = promos[idx];
            const img = p.mainImage || p.image; // Prioriza mainImage
            container.innerHTML = `
                <div class="h-full w-full fade-in relative cursor-pointer" onclick="location.href='/shop/product.html?id=${p.id}'">
                    <img src="${img}" class="absolute inset-0 w-full h-full object-cover opacity-50 transition-transform duration-700 hover:scale-110">
                    <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>
                    <div class="relative z-10 p-6 h-full flex flex-col justify-end">
                        <span class="bg-brand-red text-white text-[7px] font-black px-2 py-1 rounded-full w-fit mb-3 uppercase tracking-widest">OFERTA ESPECIAL</span>
                        <h2 class="text-xl font-black text-white uppercase tracking-tighter mb-1 line-clamp-2 leading-tight">${p.name}</h2>
                        <p class="text-brand-cyan font-black text-sm">$${p.price.toLocaleString('es-CO')}</p>
                    </div>
                </div>`;
        };
        renderSlide(0);
        setInterval(() => { 
            currentIdx = (currentIdx + 1) % promos.length; 
            renderSlide(currentIdx); 
        }, 5000);
    } catch (e) { console.error("Error slider:", e); }
}

/**
 * --- 3. LANZAMIENTO (Banner Grande) ---
 */
async function loadNewLaunch() {
    const container = document.getElementById('new-launch-banner');
    if (!container) return;
    try {
        const q = query(collection(db, "products"), where("isNewLaunch", "==", true), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const p = snap.docs[0].data();
            const id = snap.docs[0].id;
            const img = p.mainImage || p.image;
            container.innerHTML = `
                <div class="relative h-full w-full group cursor-pointer" onclick="location.href='/shop/product.html?id=${id}'">
                    <img src="${img}" class="absolute inset-0 w-full h-full object-cover transition duration-1000 group-hover:scale-105">
                    <div class="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition duration-500"></div>
                    <div class="absolute bottom-0 left-0 p-12 z-10">
                        <p class="text-brand-cyan font-black text-[10px] uppercase tracking-[0.4em] mb-3">Novedad Exclusiva</p>
                        <h3 class="text-4xl lg:text-6xl font-black text-white uppercase tracking-tighter leading-none mb-6">${p.name}</h3>
                        <div class="flex items-center gap-10">
                            <span class="text-3xl font-black text-white">$${p.price.toLocaleString('es-CO')}</span>
                            <span class="bg-white text-brand-black px-8 py-3.5 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-brand-cyan transition">Ver Detalles</span>
                        </div>
                    </div>
                </div>`;
        }
    } catch (e) { console.error("Error lanzamiento:", e); }
}

/**
 * --- 4. HISTORIAL VISTO ---
 */
function loadViewHistory() {
    const container = document.getElementById('view-history-list');
    if (!container) return;
    const history = JSON.parse(localStorage.getItem('pixeltech_view_history')) || [];
    if (history.length === 0) return;
    
    container.innerHTML = "";
    history.slice(0, 5).forEach(p => {
        container.innerHTML += `
            <a href="/shop/product.html?id=${p.id}" class="flex items-center gap-3 shrink-0 bg-white p-2 rounded-2xl border border-gray-100 hover:shadow-md transition min-w-[200px]">
                <img src="${p.mainImage || p.image}" class="w-10 h-10 object-contain bg-slate-50 rounded-lg p-1 shrink-0">
                <div class="overflow-hidden">
                    <p class="text-[9px] font-bold text-brand-black truncate uppercase leading-tight">${p.name}</p>
                    <p class="text-brand-cyan font-black text-[9px] mt-0.5">$${p.price.toLocaleString('es-CO')}</p>
                </div>
            </a>`;
    });
}

/**
 * --- 5. ELECCIÓN SEMANAL ---
 */
async function loadWeeklyChoices() {
    const container = document.getElementById('weekly-choice-container');
    if (!container) return;
    try {
        const q = query(collection(db, "products"), where("originalPrice", ">", 0), limit(4));
        const snap = await getDocs(q);
        container.innerHTML = "";
        snap.forEach(docSnap => {
            const p = docSnap.data();
            container.innerHTML += `
                <a href="/shop/product.html?id=${docSnap.id}" class="flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-50 transition border border-transparent hover:border-gray-100 group">
                    <img src="${p.mainImage || p.image}" class="w-14 h-14 object-contain shrink-0 group-hover:scale-110 transition">
                    <div class="overflow-hidden">
                        <p class="text-[10px] font-bold text-brand-black uppercase truncate">${p.name}</p>
                        <p class="text-[11px] font-black text-brand-red">$${p.price.toLocaleString('es-CO')}</p>
                    </div>
                </a>`;
        });
    } catch (e) { console.error(e); }
}

/**
 * --- 6. ESPECIALES Y CATÁLOGO ---
 */
async function loadPromotionsGrid() {
    const grid = document.getElementById('promo-products-grid');
    if (!grid) return;
    try {
        const q = query(collection(db, "products"), where("originalPrice", ">", 0), limit(5));
        const snap = await getDocs(q);
        grid.innerHTML = "";
        snap.forEach(docSnap => {
            const p = docSnap.data();
            const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
            const card = document.createElement('div');
            card.className = "bg-white rounded-[2rem] p-5 border border-gray-100 shadow-sm hover:shadow-2xl transition-all group relative flex flex-col";
            card.innerHTML = `
                <span class="absolute top-4 left-4 z-20 bg-brand-red text-white text-[8px] font-black px-3 py-1 rounded-full uppercase shadow-lg">-${disc}%</span>
                <div class="h-44 bg-brand-surface rounded-2xl overflow-hidden mb-5 flex items-center justify-center p-4">
                    <img src="${p.mainImage || p.image}" class="w-full h-full object-contain group-hover:scale-110 transition duration-700">
                </div>
                <p class="text-[9px] font-black text-brand-cyan uppercase mb-1">${p.category || 'PixelTech'}</p>
                <h3 class="font-bold text-xs text-brand-black mb-4 line-clamp-1 uppercase">${p.name}</h3>
                <div class="mt-auto flex justify-between items-end">
                    <div>
                        <p class="text-gray-300 text-[10px] line-through font-bold leading-none">$${p.originalPrice.toLocaleString('es-CO')}</p>
                        <p class="font-black text-brand-black text-lg">$${p.price.toLocaleString('es-CO')}</p>
                    </div>
                    <button class="add-cart-btn w-10 h-10 rounded-xl bg-brand-black text-white hover:bg-brand-cyan transition shadow-lg"><i class="fa-solid fa-plus text-xs"></i></button>
                </div>`;
            card.querySelector('.add-cart-btn').onclick = () => { addToCart({ id: docSnap.id, ...p }); updateCartCount(); };
            grid.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

async function loadProducts() {
    const grid = document.getElementById("products-grid");
    if (!grid) return;
    try {
        const snap = await getDocs(query(collection(db, "products"), orderBy("name", "asc"), limit(12)));
        grid.innerHTML = "";
        snap.forEach(docSnap => {
            const p = docSnap.data();
            const card = document.createElement('div');
            card.className = "bg-white rounded-[2rem] border border-gray-100 hover:shadow-2xl transition-all duration-500 group flex flex-col overflow-hidden p-6 shadow-sm";
            card.innerHTML = `
                <div class="relative h-56 bg-brand-surface rounded-2xl overflow-hidden mb-6 flex items-center justify-center p-6 cursor-pointer" onclick="location.href='/shop/product.html?id=${docSnap.id}'">
                    <img src="${p.mainImage || p.image}" alt="${p.name}" class="w-full h-full object-contain group-hover:scale-110 transition duration-700">
                </div>
                <div class="flex flex-col flex-grow">
                    <p class="text-[9px] font-black text-brand-cyan uppercase tracking-widest mb-2">${p.category || 'Tecnología'}</p>
                    <h3 class="font-black text-sm text-brand-black mb-4 line-clamp-2 min-h-[40px] uppercase">${p.name}</h3>
                    <div class="mt-auto flex justify-between items-center">
                        <span class="text-brand-black font-black text-xl">$${p.price.toLocaleString('es-CO')}</span>
                        <button class="add-btn w-12 h-12 rounded-2xl bg-brand-black text-white hover:bg-brand-cyan transition-all shadow-xl flex items-center justify-center"><i class="fa-solid fa-cart-plus"></i></button>
                    </div>
                </div>`;
            card.querySelector('.add-btn').onclick = () => { addToCart({ id: docSnap.id, ...p }); updateCartCount(); };
            grid.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

/**
 * --- 7. INICIALIZACIÓN ---
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