import { auth } from './firebase-init.js';

export function loadAdminSidebar() {
    const sidebarContainer = document.getElementById('admin-sidebar');
    if (!sidebarContainer) return;

    const currentPage = window.location.pathname;

    // Menú actualizado con TODOS los módulos (Incluyendo Inventario RMA)
    const navItems = [
        { name: 'Dashboard', icon: 'fa-chart-line', path: '/admin/index.html' },
        { name: 'Inventario', icon: 'fa-box-open', path: '/admin/products.html' },
        { name: 'Nueva Entrada', icon: 'fa-truck-loading', path: '/admin/inventory-entry.html' },
        { name: 'Proveedores', icon: 'fa-handshake', path: '/admin/suppliers.html' },
        { name: 'Departamentos', icon: 'fa-tags', path: '/admin/categories.html' },
        { name: 'Logística', icon: 'fa-truck-fast', path: '/admin/shipping-config.html' },
        { name: 'Banners y Promos', icon: 'fa-bullhorn', path: '/admin/promotions.html' },
        { name: 'Pedidos', icon: 'fa-clipboard-list', path: '/admin/orders.html' },
        { name: 'Garantías', icon: 'fa-shield-cat', path: '/admin/warranties.html' },
        { name: 'Inventario RMA', icon: 'fa-warehouse', path: '/admin/warranty-inventory.html' }, // ✅ Nuevo enlace agregado
        { name: 'Clientes', icon: 'fa-users', path: '/admin/clients.html' }
    ];

    const sidebarHTML = `
        <aside class="w-64 bg-brand-black text-white flex-shrink-0 flex flex-col shadow-2xl z-20 h-screen fixed md:relative transition-all">
            <div class="p-8 border-b border-gray-800 flex flex-col items-center gap-4 text-center">
                <div class="relative">
                    <div class="absolute inset-0 bg-brand-cyan/20 blur-xl rounded-full"></div>
                    <img src="../img/logo.png" alt="PixelTech" class="h-12 w-auto relative z-10">
                </div>
                <div>
                    <p class="text-[10px] text-gray-500 font-black uppercase tracking-[0.3em]">Admin Panel</p>
                </div>
            </div>

            <nav class="flex-grow p-4 space-y-1 mt-4 overflow-y-auto no-scrollbar">
                ${navItems.map(item => {
                    const isActive = currentPage.includes(item.path);
                    return `
                        <a href="${item.path}" class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 font-bold text-sm ${
                            isActive 
                            ? 'bg-brand-cyan text-brand-black shadow-lg shadow-cyan-500/20' 
                            : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                        }">
                            <i class="fa-solid ${item.icon} w-5 text-center ${isActive ? 'text-brand-black' : 'text-brand-cyan'}"></i> 
                            <span>${item.name}</span>
                        </a>
                    `;
                }).join('')}
            </nav>

            <div class="p-4 border-t border-gray-800 bg-black/20">
                <button id="btn-logout-global" class="w-full flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-brand-red hover:bg-red-500/10 rounded-xl transition-all duration-300">
                    <i class="fa-solid fa-right-from-bracket"></i> Cerrar Sesión
                </button>
            </div>
        </aside>
    `;

    sidebarContainer.innerHTML = sidebarHTML;

    const logoutBtn = document.getElementById('btn-logout-global');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            if(confirm("¿Deseas cerrar la sesión administrativa?")) {
                auth.signOut().then(() => window.location.href = '/index.html');
            }
        };
    }
}