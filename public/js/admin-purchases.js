import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO CENTRAL

loadAdminSidebar();

// --- REFERENCIAS DOM ---
const tableBody = document.getElementById('purchases-table-body');
const rangeSpan = document.getElementById('pagination-range');
const totalSpan = document.getElementById('pagination-total');
const btnPrev = document.getElementById('btn-prev-page');
const btnNext = document.getElementById('btn-next-page');
const pageSizeSelect = document.getElementById('page-size-select');
const searchInput = document.getElementById('search-input');
const modalBtnEdit = document.getElementById('modal-btn-edit');

// --- ESTADO GLOBAL ---
let pageSize = 50;
let currentPage = 1;
let adminPurchasesCache = []; // Recibirá los datos en RAM

const formatMoney = (amount) => `$${Math.round(amount || 0).toLocaleString('es-CO')}`;

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToPurchases((purchases) => {
    adminPurchasesCache = purchases || [];
    renderPurchasesFromMemory();
});

// ==========================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================
function renderPurchasesFromMemory() {
    if (!tableBody) return;

    let filtered = adminPurchasesCache;
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // Búsqueda ultrarrápida en RAM
    if (term.length > 0) {
        filtered = filtered.filter(p => 
            p.id.toLowerCase().includes(term) || 
            (p.supplierName || "").toLowerCase().includes(term)
        );
    }

    const totalDocs = filtered.length;
    const maxPages = Math.max(1, Math.ceil(totalDocs / pageSize));
    if (currentPage > maxPages) currentPage = maxPages;

    tableBody.innerHTML = "";

    if (totalDocs === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontraron compras.</td></tr>`;
        updatePaginationUI(0, 0, 0, maxPages);
        return;
    }

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalDocs);
    const pageData = filtered.slice(startIdx, endIdx);

    pageData.forEach(p => renderRow(p));
    updatePaginationUI(startIdx + 1, endIdx, totalDocs, maxPages);
}

function updatePaginationUI(start, end, total, maxPages) {
    if (rangeSpan) rangeSpan.textContent = total > 0 ? `${start}-${end}` : "0-0";
    if (totalSpan) totalSpan.textContent = total;
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= maxPages;
}

window.changePurchasesPage = (delta) => {
    currentPage += delta;
    if (currentPage < 1) currentPage = 1;
    renderPurchasesFromMemory();
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
};

if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value) || 50;
        currentPage = 1;
        renderPurchasesFromMemory();
    });
}

if (searchInput) {
    searchInput.addEventListener('input', () => {
        currentPage = 1;
        renderPurchasesFromMemory();
    });
}

// Redireccionar a edición de entrada
window.editPurchase = (id) => {
    window.location.href = `inventory-entry.html?editId=${encodeURIComponent(id)}`;
};

// ==========================================================================
// RENDERIZADO DE FILAS Y MODAL
// ==========================================================================
function renderRow(p) {
    const dateObj = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
    const dateStr = !isNaN(dateObj) ? dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
    
    let totalItems = 0;
    if (p.items && Array.isArray(p.items)) {
        totalItems = p.items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
    }

    const shortId = p.id.slice(0, 8).toUpperCase();
    const adminName = p.createdBy || "Sistema";

    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 transition border-b border-gray-50 fade-in";
    tr.innerHTML = `
        <td class="px-8 py-6">
            <div class="font-black text-brand-cyan uppercase tracking-tighter text-sm mb-1">#${shortId}</div>
            <div class="text-[9px] font-bold text-gray-500">${dateStr}</div>
        </td>
        <td class="px-8 py-6">
            <div class="font-black text-brand-black uppercase text-xs truncate max-w-[200px]">${p.supplierName || 'Desconocido'}</div>
        </td>
        <td class="px-8 py-6 text-center">
            <span class="bg-gray-100 text-gray-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase border border-gray-200">${totalItems} Unidades</span>
        </td>
        <td class="px-8 py-6 text-center text-[10px] font-bold text-gray-400 uppercase">${adminName}</td>
        <td class="px-8 py-6 text-right font-black text-brand-black text-base">${formatMoney(p.totalCost)}</td>
        <td class="px-8 py-6 text-center">
            <div class="flex items-center justify-center gap-2">
                <button onclick="window.viewPurchaseDetail('${p.id}')" title="Ver Factura" class="w-9 h-9 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan hover:shadow-md transition flex items-center justify-center">
                    <i class="fa-solid fa-eye text-xs"></i>
                </button>
                <button onclick="window.editPurchase('${p.id}')" title="Editar Entrada" class="w-9 h-9 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan hover:shadow-md transition flex items-center justify-center">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
            </div>
        </td>
    `;
    tableBody.appendChild(tr);
}

// Ver Detalle (0 Lecturas)
window.viewPurchaseDetail = (id) => {
    const p = adminPurchasesCache.find(x => x.id === id);
    if (!p) return;

    document.getElementById('modal-purchase-id').textContent = `#${p.id.slice(0, 8).toUpperCase()}`;
    const dateObj = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
    document.getElementById('modal-purchase-date').textContent = !isNaN(dateObj) ? dateObj.toLocaleString('es-CO') : '--';

    document.getElementById('modal-supplier-name').textContent = p.supplierName || 'No registrado';
    document.getElementById('modal-admin-name').textContent = p.createdBy || 'Sistema';
    
    if (modalBtnEdit) {
        modalBtnEdit.onclick = () => window.editPurchase(p.id);
    }

    const ivaBadge = document.getElementById('modal-iva-badge');
    if (p.hasIVA) {
        ivaBadge.textContent = "SÍ (Aplicado)";
        ivaBadge.className = "inline-block px-3 py-1 rounded bg-brand-cyan/10 text-brand-cyan text-[10px] font-black uppercase tracking-widest border border-brand-cyan/20";
    } else {
        ivaBadge.textContent = "NO APLICADO";
        ivaBadge.className = "inline-block px-3 py-1 rounded bg-gray-100 text-gray-500 text-[10px] font-black uppercase tracking-widest border border-gray-200";
    }

    const itemsTbody = document.getElementById('modal-items-list');
    itemsTbody.innerHTML = "";

    if (p.items && p.items.length > 0) {
        p.items.forEach(item => {
            let variantText = '';
            if (item.color || item.capacity) {
                variantText = `<br><span class="text-[9px] text-gray-400 uppercase font-bold tracking-widest">${item.capacity ? item.capacity + ' ' : ''}${item.color ? item.color : ''}</span>`;
            }

            itemsTbody.innerHTML += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="p-4">
                        <span class="font-black text-brand-black text-xs uppercase">${item.name}</span>
                        ${variantText}
                    </td>
                    <td class="p-4 text-center font-black text-brand-cyan">${item.quantity}</td>
                    <td class="p-4 text-right font-bold text-gray-600">${formatMoney(item.unitCostBase)}</td>
                    <td class="p-4 text-right font-black text-brand-black">${formatMoney(item.totalRow)}</td>
                </tr>
            `;
        });
    } else {
        itemsTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-xs font-bold text-gray-400">Sin detalles registrados.</td></tr>`;
    }

    document.getElementById('modal-purchase-total').textContent = formatMoney(p.totalCost);
    document.getElementById('purchase-modal').classList.remove('hidden');
};