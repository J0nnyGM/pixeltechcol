import { auth } from './firebase-init.js';

export function loadAdminSidebar() {
    const sidebarContainer = document.getElementById('admin-sidebar');
    if (!sidebarContainer) return;

    const currentPage = window.location.pathname;

    // --- 1. DEFINICIÓN DE GRUPOS Y MENÚS ---
    const navGroups = [
        {
            title: 'Principal',
            items: [
                { name: 'Dashboard', icon: 'fa-chart-line', path: '/admin/index.html' },
                { name: 'WhatsApp', icon: 'fa-brands fa-whatsapp', path: '/admin/whatsapp.html' }
            ]
        },
        {
            title: 'Gestión Comercial',
            items: [
                { name: 'Pedidos', icon: 'fa-clipboard-list', path: '/admin/orders.html' },
                { name: 'Facturación', icon: 'fa-file-invoice-dollar', path: '/admin/invoices.html' },
                { name: 'Clientes', icon: 'fa-users', path: '/admin/clients.html' },
                { name: 'Garantías', icon: 'fa-shield-cat', path: '/admin/warranties.html' }
            ]
        },
        {
            title: 'Inventario & Catálogo',
            items: [
                { name: 'Productos', icon: 'fa-box-open', path: '/admin/products.html' },
                { name: 'Categorías', icon: 'fa-tags', path: '/admin/categories.html' },
                { name: 'Marcas', icon: 'fa-copyright', path: '/admin/brands.html' }, 
                { name: 'Nueva Entrada', icon: 'fa-truck-loading', path: '/admin/inventory-entry.html' },
                { name: 'Inventario RMA', icon: 'fa-warehouse', path: '/admin/warranty-inventory.html' }
            ]
        },
        {
            title: 'Administración',
            items: [
                { name: 'Proveedores', icon: 'fa-handshake', path: '/admin/suppliers.html' },
                { name: 'Gestión de Cartera', icon: 'fa-wallet', path: '/admin/cartera.html' },
                { name: 'Cuentas', icon: 'fa-vault', path: '/admin/treasury.html' },
                { name: 'Control de Gastos', icon: 'fa-money-bill-trend-up', path: '/admin/expenses.html' }, 
                { name: 'Logística', icon: 'fa-truck-fast', path: '/admin/shipping-config.html' },
                { name: 'Banners y Promos', icon: 'fa-bullhorn', path: '/admin/promotions.html' },
                // --- NUEVO: CONFIGURACIÓN GENERAL ---
                { name: 'Configuración', icon: 'fa-gear', path: '/admin/settings.html' }
            ]
        }
    ];

    // --- 2. GENERADOR DE HTML DEL MENÚ LATERAL ---
    const generateNavHTML = () => {
        return navGroups.map(group => `
            <div class="mb-6">
                ${group.title ? `<p class="px-4 text-[9px] font-black text-gray-600 uppercase tracking-widest mb-3 opacity-60">${group.title}</p>` : ''}
                
                <div class="space-y-1">
                    ${group.items.map(item => {
                        const isActive = currentPage.includes(item.path);
                        return `
                            <a href="${item.path}" class="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 font-bold text-sm group ${
                                isActive 
                                ? 'bg-brand-cyan text-brand-black shadow-lg shadow-cyan-500/20' 
                                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                            }">
                                <div class="w-6 flex justify-center">
                                    <i class="fa-solid ${item.icon} ${isActive ? 'text-brand-black' : 'text-brand-cyan group-hover:text-white'} transition-colors"></i> 
                                </div>
                                <span>${item.name}</span>
                            </a>
                        `;
                    }).join('')}
                </div>
            </div>
        `).join('');
    };

    // --- 3. BARRA INFERIOR (SOLO MÓVIL) ---
    const mobileBottomBar = `
        <nav class="md:hidden fixed bottom-0 left-0 w-full bg-brand-black text-gray-400 border-t border-gray-800 z-50 flex justify-around items-center pb-safe">
            
            <a href="/admin/index.html" class="flex flex-col items-center py-3 px-2 w-full ${currentPage.includes('/admin/index.html') ? 'text-brand-cyan' : 'hover:text-white'}">
                <i class="fa-solid fa-chart-line text-lg mb-1"></i>
                <span class="text-[8px] font-bold uppercase tracking-widest">Inicio</span>
            </a>

            <a href="/admin/orders.html" class="flex flex-col items-center py-3 px-2 w-full ${currentPage.includes('/admin/orders.html') ? 'text-brand-cyan' : 'hover:text-white'}">
                <i class="fa-solid fa-clipboard-list text-lg mb-1"></i>
                <span class="text-[8px] font-bold uppercase tracking-widest">Pedidos</span>
            </a>

            <a href="/admin/products.html" class="flex flex-col items-center py-3 px-2 w-full ${currentPage.includes('/admin/products.html') ? 'text-brand-cyan' : 'hover:text-white'}">
                <i class="fa-solid fa-box-open text-lg mb-1"></i>
                <span class="text-[8px] font-bold uppercase tracking-widest">Stock</span>
            </a>

            <button id="mobile-menu-trigger" class="flex flex-col items-center py-3 px-2 w-full text-brand-cyan hover:text-white hover:bg-white/5 transition">
                <i class="fa-solid fa-bars text-lg mb-1"></i>
                <span class="text-[8px] font-bold uppercase tracking-widest">Menú</span>
            </button>
        </nav>
    `;

    // --- 4. OVERLAY ---
    const overlay = `
        <div id="sidebar-overlay" class="fixed inset-0 bg-black/80 z-40 hidden backdrop-blur-sm transition-opacity opacity-0"></div>
    `;

    // --- 5. ESTILOS SCROLL PERSONALIZADO ---
    const scrollStyles = `
        <style>
            .sidebar-scroll::-webkit-scrollbar { width: 4px; }
            .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
            .sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
            .sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #00AEC7; }
        </style>
    `;

    // --- 6. SIDEBAR COMPLETO (Drawer) ---
    const sidebarHTML = `
        <aside id="main-sidebar" class="fixed inset-y-0 left-0 w-72 bg-brand-black text-white flex flex-col shadow-2xl z-50 transform -translate-x-full md:translate-x-0 transition-transform duration-300 ease-out md:static md:h-screen border-r border-gray-800">
            
            <div class="p-8 border-b border-gray-800 flex justify-between items-center md:flex-col md:justify-center gap-4 bg-brand-black/50 backdrop-blur-sm sticky top-0 z-10">
                <div class="flex flex-col items-center w-full">
                    <div class="relative group cursor-pointer" onclick="window.location.href='/admin/index.html'">
                        <div class="absolute inset-0 bg-brand-cyan/20 blur-xl rounded-full group-hover:bg-brand-cyan/30 transition"></div>
                        <img src="../img/logo.png" alt="PixelTech" class="h-10 md:h-12 w-auto relative z-10 drop-shadow-lg">
                    </div>
                    <p class="text-[9px] text-gray-500 font-black uppercase tracking-[0.3em] mt-3">Admin Panel</p>
                </div>
                
                <button id="mobile-menu-close" class="md:hidden w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-white hover:bg-brand-red transition">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
            </div>

            <nav class="flex-grow p-4 mt-2 overflow-y-auto sidebar-scroll pb-24 md:pb-8">
                ${generateNavHTML()}
            </nav>

            <div class="p-4 border-t border-gray-800 bg-black/20 mb-20 md:mb-0">
                <button id="btn-logout-global" class="w-full flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-brand-red hover:bg-red-500/10 rounded-xl transition-all duration-300 group">
                    <i class="fa-solid fa-right-from-bracket group-hover:rotate-180 transition-transform duration-500"></i> Cerrar Sesión
                </button>
            </div>
        </aside>
    `;

    // Inyectar HTML + Estilos
    sidebarContainer.innerHTML = scrollStyles + overlay + sidebarHTML + mobileBottomBar;

    // --- LÓGICA DE INTERACCIÓN ---
    const sidebar = document.getElementById('main-sidebar');
    const overlayEl = document.getElementById('sidebar-overlay');
    const triggerBtn = document.getElementById('mobile-menu-trigger');
    const closeBtn = document.getElementById('mobile-menu-close');
    const logoutBtn = document.getElementById('btn-logout-global');

    function openMenu() {
        sidebar.classList.remove('-translate-x-full');
        overlayEl.classList.remove('hidden');
        setTimeout(() => overlayEl.classList.remove('opacity-0'), 10);
    }

    function closeMenu() {
        sidebar.classList.add('-translate-x-full');
        overlayEl.classList.add('opacity-0');
        setTimeout(() => overlayEl.classList.add('hidden'), 300);
    }

    if (triggerBtn) triggerBtn.addEventListener('click', openMenu);
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    if (overlayEl) overlayEl.addEventListener('click', closeMenu);

    if (logoutBtn) {
        logoutBtn.onclick = () => {
            if(confirm("¿Deseas cerrar la sesión administrativa?")) {
                auth.signOut().then(() => window.location.href = '/index.html');
            }
        };
    }
}