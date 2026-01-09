import { db, collection, getDocs, query, orderBy, deleteDoc, doc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

// Inicializar componentes globales
loadAdminSidebar();

const tableBody = document.getElementById('products-table-body');
const searchInput = document.getElementById('inventory-search');
const statusFilter = document.getElementById('filter-status');

let allProducts = []; // Memoria local para búsqueda rápida

/**
 * --- CARGAR INVENTARIO COMPLETO ---
 */
async function fetchInventory() {
    tableBody.innerHTML = `<tr><td colspan="6" class="p-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-3xl text-brand-cyan"></i></td></tr>`;
    
    try {
        const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        
        allProducts = [];
        snap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
        
        renderTable(allProducts);
    } catch (e) {
        console.error("Error cargando inventario:", e);
        tableBody.innerHTML = `<tr><td colspan="6" class="p-20 text-center text-brand-red font-bold uppercase">Error al conectar con la base de datos</td></tr>`;
    }
}

/**
 * --- RENDERIZAR FILAS DE LA TABLA ---
 */
function renderTable(data) {
    tableBody.innerHTML = "";

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-20 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">No se encontraron productos</td></tr>`;
        return;
    }

    data.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors group";
        tr.innerHTML = `
            <td class="p-6 w-24">
                <div class="w-14 h-14 rounded-2xl bg-gray-100 overflow-hidden border border-gray-100 shadow-sm">
                    <img src="${p.mainImage || p.image}" class="w-full h-full object-cover group-hover:scale-110 transition duration-500">
                </div>
            </td>
            <td class="p-6">
                <p class="font-black text-sm text-brand-black uppercase tracking-tighter">${p.name}</p>
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">SKU: ${p.sku || 'S/N'}</p>
            </td>
            <td class="p-6">
                <span class="text-[10px] font-black text-brand-cyan uppercase">${p.category}</span>
                <p class="text-[9px] text-gray-400 font-bold uppercase">${p.brand || 'PixelTech'}</p>
            </td>
            <td class="p-6">
                <p class="font-black text-brand-black">$${p.price.toLocaleString('es-CO')}</p>
                <p class="text-[9px] font-bold ${p.stock < 5 ? 'text-brand-red animate-pulse' : 'text-gray-400'} uppercase">Stock: ${p.stock}</p>
            </td>
            <td class="p-6 text-center">
                <span class="px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${p.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}">
                    ${p.status === 'active' ? 'Activo' : 'Borrador'}
                </span>
            </td>
            <td class="p-6 text-right">
                <div class="flex justify-end gap-2">
                    <button onclick="window.location.href='edit-product.html?id=${p.id}'" 
                        class="w-9 h-9 rounded-xl bg-gray-50 text-gray-400 hover:bg-brand-cyan hover:text-white transition flex items-center justify-center shadow-sm">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button onclick="deleteItem('${p.id}')" class="w-9 h-9 rounded-xl bg-gray-50 text-gray-400 hover:bg-brand-red hover:text-white transition flex items-center justify-center shadow-sm">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

/**
 * --- LÓGICA DE BÚSQUEDA Y FILTRADO ---
 */
function handleFilters() {
    const term = searchInput.value.toLowerCase();
    const status = statusFilter.value;

    const filtered = allProducts.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(term) || 
                              (p.sku && p.sku.toLowerCase().includes(term)) || 
                              (p.brand && p.brand.toLowerCase().includes(term));
        
        const matchesStatus = status === 'all' || p.status === status;

        return matchesSearch && matchesStatus;
    });

    renderTable(filtered);
}

searchInput.oninput = handleFilters;
statusFilter.onchange = handleFilters;

/**
 * --- ELIMINAR PRODUCTO ---
 */
window.deleteItem = async (id) => {
    if (confirm("¿Estás seguro de eliminar este producto? Esta acción no se puede deshacer.")) {
        try {
            await deleteDoc(doc(db, "products", id));
            // Actualizar memoria local y tabla
            allProducts = allProducts.filter(p => p.id !== id);
            renderTable(allProducts);
        } catch (e) {
            alert("Error al eliminar: " + e.message);
        }
    }
};

// Carga inicial
fetchInventory();