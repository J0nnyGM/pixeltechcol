    import { auth, db, onAuthStateChanged, doc, getDoc, collection, getDocs, query, orderBy, where, limit } from "./firebase-init.js";
    import { updateQuantity } from "./cart.js";
    

    /**
     * Inyecta Header, Footer, Menús y Herramientas Flotantes (Y EL MINI CARRITO)
     */
    export function loadGlobalHeader() {
        const headerContainer = document.getElementById('global-header');
        if (!headerContainer) return;

        document.body.classList.add('pb-20', 'lg:pb-0');

        // 1. Estilos Dinámicos (Sin cambios)
        const styles = document.createElement('style');
        styles.innerHTML = `
            @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
            .animate-marquee { display: flex; width: max-content; animation: marquee 40s linear infinite; }
            .marquee-container:hover .animate-marquee { animation-play-state: paused; }
            .drawer-shadow { box-shadow: -10px 0 30px rgba(0,0,0,0.2); }
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .menu-tab-btn.active { border-color: #00AEC7; color: #00AEC7; }
            .menu-tab-content.hidden { display: none; }
            .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
            .animate-bounce-slow { animation: bounce 3s infinite; }
            .animate-in-up { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
            @keyframes slideUp { from { transform: translateY(20px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
            .smooth-drawer { transition-property: transform, opacity, visibility; transition-duration: 500ms; transition-timing-function: cubic-bezier(0.19, 1, 0.22, 1); will-change: transform; }
            
            #toast-container { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
            .toast { pointer-events: auto; background: white; padding: 12px 20px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); display: flex; items-center; gap: 12px; transform: translateX(100%); opacity: 0; transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); border-left: 4px solid #00AEC7; max-width: 350px; }
            .toast.show { transform: translateX(0); opacity: 1; }
            .toast.error { border-left-color: #EF4444; }
            .toast-icon { font-size: 18px; }
            .toast-msg { font-size: 12px; font-weight: 800; color: #171717; text-transform: uppercase; letter-spacing: 0.05em; }

            .search-dropdown { position: absolute; top: 100%; left: 0; width: 100%; background: white; border-radius: 0 0 20px 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); z-index: 50; overflow: hidden; display: none; margin-top: 2px; border: 1px solid #f3f4f6; }
            .search-dropdown.active { display: block; animation: slideDown 0.2s ease-out; }
            @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            .search-result-item { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #f9fafb; cursor: pointer; transition: background 0.2s; }
            .search-result-item:hover { background-color: #f0fdfa; }
            .search-result-item:last-child { border-bottom: none; }
        `;
        document.head.appendChild(styles);

        const toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);

        // 2. HTML ESTRUCTURAL (Sin cambios)
        headerContainer.innerHTML = `
        <div class="fixed top-1/2 right-0 -translate-y-1/2 z-40 hidden md:flex flex-col gap-2 items-end">
            <a href="https://www.facebook.com/pixeltech.col" target="_blank" class="w-10 h-10 bg-[#1877F2] text-white flex items-center justify-center rounded-l-xl hover:w-14 transition-all duration-300 shadow-lg relative overflow-hidden group"><i class="fa-brands fa-facebook-f text-lg absolute right-3"></i></a>
            <a href="https://www.instagram.com/pixeltech.col/" target="_blank" class="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center rounded-l-xl hover:w-14 transition-all duration-300 shadow-lg relative overflow-hidden group"><i class="fa-brands fa-instagram text-xl absolute right-2.5"></i></a>
            <a href="https://www.tiktok.com/@pixeltech.col" target="_blank" class="w-10 h-10 bg-black text-white flex items-center justify-center rounded-l-xl hover:w-14 transition-all duration-300 shadow-lg border border-gray-800 relative overflow-hidden group"><i class="fa-brands fa-tiktok text-lg absolute right-3"></i></a>
        
        
            </div>



        <div id="wa-overlay" class="fixed inset-0 z-[59] hidden" onclick="window.toggleWhatsAppModal()"></div>
        <div id="wa-modal" class="fixed z-[60] hidden animate-in-up origin-bottom-right w-[90%] max-w-[380px] bottom-24 right-4 lg:w-[400px] lg:bottom-10 lg:right-24">
            <div class="bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-gray-100 relative">
                <div class="bg-gradient-to-r from-[#25D366] to-[#075E54] p-6 relative overflow-hidden">
                    <i class="fa-brands fa-whatsapp absolute -bottom-4 -right-4 text-8xl text-white opacity-20 transform rotate-12"></i>
                    <div class="relative z-10 flex justify-between items-start">
                        <div><h3 class="font-black text-xl text-white tracking-tight">Hola, ¿En qué te ayudamos? 👋</h3><p class="text-green-100 text-xs font-medium mt-1">Selecciona un área para chatear ahora.</p></div>
                        <button onclick="window.toggleWhatsAppModal()" class="bg-white/20 hover:bg-white/30 text-white rounded-full w-8 h-8 flex items-center justify-center transition backdrop-blur-sm"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="p-5 space-y-3 bg-white">
                    <a href="https://wa.me/573009046450" target="_blank" class="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-green-50 hover:border-green-200 hover:shadow-md transition-all group cursor-pointer">
                        <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center text-green-500 shadow-sm group-hover:scale-110 transition border border-gray-100"><i class="fa-solid fa-headset text-lg"></i></div>
                        <div><p class="font-black text-sm text-gray-800 uppercase tracking-wide group-hover:text-green-700 transition">Ventas Online 1</p><p class="text-[10px] text-gray-400 font-medium">Consultas y disponibilidad</p></div>
                        <i class="fa-brands fa-whatsapp text-2xl text-gray-200 ml-auto group-hover:text-green-500 transition"></i>
                    </a>
                    <a href="https://wa.me/573159834171" target="_blank" class="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-green-50 hover:border-green-200 hover:shadow-md transition-all group cursor-pointer">
                        <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center text-green-500 shadow-sm group-hover:scale-110 transition border border-gray-100"><i class="fa-solid fa-bag-shopping text-lg"></i></div>
                        <div><p class="font-black text-sm text-gray-800 uppercase tracking-wide group-hover:text-green-700 transition">Ventas Online 2</p><p class="text-[10px] text-gray-400 font-medium">Asesor Comercial</p></div>
                        <i class="fa-brands fa-whatsapp text-2xl text-gray-200 ml-auto group-hover:text-green-500 transition"></i>
                    </a>
                    <a href="https://wa.me/573159834171" target="_blank" class="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-blue-50 hover:border-blue-200 hover:shadow-md transition-all group cursor-pointer">
                        <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center text-blue-500 shadow-sm group-hover:scale-110 transition border border-gray-100"><i class="fa-solid fa-screwdriver-wrench text-lg"></i></div>
                        <div><p class="font-black text-sm text-gray-800 uppercase tracking-wide group-hover:text-blue-700 transition">Soporte Técnico</p><p class="text-[10px] text-gray-400 font-medium">Garantías y ayuda</p></div>
                        <i class="fa-brands fa-whatsapp text-2xl text-gray-200 ml-auto group-hover:text-blue-500 transition"></i>
                    </a>
                </div>
                <div class="bg-gray-50 p-3 text-center border-t border-gray-100"><p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Respuesta habitual: &lt; 5 minutos</p></div>
            </div>
        </div>

        <button onclick="window.toggleWhatsAppModal()" class="fixed bottom-24 lg:bottom-10 right-6 z-50 w-14 h-14 bg-[#25D366] text-white rounded-full shadow-xl flex items-center justify-center hover:scale-110 hover:shadow-2xl transition-all duration-300 group">
            <i class="fa-brands fa-whatsapp text-3xl group-hover:animate-none animate-bounce-slow"></i>
            <span class="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
        </button>

        <div id="top-banner-dynamic" class="hidden lg:block bg-slate-950 text-gray-400 text-[10px] py-2 border-b border-white/5 overflow-hidden marquee-container">
            <div class="container mx-auto px-6 flex justify-center items-center">
                <i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i>
            </div>
        </div>

        <header class="bg-brand-black text-white py-4 md:py-5 sticky top-0 z-40 shadow-xl lg:shadow-2xl">
            <div class="container mx-auto px-4 md:px-6">
                <div class="flex items-center justify-between gap-4 md:gap-8">
                    
                    <a href="/" class="flex items-center group shrink-0 mx-auto lg:mx-0">
                        <div class="relative flex items-center">
                            <div class="absolute inset-0 bg-brand-cyan/15 blur-2xl rounded-full group-hover:bg-brand-cyan/30 transition-all duration-500"></div>
                            <img src="/img/logo.png" alt="PixelTech" 
                                class="h-12 md:h-16 lg:h-20 w-auto object-contain relative z-10 drop-shadow-[0_0_15px_rgba(0,229,255,0.2)]">
                        </div>
                    </a>

                    <div class="hidden lg:block flex-grow max-w-2xl relative z-50">
                        <div class="relative group">
                            <input type="text" id="search-desktop" autocomplete="off" placeholder="¿Qué equipo necesitas hoy?..." 
                                class="w-full bg-slate-900 border-2 border-slate-800 text-white px-6 py-4 rounded-2xl outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 transition-all font-medium placeholder-gray-600 shadow-inner text-sm relative z-10">
                            <button class="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-brand-cyan transition z-20">
                                <i class="fa-solid fa-magnifying-glass text-lg"></i>
                            </button>
                            <div id="search-results-desktop" class="search-dropdown"></div>
                        </div>
                    </div>

                    <div class="hidden lg:flex items-center gap-3 md:gap-6 shrink-0">
                        <a href="https://wa.me/573009046450" target="_blank" class="flex flex-col items-center gap-1 group w-14">
                            <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-green-500 group-hover:text-white transition duration-300"><i class="fa-brands fa-whatsapp text-xl"></i></div>
                            <span class="text-[8px] font-black uppercase tracking-widest text-gray-400 group-hover:text-green-500 text-center">Chat</span>
                        </a>
                        <div id="user-info-desktop" class="w-14"></div>
                        
                        <button onclick="window.toggleCartDrawer()" class="flex flex-col items-center gap-1 group w-14">
                            <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center relative group-hover:bg-brand-red group-hover:text-white transition duration-300">
                                <i class="fa-solid fa-cart-shopping text-xl text-white"></i>
                                <span id="cart-count-desktop" class="absolute -top-1.5 -right-1.5 bg-brand-red text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-brand-black shadow-md z-10 hidden">0</span>
                            </div>
                            <span class="text-[8px] font-black uppercase tracking-widest text-gray-400 group-hover:text-brand-red text-center">Carrito</span>
                        </button>
                    </div>
                </div>
            </div>
        </header>

        <div class="lg:hidden bg-brand-black py-3 px-4 sticky top-[80px] z-30 border-t border-white/5 shadow-md">
            <div class="relative group z-50">
                <input type="text" id="search-mobile" autocomplete="off" placeholder="Buscar productos..." 
                    class="w-full bg-slate-900 border-2 border-slate-800 text-white px-5 py-3 rounded-xl outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20 text-xs font-bold transition-all placeholder-gray-500 relative z-10">
                <i class="fa-solid fa-magnifying-glass absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm group-focus-within:text-brand-cyan z-20"></i>
                <div id="search-results-mobile" class="search-dropdown"></div>
            </div>
        </div>

        <nav class="hidden lg:block bg-brand-cyan py-3 shadow-lg z-30 relative border-b border-white/20">
            <div class="container mx-auto px-6">
                <ul class="flex gap-10 text-[11px] font-black uppercase tracking-[0.2em] justify-start overflow-x-auto no-scrollbar whitespace-nowrap text-white">
                    <li><a href="/index.html" class="hover:text-brand-black transition duration-300">Inicio</a></li>
                    <li><a href="/categories.html" class="hover:text-brand-black transition duration-300">Categorías</a></li>
                    <li><a href="/brands.html" class="hover:text-brand-black transition duration-300">Marcas</a></li>
                    <li><a href="/shop/catalog.html?mode=promos" class="hover:text-brand-black transition duration-300">Ofertas</a></li>
                </ul>
            </div>
        </nav>

        <nav class="lg:hidden fixed bottom-0 left-0 w-full bg-white/95 backdrop-blur-md border-t border-gray-100 z-50 flex justify-around items-center pb-safe shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
            <a href="/" class="nav-item flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
                <i class="fa-solid fa-house text-xl mb-1"></i>
                <span class="text-[9px] font-bold">Inicio</span>
            </a>
            <button id="mobile-categories-btn" class="nav-item flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
                <i class="fa-solid fa-layer-group text-xl mb-1"></i>
                <span class="text-[9px] font-bold">Categorías</span>
            </button>
            <button onclick="window.toggleCartDrawer()" class="nav-item relative flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
                <div class="relative">
                    <i class="fa-solid fa-cart-shopping text-xl mb-1"></i>
                    <span id="cart-count-mobile" class="absolute -top-2 -right-2 bg-brand-red text-white text-[8px] font-black w-4 h-4 flex items-center justify-center rounded-full hidden">0</span>
                </div>
                <span class="text-[9px] font-bold">Carrito</span>
            </button>
            <a href="/profile.html" id="mobile-profile-link" class="nav-item flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
                <i class="fa-regular fa-user text-xl mb-1"></i>
                <span class="text-[9px] font-bold">Perfil</span>
            </a>
            <button id="mobile-menu-btn" class="nav-item flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
                <i class="fa-solid fa-bars text-xl mb-1"></i>
                <span class="text-[9px] font-bold">Menú</span>
            </button>
        </nav>

        <div id="mobile-menu-drawer" class="fixed inset-0 z-[100] translate-x-[-100%] transition-transform duration-300 ease-out lg:hidden">
            <div id="mobile-menu-overlay" class="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-0 transition-opacity duration-300"></div>
            <div class="relative w-[85%] max-w-sm h-full bg-white flex flex-col shadow-2xl">
                <div class="p-6 bg-brand-black flex justify-between items-center shrink-0">
                    <img src="/img/logo.png" class="h-10 w-auto" alt="PixelTech">
                    <button id="mobile-drawer-close" class="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-brand-cyan hover:text-black transition">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                
                <div class="flex border-b border-gray-100 shrink-0">
                    <button class="menu-tab-btn active flex-1 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 border-transparent transition" data-tab="tab-categories">Categorías</button>
                    <button class="menu-tab-btn flex-1 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 border-transparent transition" data-tab="tab-menu">Mi Cuenta</button>
                </div>

                <div id="tab-categories" class="menu-tab-content active flex-grow overflow-y-auto p-4 space-y-2 no-scrollbar">
                    <div id="categories-mobile-list" class="space-y-1"></div>
                </div>

                <div id="tab-menu" class="menu-tab-content hidden flex-grow overflow-y-auto p-6 space-y-6 no-scrollbar">
                    
                    <div class="space-y-2">
                        <p class="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-3">Panel de Usuario</p>
                        
                        <a href="/profile.html" class="flex items-center gap-4 p-3 rounded-xl bg-slate-50 border border-gray-100 hover:border-brand-cyan/30 transition group">
                            <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-cyan shadow-sm border border-gray-50"><i class="fa-solid fa-box-open text-xs"></i></div>
                            <span class="font-bold text-xs text-brand-black uppercase tracking-tight group-hover:text-brand-cyan transition">Mis Pedidos</span>
                        </a>

                        <a href="/profile.html" class="flex items-center gap-4 p-3 rounded-xl bg-slate-50 border border-gray-100 hover:border-brand-cyan/30 transition group">
                            <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-cyan shadow-sm border border-gray-50"><i class="fa-regular fa-id-card text-xs"></i></div>
                            <span class="font-bold text-xs text-brand-black uppercase tracking-tight group-hover:text-brand-cyan transition">Datos Personales</span>
                        </a>

                        <a href="/profile.html" class="flex items-center gap-4 p-3 rounded-xl bg-slate-50 border border-gray-100 hover:border-brand-cyan/30 transition group">
                            <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-cyan shadow-sm border border-gray-50"><i class="fa-solid fa-map-location-dot text-xs"></i></div>
                            <span class="font-bold text-xs text-brand-black uppercase tracking-tight group-hover:text-brand-cyan transition">Direcciones</span>
                        </a>
                    </div>

                    <div class="space-y-2 pt-2 border-t border-dashed border-gray-100">
                        <p class="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-3">Ayuda</p>
                        <a href="#" onclick="window.toggleWhatsAppModal()" class="flex items-center gap-4 p-3 rounded-xl bg-green-50 border border-green-100 transition group">
                            <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-green-500 shadow-sm"><i class="fa-brands fa-whatsapp text-sm"></i></div>
                            <span class="font-bold text-xs text-green-700 uppercase tracking-tight group-hover:text-green-800">Chat Soporte</span>
                        </a>
                    </div>

                </div>

                <div class="p-4 border-t border-gray-50 bg-gray-50/50 text-center shrink-0">
                    <p class="text-[8px] font-black text-gray-300 uppercase tracking-[0.3em]">PixelTech v2.0</p>
                </div>
            </div>
        </div>

        <div id="cart-drawer-container" class="fixed inset-0 z-[100] pointer-events-none">
            <div id="cart-overlay" class="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-0 transition-opacity duration-500 pointer-events-auto" style="display: none;" onclick="window.toggleCartDrawer()"></div>
            <div id="cart-drawer" class="absolute right-0 top-0 w-full max-w-[400px] h-full bg-white shadow-2xl flex flex-col drawer-shadow translate-x-full smooth-drawer pointer-events-auto">
                <div class="p-6 bg-white border-b border-gray-100 flex justify-between items-center z-10 relative">
                    <h3 class="font-black text-lg uppercase tracking-tight flex items-center gap-3"><i class="fa-solid fa-bag-shopping text-brand-cyan"></i> Mi Carrito</h3>
                    <button onclick="window.toggleCartDrawer()" class="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-brand-red hover:text-white transition"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div id="cart-shipping-bar" class="px-6 py-3 bg-slate-50 border-b border-gray-100">
                    <p id="shipping-msg" class="text-[9px] font-bold text-gray-500 uppercase tracking-wide text-center mb-2">Calculando envío...</p>
                    <div class="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden"><div id="shipping-progress" class="h-full bg-brand-cyan transition-all duration-500 w-0"></div></div>
                </div>
                <div id="cart-drawer-items" class="flex-grow overflow-y-auto p-6 space-y-4 no-scrollbar relative"></div>
                <div class="p-6 border-t border-gray-100 bg-white z-10 relative">
                    <div class="flex justify-between items-end mb-4"><span class="text-[10px] font-black uppercase text-gray-400 tracking-widest">Subtotal</span><span id="cart-drawer-total" class="text-2xl font-black text-brand-black tracking-tight">$0</span></div>
                    <div class="grid grid-cols-2 gap-3">
                        <a href="/shop/cart.html" class="py-4 rounded-xl border border-gray-200 text-brand-black font-black uppercase text-[10px] tracking-widest flex items-center justify-center hover:border-brand-black transition">Ver Carrito</a>
                        <button id="btn-checkout-drawer" onclick="window.location.href='/shop/checkout.html'" class="py-4 rounded-xl bg-brand-black text-white font-black uppercase text-[10px] tracking-widest flex items-center justify-center hover:bg-brand-cyan hover:text-brand-black transition shadow-lg shadow-cyan-500/10">Pagar Ahora</button>
                    </div>
                </div>
            </div>
        </div>
        `;

        initHeaderLogic();
        initSearchLogic();
    }

    window.showToast = (msg, type = 'success') => {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let icon = '<i class="fa-solid fa-circle-check text-brand-cyan toast-icon"></i>';
        if(type === 'error') icon = '<i class="fa-solid fa-circle-exclamation text-brand-red toast-icon"></i>';
        toast.innerHTML = `${icon}<span class="toast-msg">${msg}</span>`;
        container.appendChild(toast);
        requestAnimationFrame(() => { toast.classList.add('show'); });
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3000);
    };

    // --- LÓGICA DE BÚSQUEDA ---
    function initSearchLogic() {
        const setupSearch = (inputId, resultsId) => {
            const input = document.getElementById(inputId);
            const results = document.getElementById(resultsId);
            let debounceTimer;

            if (!input || !results) return;

            document.addEventListener('click', (e) => {
                if (!input.contains(e.target) && !results.contains(e.target)) {
                    results.classList.remove('active');
                }
            });

            input.addEventListener('input', (e) => {
                const term = e.target.value.trim().toLowerCase();
                clearTimeout(debounceTimer);

                if (term.length < 2) {
                    results.innerHTML = '';
                    results.classList.remove('active');
                    return;
                }

                debounceTimer = setTimeout(async () => {
                    try {
                        // Usamos master catalog de caché si existe para búsqueda instantánea
                        const cachedRaw = localStorage.getItem('pixeltech_master_catalog');
                        let localProducts = [];
                        
                        if (cachedRaw) {
                            try {
                                const data = JSON.parse(cachedRaw);
                                localProducts = Object.values(data.map || {});
                            } catch(e) {}
                        }

                        let resultsArray = [];

                        if (localProducts.length > 0) {
                            // Filtro local (ultra rápido)
                            resultsArray = localProducts.filter(p => {
                                const name = (p.name || "").toLowerCase();
                                const cat = (p.category || "").toLowerCase();
                                return (name.includes(term) || cat.includes(term)) && p.status === 'active';
                            });
                        } else {
                            // Fallback a Firebase si no hay caché
                            const q = query(
                                collection(db, "products"),
                                where("status", "==", "active"),
                                limit(20) // Limitamos para no gastar
                            );
                            const snap = await getDocs(q);
                            const products = [];
                            snap.forEach(d => products.push({ id: d.id, ...d.data() }));
                            
                            resultsArray = products.filter(p => {
                                const name = (p.name || "").toLowerCase();
                                const cat = (p.category || "").toLowerCase();
                                return name.includes(term) || cat.includes(term);
                            });
                        }

                        renderResults(resultsArray.slice(0, 5), term);

                    } catch (err) {
                        console.error("Search error", err);
                    }
                }, 300);
            });

            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const term = input.value.trim();
                    if(term) window.location.href = `/shop/search.html?q=${encodeURIComponent(term)}`;
                }
            });

            function renderResults(products, term) {
                results.innerHTML = '';
                
                if (products.length === 0) {
                    results.innerHTML = `
                        <div class="p-4 text-center">
                            <p class="text-[10px] font-bold text-gray-400 uppercase">No hay resultados directos</p>
                            <button onclick="window.location.href='/shop/search.html?q=${encodeURIComponent(term)}'" class="text-brand-cyan text-xs font-black mt-1 hover:underline">Buscar "${term}" en todo el catálogo</button>
                        </div>`;
                } else {
                    products.forEach(p => {
                        const img = p.mainImage || p.image || 'https://placehold.co/50';
                        const price = p.price.toLocaleString('es-CO');
                        
                        results.innerHTML += `
                            <div onclick="window.location.href='/shop/product.html?id=${p.id}'" class="search-result-item">
                                <img src="${img}" class="w-10 h-10 object-contain rounded-lg bg-gray-50 border border-gray-100">
                                <div class="flex-grow min-w-0">
                                    <p class="text-[10px] font-black text-brand-black uppercase truncate">${p.name}</p>
                                    <p class="text-[9px] font-bold text-gray-400">${p.category || 'Producto'}</p>
                                </div>
                                <span class="text-xs font-black text-brand-cyan">$${price}</span>
                            </div>
                        `;
                    });
                    
                    if (products.length >= 5) {
                        results.innerHTML += `
                            <div onclick="window.location.href='/shop/search.html?q=${encodeURIComponent(term)}'" class="p-3 text-center bg-gray-50 cursor-pointer hover:bg-gray-100 transition">
                                <span class="text-[9px] font-black text-brand-black uppercase tracking-widest">Ver todos los resultados</span>
                            </div>
                        `;
                    }
                }
                results.classList.add('active');
            }
        };

        setupSearch('search-desktop', 'search-results-desktop');
        setupSearch('search-mobile', 'search-results-mobile');
    }

    // --- LOGICA DE HEADER Y MENÚ (Optimizada con SessionStorage) ---
    async function initHeaderLogic() {
        const topBanner = document.getElementById('top-banner-dynamic');
        if (topBanner) {
            // 1. Banner Envío Gratis (Caché Session)
            const cachedConfig = sessionStorage.getItem('pixeltech_shipping_config');
            
            const renderBanner = (data) => {
                let freeHTML = '';
                if (data && data.freeThreshold > 0) {
                    freeHTML = `<span class="mx-8 flex items-center gap-2 text-brand-cyan"><i class="fa-solid fa-gift animate-pulse"></i> ENVÍO GRATIS DESDE $${parseInt(data.freeThreshold).toLocaleString('es-CO')}</span>`;
                }
                const baseContent = `<span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-truck-fast text-brand-cyan"></i> Envíos a toda Colombia</span><span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-hand-holding-dollar text-brand-cyan"></i> Contra entrega en Bogotá</span><span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-credit-card text-brand-cyan"></i> Paga con ADDI</span>${freeHTML}`;
                topBanner.innerHTML = `<div class="flex items-center animate-marquee font-black uppercase tracking-[0.3em]">${baseContent} ${baseContent} ${baseContent}</div>`;
            };

            if (cachedConfig) {
                renderBanner(JSON.parse(cachedConfig));
            } else {
                // Cargar si no está (solo una vez por sesión)
                getDoc(doc(db, "config", "shipping")).then(snap => {
                    if (snap.exists()) {
                        const data = snap.data();
                        sessionStorage.setItem('pixeltech_shipping_config', JSON.stringify(data));
                        renderBanner(data);
                    }
                }).catch(() => topBanner.innerHTML = `<p class="text-center">ENVÍOS A TODO EL PAÍS 🚚</p>`);
            }
        }

        // Funciones del Drawer
        window.toggleWhatsAppModal = () => {
            const modal = document.getElementById('wa-modal');
            const overlay = document.getElementById('wa-overlay');
            if (modal && overlay) {
                modal.classList.toggle('hidden');
                modal.classList.toggle('flex');
                overlay.classList.toggle('hidden');
            }
        };

        const cartDrawer = document.getElementById('cart-drawer');
        const cartOverlay = document.getElementById('cart-overlay');
        let isDrawerAnimating = false;

        window.toggleCartDrawer = () => {
            if (!cartDrawer || !cartOverlay || isDrawerAnimating) return;
            const isClosed = cartDrawer.classList.contains('translate-x-full');
            isDrawerAnimating = true;

            if (isClosed) {
                cartOverlay.style.display = 'block';
                void cartOverlay.offsetWidth;
                cartOverlay.classList.remove('opacity-0');
                cartOverlay.classList.add('opacity-100');
                cartDrawer.classList.remove('translate-x-full');
                window.renderCartDrawerItems();
                setTimeout(() => { isDrawerAnimating = false; }, 500);
            } else {
                cartDrawer.classList.add('translate-x-full');
                cartOverlay.classList.remove('opacity-100');
                cartOverlay.classList.add('opacity-0');
                setTimeout(() => { cartOverlay.style.display = 'none'; isDrawerAnimating = false; }, 500);
            }
        };

        window.removeCartItemDrawer = (index) => {
            let cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
            cart.splice(index, 1);
            localStorage.setItem('pixeltech_cart', JSON.stringify(cart));
            window.renderCartDrawerItems();
            window.updateCartCountGlobal();
            window.dispatchEvent(new Event('cartUpdated'));
        };

        window.changeDrawerQty = (cartId, currentQty, change) => {
            const newQty = currentQty + change;
            if(newQty < 1) return;
            const result = updateQuantity(cartId, newQty);
            if (!result.success && result.message) {
                window.showToast(result.message, 'error');
            } else {
                window.renderCartDrawerItems();
                window.updateCartCountGlobal();
                window.dispatchEvent(new Event('cartUpdated'));
            }
        };

        window.updateCartCountGlobal = () => {
            const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
            const count = cart.reduce((acc, i) => acc + (i.quantity || 1), 0);
            const deskBadge = document.getElementById('cart-count-desktop');
            if (deskBadge) { deskBadge.textContent = count; count > 0 ? deskBadge.classList.remove('hidden') : deskBadge.classList.add('hidden'); }
            const mobileBadge = document.getElementById('cart-count-mobile');
            if (mobileBadge) { mobileBadge.textContent = count; count > 0 ? mobileBadge.classList.remove('hidden') : mobileBadge.classList.add('hidden'); }
        };

        window.addEventListener('cartItemAdded', () => {
            window.updateCartCountGlobal();
            window.renderCartDrawerItems();
            const drawer = document.getElementById('cart-drawer');
            if (drawer && drawer.classList.contains('translate-x-full')) {
                window.toggleCartDrawer();
            }
        });

        window.addEventListener('cartUpdated', () => {
            window.updateCartCountGlobal();
            const drawer = document.getElementById('cart-drawer');
            if (drawer && !drawer.classList.contains('translate-x-full')) {
                window.renderCartDrawerItems();
            }
        });

        window.addEventListener('storage', (e) => {
            if (e.key === 'pixeltech_cart') {
                window.updateCartCountGlobal();
                window.renderCartDrawerItems();
            }
        });

        window.updateCartCountGlobal();

        // RENDERIZAR ITEMS (DRAWER)
        window.renderCartDrawerItems = async () => {
            const container = document.getElementById('cart-drawer-items');
            const totalEl = document.getElementById('cart-drawer-total');
            const shippingMsg = document.getElementById('shipping-msg');
            const shippingBar = document.getElementById('shipping-progress');
            const btnCheckout = document.getElementById('btn-checkout-drawer');

            const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];

            if (cart.length === 0) {
                container.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center opacity-50 py-10"><i class="fa-solid fa-basket-shopping text-6xl text-gray-200 mb-4"></i><p class="text-xs font-bold text-gray-400">Tu carrito está vacío</p></div>`;
                totalEl.textContent = "$0";
                shippingMsg.innerHTML = "Agrega productos para ver beneficios";
                shippingBar.style.width = "0%";
                if (btnCheckout) { btnCheckout.disabled = true; btnCheckout.classList.add('opacity-50', 'cursor-not-allowed'); btnCheckout.onclick = null; }
                return;
            }

            if (btnCheckout) { 
                btnCheckout.disabled = false; btnCheckout.classList.remove('opacity-50', 'cursor-not-allowed');
                // La validación real se hace en checkout.js, aquí solo es link
                btnCheckout.onclick = () => window.location.href='/shop/checkout.html';
            }

            let subtotal = 0;
            container.innerHTML = cart.map((item, index) => {
                const isOutOfStock = (item.maxStock !== undefined && item.maxStock <= 0);
                const isMaxedOut = !isOutOfStock && (item.quantity >= (item.maxStock || 999));
                if (!isOutOfStock) subtotal += item.price * item.quantity;
                const itemTotal = item.price * item.quantity;
                const opacityClass = isOutOfStock ? 'opacity-50 grayscale bg-gray-50' : 'bg-white hover:border-gray-100';
                const statusBadge = isOutOfStock ? `<span class="absolute top-2 right-2 bg-red-500 text-white text-[8px] font-black px-2 py-0.5 rounded shadow-sm z-10">AGOTADO</span>` : '';

                return `
                    <div class="${opacityClass} p-2 rounded-xl border border-gray-50 transition group relative mb-3">
                        ${statusBadge}
                        <div onclick="${isOutOfStock ? '' : `window.location.href='/shop/product.html?id=${item.id}'`}" class="flex gap-4 items-center cursor-pointer">
                            <div class="w-16 h-16 bg-gray-50 rounded-lg shrink-0 p-1 flex items-center justify-center border border-gray-100"><img src="${item.image || 'https://placehold.co/50'}" class="w-full h-full object-contain"></div>
                            <div class="flex-grow min-w-0"><h4 class="text-[10px] font-black uppercase text-brand-black truncate leading-tight">${item.name}</h4><p class="text-[9px] text-gray-400 mt-0.5">${item.color || ''} ${item.capacity || ''}</p><span class="text-[11px] font-black ${isOutOfStock ? 'text-gray-400 line-through' : 'text-brand-black'} block mt-1">${isOutOfStock ? '$0' : `$${itemTotal.toLocaleString('es-CO')}`}</span></div>
                        </div>
                        <div class="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                            ${isOutOfStock ? `<span class="text-[9px] text-red-500 font-bold ml-1">No disponible</span>` : `<div class="flex items-center bg-gray-50 rounded-lg h-7 border border-gray-100"><button onclick="window.changeDrawerQty('${item.cartId}', ${item.quantity}, -1)" class="w-7 h-full flex items-center justify-center text-gray-400 hover:text-black font-bold active:scale-90">-</button><span class="text-[10px] font-black min-w-[20px] text-center">${item.quantity}</span><button onclick="window.changeDrawerQty('${item.cartId}', ${item.quantity}, 1)" class="w-7 h-full flex items-center justify-center ${isMaxedOut ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-black'} font-bold active:scale-90" ${isMaxedOut ? 'disabled' : ''}>+</button></div>`}
                            <button onclick="window.removeCartItemDrawer(${index})" class="text-gray-300 hover:text-red-500 transition px-2 z-10"><i class="fa-solid fa-trash-can text-xs"></i></button>
                        </div>
                    </div>`;
            }).join('');

            totalEl.textContent = `$${subtotal.toLocaleString('es-CO')}`;

            // Barra Envío (Usando config de SessionStorage para no leer DB)
            try {
                const cachedConfig = sessionStorage.getItem('pixeltech_shipping_config');
                if (cachedConfig) {
                    const data = JSON.parse(cachedConfig);
                    const threshold = parseInt(data.freeThreshold) || 0;
                    if (threshold > 0) {
                        const diff = threshold - subtotal;
                        let percent = subtotal >= threshold ? 100 : (subtotal / threshold) * 100;
                        shippingBar.style.width = `${percent}%`;
                        if (diff > 0) {
                            shippingMsg.innerHTML = `Te faltan <span class="text-brand-cyan font-black">$${diff.toLocaleString('es-CO')}</span> para envío gratis`;
                            shippingBar.classList.remove('bg-green-500'); shippingBar.classList.add('bg-brand-cyan');
                        } else {
                            shippingMsg.innerHTML = `<span class="text-green-600 font-black"><i class="fa-solid fa-check-circle"></i> ¡Tienes envío gratis!</span>`;
                            shippingBar.classList.remove('bg-brand-cyan'); shippingBar.classList.add('bg-green-500');
                        }
                    }
                }
            } catch (e) { console.error(e); }
        };

        // Funciones del Menú Móvil
        const drawer = document.getElementById('mobile-menu-drawer');
        const overlay = document.getElementById('mobile-menu-overlay');
        const btnClose = document.getElementById('mobile-drawer-close');
        const btnCategories = document.getElementById('mobile-categories-btn');
        const btnMenu = document.getElementById('mobile-menu-btn');
        const tabs = document.querySelectorAll('.menu-tab-btn');

        const openDrawer = (tabName) => {
            if (!drawer) return;
            drawer.classList.remove('translate-x-[-100%]'); drawer.classList.add('translate-x-0'); overlay.classList.remove('opacity-0');
            tabs.forEach(t => {
                if (t.dataset.tab === tabName) { t.classList.add('active'); document.getElementById(tabName).classList.remove('hidden'); }
                else { t.classList.remove('active'); document.getElementById(t.dataset.tab).classList.add('hidden'); }
            });
        };
        const closeDrawer = () => { if (!drawer) return; drawer.classList.add('translate-x-[-100%]'); drawer.classList.remove('translate-x-0'); overlay.classList.add('opacity-0'); };
        
        if (btnCategories) btnCategories.onclick = () => openDrawer('tab-categories');
        if (btnMenu) btnMenu.onclick = () => openDrawer('tab-menu');
        if (btnClose) btnClose.onclick = closeDrawer;
        if (overlay) overlay.onclick = closeDrawer;

        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active')); tab.classList.add('active');
                document.querySelectorAll('.menu-tab-content').forEach(c => c.classList.add('hidden'));
                document.getElementById(tab.dataset.tab).classList.remove('hidden');
            };
        });

        // 2. Cargar Categorías desde Caché Local (SOLO LECTURA, NO SYNC)
        syncAllCategories();
        
        onAuthStateChanged(auth, async (user) => {
            const container = document.getElementById('user-info-desktop');
            const mobileProfile = document.getElementById('mobile-profile-link');
            if (user) {
                if (container) {
                    // Pequeña verificación de admin (inevitable si queremos mostrar el ícono correcto, pero se hace una vez)
                    // Se podría guardar en sessionStorage si el rol no cambia
                    let role = sessionStorage.getItem('pixeltech_user_role');
                    if(!role) {
                        const userSnap = await getDoc(doc(db, "users", user.uid));
                        role = (userSnap.exists() && userSnap.data().role === 'admin') ? 'admin' : 'user';
                        sessionStorage.setItem('pixeltech_user_role', role);
                    }
                    
                    const isAdmin = role === 'admin';
                    const label = isAdmin ? 'Admin' : 'Cuenta';
                    const link = isAdmin ? '/admin/index.html' : '/profile.html';
                    container.innerHTML = `<a href="${link}" class="flex flex-col items-center gap-1 group w-14"><div class="w-12 h-12 rounded-2xl bg-brand-cyan text-brand-black flex items-center justify-center shadow-lg transition duration-300 hover:bg-white"><i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-user-check'} text-xl"></i></div><span class="text-[8px] font-black uppercase tracking-widest text-brand-cyan text-center">${label}</span></a>`;
                    if (mobileProfile) mobileProfile.href = link;
                }
            } else {
                if (container) {
                    container.innerHTML = `<a href="/auth/login.html" class="flex flex-col items-center gap-1 group w-14"><div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-brand-cyan transition duration-300 shadow-lg"><i class="fa-regular fa-user text-xl text-white group-hover:text-brand-black"></i></div><span class="text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-brand-cyan text-center">Ingresar</span></a>`;
                }
                if (mobileProfile) mobileProfile.href = "/auth/login.html";
            }
        });

        const handleSearch = (e) => { if (e.key === 'Enter' && e.target.value.trim()) window.location.href = `/shop/search.html?q=${encodeURIComponent(e.target.value.trim())}`; };
        document.getElementById('search-desktop')?.addEventListener('keypress', handleSearch);
        document.getElementById('search-mobile')?.addEventListener('keypress', handleSearch);
    }

    // --- CARGA DE CATEGORÍAS (Caché Primero -> Fallback a Red) ---
    async function syncAllCategories() {
        const mobileList = document.getElementById('categories-mobile-list');
        if (!mobileList) return;

        const STORAGE_KEY = 'pixeltech_categories';
        const SYNC_KEY = 'pixeltech_cat_last_sync';
        
        let categories = [];
        let source = "CACHE";

        // 1. INTENTAR LEER DE CACHÉ
        const cachedRaw = localStorage.getItem(STORAGE_KEY);
        if (cachedRaw) {
            try {
                categories = JSON.parse(cachedRaw);
            } catch (e) { console.warn("Caché categorías corrupto"); }
        }

        // 2. SI NO HAY CACHÉ (PRIMERA VISITA), DESCARGAR DE FIREBASE
        if (categories.length === 0) {
            console.log("☁️ [Global] Primer visita: Descargando categorías...");
            source = "NETWORK";
            try {
                const q = query(collection(db, "categories"), orderBy("name", "asc"));
                const snap = await getDocs(q);
                
                snap.forEach(doc => {
                    categories.push({ id: doc.id, ...doc.data() });
                });

                // GUARDAR EN CACHÉ PARA EL FUTURO
                if (categories.length > 0) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
                    // Marcamos que ya sincronizamos para que app.js no lo haga de nuevo innecesariamente
                    localStorage.setItem(SYNC_KEY, Date.now().toString()); 
                }
            } catch (e) {
                console.error("Error descargando categorías:", e);
                mobileList.innerHTML = `<p class="text-xs text-red-400 p-4">Error cargando menú.</p>`;
                return;
            }
        } else {
            console.log("⚡ [Global] Categorías cargadas desde caché.");
        }

        // 3. RENDERIZAR (Misma lógica visual que tenías)
        renderMobileMenuHTML(mobileList, categories);
    }

    // Función Helper para generar el HTML (Separada para limpieza)
    function renderMobileMenuHTML(container, categories) {
        // Header del menú
        container.innerHTML = `
            <a href="/shop/catalog.html" class="group flex items-center gap-3 p-3 mb-2 rounded-xl hover:bg-gray-50 transition-all border border-transparent hover:border-gray-100">
                <div class="w-8 h-8 rounded-lg bg-brand-black text-white flex items-center justify-center shrink-0 shadow-md group-hover:scale-90 transition-transform"><i class="fa-solid fa-store text-xs"></i></div>
                <div class="flex flex-col"><span class="text-[10px] font-black uppercase tracking-widest text-brand-black">Ver Catálogo Completo</span><span class="text-[8px] font-bold text-gray-400">Explorar todos los productos</span></div>
                <i class="fa-solid fa-arrow-right text-gray-300 ml-auto text-xs group-hover:text-brand-cyan group-hover:translate-x-1 transition-all"></i>
            </a>
            <div class="h-px w-full bg-gray-100 my-2"></div>
        `;
        
        categories.forEach(cat => {
            const subcats = cat.subcategories || [];
            const catUrl = `/shop/search.html?category=${encodeURIComponent(cat.name)}`;
            // Generar ID único seguro para el acordeón
            const accordionId = `acc-${(cat.id || cat.name).replace(/\s+/g, '-')}`;
            
            if (subcats.length === 0) {
                // Categoría simple
                container.innerHTML += `
                    <a href="${catUrl}" class="flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition duration-300 mb-1 border-b border-gray-50 last:border-0">
                        <span class="font-bold text-xs text-gray-600 uppercase tracking-tight">${cat.name}</span>
                        <i class="fa-solid fa-chevron-right text-[10px] text-gray-300"></i>
                    </a>`;
            } else {
                // Acordeón con subcategorías
                const subListHTML = subcats.map(sub => { 
                    const subName = typeof sub === 'string' ? sub : sub.name; 
                    return `<a href="/shop/search.html?category=${encodeURIComponent(cat.name)}&subcategory=${encodeURIComponent(subName)}" class="block py-3 px-4 text-[10px] font-bold text-gray-500 hover:text-brand-cyan border-l-2 border-gray-100 hover:border-brand-cyan ml-3 transition-all">${subName}</a>` 
                }).join('');
                
                container.innerHTML += `
                    <div class="mb-1 border-b border-gray-50 last:border-0 transition-all duration-300 group-accordion">
                        <button class="w-full flex items-center justify-between p-4 text-left focus:outline-none hover:bg-slate-50 rounded-2xl transition" onclick="window.toggleAccordion('${accordionId}')">
                            <span class="font-bold text-xs text-gray-600 uppercase tracking-tight">${cat.name}</span>
                            <div class="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 transition-transform duration-300 icon-rotate"><i class="fa-solid fa-chevron-down text-[9px]"></i></div>
                        </button>
                        <div id="${accordionId}" class="hidden bg-white px-2 pb-2">
                            <a href="${catUrl}" class="block py-3 px-4 text-[10px] font-black text-brand-black uppercase tracking-widest border-b border-dashed border-gray-100 mb-1 hover:text-brand-cyan">Ver todo ${cat.name}</a>
                            <div class="pl-2 space-y-1 mt-1">${subListHTML}</div>
                        </div>
                    </div>`;
            }
        });

        // Inyectar función de toggle global si no existe
        if (!window.toggleAccordion) {
            window.toggleAccordion = (id) => {
                const content = document.getElementById(id);
                if(!content) return;
                const btn = content.previousElementSibling;
                const icon = btn.querySelector('.icon-rotate');
                
                if (content.classList.contains('hidden')) { 
                    content.classList.remove('hidden'); 
                    icon.classList.add('rotate-180', 'bg-brand-black', 'text-white'); 
                    icon.classList.remove('bg-gray-50', 'text-gray-400'); 
                } else { 
                    content.classList.add('hidden'); 
                    icon.classList.remove('rotate-180', 'bg-brand-black', 'text-white'); 
                    icon.classList.add('bg-gray-50', 'text-gray-400'); 
                }
            };
        }
    }

    export function loadGlobalFooter() {
        const footerContainer = document.getElementById('global-footer');
        if (!footerContainer) return;
        // ... (El HTML del footer no cambia, es estático) ...
        footerContainer.innerHTML = `
        <footer class="bg-brand-black text-white pt-12 lg:pt-20 pb-24 lg:pb-10 border-t border-white/5">
            <div class="container mx-auto px-6">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12 mb-16">
                    <div class="space-y-6">
                        <img src="/img/logo.png" alt="PixelTech" class="h-10 opacity-90">
                        <p class="text-gray-500 text-xs leading-relaxed uppercase font-medium tracking-wider">Innovación al alcance de tu mano.</p>
                        <div class="flex gap-4 text-gray-400"><a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-instagram text-lg"></i></a><a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-facebook text-lg"></i></a><a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-tiktok text-lg"></i></a></div>
                    </div>
                    <div><h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Navegación</h4><ul class="space-y-4 text-[10px] font-bold uppercase tracking-widest text-gray-400"><li><a href="/index.html" class="hover:text-white transition">Inicio</a></li><li><a href="/shop/catalog.html" class="hover:text-white transition text-brand-cyan">Catálogo</a></li><li><a href="/shop/catalog.html?mode=promos" class="hover:text-white transition">Ofertas Especiales</a></li><li><a href="/profile.html" class="hover:text-white transition">Mi Cuenta</a></li></ul></div>
                    <div><h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Ayuda</h4><ul class="space-y-4 text-[10px] font-bold uppercase tracking-widest text-gray-400"><li><a href="#" class="hover:text-white transition">Rastrear Pedido</a></li><li><a href="/policies/warranty.html" class="hover:text-white transition">Políticas de Garantía</a></li><li><a href="/policies/shipping.html" class="hover:text-white transition">Envíos y Devoluciones</a></li><li><a href="/policies/terms.html" class="hover:text-white transition">Términos y Condiciones</a></li></ul></div>
                    <div><h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Contacto</h4><div class="space-y-4"><a href="https://wa.me/573159834171" class="flex items-center gap-3 group"><div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-brand-cyan/20 transition"><i class="fa-brands fa-whatsapp text-brand-cyan"></i></div><div><p class="text-[10px] font-black uppercase text-gray-400 group-hover:text-white transition">Ventas</p><p class="text-[9px] text-gray-500">+57 300 000 0000</p></div></a><a href="mailto:soporte@pixeltech.com" class="flex items-center gap-3 group"><div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-brand-cyan/20 transition"><i class="fa-solid fa-envelope text-brand-cyan"></i></div><div><p class="text-[10px] font-black uppercase text-gray-400 group-hover:text-white transition">Email</p><p class="text-[9px] text-gray-500">soporte@pixeltech.com</p></div></a></div></div>
                    <button id="btn-install-pwa" onclick="window.installPWA()" class="hidden bg-brand-cyan text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg animate-pulse">
                        <i class="fa-solid fa-download mr-2"></i> Instalar App
                    </button>
                
                    </div>
                <div class="border-t border-white/5 pt-10 flex flex-col md:flex-row justify-between items-center gap-6"><p class="text-[9px] font-black uppercase tracking-[0.4em] text-gray-600">© 2026 PIXELTECH.</p><div class="flex gap-4 grayscale opacity-30"><i class="fa-brands fa-cc-visa text-2xl text-white"></i><i class="fa-brands fa-cc-mastercard text-2xl text-white"></i><i class="fa-brands fa-cc-amex text-2xl text-white"></i></div></div>
            </div>
        </footer>`;
    }

    export async function renderBrandCarousel(containerId, activeBrandNames = null) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // OPTIMIZACIÓN: LEER DE CACHÉ LOCAL
        const cachedRaw = localStorage.getItem('pixeltech_brands');
        if (cachedRaw) {
            try {
                let brands = JSON.parse(cachedRaw);
                
                // Si piden filtrar por nombres activos (ej: solo marcas con productos en catálogo)
                if (activeBrandNames) {
                    const activeSet = new Set([...activeBrandNames].map(b => b.toLowerCase()));
                    brands = brands.filter(b => activeSet.has(b.name.toLowerCase()));
                }

                if (brands.length === 0) { container.innerHTML = ""; container.classList.add('hidden'); return; }

                container.innerHTML = `<div class="relative group mb-8"><div class="flex items-center justify-between mb-4 px-2"><h3 class="font-black text-sm uppercase tracking-widest text-brand-black">Marcas Destacadas</h3><div class="flex gap-2"><button id="btn-brand-prev" class="w-8 h-8 rounded-full bg-gray-50 text-brand-black hover:bg-brand-cyan hover:text-white transition flex items-center justify-center shadow-sm"><i class="fa-solid fa-chevron-left text-[10px]"></i></button><button id="btn-brand-next" class="w-8 h-8 rounded-full bg-gray-50 text-brand-black hover:bg-brand-cyan hover:text-white transition flex items-center justify-center shadow-sm"><i class="fa-solid fa-chevron-right text-[10px]"></i></button></div></div><div id="brand-track-container" class="overflow-x-auto no-scrollbar scroll-smooth"><div class="flex gap-4 w-max px-1" id="brand-track">${brands.map(b => `<a href="/shop/search.html?subcategory=${encodeURIComponent(b.name)}" class="block w-28 h-28 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-brand-cyan/30 transition-all duration-300 flex flex-col items-center justify-center p-3 group/brand shrink-0"><img src="${b.image || 'https://placehold.co/100'}" alt="${b.name}" class="w-full h-12 object-contain filter grayscale group-hover/brand:grayscale-0 transition duration-500 mb-2 opacity-60 group-hover/brand:opacity-100"><span class="text-[9px] font-bold text-gray-400 group-hover/brand:text-brand-black uppercase tracking-wider text-center line-clamp-1">${b.name}</span></a>`).join('')}</div></div></div>`;
                
                const trackContainer = container.querySelector('#brand-track-container');
                const prevBtn = container.querySelector('#btn-brand-prev');
                const nextBtn = container.querySelector('#btn-brand-next');
                if (prevBtn) prevBtn.onclick = () => trackContainer.scrollBy({ left: -300, behavior: 'smooth' });
                if (nextBtn) nextBtn.onclick = () => trackContainer.scrollBy({ left: 300, behavior: 'smooth' });
                
                return; // Éxito desde caché
            } catch(e) { console.error(e); }
        }

        // Fallback silencioso (si no hay caché de marcas, no renderizamos el carrusel en componentes secundarios para no gastar lecturas)
        // El usuario verá marcas en la página de Marcas o Home.
        container.innerHTML = "";
        container.classList.add('hidden');
    }

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then(reg => console.log('SW registrado: ', reg.scope))
        .catch(err => console.log('SW falló: ', err));
    });
  }

  let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  // 1. Evita que Chrome muestre el prompt automático (menos intrusivo)
  e.preventDefault();
  deferredPrompt = e;
  
  // 2. Muestra tu propio botón (puedes inyectarlo en el menú móvil o header)
  const installBtn = document.getElementById('btn-install-pwa');
  if(installBtn) installBtn.classList.remove('hidden');
});

window.installPWA = async () => {
  if (!deferredPrompt) return;
  // 3. Lanza el prompt nativo
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`User response: ${outcome}`);
  deferredPrompt = null;
  // Ocultar botón
  document.getElementById('btn-install-pwa')?.classList.add('hidden');
};

// Escuchar si la app ya fue instalada para ocultar todo
window.addEventListener('appinstalled', () => {
  document.getElementById('btn-install-pwa')?.classList.add('hidden');
  console.log('PWA Installed');
});

export function trackEcommerceEvent(eventName, params) {
    // 1. Google Analytics
    if (typeof gtag === 'function') {
        gtag('event', eventName, params);
    }

    // 2. Facebook Pixel (Mapeo de eventos)
    if (typeof fbq === 'function') {
        switch(eventName) {
            case 'view_item':
                fbq('track', 'ViewContent', {
                    content_name: params.items[0].item_name,
                    content_ids: [params.items[0].item_id],
                    content_type: 'product',
                    value: params.value,
                    currency: 'COP'
                });
                break;
            case 'add_to_cart':
                fbq('track', 'AddToCart', {
                    content_ids: [params.items[0].item_id],
                    content_type: 'product',
                    value: params.value,
                    currency: 'COP'
                });
                break;
            case 'purchase': // Asumiendo que implementas este en success
                fbq('track', 'Purchase', {
                    value: params.value,
                    currency: 'COP'
                });
                break;
        }
    }
}