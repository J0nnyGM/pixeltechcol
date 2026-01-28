import { auth, db, onAuthStateChanged, doc, getDoc, collection, getDocs, query, orderBy } from "./firebase-init.js";

/**
 * Inyecta Header, Footer, Menús y Herramientas Flotantes (Y EL MINI CARRITO)
 */
export function loadGlobalHeader() {
    const headerContainer = document.getElementById('global-header');
    if (!headerContainer) return;

    document.body.classList.add('pb-20', 'lg:pb-0');

    // 1. Estilos Dinámicos (Marquee + Scrollbar + Drawer Premium Animation)
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
        
        /* --- NUEVA ANIMACIÓN PREMIUM --- */
        .smooth-drawer {
            transition-property: transform, opacity, visibility;
            transition-duration: 500ms;
            transition-timing-function: cubic-bezier(0.19, 1, 0.22, 1); /* Efecto "Slide & Brake" suave */
            will-change: transform;
        }
    `;
    document.head.appendChild(styles);

    // 2. HTML ESTRUCTURAL (Header + Drawers)
    headerContainer.innerHTML = `
    <div class="fixed top-1/2 right-0 -translate-y-1/2 z-40 hidden md:flex flex-col gap-2 items-end">
        <a href="https://www.facebook.com/pixeltech.col" target="_blank" class="w-10 h-10 bg-[#1877F2] text-white flex items-center justify-center rounded-l-xl hover:w-14 transition-all duration-300 shadow-lg relative overflow-hidden group">
            <i class="fa-brands fa-facebook-f text-lg absolute right-3"></i>
        </a>
        <a href="https://www.instagram.com/pixeltech.col/" target="_blank" class="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center rounded-l-xl hover:w-14 transition-all duration-300 shadow-lg relative overflow-hidden group">
            <i class="fa-brands fa-instagram text-xl absolute right-2.5"></i>
        </a>
        <a href="https://www.tiktok.com/@pixeltech.col" target="_blank" class="w-10 h-10 bg-black text-white flex items-center justify-center rounded-l-xl hover:w-14 transition-all duration-300 shadow-lg border border-gray-800 relative overflow-hidden group">
            <i class="fa-brands fa-tiktok text-lg absolute right-3"></i>
        </a>
    </div>

    <div id="wa-overlay" class="fixed inset-0 z-[59] hidden" onclick="window.toggleWhatsAppModal()"></div>
    <div id="wa-modal" class="fixed z-[60] hidden animate-in-up origin-bottom-right w-[90%] max-w-[380px] bottom-24 right-4 lg:w-[400px] lg:bottom-10 lg:right-24">
        <div class="bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-gray-100 relative">
            <div class="bg-gradient-to-r from-[#25D366] to-[#075E54] p-6 relative overflow-hidden">
                <i class="fa-brands fa-whatsapp absolute -bottom-4 -right-4 text-8xl text-white opacity-20 transform rotate-12"></i>
                <div class="relative z-10 flex justify-between items-start">
                    <div>
                        <h3 class="font-black text-xl text-white tracking-tight">Hola, ¿En qué te ayudamos? 👋</h3>
                        <p class="text-green-100 text-xs font-medium mt-1">Selecciona un área para chatear ahora.</p>
                    </div>
                    <button onclick="window.toggleWhatsAppModal()" class="bg-white/20 hover:bg-white/30 text-white rounded-full w-8 h-8 flex items-center justify-center transition backdrop-blur-sm">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
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
            <div class="bg-gray-50 p-3 text-center border-t border-gray-100">
                <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Respuesta habitual: &lt; 5 minutos</p>
            </div>
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

                <div class="hidden lg:block flex-grow max-w-2xl">
                    <div class="relative group">
                        <input type="text" id="search-desktop" placeholder="¿Qué equipo necesitas hoy?..." 
                               class="w-full bg-slate-900 border-2 border-slate-800 text-white px-6 py-4 rounded-2xl outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 transition-all font-medium placeholder-gray-600 shadow-inner text-sm">
                        <button class="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-brand-cyan transition">
                            <i class="fa-solid fa-magnifying-glass text-lg"></i>
                        </button>
                    </div>
                </div>

                <div class="hidden lg:flex items-center gap-3 md:gap-6 shrink-0">
                    <a href="https://wa.me/573009046450" target="_blank" class="flex flex-col items-center gap-1 group w-14">
                        <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-green-500 group-hover:text-white transition duration-300">
                            <i class="fa-brands fa-whatsapp text-xl"></i>
                        </div>
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
        <div class="relative group">
            <input type="text" id="search-mobile" placeholder="Buscar productos..." 
                   class="w-full bg-slate-900 border-2 border-slate-800 text-white px-5 py-3 rounded-xl outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20 text-xs font-bold transition-all placeholder-gray-500">
            <i class="fa-solid fa-magnifying-glass absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm group-focus-within:text-brand-cyan"></i>
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
                <button class="menu-tab-btn flex-1 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 border-transparent transition" data-tab="tab-menu">Más</button>
            </div>
            <div id="tab-categories" class="menu-tab-content active flex-grow overflow-y-auto p-4 space-y-2 no-scrollbar">
                <div id="categories-mobile-list" class="space-y-1"></div>
            </div>
            <div id="tab-menu" class="menu-tab-content hidden flex-grow overflow-y-auto p-6 space-y-6 no-scrollbar">
                <div class="space-y-1">
                    <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Mi Cuenta</p>
                    <a href="/profile.html" class="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 font-bold text-xs text-brand-black transition"><i class="fa-solid fa-box-open text-gray-400 w-5"></i> Mis Pedidos</a>
                    <a href="/profile.html" class="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 font-bold text-xs text-brand-black transition"><i class="fa-solid fa-heart text-gray-400 w-5"></i> Lista de Deseos</a>
                </div>
                <div class="space-y-1">
                    <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 mt-4">Soporte</p>
                    <a href="#" onclick="window.toggleWhatsAppModal()" class="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 font-bold text-xs text-brand-black transition"><i class="fa-brands fa-whatsapp text-green-500 w-5 text-lg"></i> Contactar Asesor</a>
                </div>
            </div>
            <div class="p-4 border-t border-gray-50 bg-gray-50/50 text-center shrink-0">
                <p class="text-[8px] font-black text-gray-300 uppercase tracking-[0.3em]">PixelTech v2.0</p>
            </div>
        </div>
    </div>

   <div id="cart-drawer-container" class="fixed inset-0 z-[100] pointer-events-none">
        
        <div id="cart-overlay" 
             class="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-0 transition-opacity duration-500 pointer-events-auto" 
             style="display: none;"
             onclick="window.toggleCartDrawer()">
        </div>
        
        <div id="cart-drawer" 
             class="absolute right-0 top-0 w-full max-w-[400px] h-full bg-white shadow-2xl flex flex-col drawer-shadow translate-x-full smooth-drawer pointer-events-auto">
            
            <div class="p-6 bg-white border-b border-gray-100 flex justify-between items-center z-10 relative">
                <h3 class="font-black text-lg uppercase tracking-tight flex items-center gap-3">
                    <i class="fa-solid fa-bag-shopping text-brand-cyan"></i> Mi Carrito
                </h3>
                <button onclick="window.toggleCartDrawer()" class="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-brand-red hover:text-white transition">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div id="cart-shipping-bar" class="px-6 py-3 bg-slate-50 border-b border-gray-100">
                <p id="shipping-msg" class="text-[9px] font-bold text-gray-500 uppercase tracking-wide text-center mb-2">Calculando envío...</p>
                <div class="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div id="shipping-progress" class="h-full bg-brand-cyan transition-all duration-500 w-0"></div>
                </div>
            </div>

            <div id="cart-drawer-items" class="flex-grow overflow-y-auto p-6 space-y-4 no-scrollbar relative">
                </div>

            <div class="p-6 border-t border-gray-100 bg-white z-10 relative">
                <div class="flex justify-between items-end mb-4">
                    <span class="text-[10px] font-black uppercase text-gray-400 tracking-widest">Subtotal</span>
                    <span id="cart-drawer-total" class="text-2xl font-black text-brand-black tracking-tight">$0</span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <a href="/shop/cart.html" class="py-4 rounded-xl border border-gray-200 text-brand-black font-black uppercase text-[10px] tracking-widest flex items-center justify-center hover:border-brand-black transition">
                        Ver Carrito
                    </a>
                    <button id="btn-checkout-drawer" onclick="window.location.href='/shop/checkout.html'" class="py-4 rounded-xl bg-brand-black text-white font-black uppercase text-[10px] tracking-widest flex items-center justify-center hover:bg-brand-cyan hover:text-brand-black transition shadow-lg shadow-cyan-500/10">
                        Pagar Ahora
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;

    initHeaderLogic();
}

// --- LÓGICA DE INTERACCIÓN GLOBAL ---
function initHeaderLogic() {

    // --- TOP BANNER DINÁMICO ---
    const topBanner = document.getElementById('top-banner-dynamic');
    if (topBanner) {
        getDoc(doc(db, "config", "shipping")).then(snap => {
            let freeShippingHTML = '';

            if (snap.exists()) {
                const config = snap.data();
                if (config.freeThreshold && config.freeThreshold > 0) {
                    freeShippingHTML = `
                        <span class="mx-8 flex items-center gap-2 text-brand-cyan">
                            <i class="fa-solid fa-gift animate-pulse"></i> 
                            ENVÍO GRATIS DESDE $${parseInt(config.freeThreshold).toLocaleString('es-CO')}
                        </span>
                    `;
                }
            }

            const baseContent = `
                <span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-truck-fast text-brand-cyan"></i> Envíos a toda Colombia</span>
                <span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-hand-holding-dollar text-brand-cyan"></i> Contra entrega en Bogotá</span>
                <span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-credit-card text-brand-cyan"></i> Paga con ADDI</span>
                ${freeShippingHTML}
            `;

            const messagesHTML = `
                <div class="flex items-center animate-marquee font-black uppercase tracking-[0.3em]">
                    ${baseContent} ${baseContent} ${baseContent}
                </div>
            `;

            topBanner.innerHTML = messagesHTML;
        }).catch(err => {
            console.log("Error banner:", err);
            topBanner.innerHTML = `<p class="text-center">ENVÍOS A TODO EL PAÍS 🚚</p>`;
        });
    }

    // --- WHATSAPP MODAL ---
    window.toggleWhatsAppModal = () => {
        const modal = document.getElementById('wa-modal');
        const overlay = document.getElementById('wa-overlay');
        if (modal && overlay) {
            if (modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
                overlay.classList.remove('hidden');
            } else {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                overlay.classList.add('hidden');
            }
        }
    };

    // --- DRAWER CARRITO (LÓGICA MEJORADA) ---
    const cartDrawer = document.getElementById('cart-drawer');
    const cartOverlay = document.getElementById('cart-overlay');
    let isDrawerAnimating = false; // Bandera para evitar spam de clics

    window.toggleCartDrawer = () => {
        if (!cartDrawer || !cartOverlay || isDrawerAnimating) return;
        
        const isClosed = cartDrawer.classList.contains('translate-x-full');
        isDrawerAnimating = true;

        if (isClosed) {
            // ABRIR
            cartOverlay.style.display = 'block';
            void cartOverlay.offsetWidth; // Force reflow
            cartOverlay.classList.remove('opacity-0');
            cartOverlay.classList.add('opacity-100');
            cartDrawer.classList.remove('translate-x-full');
            
            // Cargar datos inmediatamente
            window.renderCartDrawerItems();
            
            setTimeout(() => { isDrawerAnimating = false; }, 500); // Sincronizado con CSS duration-500
        } else {
            // CERRAR
            cartDrawer.classList.add('translate-x-full');
            cartOverlay.classList.remove('opacity-100');
            cartOverlay.classList.add('opacity-0');
            
            setTimeout(() => {
                cartOverlay.style.display = 'none';
                isDrawerAnimating = false;
            }, 500);
        }
    };

    // EVENT LISTENER MEJORADO
    // Solo abre si está cerrado. Si está abierto, solo actualiza datos.
    window.addEventListener('cartItemAdded', () => {
        window.updateCartCountGlobal();
        window.renderCartDrawerItems();
        
        const drawer = document.getElementById('cart-drawer');
        // Solo llamar toggle si está cerrado (tiene la clase translate-x-full)
        if (drawer && drawer.classList.contains('translate-x-full')) {
            window.toggleCartDrawer();
        }
    });

    // RENDERIZAR ITEMS DEL CARRITO EN EL DRAWER
    window.renderCartDrawerItems = async () => {
        const container = document.getElementById('cart-drawer-items');
        const totalEl = document.getElementById('cart-drawer-total');
        const shippingMsg = document.getElementById('shipping-msg');
        const shippingBar = document.getElementById('shipping-progress');
        const btnCheckout = document.getElementById('btn-checkout-drawer');

        const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];

        if (cart.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-center opacity-50 py-10">
                    <i class="fa-solid fa-basket-shopping text-6xl text-gray-200 mb-4"></i>
                    <p class="text-xs font-bold text-gray-400">Tu carrito está vacío</p>
                </div>`;
            totalEl.textContent = "$0";
            shippingMsg.innerHTML = "Agrega productos para ver beneficios";
            shippingBar.style.width = "0%";
            if (btnCheckout) btnCheckout.disabled = true;
            if (btnCheckout) btnCheckout.classList.add('opacity-50', 'cursor-not-allowed');
            return;
        }

        if (btnCheckout) btnCheckout.disabled = false;
        if (btnCheckout) btnCheckout.classList.remove('opacity-50', 'cursor-not-allowed');

        let subtotal = 0;
        container.innerHTML = cart.map((item, index) => {
            const itemTotal = item.price * item.quantity;
            subtotal += itemTotal;
            return `
                <div class="flex gap-4 items-center bg-white p-2 rounded-xl border border-gray-50 hover:border-gray-100 transition">
                    <div class="w-16 h-16 bg-gray-50 rounded-lg shrink-0 p-1 flex items-center justify-center">
                        <img src="${item.image || 'https://placehold.co/50'}" class="w-full h-full object-contain">
                    </div>
                    <div class="flex-grow min-w-0">
                        <h4 class="text-[10px] font-black uppercase text-brand-black truncate leading-tight">${item.name}</h4>
                        <p class="text-[9px] text-gray-400 mt-0.5">${item.color || ''} ${item.capacity || ''}</p>
                        <div class="flex justify-between items-center mt-2">
                            <span class="text-[10px] font-bold text-gray-500">${item.quantity} x $${item.price.toLocaleString('es-CO')}</span>
                            <span class="text-[11px] font-black text-brand-black">$${itemTotal.toLocaleString('es-CO')}</span>
                        </div>
                    </div>
                    <button onclick="window.removeCartItemDrawer(${index})" class="w-6 h-6 rounded-full bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition">
                        <i class="fa-solid fa-xmark text-[10px]"></i>
                    </button>
                </div>
            `;
        }).join('');

        totalEl.textContent = `$${subtotal.toLocaleString('es-CO')}`;

        // LÓGICA DE ENVÍO GRATIS EN TIEMPO REAL
        try {
            const snap = await getDoc(doc(db, "config", "shipping"));
            if (snap.exists()) {
                const config = snap.data();
                const threshold = parseInt(config.freeThreshold) || 0;

                if (threshold > 0) {
                    const diff = threshold - subtotal;
                    let percent = 0;
                    if (subtotal >= threshold) percent = 100;
                    else percent = (subtotal / threshold) * 100;

                    shippingBar.style.width = `${percent}%`;

                    if (diff > 0) {
                        shippingMsg.innerHTML = `Te faltan <span class="text-brand-cyan font-black">$${diff.toLocaleString('es-CO')}</span> para envío gratis`;
                        shippingBar.classList.remove('bg-green-500');
                        shippingBar.classList.add('bg-brand-cyan');
                    } else {
                        shippingMsg.innerHTML = `<span class="text-green-600 font-black"><i class="fa-solid fa-check-circle"></i> ¡Tienes envío gratis!</span>`;
                        shippingBar.classList.remove('bg-brand-cyan');
                        shippingBar.classList.add('bg-green-500');
                    }
                }
            }
        } catch (e) { console.error(e); }
    };

    window.removeCartItemDrawer = (index) => {
        let cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
        cart.splice(index, 1);
        localStorage.setItem('pixeltech_cart', JSON.stringify(cart));
        window.renderCartDrawerItems();
        window.updateCartCountGlobal();
        // Disparar evento para que si estamos en /cart.html también se actualice
        window.dispatchEvent(new Event('cartUpdated'));
    };

    // --- DRAWER MÓVIL MENU (LADO IZQUIERDO) ---
    const drawer = document.getElementById('mobile-menu-drawer');
    const overlay = document.getElementById('mobile-menu-overlay');
    const btnClose = document.getElementById('mobile-drawer-close');
    const btnCategories = document.getElementById('mobile-categories-btn');
    const btnMenu = document.getElementById('mobile-menu-btn');
    const tabs = document.querySelectorAll('.menu-tab-btn');

    const openDrawer = (tabName) => {
        if (!drawer) return;
        drawer.classList.remove('translate-x-[-100%]');
        drawer.classList.add('translate-x-0');
        overlay.classList.remove('opacity-0');

        tabs.forEach(t => {
            if (t.dataset.tab === tabName) {
                t.classList.add('active');
                document.getElementById(tabName).classList.remove('hidden');
            } else {
                t.classList.remove('active');
                document.getElementById(t.dataset.tab).classList.add('hidden');
            }
        });
    };

    const closeDrawer = () => {
        if (!drawer) return;
        drawer.classList.add('translate-x-[-100%]');
        drawer.classList.remove('translate-x-0');
        overlay.classList.add('opacity-0');
    };

    if (btnCategories) btnCategories.onclick = () => openDrawer('tab-categories');
    if (btnMenu) btnMenu.onclick = () => openDrawer('tab-menu');
    if (btnClose) btnClose.onclick = closeDrawer;
    if (overlay) overlay.onclick = closeDrawer;

    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.menu-tab-content').forEach(c => c.classList.add('hidden'));
            const target = document.getElementById(tab.dataset.tab);
            if (target) target.classList.remove('hidden');
        };
    });

    // Inicializaciones
    syncAllCategories();
    window.updateCartCountGlobal = () => {
        const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
        const count = cart.reduce((acc, i) => acc + (i.quantity || 1), 0);
        const deskBadge = document.getElementById('cart-count-desktop');
        if (deskBadge) {
            deskBadge.textContent = count;
            count > 0 ? deskBadge.classList.remove('hidden') : deskBadge.classList.add('hidden');
        }
        const mobileBadge = document.getElementById('cart-count-mobile');
        if (mobileBadge) {
            mobileBadge.textContent = count;
            count > 0 ? mobileBadge.classList.remove('hidden') : mobileBadge.classList.add('hidden');
        }
    };
    window.updateCartCountGlobal();

    // AUTH Listener
    onAuthStateChanged(auth, async (user) => {
        const container = document.getElementById('user-info-desktop');
        const mobileProfile = document.getElementById('mobile-profile-link');
        if (user) {
            if (container) {
                const userSnap = await getDoc(doc(db, "users", user.uid));
                const isAdmin = userSnap.exists() && userSnap.data().role === 'admin';
                const label = isAdmin ? 'Admin' : 'Cuenta';
                const link = isAdmin ? '/admin/index.html' : '/profile.html';
                container.innerHTML = `
                    <a href="${link}" class="flex flex-col items-center gap-1 group w-14">
                        <div class="w-12 h-12 rounded-2xl bg-brand-cyan text-brand-black flex items-center justify-center shadow-lg transition duration-300 hover:bg-white">
                            <i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-user-check'} text-xl"></i>
                        </div>
                        <span class="text-[8px] font-black uppercase tracking-widest text-brand-cyan text-center">${label}</span>
                    </a>`;
                if (mobileProfile) mobileProfile.href = link;
            }
        } else {
            if (container) {
                container.innerHTML = `
                    <a href="/auth/login.html" class="flex flex-col items-center gap-1 group w-14">
                        <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-brand-cyan transition duration-300 shadow-lg">
                            <i class="fa-regular fa-user text-xl text-white group-hover:text-brand-black"></i>
                        </div>
                        <span class="text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-brand-cyan text-center">Ingresar</span>
                    </a>`;
            }
            if (mobileProfile) mobileProfile.href = "/auth/login.html";
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

// --- SINCRONIZACIÓN DE CATEGORÍAS (ACORDEÓN MÓVIL + LISTA ESTÁTICA DESKTOP) ---
async function syncAllCategories() {
    const mobileList = document.getElementById('categories-mobile-list');

    try {
        const q = query(collection(db, "categories"), orderBy("name", "asc"));
        const snap = await getDocs(q);

        // NOTA: Se eliminó la inyección en desktopNav porque ahora es estático en el HTML.

        if (mobileList) {
            mobileList.innerHTML = `
                <a href="/shop/catalog.html" class="group flex items-center gap-3 p-3 mb-2 rounded-xl hover:bg-gray-50 transition-all border border-transparent hover:border-gray-100">
                    <div class="w-8 h-8 rounded-lg bg-brand-black text-white flex items-center justify-center shrink-0 shadow-md group-hover:scale-90 transition-transform">
                        <i class="fa-solid fa-store text-xs"></i>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-[10px] font-black uppercase tracking-widest text-brand-black">Ver Catálogo Completo</span>
                        <span class="text-[8px] font-bold text-gray-400">Explorar todos los productos</span>
                    </div>
                    <i class="fa-solid fa-arrow-right text-gray-300 ml-auto text-xs group-hover:text-brand-cyan group-hover:translate-x-1 transition-all"></i>
                </a>
                <div class="h-px w-full bg-gray-100 my-2"></div>
            `;
        }

        snap.forEach(docSnap => {
            const cat = docSnap.data();
            const subcats = cat.subcategories || [];
            const hasSub = subcats.length > 0;
            const catUrl = `/shop/search.html?category=${encodeURIComponent(cat.name)}`;

            if (mobileList) {
                const accordionId = `acc-${docSnap.id}`;
                if (!hasSub) {
                    mobileList.innerHTML += `
                        <a href="${catUrl}" class="flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition duration-300 mb-1 border-b border-gray-50 last:border-0">
                            <span class="font-bold text-xs text-gray-600 uppercase tracking-tight">${cat.name}</span>
                            <i class="fa-solid fa-chevron-right text-[10px] text-gray-300"></i>
                        </a>`;
                } else {
                    const subListHTML = subcats.map(sub => {
                        // Manejo de subcategoría como objeto o string (compatibilidad)
                        const subName = typeof sub === 'string' ? sub : sub.name;
                        return `
                        <a href="/shop/search.html?category=${encodeURIComponent(cat.name)}&subcategory=${encodeURIComponent(subName)}" 
                           class="block py-3 px-4 text-[10px] font-bold text-gray-500 hover:text-brand-cyan border-l-2 border-gray-100 hover:border-brand-cyan ml-3 transition-all">
                           ${subName}
                        </a>
                    `}).join('');

                    mobileList.innerHTML += `
                        <div class="mb-1 border-b border-gray-50 last:border-0 transition-all duration-300 group-accordion">
                            <button class="w-full flex items-center justify-between p-4 text-left focus:outline-none hover:bg-slate-50 rounded-2xl transition" onclick="window.toggleAccordion('${accordionId}')">
                                <span class="font-bold text-xs text-gray-600 uppercase tracking-tight">${cat.name}</span>
                                <div class="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 transition-transform duration-300 icon-rotate">
                                    <i class="fa-solid fa-chevron-down text-[9px]"></i>
                                </div>
                            </button>
                            <div id="${accordionId}" class="hidden bg-white px-2 pb-2">
                                <a href="${catUrl}" class="block py-3 px-4 text-[10px] font-black text-brand-black uppercase tracking-widest border-b border-dashed border-gray-100 mb-1 hover:text-brand-cyan">Ver todo ${cat.name}</a>
                                <div class="pl-2 space-y-1 mt-1">${subListHTML}</div>
                            </div>
                        </div>`;
                }
            }
        });

        if (!window.toggleAccordion) {
            window.toggleAccordion = (id) => {
                const content = document.getElementById(id);
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
    } catch (e) {
        console.error("Error cats:", e);
    }
}

// ------------------------------------------
// FOOTER RESTAURADO (DISEÑO PROFESIONAL)
// ------------------------------------------
export function loadGlobalFooter() {
    const footerContainer = document.getElementById('global-footer');
    if (!footerContainer) return;

    // Cambios Responsive: pt-12 en movil, gap-8 en movil
    footerContainer.innerHTML = `
    <footer class="bg-brand-black text-white pt-12 lg:pt-20 pb-24 lg:pb-10 border-t border-white/5">
        <div class="container mx-auto px-6">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12 mb-16">
                
                <div class="space-y-6">
                    <img src="/img/logo.png" alt="PixelTech" class="h-10 opacity-90">
                    <p class="text-gray-500 text-xs leading-relaxed uppercase font-medium tracking-wider">
                        Innovación al alcance de tu mano.
                    </p>
                    <div class="flex gap-4 text-gray-400">
                        <a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-instagram text-lg"></i></a>
                        <a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-facebook text-lg"></i></a>
                        <a href="#" class="hover:text-brand-cyan transition"><i class="fa-brands fa-tiktok text-lg"></i></a>
                    </div>
                </div>

                <div>
                    <h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Navegación</h4>
                    <ul class="space-y-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        <li><a href="/index.html" class="hover:text-white transition">Inicio</a></li>
                        <li><a href="/shop/catalog.html" class="hover:text-white transition text-brand-cyan">Catálogo</a></li>
                        <li><a href="/shop/catalog.html?mode=promos" class="hover:text-white transition">Ofertas Especiales</a></li>
                        <li><a href="/profile.html" class="hover:text-white transition">Mi Cuenta</a></li>
                    </ul>
                </div>

                <div>
                    <h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Ayuda</h4>
                    <ul class="space-y-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        <li><a href="#" class="hover:text-white transition">Rastrear Pedido</a></li>
                        <li><a href="#" class="hover:text-white transition">Políticas de Garantía</a></li>
                        <li><a href="#" class="hover:text-white transition">Envíos y Devoluciones</a></li>
                        <li><a href="#" class="hover:text-white transition">Términos y Condiciones</a></li>
                    </ul>
                </div>

                <div>
                    <h4 class="font-black text-[10px] uppercase tracking-[0.3em] text-brand-cyan mb-8">Contacto</h4>
                    <div class="space-y-4">
                        <a href="https://wa.me/573159834171" class="flex items-center gap-3 group">
                            <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-brand-cyan/20 transition">
                                <i class="fa-brands fa-whatsapp text-brand-cyan"></i>
                            </div>
                            <div>
                                <p class="text-[10px] font-black uppercase text-gray-400 group-hover:text-white transition">Ventas</p>
                                <p class="text-[9px] text-gray-500">+57 300 000 0000</p>
                            </div>
                        </a>
                        <a href="mailto:soporte@pixeltech.com" class="flex items-center gap-3 group">
                            <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-brand-cyan/20 transition">
                                <i class="fa-solid fa-envelope text-brand-cyan"></i>
                            </div>
                            <div>
                                <p class="text-[10px] font-black uppercase text-gray-400 group-hover:text-white transition">Email</p>
                                <p class="text-[9px] text-gray-500">soporte@pixeltech.com</p>
                            </div>
                        </a>
                    </div>
                </div>
            </div>

            <div class="border-t border-white/5 pt-10 flex flex-col md:flex-row justify-between items-center gap-6">
                <p class="text-[9px] font-black uppercase tracking-[0.4em] text-gray-600">
                    © 2026 PIXELTECH.
                </p>
                <div class="flex gap-4 grayscale opacity-30">
                    <i class="fa-brands fa-cc-visa text-2xl text-white"></i>
                    <i class="fa-brands fa-cc-mastercard text-2xl text-white"></i>
                    <i class="fa-brands fa-cc-amex text-2xl text-white"></i>
                </div>
            </div>
        </div>
    </footer>`;
}

/**
 * Renderiza el carrusel de marcas
 * @param {string} containerId - ID del div contenedor
 * @param {Set|Array} activeBrandNames - (Opcional) Lista de nombres de marcas que tienen productos. Si es null, muestra todas.
 */
export async function renderBrandCarousel(containerId, activeBrandNames = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        // 1. Traer todas las marcas (para obtener los logos)
        const q = query(collection(db, "brands"), orderBy("name", "asc"));
        const snap = await getDocs(q);

        let brands = [];
        snap.forEach(doc => brands.push(doc.data()));

        // 2. Filtrar solo las activas (si se requiere)
        if (activeBrandNames) {
            // Convertimos a Set para búsqueda rápida y normalizamos a minúsculas
            const activeSet = new Set([...activeBrandNames].map(b => b.toLowerCase()));
            brands = brands.filter(b => activeSet.has(b.name.toLowerCase()));
        }

        if (brands.length === 0) {
            container.innerHTML = ""; // Si no hay marcas activas, no mostrar nada
            container.classList.add('hidden');
            return;
        }

        // 3. Renderizar HTML
        container.innerHTML = `
            <div class="relative group mb-8">
                <div class="flex items-center justify-between mb-4 px-2">
                    <h3 class="font-black text-sm uppercase tracking-widest text-brand-black">Marcas Destacadas</h3>
                    <div class="flex gap-2">
                        <button id="btn-brand-prev" class="w-8 h-8 rounded-full bg-gray-50 text-brand-black hover:bg-brand-cyan hover:text-white transition flex items-center justify-center shadow-sm">
                            <i class="fa-solid fa-chevron-left text-[10px]"></i>
                        </button>
                        <button id="btn-brand-next" class="w-8 h-8 rounded-full bg-gray-50 text-brand-black hover:bg-brand-cyan hover:text-white transition flex items-center justify-center shadow-sm">
                            <i class="fa-solid fa-chevron-right text-[10px]"></i>
                        </button>
                    </div>
                </div>

                <div id="brand-track-container" class="overflow-x-auto no-scrollbar scroll-smooth">
                    <div class="flex gap-4 w-max px-1" id="brand-track">
                        ${brands.map(b => `
                            <a href="/shop/search.html?category=${encodeURIComponent(b.name)}" 
                               class="block w-28 h-28 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-brand-cyan/30 transition-all duration-300 flex flex-col items-center justify-center p-3 group/brand shrink-0">
                                <img src="${b.image || 'https://placehold.co/100'}" alt="${b.name}" class="w-full h-12 object-contain filter grayscale group-hover/brand:grayscale-0 transition duration-500 mb-2 opacity-60 group-hover/brand:opacity-100">
                                <span class="text-[9px] font-bold text-gray-400 group-hover/brand:text-brand-black uppercase tracking-wider text-center line-clamp-1">${b.name}</span>
                            </a>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        // 4. Lógica de Scroll
        const trackContainer = container.querySelector('#brand-track-container');
        const prevBtn = container.querySelector('#btn-brand-prev');
        const nextBtn = container.querySelector('#btn-brand-next');

        if (prevBtn) prevBtn.onclick = () => trackContainer.scrollBy({ left: -300, behavior: 'smooth' });
        if (nextBtn) nextBtn.onclick = () => trackContainer.scrollBy({ left: 300, behavior: 'smooth' });

    } catch (e) {
        console.error("Error marcas:", e);
    }
}