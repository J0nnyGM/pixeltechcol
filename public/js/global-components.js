import { auth, db, onAuthStateChanged, doc, getDoc, collection, getDocs, query, orderBy } from "./firebase-init.js";

/**
 * Inyecta todos los componentes de navegación global con el nuevo logo imponente
 */
export function loadGlobalHeader() {
    const headerContainer = document.getElementById('global-header');
    if (!headerContainer) return;

    headerContainer.innerHTML = `
    <div class="hidden lg:block bg-slate-950 text-gray-400 text-[10px] py-2 border-b border-white/5">
        <div class="container mx-auto px-6 flex justify-between items-center font-black uppercase tracking-widest">
            <div class="flex gap-6">
                <span class="flex items-center gap-2 text-brand-cyan">
                    <i class="fa-solid fa-bolt animate-pulse"></i> Despacho Express Hoy
                </span>
                <span class="flex items-center gap-2">
                    <i class="fa-solid fa-headset text-brand-cyan"></i> Soporte Premium
                </span>
            </div>
            <div class="flex gap-6">
                <a href="/profile.html" class="hover:text-white transition flex items-center gap-2">
                    <i class="fa-solid fa-location-dot"></i> Rastrea tu pedido
                </a>
            </div>
        </div>
    </div>

    <header class="bg-brand-black text-white py-4 md:py-5 sticky top-0 z-50 shadow-2xl">
        <div class="container mx-auto px-4 md:px-6">
            <div class="flex items-center justify-between gap-4 md:gap-8">
                
                <button id="mobile-menu-open" class="lg:hidden w-11 h-11 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl text-brand-cyan hover:bg-brand-cyan hover:text-brand-black transition">
                    <i class="fa-solid fa-bars-staggered text-xl"></i>
                </button>

                <a href="/" class="flex items-center group shrink-0">
                    <div class="relative flex items-center">
                        <div class="absolute inset-0 bg-brand-cyan/15 blur-2xl rounded-full group-hover:bg-brand-cyan/30 transition-all duration-500"></div>
                        <img src="/img/logo.png" alt="PixelTech" 
                             class="h-10 md:h-16 lg:h-20 w-auto object-contain relative z-10 drop-shadow-[0_0_15px_rgba(0,229,255,0.2)]">
                    </div>
                </a>

                <div class="hidden lg:block flex-grow max-w-2xl">
                    <div class="relative group">
                        <input type="text" id="search-desktop" placeholder="¿Qué equipo necesitas hoy?..." 
                               class="w-full bg-slate-900 border-2 border-slate-800 text-white px-6 py-4 rounded-2xl outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 transition-all font-medium placeholder-gray-600 shadow-inner text-sm">
                        <button class="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-brand-cyan transition">
                            <i class="fa-solid fa-magnifying-glass text-lg"></i>
                        </button>
                    </div>
                </div>

                <div class="flex items-center gap-3 md:gap-6 shrink-0">
                    <a href="https://wa.me/tu_numero" target="_blank" class="hidden md:flex flex-col items-center gap-1 group w-14">
                        <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-green-500 group-hover:text-white transition duration-300">
                            <i class="fa-brands fa-whatsapp text-xl"></i>
                        </div>
                        <span class="text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-green-500 text-center">Chat</span>
                    </a>

                    <div id="user-info-global" class="hidden lg:block w-14"></div>

                    <a href="/shop/cart.html" class="flex flex-col items-center gap-1 group w-10 md:w-14">
                        <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center relative group-hover:bg-brand-red group-hover:text-white transition duration-300">
                            <i class="fa-solid fa-cart-shopping text-lg md:text-xl text-white"></i>
                            <span id="cart-count-global" class="absolute -top-1.5 -right-1.5 bg-brand-red text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-brand-black shadow-md z-10">0</span>
                        </div>
                        <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-gray-400 group-hover:text-brand-red text-center">Carrito</span>
                    </a>
                </div>
            </div>
        </div>
    </header>

    <div class="lg:hidden bg-brand-black py-3 px-4 sticky top-[77px] md:top-[92px] z-40 border-t border-white/5 shadow-xl">
        <div class="relative group">
            <input type="text" id="search-mobile" placeholder="¿Qué buscas hoy en PixelTech?..." 
                   class="w-full bg-slate-900 border border-slate-800 text-white px-5 py-3 rounded-xl outline-none focus:border-brand-cyan text-xs font-bold transition-all shadow-inner">
            <i class="fa-solid fa-magnifying-glass absolute right-4 top-1/2 -translate-y-1/2 text-brand-cyan text-sm"></i>
        </div>
    </div>

    <nav class="hidden lg:block bg-brand-cyan py-3 shadow-lg z-40 relative border-b border-white/20">
        <div class="container mx-auto px-6">
            <ul id="dynamic-nav" class="flex gap-10 text-[11px] font-black uppercase tracking-[0.2em] justify-center lg:justify-start overflow-x-auto no-scrollbar whitespace-nowrap text-white">
                <li class="flex items-center gap-2">
                    <i class="fa-solid fa-circle-notch fa-spin"></i> Cargando Categorías...
                </li>
            </ul>
        </div>
    </nav>

    <div id="mobile-menu-drawer" class="fixed inset-0 z-[100] translate-x-[-100%] transition-transform duration-500 ease-in-out">
        <div id="mobile-menu-overlay" class="absolute inset-0 bg-brand-black/80 backdrop-blur-sm"></div>
        <div class="relative w-[85%] max-w-sm h-full bg-white flex flex-col shadow-2xl">
            <div class="p-6 bg-brand-black flex justify-between items-center">
                <img src="/img/logo.png" class="h-10 w-auto" alt="PixelTech">
                <button id="mobile-menu-close" class="text-brand-cyan text-xl hover:scale-110 transition"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="flex border-b border-gray-100">
                <button class="menu-tab-btn active flex-1 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 border-transparent transition" data-tab="tab-categories">Categorías</button>
                <button class="menu-tab-btn flex-1 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 border-transparent transition" data-tab="tab-navigation">Menú</button>
            </div>

            <div id="tab-categories" class="menu-tab-content active flex-grow overflow-y-auto p-4 space-y-2">
                <div id="categories-mobile-list" class="space-y-1"></div>
            </div>

            <div id="tab-navigation" class="menu-tab-content hidden flex-grow overflow-y-auto p-6 space-y-6">
                <div class="space-y-4">
                    <a href="/profile.html" class="flex items-center gap-4 font-bold text-sm text-gray-600 hover:text-brand-cyan transition"><i class="fa-solid fa-user-circle text-lg"></i> Mi Perfil / Pedidos</a>
                    <a href="#" class="flex items-center gap-4 font-bold text-sm text-gray-600"><i class="fa-solid fa-headset text-lg"></i> Soporte Premium</a>
                    <a href="#" class="flex items-center gap-4 font-bold text-sm text-gray-600"><i class="fa-solid fa-circle-info text-lg"></i> Sobre PixelTech</a>
                </div>
            </div>
            
            <div class="p-6 border-t border-gray-50 bg-gray-50/50">
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-[0.3em] text-center italic">PixelTech 2026 — Bogotá, CO</p>
            </div>
        </div>
    </div>

    <style>
        .menu-tab-btn.active { border-color: #00AEC7; color: #00AEC7; }
        .menu-tab-content.hidden { display: none; }
    </style>
    `;

    initHeaderLogic();
}

function initHeaderLogic() {
    const drawer = document.getElementById('mobile-menu-drawer');
    const btnOpen = document.getElementById('mobile-menu-open');
    const btnClose = document.getElementById('mobile-menu-close');
    const overlay = document.getElementById('mobile-menu-overlay');

    const toggleMenu = () => {
        if(!drawer) return;
        drawer.classList.toggle('translate-x-[-100%]');
        drawer.classList.toggle('translate-x-0');
    };
    if(btnOpen) btnOpen.onclick = toggleMenu;
    if(btnClose) btnClose.onclick = toggleMenu;
    if(overlay) overlay.onclick = toggleMenu;

    const tabs = document.querySelectorAll('.menu-tab-btn');
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.menu-tab-content').forEach(c => c.classList.add('hidden'));
            const target = document.getElementById(tab.dataset.tab);
            if(target) target.classList.remove('hidden');
        };
    });

    syncAllCategories();

    const updateCart = () => {
        const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
        const countEl = document.getElementById('cart-count-global');
        if (countEl) countEl.textContent = cart.reduce((acc, i) => acc + (i.quantity || 1), 0);
    };
    updateCart();

    onAuthStateChanged(auth, async (user) => {
        const container = document.getElementById('user-info-global');
        if (!container) return;

        // Nota: Como el contenedor ahora tiene "hidden lg:block", este código solo
        // afectará visualmente a la versión de escritorio.
        if (user) {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            const isAdmin = userSnap.exists() && userSnap.data().role === 'admin';
            const label = isAdmin ? 'Admin' : 'Cuenta';

            container.innerHTML = `
                <a href="${isAdmin ? '/admin/index.html' : '/profile.html'}" class="flex flex-col items-center gap-1 group w-14">
                    <div class="w-12 h-12 rounded-2xl bg-brand-cyan text-brand-black flex items-center justify-center shadow-lg transition duration-300">
                        <i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-user-check'} text-xl"></i>
                    </div>
                    <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-brand-cyan text-center">${label}</span>
                </a>`;
        } else {
            container.innerHTML = `
                <a href="/auth/login.html" class="flex flex-col items-center gap-1 group w-14">
                    <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-brand-cyan transition duration-300 shadow-lg">
                        <i class="fa-regular fa-user text-xl text-white group-hover:text-brand-black"></i>
                    </div>
                    <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-brand-cyan text-center">Ingresar</span>
                </a>`;
        }
    });

    const handleSearch = (e) => {
        if (e.key === 'Enter') {
            const queryVal = e.target.value.trim();
            if (queryVal) window.location.href = `/shop/search.html?q=${encodeURIComponent(queryVal)}`;
        }
    };
    document.getElementById('search-desktop')?.addEventListener('keypress', handleSearch);
    document.getElementById('search-mobile')?.addEventListener('keypress', handleSearch);
}

/**
 * Carga las categorías desde Firebase e inyecta manualmente la opción "TODOS"
 */
async function syncAllCategories() {
    const desktopNav = document.getElementById('dynamic-nav');
    const mobileList = document.getElementById('categories-mobile-list');

    try {
        const q = query(collection(db, "categories"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        
        if(desktopNav) {
            desktopNav.innerHTML = `
                <li><a href="/index.html" class="hover:text-brand-black transition duration-300">TODOS</a></li>
            `;
        }
        if(mobileList) {
            mobileList.innerHTML = `
                <a href="/index.html" class="flex items-center justify-between p-4 bg-gray-50 rounded-2xl hover:bg-brand-cyan/10 group transition duration-300 mb-2">
                    <span class="font-bold text-xs text-gray-700 group-hover:text-brand-cyan uppercase tracking-tight">TODOS LOS PRODUCTOS</span>
                    <i class="fa-solid fa-chevron-right text-[10px] text-gray-300 group-hover:text-brand-cyan"></i>
                </a>
            `;
        }

        snap.forEach(docSnap => {
            const cat = docSnap.data();
            const url = `/shop/category.html?id=${docSnap.id}`;

            if(desktopNav) {
                desktopNav.innerHTML += `
                    <li><a href="${url}" class="hover:text-brand-black transition duration-300">${cat.name}</a></li>
                `;
            }

            if(mobileList) {
                mobileList.innerHTML += `
                    <a href="${url}" class="flex items-center justify-between p-4 bg-gray-50 rounded-2xl hover:bg-brand-cyan/10 group transition duration-300 mb-2">
                        <span class="font-bold text-xs text-gray-700 group-hover:text-brand-cyan uppercase tracking-tight">${cat.name}</span>
                        <i class="fa-solid fa-chevron-right text-[10px] text-gray-300 group-hover:text-brand-cyan"></i>
                    </a>
                `;
            }
        });
    } catch (e) {
        console.error("Error al sincronizar categorías:", e);
    }
}

export function loadGlobalFooter() {
    const footerContainer = document.getElementById('global-footer');
    if (!footerContainer) return;

    footerContainer.innerHTML = `
    <footer class="bg-brand-black text-white pt-20 pb-10 border-t border-white/5">
        <div class="container mx-auto px-6">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
                
                <div class="space-y-6">
                    <img src="/img/logo.png" alt="PixelTech" class="h-10 opacity-90">
                    <p class="text-gray-500 text-xs leading-relaxed uppercase font-medium tracking-wider">
                        Líder en tecnología.
                    </p>
                    <div class="flex gap-4 text-gray-400">
                        <a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-instagram text-lg"></i></a>
                        <a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-facebook text-lg"></i></a>
                        <a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-x-twitter text-lg"></i></a>
                    </div>
                </div>

                <div>
                    <h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Explorar</h4>
                    <ul class="space-y-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        <li><a href="/index.html" class="hover:text-white transition">Inicio</a></li>
                        <li><a href="/shop/catalog.html" class="hover:text-white transition">Catálogo Completo</a></li>
                        <li><a href="/shop/promos.html" class="hover:text-white transition">Ofertas Especiales</a></li>
                        <li><a href="/profile.html" class="hover:text-white transition">Mi Cuenta</a></li>
                    </ul>
                </div>

                <div>
                    <h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Soporte Pro</h4>
                    <ul class="space-y-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        <li><a href="#" class="hover:text-white transition">Rastreo de Pedido</a></li>
                        <li><a href="#" class="hover:text-white transition">Garantía Extendida</a></li>
                        <li><a href="#" class="hover:text-white transition">Preguntas Frecuentes</a></li>
                        <li><a href="#" class="hover:text-white transition">Términos de Servicio</a></li>
                    </ul>
                </div>

                <div>
                    <h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Contacto Directo</h4>
                    <div class="space-y-4">
                        <a href="https://wa.me/573000000000" class="flex items-center gap-3 group">
                            <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-brand-cyan/20 transition">
                                <i class="fa-brands fa-whatsapp text-brand-cyan"></i>
                            </div>
                            <span class="text-[10px] font-black uppercase tracking-widest text-gray-400">WhatsApp Business</span>
                        </a>
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                                <i class="fa-solid fa-envelope text-gray-500"></i>
                            </div>
                            <span class="text-[10px] font-black uppercase tracking-widest text-gray-400">soporte@pixeltech.com</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="border-t border-white/5 pt-10 flex flex-col md:flex-row justify-between items-center gap-6">
                <p class="text-[9px] font-black uppercase tracking-[0.4em] text-gray-600">
                    © 2026 PIXELTECH — GLOBAL TECHNOLOGY LEADER.
                </p>
                <div class="flex gap-6 grayscale opacity-30">
                    <img src="https://img.icons8.com/color/48/visa.png" class="h-5">
                    <img src="https://img.icons8.com/color/48/mastercard.png" class="h-5">
                    <img src="https://img.icons8.com/color/48/paypal.png" class="h-5">
                </div>
            </div>
        </div>
    </footer>`;
}