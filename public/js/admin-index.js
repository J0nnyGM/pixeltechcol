import '../js/admin-guard.js';
import { db, collection, query, where, orderBy, limit, auth, doc, getDoc, getDocs, onSnapshot, Timestamp } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js?v=2.0.0';
import { initManualSale, openManualSaleModal } from './manual-sale.js?v=1.0.6';
import { AdminStore } from './admin-store.js';
import './order-actions.js?v=1.1.7';

// Estado global del dashboard
let currentRole = 'admin';
let currentUserName = 'Admin';
let ordersCache = [];
let receivablesCache = [];
let activeOrderFilter = 'ALL';
let orderSearchQuery = '';
let receivableSearchQuery = '';

// Paginacion Dashboard
let currentOrdersPage = 1;
let ordersPageSize = 15;
let currentRecsPage = 1;
let recsPageSize = 15;

// Desuscriptores
let unsubscribeOrders = null;
let unsubscribeToday = null;
let unsubscribeChats = null;

// Helper universal para parsear fechas de Firestore/IndexedDB
function parseDateSafe(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    if (typeof raw.toDate === 'function') {
        const d = raw.toDate();
        return isNaN(d.getTime()) ? null : d;
    }
    if (raw.seconds) {
        const d = new Date(raw.seconds * 1000);
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof raw === 'string' || typeof raw === 'number') {
        if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
            const parts = raw.trim().split('-');
            const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
            return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

// Inicializacion principal
document.addEventListener('DOMContentLoaded', () => {
    loadAdminSidebar();
    initManualSale();
    
    const manualBtn = document.getElementById('btn-open-manual');
    if (manualBtn) manualBtn.onclick = openManualSaleModal;

    initAuthListener();
    initVersionBadge();
});

// Autenticacion y deteccion de rol
function initAuthListener() {
    auth.onAuthStateChanged(async (user) => {
        if (!user) return;
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            let role = 'customer';
            let name = user.displayName || 'Admin';
            
            if (userDoc.exists()) {
                const uData = userDoc.data();
                role = uData.role || 'customer';
                name = uData.name || user.displayName || 'Admin';
            }

            // Developer tiene acceso maestro equivalente a admin
            if (role === 'developer') role = 'admin';

            currentRole = role;
            currentUserName = name;

            const nameEl = document.getElementById('admin-name');
            if (nameEl) nameEl.textContent = name;

            renderDashboardLayout(role, name);
            subscribeDashboardData(role);
        } catch (err) {
            console.error("[Dashboard] Error al autenticar usuario:", err);
        }
    });
}

// Configura la vista segun el rol del usuario
function renderDashboardLayout(role, name) {
    const headerTitle = document.getElementById('header-role-name');
    const headerDesc = document.getElementById('header-role-desc');
    const rolePill = document.getElementById('role-pill-badge');
    const dateEl = document.getElementById('header-today-date');
    const quickActionsContainer = document.getElementById('role-quick-actions');

    // Fecha actual legible en espanol
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('es-CO', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    if (dateEl) {
        dateEl.textContent = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);
    }

    // Configuraciones especificas por rol
    if (role === 'admin') {
        if (rolePill) {
            rolePill.className = "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-900 text-white border border-slate-700 shadow-2xs";
            rolePill.innerHTML = ' Control Administrador';
        }
        if (headerTitle) headerTitle.textContent = "Panel de Gerencia";
        if (headerDesc) headerDesc.textContent = "Vision integral comercial, financiera y logistica en tiempo real.";
        
        if (quickActionsContainer) {
            quickActionsContainer.innerHTML = `
                <button id="btn-quick-sale" class="bg-brand-black text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:bg-brand-cyan hover:text-brand-black transition flex items-center gap-2 shadow-sm">
                    <i class="fa-solid fa-plus"></i> Nueva Venta
                </button>
                <a href="branches-profitability.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-chart-pie text-brand-cyan"></i> Rentabilidad
                </a>
                <a href="treasury.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-building-columns text-brand-cyan"></i> Tesoreria
                </a>
                <a href="cartera.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-hand-holding-dollar text-brand-cyan"></i> Cartera
                </a>
            `;
            const qSale = document.getElementById('btn-quick-sale');
            if (qSale) qSale.onclick = openManualSaleModal;
        }
    } 
    else if (role === 'contabilidad') {
        if (rolePill) {
            rolePill.className = "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs";
            rolePill.innerHTML = '<i class="fa-solid fa-coins text-emerald-600 mr-1.5"></i> Contabilidad';
        }
        if (headerTitle) headerTitle.textContent = "Finanzas y Tesoreria";
        if (headerDesc) headerDesc.textContent = "Balance de cuentas bancarias, flujo de caja y cartera por cobrar/pagar.";
        
        if (quickActionsContainer) {
            quickActionsContainer.innerHTML = `
                <a href="expenses.html" class="bg-brand-black text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:bg-brand-cyan hover:text-brand-black transition flex items-center gap-2 shadow-sm">
                    <i class="fa-solid fa-receipt"></i> Registrar Gasto
                </a>
                <a href="cartera.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-hand-holding-dollar text-emerald-600"></i> Gestionar Cartera
                </a>
                <a href="treasury.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-building-columns text-emerald-600"></i> Movimientos Bancarios
                </a>
                <a href="profitability.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-chart-line text-emerald-600"></i> Rentabilidad FIFO
                </a>
            `;
        }
    } 
    else if (role === 'ventas') {
        if (rolePill) {
            rolePill.className = "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-50 text-brand-cyan border border-brand-cyan/20 shadow-2xs";
            rolePill.innerHTML = '<i class="fa-solid fa-shop text-brand-cyan mr-1.5"></i> Area Comercial';
        }
        if (headerTitle) headerTitle.textContent = "Gestion de Ventas";
        if (headerDesc) headerDesc.textContent = "Cierre de pedidos, atencion a clientes y canales de comercializacion.";
        
        if (quickActionsContainer) {
            quickActionsContainer.innerHTML = `
                <button id="btn-quick-sale" class="bg-brand-black text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:bg-brand-cyan hover:text-brand-black transition flex items-center gap-2 shadow-sm">
                    <i class="fa-solid fa-plus"></i> Nueva Venta (POS)
                </button>
                <a href="whatsapp.html" class="bg-emerald-500 text-white px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:bg-emerald-600 transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-brands fa-whatsapp"></i> WhatsApp Web
                </a>
                <a href="products.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-boxes-stacked text-brand-cyan"></i> Catalogo & Stock
                </a>
                <a href="clients.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-users text-brand-cyan"></i> Clientes
                </a>
            `;
            const qSale = document.getElementById('btn-quick-sale');
            if (qSale) qSale.onclick = openManualSaleModal;
        }
    } 
    else if (role === 'logistica') {
        if (rolePill) {
            rolePill.className = "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs";
            rolePill.innerHTML = '<i class="fa-solid fa-truck-ramp-box text-amber-600 mr-1.5"></i> Bodega y Despachos';
        }
        if (headerTitle) headerTitle.textContent = "Operaciones Logisticas";
        if (headerDesc) headerDesc.textContent = "Alistamiento de ordenes, control de seriales y entregas a transportadoras.";
        
        if (quickActionsContainer) {
            quickActionsContainer.innerHTML = `
                <a href="inventory-entry.html" class="bg-brand-black text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:bg-brand-cyan hover:text-brand-black transition flex items-center gap-2 shadow-sm">
                    <i class="fa-solid fa-box-open"></i> Entrada Mercancia
                </a>
                <a href="product-serials.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-barcode text-amber-600"></i> Auditoria Seriales
                </a>
                <a href="warranty-inventory.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-shield-halved text-amber-600"></i> Inventario RMA
                </a>
                <a href="shipping-config.html" class="bg-white border border-gray-200 text-brand-black px-3.5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider hover:border-brand-cyan hover:text-brand-cyan transition flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-clock text-amber-600"></i> Horario de Corte
                </a>
            `;
        }
    }

    renderRoleCardsMarkup(role);
    renderRoleWidgetsMarkup(role);
    renderRoleTablesMarkup(role);
}

// Inyeccion de las tarjetas KPI segun rol
function renderRoleCardsMarkup(role) {
    const container = document.getElementById('cards-container');
    if (!container) return;

    if (role === 'admin') {
        container.innerHTML = `
            <div id="card-sales-today" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-green-100 text-green-600 flex items-center justify-center text-base"><i class="fa-solid fa-bolt"></i></div>
                    <span class="bg-green-50 text-green-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-green-100">Hoy</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Ventas de Hoy</p>
                <h3 id="stat-sales-today" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-sales-today" class="text-[9px] font-bold text-gray-400">0 ordenes hoy</p>
            </div>

            <div id="card-sales-month" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-cyan-100 text-brand-cyan flex items-center justify-center text-base"><i class="fa-solid fa-calendar-check"></i></div>
                    <span class="bg-cyan-50 text-cyan-800 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-cyan-100">Este Mes</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Facturado en el Mes</p>
                <h3 id="stat-sales-month" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-sales-month" class="text-[9px] font-bold text-gray-400">Mes en curso</p>
            </div>

            <div id="card-treasury" onclick="window.location.href='treasury.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-base"><i class="fa-solid fa-building-columns"></i></div>
                    <span class="bg-blue-50 text-blue-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-blue-100">Liquidez</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Saldo en Cuentas</p>
                <h3 id="stat-treasury" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-treasury" class="text-[9px] font-bold text-gray-400">Total en bancos y cajas</p>
            </div>

            <div id="card-cartera" onclick="window.location.href='cartera.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center text-base"><i class="fa-solid fa-scale-balanced"></i></div>
                    <span class="bg-amber-50 text-amber-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-amber-100">Cartera</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Por Cobrar vs Pagar</p>
                <div class="flex items-baseline gap-2 mb-1">
                    <span id="stat-receivable-summary" class="text-base font-black text-emerald-600">$0</span>
                    <span class="text-xs text-gray-300">/</span>
                    <span id="stat-payable-summary" class="text-base font-black text-rose-500">$0</span>
                </div>
                <p id="sub-cartera" class="text-[9px] font-bold text-gray-400">Clientes vs Proveedores</p>
            </div>

            <div id="card-packing-priority" onclick="scrollToOrdersTable()" class="bg-brand-black p-6 rounded-[2rem] shadow-lg shadow-gray-200 hover:shadow-2xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-gray-800 text-brand-cyan flex items-center justify-center text-base border border-gray-700"><i class="fa-solid fa-box-open"></i></div>
                    <span class="bg-brand-cyan text-brand-black text-[8px] font-black px-2 py-0.5 rounded uppercase">Por Atender</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Alistamiento Urgente</p>
                <h3 id="stat-packing-urgent" class="text-2xl font-black text-white tracking-tight leading-none mb-1">0</h3>
                <p id="sub-packing-urgent" class="text-[9px] font-bold text-gray-400">Corte 2:00 PM</p>
            </div>
        `;
    } 
    else if (role === 'contabilidad') {
        container.innerHTML = `
            <div id="card-treasury" onclick="window.location.href='treasury.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-base"><i class="fa-solid fa-building-columns"></i></div>
                    <span class="bg-blue-50 text-blue-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-blue-100">Tesoreria</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Saldo en Cuentas</p>
                <h3 id="stat-treasury" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-treasury" class="text-[9px] font-bold text-gray-400">Total disponible</p>
            </div>

            <div id="card-receivable" onclick="window.location.href='cartera.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-base"><i class="fa-solid fa-hand-holding-dollar"></i></div>
                    <span class="bg-emerald-50 text-emerald-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-emerald-100">Por Cobrar</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Cartera Clientes</p>
                <h3 id="stat-receivable" class="text-2xl font-black text-emerald-600 tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-receivable" class="text-[9px] font-bold text-gray-400">Cuentas pendientes</p>
            </div>

            <div id="card-payable" onclick="window.location.href='cartera.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center text-base"><i class="fa-solid fa-file-invoice-dollar"></i></div>
                    <span class="bg-rose-50 text-rose-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-rose-100">Por Pagar</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Proveedores & Compras</p>
                <h3 id="stat-payable" class="text-2xl font-black text-rose-600 tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-payable" class="text-[9px] font-bold text-gray-400">Compromisos pendientes</p>
            </div>

            <div id="card-sales-month" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-cyan-100 text-brand-cyan flex items-center justify-center text-base"><i class="fa-solid fa-chart-line"></i></div>
                    <span class="bg-cyan-50 text-cyan-800 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-cyan-100">Facturacion</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Ventas del Mes</p>
                <h3 id="stat-sales-month" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-sales-month" class="text-[9px] font-bold text-gray-400">Ingresos netos acumulados</p>
            </div>

            <div id="card-expenses-month" onclick="window.location.href='expenses.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center text-base"><i class="fa-solid fa-receipt"></i></div>
                    <span class="bg-orange-50 text-orange-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-orange-100">Egresos</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Gastos del Mes</p>
                <h3 id="stat-expenses-month" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-expenses-month" class="text-[9px] font-bold text-gray-400">Gastos operacionales</p>
            </div>
        `;
    }
    else if (role === 'ventas') {
        container.innerHTML = `
            <div id="card-sales-today" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-green-100 text-green-600 flex items-center justify-center text-base"><i class="fa-solid fa-hand-holding-dollar"></i></div>
                    <span class="bg-green-50 text-green-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-green-100">Ventas Hoy</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Facturado Hoy</p>
                <h3 id="stat-sales-today" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p id="sub-sales-today" class="text-[9px] font-bold text-gray-400">0 ordenes hoy</p>
            </div>

            <div id="card-packing-priority" onclick="scrollToOrdersTable()" class="bg-brand-black p-6 rounded-[2rem] shadow-lg shadow-gray-200 hover:shadow-2xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-gray-800 text-brand-cyan flex items-center justify-center text-base border border-gray-700"><i class="fa-solid fa-bell"></i></div>
                    <span class="bg-brand-cyan text-brand-black text-[8px] font-black px-2 py-0.5 rounded uppercase">Por Atender</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Pedidos Activos</p>
                <h3 id="stat-packing-urgent" class="text-2xl font-black text-white tracking-tight leading-none mb-1">0</h3>
                <p id="sub-packing-urgent" class="text-[9px] font-bold text-gray-400">Pendientes de despacho</p>
            </div>

            <div id="card-chats" onclick="window.location.href='whatsapp.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-base"><i class="fa-brands fa-whatsapp"></i></div>
                    <span class="bg-emerald-50 text-emerald-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-emerald-100">En Vivo</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Chats WhatsApp</p>
                <h3 id="stat-chats" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1">0</h3>
                <p class="text-[9px] font-bold text-gray-400">Mensajes sin atender</p>
            </div>

            <div id="card-warranties" onclick="window.location.href='warranties.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center text-base"><i class="fa-solid fa-headset"></i></div>
                    <span class="bg-amber-50 text-amber-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-amber-100">Soporte</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Garantias Clientes</p>
                <h3 id="stat-warranties" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1"><i class="fa-solid fa-spinner fa-spin text-sm"></i></h3>
                <p class="text-[9px] font-bold text-gray-400">Casos activos</p>
            </div>

            <div id="card-dispatch" onclick="scrollToOrdersTable()" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center text-base"><i class="fa-solid fa-truck-fast"></i></div>
                    <span class="bg-indigo-50 text-indigo-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-indigo-100">Envios</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Listos p/ Despacho</p>
                <h3 id="stat-dispatch" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1">0</h3>
                <p class="text-[9px] font-bold text-gray-400">Alistados para entrega</p>
            </div>
        `;
    }
    else if (role === 'logistica') {
        container.innerHTML = `
            <div id="card-packing-priority" onclick="scrollToOrdersTable()" class="bg-brand-black p-6 rounded-[2rem] shadow-lg shadow-gray-200 hover:shadow-2xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center text-base"><i class="fa-solid fa-fire"></i></div>
                    <span class="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[8px] font-black px-2 py-0.5 rounded uppercase">Corte Hoy 2 PM</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Alistar Urgente (Hoy)</p>
                <h3 id="stat-packing-urgent" class="text-2xl font-black text-white tracking-tight leading-none mb-1">0</h3>
                <p class="text-[9px] font-bold text-rose-400">Prioridad despacho hoy</p>
            </div>

            <div id="card-packing-tomorrow" onclick="scrollToOrdersTable()" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-base"><i class="fa-solid fa-clock"></i></div>
                    <span class="bg-blue-50 text-blue-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-blue-100">Manana</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Alistar Despues de Corte</p>
                <h3 id="stat-packing-tomorrow" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1">0</h3>
                <p class="text-[9px] font-bold text-gray-400">Despacho programado</p>
            </div>

            <div id="card-dispatch" onclick="scrollToOrdersTable()" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-base"><i class="fa-solid fa-truck-fast"></i></div>
                    <span class="bg-emerald-50 text-emerald-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-emerald-100">Listos</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Alistados para Guia</p>
                <h3 id="stat-dispatch" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1">0</h3>
                <p class="text-[9px] font-bold text-gray-400">Esperando transportadora</p>
            </div>

            <div id="card-warranties-rma" onclick="window.location.href='warranty-inventory.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center text-base"><i class="fa-solid fa-shield-halved"></i></div>
                    <span class="bg-amber-50 text-amber-700 text-[8px] font-black px-2 py-0.5 rounded uppercase border border-amber-100">RMA Bodega</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Equipos en Revision</p>
                <h3 id="stat-rma-count" class="text-2xl font-black text-brand-black tracking-tight leading-none mb-1">0</h3>
                <p class="text-[9px] font-bold text-gray-400">Garantias fisicas</p>
            </div>

            <div id="card-inventory-quick" onclick="window.location.href='inventory-entry.html'" class="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden group">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-xl bg-cyan-100 text-brand-cyan flex items-center justify-center text-base"><i class="fa-solid fa-dolly"></i></div>
                    <span class="bg-cyan-50 text-brand-cyan text-[8px] font-black px-2 py-0.5 rounded uppercase border border-cyan-100">Operacion</span>
                </div>
                <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Recepcion de Stock</p>
                <h3 class="text-sm font-black text-brand-black tracking-tight leading-none mb-1 flex items-center gap-1.5"><i class="fa-solid fa-arrow-right text-brand-cyan"></i> Nueva Entrada</h3>
                <p class="text-[9px] font-bold text-gray-400">Ingresar proveedores</p>
            </div>
        `;
    }
}

// Inyeccion de widgets intermedios
function renderRoleWidgetsMarkup(role) {
    const container = document.getElementById('widgets-container');
    if (!container) return;

    if (role === 'admin' || role === 'contabilidad') {
        container.innerHTML = `
            <div id="widget-treasury-section" class="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-gray-100 mb-10 fade-in">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                    <div>
                        <h3 class="text-xs font-black uppercase tracking-widest text-brand-black flex items-center gap-2">
                            <i class="fa-solid fa-building-columns text-brand-cyan"></i> Disponibilidad en Cuentas y Cajas
                        </h3>
                        <p class="text-[10px] text-gray-400 font-bold mt-0.5">Saldos bancarios actualizados en tiempo real</p>
                    </div>
                    <a href="treasury.html" class="text-[10px] font-black uppercase text-brand-cyan hover:underline flex items-center gap-1.5">
                        Ver Movimientos <i class="fa-solid fa-arrow-right text-[8px]"></i>
                    </a>
                </div>
                <div id="accounts-mosaic-grid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div class="p-4 bg-slate-50 rounded-2xl border border-gray-100 animate-pulse text-center">
                        <div class="h-3 bg-gray-200 rounded w-16 mx-auto mb-2"></div>
                        <div class="h-5 bg-gray-200 rounded w-20 mx-auto"></div>
                    </div>
                </div>
            </div>
        `;
    } else if (role === 'logistica') {
        container.innerHTML = `
            <div id="widget-logistics-banner" class="bg-gradient-to-r from-slate-900 to-brand-black text-white p-6 md:p-8 rounded-[2.5rem] shadow-xl border border-gray-800 mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6 fade-in">
                <div class="flex items-center gap-5">
                    <div class="w-14 h-14 rounded-2xl bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30 flex items-center justify-center text-2xl shrink-0">
                        <i class="fa-solid fa-clock"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="bg-rose-500 text-white text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider">Corte Nacional: 2:00 PM</span>
                            <span class="text-gray-400 text-xs font-bold">• Despachos del dia</span>
                        </div>
                        <h4 class="text-base font-black uppercase tracking-tight">Prioridad de Empaque para Hoy</h4>
                        <p class="text-xs text-gray-300 font-medium">Los pedidos pagados antes de las 2:00 PM deben entregarse rotulados hoy a Servientrega, Coordinadora o Envia.</p>
                    </div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <a href="inventory-entry.html" class="bg-brand-cyan text-brand-black px-4 py-3 rounded-xl font-black text-xs uppercase tracking-wider hover:bg-white transition flex items-center gap-2">
                        <i class="fa-solid fa-barcode"></i> Entrada
                    </a>
                    <a href="product-serials.html" class="bg-gray-800 hover:bg-gray-700 text-white border border-gray-700 px-4 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition flex items-center gap-2">
                        <i class="fa-solid fa-magnifying-glass"></i> Seriales
                    </a>
                </div>
            </div>
        `;
    } else if (role === 'ventas') {
        container.innerHTML = `
            <div id="widget-sales-summary" class="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-gray-100 mb-10 fade-in">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-xs font-black uppercase tracking-widest text-brand-black flex items-center gap-2">
                        <i class="fa-solid fa-chart-pie text-brand-cyan"></i> Canales de Venta Hoy
                    </h3>
                    <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">En Vivo</span>
                </div>
                <div id="channels-chips-grid" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div class="p-4 bg-slate-50 rounded-2xl border border-gray-100 flex items-center justify-between">
                        <div>
                            <p class="text-[9px] font-black uppercase tracking-widest text-gray-400">Tienda Web</p>
                            <h4 id="channel-web-total" class="text-lg font-black text-brand-black tracking-tight">$0</h4>
                        </div>
                        <span class="w-8 h-8 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center text-xs font-black"><i class="fa-solid fa-globe"></i></span>
                    </div>
                    <div class="p-4 bg-slate-50 rounded-2xl border border-gray-100 flex items-center justify-between">
                        <div>
                            <p class="text-[9px] font-black uppercase tracking-widest text-gray-400">Mostrador / POS</p>
                            <h4 id="channel-pos-total" class="text-lg font-black text-brand-black tracking-tight">$0</h4>
                        </div>
                        <span class="w-8 h-8 rounded-xl bg-slate-200 text-brand-black flex items-center justify-center text-xs font-black"><i class="fa-solid fa-store"></i></span>
                    </div>
                    <div class="p-4 bg-slate-50 rounded-2xl border border-gray-100 flex items-center justify-between">
                        <div>
                            <p class="text-[9px] font-black uppercase tracking-widest text-gray-400">WhatsApp Comercial</p>
                            <h4 id="channel-wa-total" class="text-lg font-black text-brand-black tracking-tight">Activo</h4>
                        </div>
                        <span class="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-black"><i class="fa-brands fa-whatsapp"></i></span>
                    </div>
                </div>
            </div>
        `;
    }
}

// Inyeccion de tablas
function renderRoleTablesMarkup(role) {
    const ordersContainer = document.getElementById('table-orders-section');
    const recsContainer = document.getElementById('table-receivables-section');

    if (role === 'contabilidad') {
        if (ordersContainer) ordersContainer.classList.add('hidden');
        if (recsContainer) recsContainer.classList.remove('hidden');
        initReceivablesSearch();
    } else {
        if (recsContainer) recsContainer.classList.add('hidden');
        if (ordersContainer) ordersContainer.classList.remove('hidden');
        setupOrdersTabs(role);
        initOrdersSearch();
    }
}

// Configura las pestanas interactivas segun el rol
function setupOrdersTabs(role) {
    const tabsContainer = document.getElementById('orders-filter-tabs');
    if (!tabsContainer) return;

    if (role === 'logistica') {
        tabsContainer.innerHTML = `
            <button data-filter="ALL" class="tab-btn active px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-brand-black text-white whitespace-nowrap shrink-0">Todos</button>
            <button data-filter="TODAY_URGENT" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">Alistar Hoy (Corte)</button>
            <button data-filter="TOMORROW" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">Alistar Mañana</button>
            <button data-filter="ALISTADO" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">Listos para Despacho</button>
        `;
    } else {
        tabsContainer.innerHTML = `
            <button data-filter="ALL" class="tab-btn active px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-brand-black text-white whitespace-nowrap shrink-0">Todos</button>
            <button data-filter="TODAY_URGENT" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">Despachar Hoy</button>
            <button data-filter="TOMORROW" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">Despachar Mañana</button>
            <button data-filter="ML" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">MercadoLibre</button>
            <button data-filter="WEB" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">Tienda Web</button>
            <button data-filter="MANUAL" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">Mostrador / POS</button>
            <button data-filter="PENDING_PAY" class="tab-btn px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition bg-white text-gray-500 hover:text-brand-black border border-gray-100 whitespace-nowrap shrink-0">Por Cobrar</button>
        `;
    }

    tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            tabsContainer.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('bg-brand-black', 'text-white', 'active');
                b.classList.add('bg-white', 'text-gray-500');
            });
            btn.classList.add('bg-brand-black', 'text-white', 'active');
            btn.classList.remove('bg-white', 'text-gray-500');
            activeOrderFilter = btn.dataset.filter;
            currentOrdersPage = 1;
            filterAndRenderOrders();
        };
    });
}

function initOrdersSearch() {
    const input = document.getElementById('orders-search-input');
    if (!input) return;
    input.oninput = (e) => {
        orderSearchQuery = e.target.value.toLowerCase().trim();
        currentOrdersPage = 1;
        filterAndRenderOrders();
    };
}

function initReceivablesSearch() {
    const input = document.getElementById('receivables-search-input');
    if (!input) return;
    input.oninput = (e) => {
        receivableSearchQuery = e.target.value.toLowerCase().trim();
        currentRecsPage = 1;
        filterAndRenderReceivables();
    };
}

// Suscripcion a los datos segun rol
function subscribeDashboardData(role) {
    const now = new Date();

    // 1. Cuentas de Tesoreria (Admin, Contabilidad)
    if (role === 'admin' || role === 'contabilidad') {
        AdminStore.subscribeToAccounts(accounts => {
            const total = accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
            const el = document.getElementById('stat-treasury');
            if (el) el.textContent = `$${total.toLocaleString('es-CO')}`;

            renderAccountsMosaic(accounts);
        });

        // Cartera por cobrar
        AdminStore.subscribeToReceivables(recs => {
            receivablesCache = recs || [];
            let totalRec = 0;
            const validRecs = receivablesCache.filter(r => r.status !== 'CANCELADO' && r.status !== 'RECHAZADO');
            validRecs.forEach(r => {
                totalRec += (Number(r.total) || 0) - (Number(r.amountPaid) || 0) - (Number(r.refundedAmount) || 0);
            });
            
            const recEl = document.getElementById('stat-receivable');
            if (recEl) recEl.textContent = `$${totalRec.toLocaleString('es-CO')}`;

            const recSummary = document.getElementById('stat-receivable-summary');
            if (recSummary) recSummary.textContent = `$${totalRec.toLocaleString('es-CO')}`;

            const subRec = document.getElementById('sub-receivable');
            if (subRec) subRec.textContent = `${validRecs.length} cuentas pendientes`;

            if (role === 'contabilidad') {
                filterAndRenderReceivables();
            }
        });

        // Cuentas por pagar
        AdminStore.subscribeToPayables(pays => {
            let totalPay = 0;
            pays.forEach(p => { totalPay += (Number(p.total) || 0) - (Number(p.amountPaid) || 0); });
            
            const payEl = document.getElementById('stat-payable');
            if (payEl) payEl.textContent = `$${totalPay.toLocaleString('es-CO')}`;

            const paySummary = document.getElementById('stat-payable-summary');
            if (paySummary) paySummary.textContent = `$${totalPay.toLocaleString('es-CO')}`;

            const subPay = document.getElementById('sub-payable');
            if (subPay) subPay.textContent = `${pays.length} compromisos`;
        });

        // Gastos del mes para contabilidad
        if (role === 'contabilidad') {
            AdminStore.subscribeToExpenses(expenses => {
                const currentYear = now.getFullYear();
                const currentMonth = now.getMonth();

                const mExpenses = expenses.filter(e => {
                    const d = parseDateSafe(e.date) || parseDateSafe(e.createdAt) || parseDateSafe(e.updatedAt);
                    if (!d) return false;
                    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
                });
                const totalExp = mExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
                const expEl = document.getElementById('stat-expenses-month');
                if (expEl) expEl.textContent = `$${totalExp.toLocaleString('es-CO')}`;
                const subExp = document.getElementById('sub-expenses-month');
                if (subExp) subExp.textContent = `${mExpenses.length} registros`;
            });
        }

        // Ventas del mes (consultado por rango de fecha sobre el mes en curso)
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const qMonth = query(
            collection(db, "orders"),
            where("createdAt", ">=", Timestamp.fromDate(startOfMonth))
        );
        getDocs(qMonth).then(snap => {
            let totalMonth = 0;
            let countMonth = 0;
            snap.forEach(docSnap => {
                const o = docSnap.data();
                if (o.status !== 'CANCELADO' && o.status !== 'RECHAZADO') {
                    totalMonth += (Number(o.total) || 0);
                    countMonth++;
                }
            });
            const el = document.getElementById('stat-sales-month');
            if (el) el.textContent = `$${totalMonth.toLocaleString('es-CO')}`;
            const sub = document.getElementById('sub-sales-month');
            if (sub) sub.textContent = `${countMonth} pedidos en el mes`;
        }).catch(err => {
            console.warn("[Dashboard] Error leyendo total del mes:", err);
        });
    }

    // 2. Ventas de Hoy en Tiempo Real (Admin, Ventas)
    if (role === 'admin' || role === 'ventas') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const qToday = query(
            collection(db, "orders"),
            where("createdAt", ">=", Timestamp.fromDate(startOfToday)),
            orderBy("createdAt", "desc")
        );

        if (unsubscribeToday) unsubscribeToday();
        unsubscribeToday = onSnapshot(qToday, (snap) => {
            let todayTotal = 0;
            let todayCount = 0;
            let webTotal = 0;
            let posTotal = 0;

            snap.forEach(d => {
                const o = d.data();
                if (o.status !== 'CANCELADO' && o.status !== 'RECHAZADO') {
                    const totalVal = Number(o.total) || 0;
                    todayTotal += totalVal;
                    todayCount++;
                    if (o.source === 'TIENDA' || o.source === 'TIENDA_WEB') webTotal += totalVal;
                    else posTotal += totalVal;
                }
            });

            const elToday = document.getElementById('stat-sales-today');
            if (elToday) elToday.textContent = `$${todayTotal.toLocaleString('es-CO')}`;
            const subToday = document.getElementById('sub-sales-today');
            if (subToday) subToday.textContent = `${todayCount} ordenes hoy`;

            const elWeb = document.getElementById('channel-web-total');
            if (elWeb) elWeb.textContent = `$${webTotal.toLocaleString('es-CO')}`;
            const elPos = document.getElementById('channel-pos-total');
            if (elPos) elPos.textContent = `$${posTotal.toLocaleString('es-CO')}`;
        }, err => console.warn("[Dashboard] Listener hoy:", err));
    }

    // 3. Garantias & RMA (Ventas, Logistica, Admin)
    if (role === 'ventas' || role === 'admin') {
        AdminStore.subscribeToWarranties(warranties => {
            const activeW = warranties.filter(w => w.status === 'PENDIENTE' || w.status === 'PENDIENTE_REVISION');
            const el = document.getElementById('stat-warranties');
            if (el) el.textContent = activeW.length;
        });
    }

    if (role === 'logistica') {
        AdminStore.subscribeToRma(rmaList => {
            const activeRMA = rmaList.filter(r => r.status !== 'ENTREGADO' && r.status !== 'DEVUELTO');
            const el = document.getElementById('stat-rma-count');
            if (el) el.textContent = activeRMA.length;
        });
    }

    // 4. Chats de WhatsApp (Ventas)
    if (role === 'ventas') {
        if (unsubscribeChats) unsubscribeChats();
        const qChats = query(collection(db, "chats"), where("status", "==", "open"));
        unsubscribeChats = onSnapshot(qChats, snap => {
            let unreadChats = 0;
            snap.forEach(d => {
                const c = d.data();
                if (!c.assignedTo || c.unread) unreadChats++;
            });
            const el = document.getElementById('stat-chats');
            if (el) el.textContent = unreadChats;
        }, err => console.warn("[Dashboard] Listener chats:", err));
    }

    // 5. Tabla de Pedidos en Vivo (Admin, Ventas, Logistica)
    if (role !== 'contabilidad') {
        if (unsubscribeOrders) unsubscribeOrders();
        const qOrders = query(
            collection(db, "orders"),
            where("status", "in", ["PAGADO", "PENDIENTE", "ALISTADO", "CANCELACION_PENDIENTE"]),
            orderBy("createdAt", "desc")
        );

        unsubscribeOrders = onSnapshot(qOrders, snap => {
            ordersCache = [];
            let urgentTodayCount = 0;
            let tomorrowCount = 0;
            let alistadoCount = 0;

            const cutoffToday = new Date();
            cutoffToday.setHours(14, 0, 0, 0); // 2:00 PM

            snap.forEach(d => {
                const o = { id: d.id, ...d.data() };
                ordersCache.push(o);

                const oDate = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : new Date(o.createdAt || Date.now()));
                const isCreatedToday = oDate.toDateString() === now.toDateString();

                if (o.status === 'ALISTADO') {
                    alistadoCount++;
                } else if (isCreatedToday && oDate > cutoffToday) {
                    tomorrowCount++;
                } else {
                    urgentTodayCount++;
                }
            });

            // Actualizar tarjetas de conteo
            const elUrgent = document.getElementById('stat-packing-urgent');
            if (elUrgent) elUrgent.textContent = urgentTodayCount;

            const elTomorrow = document.getElementById('stat-packing-tomorrow');
            if (elTomorrow) elTomorrow.textContent = tomorrowCount;

            const elDispatch = document.getElementById('stat-dispatch');
            if (elDispatch) elDispatch.textContent = alistadoCount;

            filterAndRenderOrders();
        }, err => console.error("[Dashboard] Error leyendo pedidos en vivo:", err));
    }
}

// Renderiza el mosaico de cuentas de tesoreria
function renderAccountsMosaic(accounts) {
    const grid = document.getElementById('accounts-mosaic-grid');
    if (!grid) return;

    if (!accounts || accounts.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-xs text-gray-400 font-bold text-center py-4">No hay cuentas bancarias registradas.</p>`;
        return;
    }

    grid.innerHTML = accounts.map(a => {
        const bal = Number(a.balance) || 0;
        let icon = '<i class="fa-solid fa-building-columns text-blue-500"></i>';
        if (a.name?.toLowerCase().includes('nequi')) icon = '<i class="fa-solid fa-mobile-screen-button text-purple-600"></i>';
        else if (a.name?.toLowerCase().includes('daviplata')) icon = '<i class="fa-solid fa-mobile-screen text-red-500"></i>';
        else if (a.name?.toLowerCase().includes('caja')) icon = '<i class="fa-solid fa-cash-register text-emerald-600"></i>';
        else if (a.name?.toLowerCase().includes('mercadopago')) icon = '<i class="fa-solid fa-handshake text-cyan-600"></i>';

        return `
            <div class="p-4 bg-slate-50 hover:bg-white rounded-2xl border border-gray-100 hover:border-brand-cyan hover:shadow-md transition cursor-pointer flex flex-col justify-between" onclick="window.location.href='treasury.html'">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm">${icon}</span>
                    <span class="text-[8px] font-black uppercase text-gray-400 tracking-wider">${a.type || 'Cuenta'}</span>
                </div>
                <div>
                    <h5 class="text-[10px] font-black uppercase text-brand-black truncate mb-1" title="${a.name}">${a.name}</h5>
                    <p class="text-sm font-black text-brand-black tracking-tight leading-none">$${bal.toLocaleString('es-CO')}</p>
                </div>
            </div>
        `;
    }).join('');
}

// Filtra y renderiza los pedidos en la tabla desktop y tarjetas moviles
function filterAndRenderOrders() {
    const tableBody = document.getElementById('orders-table-body');
    const mobileList = document.getElementById('orders-mobile-list');
    const badgeCount = document.getElementById('orders-count-badge');
    if (!tableBody && !mobileList) return;

    const now = new Date();
    const cutoffToday = new Date();
    cutoffToday.setHours(14, 0, 0, 0);

    let filtered = ordersCache.filter(o => {
        // Filtro de busqueda reactiva
        if (orderSearchQuery) {
            const client = (o.buyerInfo?.name || o.userName || '').toLowerCase();
            const phone = (o.buyerInfo?.phone || o.phone || '').toLowerCase();
            const city = (o.shippingData?.city || o.buyerInfo?.city || '').toLowerCase();
            const num = String(o.internalOrderNumber || o.id).toLowerCase();
            if (!client.includes(orderSearchQuery) && !phone.includes(orderSearchQuery) && !city.includes(orderSearchQuery) && !num.includes(orderSearchQuery)) {
                return false;
            }
        }

        // Filtro por pestana
        const oDate = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : new Date(o.createdAt || Date.now()));
        const isCreatedToday = oDate.toDateString() === now.toDateString();

        if (activeOrderFilter === 'TODAY_URGENT') {
            return o.status !== 'ALISTADO' && (!isCreatedToday || oDate <= cutoffToday);
        }
        if (activeOrderFilter === 'TOMORROW') {
            return o.status !== 'ALISTADO' && isCreatedToday && oDate > cutoffToday;
        }
        if (activeOrderFilter === 'ALISTADO') {
            return o.status === 'ALISTADO';
        }
        const isML = (o.source && o.source.startsWith('MERCADOLIBRE')) ||
                     o.channel === 'MERCADOLIBRE' ||
                     (o.paymentMethod && o.paymentMethod.startsWith('MERCADOLIBRE')) ||
                     String(o.id).startsWith('ML-') ||
                     String(o.id).startsWith('ML2-') ||
                     String(o.id).startsWith('ML3-');
        const isWeb = o.source === 'TIENDA' || o.source === 'TIENDA_WEB';

        if (activeOrderFilter === 'ML') {
            return isML;
        }
        if (activeOrderFilter === 'WEB') {
            return isWeb;
        }
        if (activeOrderFilter === 'MANUAL') {
            return !isWeb && !isML;
        }
        if (activeOrderFilter === 'PENDING_PAY') {
            const tot = Number(o.total) || 0;
            const paid = Number(o.amountPaid) || 0;
            const ref = Number(o.refundedAmount) || 0;
            return (tot - paid - ref) > 0 && o.paymentStatus !== 'PAID' && o.status !== 'PAGADO';
        }

        return true;
    });

    const totalFiltered = filtered.length;
    if (badgeCount) badgeCount.textContent = totalFiltered;

    if (totalFiltered === 0) {
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="p-12 text-center text-xs text-brand-black font-bold uppercase"><i class="fa-solid fa-circle-check text-green-500 mr-2 text-sm"></i> No hay pedidos pendientes en esta vista.</td></tr>`;
        if (mobileList) mobileList.innerHTML = `<div class="p-8 text-center text-xs text-brand-black font-bold uppercase"><i class="fa-solid fa-circle-check text-green-500 mr-2 text-sm"></i> No hay pedidos pendientes en esta vista.</div>`;
        updateOrdersPaginationControls(0, 0, 0);
        return;
    }

    const totalPages = Math.ceil(totalFiltered / ordersPageSize) || 1;
    if (currentOrdersPage > totalPages) currentOrdersPage = totalPages;
    if (currentOrdersPage < 1) currentOrdersPage = 1;

    const startIndex = (currentOrdersPage - 1) * ordersPageSize;
    const endIndex = Math.min(startIndex + ordersPageSize, totalFiltered);
    const pageItems = filtered.slice(startIndex, endIndex);

    if (tableBody) {
        tableBody.innerHTML = pageItems.map(o => {
            try {
                return renderOrderRow(o, currentRole);
            } catch (errRow) {
                console.error("[Dashboard] Error renderizando orden desktop:", o.id, errRow);
                return `<tr><td colspan="7" class="p-4 text-center text-xs text-rose-500 font-bold">Error al procesar orden #${o.id}</td></tr>`;
            }
        }).join('');
    }
    if (mobileList) {
        mobileList.innerHTML = pageItems.map(o => {
            try {
                return renderOrderMobileCard(o, currentRole);
            } catch (errCard) {
                console.error("[Dashboard] Error renderizando orden movil:", o.id, errCard);
                return `<div class="p-4 text-center text-xs text-rose-500 font-bold">Error al procesar orden #${o.id}</div>`;
            }
        }).join('');
    }

    updateOrdersPaginationControls(startIndex + 1, endIndex, totalFiltered);
}

// Renderiza una fila de la tabla de pedidos (Desktop)
function renderOrderRow(o, role) {
    const isWeb = o.source === 'TIENDA' || o.source === 'TIENDA_WEB';
    const isCancelPending = o.cancellationPendingConfirm || o.status === 'CANCELACION_PENDIENTE';
    const total = Number(o.total) || 0;
    const paid = Number(o.amountPaid) || 0;
    const refunded = Number(o.refundedAmount) || 0;
    let pendingBalance = total - paid - refunded;
    if (pendingBalance < 0) pendingBalance = 0;

    const isFullyPaid = o.paymentStatus === 'PAID' || o.status === 'PAGADO' || pendingBalance === 0;

    // Badges de estado logistico
    let sClass = 'bg-gray-100 text-gray-500 border-gray-200';
    let sText = o.status;
    if (isCancelPending) {
        sClass = 'bg-rose-600 text-white border-rose-700 font-black animate-pulse';
        sText = 'CANCELADO ML';
    } else if (o.status === 'PENDIENTE') { sClass = 'bg-yellow-50 text-yellow-700 border-yellow-200'; sText = 'Por Alistar'; }
    else if (o.status === 'ALISTADO') { sClass = 'bg-cyan-50 text-brand-cyan border-brand-cyan/20'; sText = 'Alistado'; }
    else if (o.status === 'PAGADO') { sClass = 'bg-rose-50 text-rose-600 border-rose-200 font-black animate-pulse'; sText = 'PAGADO URGENTE'; }

    // Badge de pago
    let pBadge = `<span class="text-[9px] font-black uppercase text-rose-600 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200 whitespace-nowrap inline-block">Saldo: $${pendingBalance.toLocaleString('es-CO')}</span>`;
    if (isFullyPaid) {
        pBadge = `<span class="text-[9px] font-black uppercase text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 whitespace-nowrap inline-flex items-center gap-1"><i class="fa-solid fa-check text-[8px]"></i> Pagado</span>`;
    }

    // Fecha formateada
    const oDate = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : new Date(o.createdAt || Date.now()));
    const dateStr = oDate ? oDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '--';

    // Ciudad y direccion
    const city = String(o.shippingData?.city || o.buyerInfo?.city || (isWeb ? 'Nacional' : 'Mostrador'));
    const isBogota = city.toLowerCase().includes('bogota') || city.toLowerCase().includes('bogotá');

    const isML = (o.source && o.source.startsWith('MERCADOLIBRE')) ||
                 o.channel === 'MERCADOLIBRE' ||
                 (o.paymentMethod && o.paymentMethod.startsWith('MERCADOLIBRE')) ||
                 String(o.id).startsWith('ML-') ||
                 String(o.id).startsWith('ML2-') ||
                 String(o.id).startsWith('ML3-');

    let channelBadgeHtml = '<span class="text-[8px] font-black px-2.5 py-1 rounded-md shadow-2xs whitespace-nowrap inline-block bg-slate-900 text-white">MOSTRADOR</span>';
    if (isML) {
        channelBadgeHtml = '<span class="text-[8px] font-black px-2.5 py-1 rounded-md shadow-2xs whitespace-nowrap inline-block bg-[#FFE600] text-black border border-yellow-400">MERCADOLIBRE</span>';
    } else if (isWeb) {
        channelBadgeHtml = '<span class="text-[8px] font-black px-2.5 py-1 rounded-md shadow-2xs whitespace-nowrap inline-block bg-cyan-50 text-cyan-800 border border-cyan-200">TIENDA WEB</span>';
    }

    const cancelConfirmBtn = isCancelPending ? `
        <button onclick="window.confirmOrderCancellation('${o.id}')" title="Confirmar Retención en Bodega" class="h-9 px-2.5 rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition shadow-sm flex items-center gap-1 text-[9px] font-black uppercase shrink-0">
            <i class="fa-solid fa-hand text-xs"></i> <span>Retener</span>
        </button>
    ` : '';

    // Botones de accion segun rol
    let actionsHtml = '';
    if (role === 'logistica') {
        const isReadyToDispatch = o.status === 'ALISTADO';
        actionsHtml = `
            <div class="flex items-center justify-center gap-1.5 whitespace-nowrap">
                ${cancelConfirmBtn}
                <button onclick="window.viewOrderDetail('${o.id}')" title="Alistar / Registrar Seriales" class="h-9 px-3 rounded-xl bg-brand-black text-white hover:bg-brand-cyan hover:text-brand-black transition shadow-sm flex items-center gap-1.5 text-[9px] font-black uppercase shrink-0">
                    <i class="fa-solid fa-boxes-packing text-xs"></i> <span>Alistar</span>
                </button>
                ${isReadyToDispatch && !isCancelPending ? `
                    <button onclick="window.openDispatchModal('${o.id}')" title="Despachar / Asignar Guia" class="h-9 px-3 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition shadow-sm flex items-center gap-1 text-[9px] font-black uppercase shrink-0">
                        <i class="fa-solid fa-truck-fast text-xs"></i> <span>Despachar</span>
                    </button>
                ` : ''}
            </div>
        `;
    } else {
        const canPay = pendingBalance > 0 && !isFullyPaid;
        actionsHtml = `
            <div class="flex items-center justify-center gap-1.5 whitespace-nowrap">
                ${cancelConfirmBtn}
                <button onclick="window.viewOrderDetail('${o.id}')" title="Ver Detalle" class="w-9 h-9 rounded-xl bg-white border border-gray-200 text-brand-black hover:bg-brand-black hover:text-white transition shadow-sm flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-eye text-xs"></i>
                </button>
                <button onclick="window.viewReceipt('${o.id}')" title="Ver Recibo" class="w-9 h-9 rounded-xl bg-white border border-rose-200 text-rose-500 hover:bg-rose-500 hover:text-white transition shadow-sm flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-receipt text-xs"></i>
                </button>
                ${canPay ? `
                    <button onclick="window.openPaymentModal('${o.id}', ${pendingBalance})" title="Registrar Pago" class="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-500 hover:text-white transition shadow-sm flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-hand-holding-dollar text-xs"></i>
                    </button>
                ` : ''}
            </div>
        `;
    }

    return `
        <tr class="${isCancelPending ? 'bg-rose-50/90 border-l-4 border-rose-600' : 'hover:bg-slate-50'} transition border-b border-gray-100 group fade-in">
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="font-mono text-[11px] text-brand-black uppercase font-black">#${(o.internalOrderNumber || o.id.slice(0, 8)).toString().toUpperCase()}</div>
                <div class="text-[9px] font-bold text-gray-400 mt-0.5 flex items-center gap-1.5">
                    <span>${dateStr}</span>
                    ${(window.hasDraftSerials && window.hasDraftSerials(o.id) && o.status !== 'DESPACHADO') ? `<span class="bg-cyan-50 border border-cyan-200 text-brand-cyan text-[8px] font-black px-1.5 py-0.5 rounded uppercase"><i class="fa-solid fa-floppy-disk text-[7px]"></i> Borrador</span>` : ''}
                </div>
            </td>
            <td class="px-6 py-4 min-w-[200px]">
                <div class="font-black text-brand-black uppercase text-xs truncate max-w-[220px]" title="${o.buyerInfo?.name || o.userName || 'Cliente General'}">${o.buyerInfo?.name || o.userName || 'Cliente General'}</div>
                <div class="text-[9px] text-gray-400 font-bold flex items-center gap-2 mt-0.5">
                    <span><i class="fa-solid fa-phone text-[8px] mr-0.5"></i> ${o.buyerInfo?.phone || o.phone || '--'}</span>
                    <span class="text-gray-300">•</span>
                    <span class="${isBogota ? 'text-brand-cyan' : 'text-gray-500'} font-bold truncate max-w-[120px]"><i class="fa-solid fa-location-dot text-[8px] mr-0.5"></i> ${city}</span>
                </div>
            </td>
            <td class="px-6 py-4 text-center whitespace-nowrap">
                ${channelBadgeHtml}
            </td>
            <td class="px-6 py-4 text-center whitespace-nowrap">${pBadge}</td>
            <td class="px-6 py-4 text-center whitespace-nowrap">
                <span class="${sClass} px-3 py-1 rounded-full text-[9px] font-black uppercase border shadow-2xs whitespace-nowrap inline-block">${sText}</span>
            </td>
            <td class="px-6 py-4 text-right font-black text-brand-black text-sm whitespace-nowrap">
                $${total.toLocaleString('es-CO')}
            </td>
            <td class="px-6 py-4 text-center whitespace-nowrap">
                ${actionsHtml}
            </td>
        </tr>
    `;
}

// Renderiza una tarjeta de pedido para vista movil (< md)
function renderOrderMobileCard(o, role) {
    const isWeb = o.source === 'TIENDA' || o.source === 'TIENDA_WEB';
    const isCancelPending = o.cancellationPendingConfirm || o.status === 'CANCELACION_PENDIENTE';
    const total = Number(o.total) || 0;
    const paid = Number(o.amountPaid) || 0;
    const refunded = Number(o.refundedAmount) || 0;
    let pendingBalance = total - paid - refunded;
    if (pendingBalance < 0) pendingBalance = 0;
    const isFullyPaid = o.paymentStatus === 'PAID' || o.status === 'PAGADO' || pendingBalance === 0;

    let sClass = 'bg-gray-100 text-gray-500 border-gray-200';
    let sText = o.status;
    if (isCancelPending) {
        sClass = 'bg-rose-600 text-white border-rose-700 font-black animate-pulse';
        sText = 'CANCELADO ML';
    } else if (o.status === 'PENDIENTE') { sClass = 'bg-yellow-50 text-yellow-700 border-yellow-200'; sText = 'Por Alistar'; }
    else if (o.status === 'ALISTADO') { sClass = 'bg-cyan-50 text-brand-cyan border-brand-cyan/20'; sText = 'Alistado'; }
    else if (o.status === 'PAGADO') { sClass = 'bg-rose-50 text-rose-600 border-rose-200 font-black animate-pulse'; sText = 'PAGADO URGENTE'; }

    let pBadge = `<span class="text-[9px] font-black uppercase text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 whitespace-nowrap">Saldo: $${pendingBalance.toLocaleString('es-CO')}</span>`;
    if (isFullyPaid) {
        pBadge = `<span class="text-[9px] font-black uppercase text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 whitespace-nowrap inline-flex items-center gap-1"><i class="fa-solid fa-check text-[8px]"></i> Pagado</span>`;
    }

    const oDate = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : new Date(o.createdAt || Date.now()));
    const dateStr = oDate ? oDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '--';

    const clientName = o.buyerInfo?.name || o.userName || 'Cliente General';
    const phone = o.buyerInfo?.phone || o.phone || '';
    const city = String(o.shippingData?.city || o.buyerInfo?.city || (isWeb ? 'Nacional' : 'Mostrador'));
    const isBogota = city.toLowerCase().includes('bogota') || city.toLowerCase().includes('bogotá');
    const orderNum = (o.internalOrderNumber || o.id.slice(0, 8)).toString().toUpperCase();

    const isML = (o.source && o.source.startsWith('MERCADOLIBRE')) ||
                 o.channel === 'MERCADOLIBRE' ||
                 (o.paymentMethod && o.paymentMethod.startsWith('MERCADOLIBRE')) ||
                 String(o.id).startsWith('ML-') ||
                 String(o.id).startsWith('ML2-') ||
                 String(o.id).startsWith('ML3-');

    let mobileChannelBadgeHtml = '<span class="text-[8px] font-black px-2 py-0.5 rounded shadow-2xs whitespace-nowrap bg-slate-900 text-white">MOSTRADOR</span>';
    if (isML) {
        mobileChannelBadgeHtml = '<span class="text-[8px] font-black px-2 py-0.5 rounded shadow-2xs whitespace-nowrap bg-[#FFE600] text-black border border-yellow-400">MERCADOLIBRE</span>';
    } else if (isWeb) {
        mobileChannelBadgeHtml = '<span class="text-[8px] font-black px-2 py-0.5 rounded shadow-2xs whitespace-nowrap bg-cyan-50 text-cyan-800 border border-cyan-200">TIENDA WEB</span>';
    }

    const cancelConfirmBtn = isCancelPending ? `
        <button onclick="window.confirmOrderCancellation('${o.id}')" class="flex-1 py-2 px-3 rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition text-xs font-black uppercase flex items-center justify-center gap-1.5 shadow-2xs">
            <i class="fa-solid fa-hand text-xs"></i> <span>Retener Bodega</span>
        </button>
    ` : '';

    let actionsHtml = '';
    if (role === 'logistica') {
        const isReadyToDispatch = o.status === 'ALISTADO';
        actionsHtml = `
            <div class="flex items-center gap-2 pt-2 border-t border-gray-100 flex-wrap">
                ${cancelConfirmBtn}
                <button onclick="window.viewOrderDetail('${o.id}')" class="flex-1 py-2 px-3 rounded-xl bg-brand-black text-white hover:bg-brand-cyan hover:text-brand-black transition text-xs font-black uppercase flex items-center justify-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-boxes-packing text-xs"></i> <span>Alistar</span>
                </button>
                ${isReadyToDispatch && !isCancelPending ? `
                    <button onclick="window.openDispatchModal('${o.id}')" class="flex-1 py-2 px-3 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition text-xs font-black uppercase flex items-center justify-center gap-1.5 shadow-2xs">
                        <i class="fa-solid fa-truck-fast text-xs"></i> <span>Despachar</span>
                    </button>
                ` : ''}
            </div>
        `;
    } else {
        const canPay = pendingBalance > 0 && !isFullyPaid;
        actionsHtml = `
            <div class="flex items-center gap-2 pt-2 border-t border-gray-100 flex-wrap">
                ${cancelConfirmBtn}
                <button onclick="window.viewOrderDetail('${o.id}')" class="flex-1 py-2 px-3 rounded-xl bg-slate-100 text-brand-black hover:bg-brand-black hover:text-white transition text-xs font-black uppercase flex items-center justify-center gap-1.5">
                    <i class="fa-solid fa-eye text-xs"></i> <span>Detalle</span>
                </button>
                <button onclick="window.viewReceipt('${o.id}')" class="py-2 px-3 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-500 hover:text-white transition text-xs font-black uppercase flex items-center justify-center gap-1">
                    <i class="fa-solid fa-receipt text-xs"></i>
                </button>
                ${canPay ? `
                    <button onclick="window.openPaymentModal('${o.id}', ${pendingBalance})" class="py-2 px-3 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-500 hover:text-white transition text-xs font-black uppercase flex items-center justify-center gap-1">
                        <i class="fa-solid fa-hand-holding-dollar text-xs"></i> <span>Cobrar</span>
                    </button>
                ` : ''}
            </div>
        `;
    }

    return `
        <div class="p-4 space-y-2.5 ${isCancelPending ? 'bg-rose-50/90 border-l-4 border-rose-600' : 'hover:bg-slate-50/50'} transition">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-mono text-xs font-black text-brand-black uppercase">#${orderNum}</span>
                    ${mobileChannelBadgeHtml}
                    ${(window.hasDraftSerials && window.hasDraftSerials(o.id) && o.status !== 'DESPACHADO') ? `<span class="bg-cyan-50 border border-cyan-200 text-brand-cyan text-[8px] font-black px-1.5 py-0.5 rounded uppercase"><i class="fa-solid fa-floppy-disk text-[7px]"></i> Borrador</span>` : ''}
                </div>
                <span class="text-[10px] font-bold text-gray-400 whitespace-nowrap">${dateStr}</span>
            </div>

            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                    <h4 class="font-black text-brand-black uppercase text-xs truncate">${clientName}</h4>
                    <div class="text-[10px] text-gray-500 font-bold flex items-center gap-2 mt-0.5 flex-wrap">
                        ${phone ? `<a href="tel:${phone}" class="hover:text-brand-cyan transition"><i class="fa-solid fa-phone text-[8px] mr-1"></i>${phone}</a>` : ''}
                        <span>•</span>
                        <span class="${isBogota ? 'text-brand-cyan' : 'text-gray-500'} font-bold"><i class="fa-solid fa-location-dot text-[8px] mr-1"></i>${city}</span>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-sm font-black text-brand-black block">$${total.toLocaleString('es-CO')}</span>
                </div>
            </div>

            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="${sClass} px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase border shadow-2xs whitespace-nowrap">${sText}</span>
                    ${pBadge}
                </div>
            </div>

            ${actionsHtml}
        </div>
    `;
}

// Filtra y renderiza las cuentas por cobrar (Rol Contabilidad)
function filterAndRenderReceivables() {
    const tableBody = document.getElementById('receivables-table-body');
    const mobileList = document.getElementById('receivables-mobile-list');
    if (!tableBody && !mobileList) return;

    let filtered = receivablesCache.filter(r => {
        if (r.status === 'CANCELADO' || r.status === 'RECHAZADO') return false;
        const total = Number(r.total) || 0;
        const paid = Number(r.amountPaid) || 0;
        const ref = Number(r.refundedAmount) || 0;
        const balance = total - paid - ref;
        if (balance <= 0) return false;

        if (receivableSearchQuery) {
            const client = (r.userName || r.buyerInfo?.name || '').toLowerCase();
            const phone = (r.phone || r.buyerInfo?.phone || '').toLowerCase();
            const num = String(r.internalOrderNumber || r.orderNumber || r.id).toLowerCase();
            if (!client.includes(receivableSearchQuery) && !phone.includes(receivableSearchQuery) && !num.includes(receivableSearchQuery)) {
                return false;
            }
        }
        return true;
    });

    const totalFiltered = filtered.length;

    if (totalFiltered === 0) {
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="p-12 text-center text-xs text-brand-black font-bold uppercase"><i class="fa-solid fa-circle-check text-green-500 mr-2 text-sm"></i> Excelente. No hay cartera pendiente de cobro.</td></tr>`;
        if (mobileList) mobileList.innerHTML = `<div class="p-8 text-center text-xs text-brand-black font-bold uppercase"><i class="fa-solid fa-circle-check text-green-500 mr-2 text-sm"></i> Excelente. No hay cartera pendiente de cobro.</div>`;
        updateRecsPaginationControls(0, 0, 0);
        return;
    }

    const totalPages = Math.ceil(totalFiltered / recsPageSize) || 1;
    if (currentRecsPage > totalPages) currentRecsPage = totalPages;
    if (currentRecsPage < 1) currentRecsPage = 1;

    const startIndex = (currentRecsPage - 1) * recsPageSize;
    const endIndex = Math.min(startIndex + recsPageSize, totalFiltered);
    const pageItems = filtered.slice(startIndex, endIndex);

    if (tableBody) {
        tableBody.innerHTML = pageItems.map(r => {
            const total = Number(r.total) || 0;
            const paid = Number(r.amountPaid) || 0;
            const ref = Number(r.refundedAmount) || 0;
            const balance = total - paid - ref;
            const oDate = r.createdAt?.toDate ? r.createdAt.toDate() : (r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000) : new Date(r.createdAt || Date.now()));
            const dateStr = oDate ? oDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '--';

            return `
                <tr class="hover:bg-slate-50 transition border-b border-gray-50 group fade-in">
                    <td class="px-6 py-4 font-mono text-[11px] font-black text-brand-black uppercase whitespace-nowrap">
                        #${(r.internalOrderNumber || r.orderNumber || r.id.slice(0, 8)).toString().toUpperCase()}
                        <div class="text-[9px] font-bold text-gray-400 mt-0.5">${dateStr}</div>
                    </td>
                    <td class="px-6 py-4">
                        <div class="font-black text-brand-black uppercase text-xs truncate max-w-[220px]">${r.userName || r.buyerInfo?.name || 'Cliente'}</div>
                        <div class="text-[9px] text-gray-400 font-bold"><i class="fa-solid fa-phone text-[8px] mr-0.5"></i> ${r.phone || r.buyerInfo?.phone || '--'}</div>
                    </td>
                    <td class="px-6 py-4 text-right font-bold text-gray-700 text-xs whitespace-nowrap">$${total.toLocaleString('es-CO')}</td>
                    <td class="px-6 py-4 text-right font-bold text-emerald-600 text-xs whitespace-nowrap">$${paid.toLocaleString('es-CO')}</td>
                    <td class="px-6 py-4 text-right font-black text-rose-600 text-sm whitespace-nowrap">$${balance.toLocaleString('es-CO')}</td>
                    <td class="px-6 py-4 text-center whitespace-nowrap">
                        <span class="bg-rose-50 border border-rose-100 text-rose-600 text-[8px] font-black px-2 py-0.5 rounded uppercase">Pendiente</span>
                    </td>
                    <td class="px-6 py-4 text-center whitespace-nowrap">
                        <button onclick="window.openPaymentModal('${r.id}', ${balance})" title="Registrar Cobro" class="h-9 px-3 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition shadow-sm font-black text-[9px] uppercase tracking-wider flex items-center justify-center gap-1.5 mx-auto">
                            <i class="fa-solid fa-hand-holding-dollar text-xs"></i> <span>Cobrar</span>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (mobileList) {
        mobileList.innerHTML = pageItems.map(r => {
            const total = Number(r.total) || 0;
            const paid = Number(r.amountPaid) || 0;
            const ref = Number(r.refundedAmount) || 0;
            const balance = total - paid - ref;
            const oDate = r.createdAt?.toDate ? r.createdAt.toDate() : (r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000) : new Date(r.createdAt || Date.now()));
            const dateStr = oDate ? oDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '--';

            return `
                <div class="p-4 space-y-2.5 hover:bg-slate-50/50 transition">
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-mono text-xs font-black text-brand-black uppercase">#${(r.internalOrderNumber || r.orderNumber || r.id.slice(0, 8)).toString().toUpperCase()}</span>
                        <span class="text-[10px] font-bold text-gray-400">${dateStr}</span>
                    </div>
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <h4 class="font-black text-brand-black uppercase text-xs">${r.userName || r.buyerInfo?.name || 'Cliente'}</h4>
                            <p class="text-[10px] text-gray-500 font-bold mt-0.5"><i class="fa-solid fa-phone text-[8px] mr-1"></i>${r.phone || r.buyerInfo?.phone || '--'}</p>
                        </div>
                        <div class="text-right">
                            <span class="text-[9px] font-bold text-gray-400 uppercase block">Saldo Pendiente</span>
                            <span class="text-sm font-black text-rose-600 block">$${balance.toLocaleString('es-CO')}</span>
                        </div>
                    </div>
                    <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                        <span class="text-[9px] font-bold text-gray-500">Total: $${total.toLocaleString('es-CO')} | Abono: $${paid.toLocaleString('es-CO')}</span>
                        <button onclick="window.openPaymentModal('${r.id}', ${balance})" class="h-8 px-3 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition shadow-sm font-black text-[9px] uppercase tracking-wider flex items-center justify-center gap-1">
                            <i class="fa-solid fa-hand-holding-dollar text-xs"></i> <span>Cobrar</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateRecsPaginationControls(startIndex + 1, endIndex, totalFiltered);
}

// Controles de paginacion para Pedidos (Gestion)
function updateOrdersPaginationControls(start, end, total) {
    const rangeEl = document.getElementById('orders-pagination-range');
    const totalEl = document.getElementById('orders-pagination-total');
    const btnPrev = document.getElementById('orders-btn-prev');
    const btnNext = document.getElementById('orders-btn-next');
    if (rangeEl) rangeEl.textContent = total === 0 ? "0-0" : `${start}-${end}`;
    if (totalEl) totalEl.textContent = total;
    if (btnPrev) btnPrev.disabled = (currentOrdersPage <= 1);
    if (btnNext) btnNext.disabled = (end >= total);
}

window.changeOrdersPage = (delta) => {
    currentOrdersPage += delta;
    if (currentOrdersPage < 1) currentOrdersPage = 1;
    filterAndRenderOrders();
    const tableSection = document.getElementById('table-orders-section');
    if (tableSection) tableSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.handleOrdersPageSizeChange = (newSize) => {
    ordersPageSize = parseInt(newSize, 10) || 15;
    currentOrdersPage = 1;
    filterAndRenderOrders();
};

// Controles de paginacion para Cartera / Contabilidad
function updateRecsPaginationControls(start, end, total) {
    const rangeEl = document.getElementById('recs-pagination-range');
    const totalEl = document.getElementById('recs-pagination-total');
    const btnPrev = document.getElementById('recs-btn-prev');
    const btnNext = document.getElementById('recs-btn-next');
    if (rangeEl) rangeEl.textContent = total === 0 ? "0-0" : `${start}-${end}`;
    if (totalEl) totalEl.textContent = total;
    if (btnPrev) btnPrev.disabled = (currentRecsPage <= 1);
    if (btnNext) btnNext.disabled = (end >= total);
}

window.changeRecsPage = (delta) => {
    currentRecsPage += delta;
    if (currentRecsPage < 1) currentRecsPage = 1;
    filterAndRenderReceivables();
    const tableSection = document.getElementById('table-receivables-section');
    if (tableSection) tableSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.handleRecsPageSizeChange = (newSize) => {
    recsPageSize = parseInt(newSize, 10) || 15;
    currentRecsPage = 1;
    filterAndRenderReceivables();
};

// Desplazamiento comodo a la tabla
window.scrollToOrdersTable = () => {
    const table = document.getElementById('table-orders-section') || document.getElementById('table-receivables-section');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Version de PWA
function initVersionBadge() {
    if ('caches' in window) {
        caches.keys().then(keys => {
            const cacheName = keys.find(k => k.startsWith('pixeltech-shell-v'));
            if (cacheName) {
                const version = cacheName.replace('pixeltech-shell-', '');
                const badge = document.getElementById('app-version-badge');
                if (badge) badge.textContent = version;
            }
        });
    }
}
