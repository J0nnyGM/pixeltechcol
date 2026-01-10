import { db, collection, getDocs, query, orderBy, deleteDoc, doc, updateDoc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const tableBody = document.getElementById('products-table-body');
const searchInput = document.getElementById('inventory-search');
const statusFilter = document.getElementById('filter-status');
const noResultsMsg = document.getElementById('no-results');

// Elementos del Modal
const discountModal = document.getElementById('discount-modal');
const discountForm = document.getElementById('discount-form');
const dInputDays = document.getElementById('input-days-container');
const dInputDate = document.getElementById('input-date-container');
const btnTypeDays = document.getElementById('btn-type-days');
const btnTypeDate = document.getElementById('btn-type-date');

let allProducts = [];
let currentEditingId = null;
let currentDurationType = 'days'; // 'days' | 'date'

// --- 1. CARGA INICIAL ---
async function loadProducts() {
    try {
        const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        
        allProducts = [];
        querySnapshot.forEach((doc) => {
            allProducts.push({ id: doc.id, ...doc.data() });
        });

        renderTable(allProducts);

    } catch (error) {
        console.error("Error cargando productos:", error);
    }
}

// --- 2. RENDERIZADO DE TABLA ---
function renderTable(products) {
    tableBody.innerHTML = "";
    
    if (products.length === 0) {
        tableBody.classList.add('hidden');
        noResultsMsg.classList.remove('hidden');
        return;
    }
    
    tableBody.classList.remove('hidden');
    noResultsMsg.classList.add('hidden');

    products.forEach((product, index) => {
        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50 transition-colors group fade-in";
        row.style.animationDelay = `${index * 50}ms`;

        const img = product.mainImage || product.image || 'https://placehold.co/100';

        // Badges de Estado
        let statusBadge = '';
        if (product.status === 'active') statusBadge = `<span class="px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-600 border border-emerald-200">Activo</span>`;
        else statusBadge = `<span class="px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest bg-amber-100 text-amber-600 border border-amber-200">Borrador</span>`;
        
        // Badge de Descuento Activo
        let priceDisplay = `$${(product.price || 0).toLocaleString('es-CO')}`;
        if (product.originalPrice && product.price < product.originalPrice) {
            const discountPercent = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
            statusBadge += `<span class="ml-2 px-2 py-1 rounded-full text-[7px] font-black uppercase bg-purple-100 text-purple-600 border border-purple-200" title="Oferta activa">-${discountPercent}%</span>`;
            priceDisplay = `
                <span class="block text-[10px] text-gray-400 line-through">$${product.originalPrice.toLocaleString('es-CO')}</span>
                <span class="text-brand-red font-black">$${product.price.toLocaleString('es-CO')}</span>
            `;
        }

        row.innerHTML = `
            <td class="p-6">
                <div class="w-16 h-16 rounded-2xl bg-white border border-gray-100 p-2 shadow-sm group-hover:scale-105 transition-transform">
                    <img src="${img}" class="w-full h-full object-contain">
                </div>
            </td>
            <td class="p-6">
                <p class="font-black text-brand-black text-xs uppercase mb-1 leading-tight group-hover:text-brand-cyan transition-colors cursor-pointer">${product.name}</p>
                <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wide">SKU: ${product.sku || 'N/A'}</p>
            </td>
            <td class="p-6">
                <span class="text-[10px] font-bold text-gray-500 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100 uppercase">${product.category || 'General'}</span>
            </td>
            <td class="p-6">
                <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">${product.brand || '---'}</p>
            </td>
            <td class="p-6">
                <div class="flex flex-col">
                    ${priceDisplay}
                    <p class="text-[9px] font-bold text-gray-400 uppercase mt-1">Stock: <span class="${(product.stock || 0) < 5 ? 'text-red-500 font-black' : 'text-emerald-500'}">${product.stock || 0} un.</span></p>
                </div>
            </td>
            <td class="p-6 text-center">${statusBadge}</td>
            <td class="p-6 text-right">
                <div class="flex items-center justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button onclick="openDiscountModal('${product.id}')" class="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-500 transition shadow-sm flex items-center justify-center" title="Aplicar Descuento">
                        <i class="fa-solid fa-tags text-xs"></i>
                    </button>
                    
                    <button onclick="window.location.href='edit-product.html?id=${product.id}'" class="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm flex items-center justify-center">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button onclick="deleteProduct('${product.id}')" class="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-brand-red hover:border-brand-red transition shadow-sm flex items-center justify-center">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

// --- 3. LÓGICA DEL MODAL DE DESCUENTO ---

window.openDiscountModal = (id) => {
    const product = allProducts.find(p => p.id === id);
    if (!product) return;

    currentEditingId = id;
    
    // Llenar datos
    document.getElementById('d-prod-name').textContent = product.name;
    
    // Si ya tiene oferta, mostrar precio original guardado, si no, el precio actual
    const originalPrice = product.originalPrice || product.price;
    document.getElementById('d-original-price').value = `$${originalPrice.toLocaleString('es-CO')}`;
    
    // Si tiene oferta activa, llenar campos
    if (product.originalPrice && product.originalPrice > product.price) {
        document.getElementById('d-new-price').value = product.price;
        document.getElementById('btn-remove-discount').classList.remove('hidden');
    } else {
        document.getElementById('d-new-price').value = "";
        document.getElementById('btn-remove-discount').classList.add('hidden');
    }

    // Resetear fechas
    document.getElementById('d-duration-days').value = "";
    document.getElementById('d-duration-date').value = "";
    
    // Mostrar modal
    discountModal.classList.remove('hidden');
    discountModal.classList.add('flex');
};

window.closeDiscountModal = () => {
    discountModal.classList.add('hidden');
    discountModal.classList.remove('flex');
    currentEditingId = null;
};

window.toggleDurationType = (type) => {
    currentDurationType = type;
    if (type === 'days') {
        dInputDays.classList.remove('hidden');
        dInputDate.classList.add('hidden');
        btnTypeDays.classList.replace('text-gray-400', 'text-brand-black');
        btnTypeDays.classList.add('bg-white', 'shadow-sm');
        btnTypeDate.classList.replace('text-brand-black', 'text-gray-400');
        btnTypeDate.classList.remove('bg-white', 'shadow-sm');
    } else {
        dInputDays.classList.add('hidden');
        dInputDate.classList.remove('hidden');
        btnTypeDate.classList.replace('text-gray-400', 'text-brand-black');
        btnTypeDate.classList.add('bg-white', 'shadow-sm');
        btnTypeDays.classList.replace('text-brand-black', 'text-gray-400');
        btnTypeDays.classList.remove('bg-white', 'shadow-sm');
    }
};

// Guardar Descuento
discountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = discountForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

    try {
        const product = allProducts.find(p => p.id === currentEditingId);
        const originalPrice = product.originalPrice || product.price; // Asegurar base
        const newPrice = parseFloat(document.getElementById('d-new-price').value);
        
        if (newPrice >= originalPrice) {
            alert("El precio de oferta debe ser menor al original.");
            throw new Error("Precio inválido");
        }

        // Calcular Fecha de Expiración
        let endDate = new Date();
        if (currentDurationType === 'days') {
            const days = parseInt(document.getElementById('d-duration-days').value);
            if (!days || days <= 0) { alert("Ingresa días válidos"); throw new Error("Días inválidos"); }
            endDate.setDate(endDate.getDate() + days);
        } else {
            const dateVal = document.getElementById('d-duration-date').value;
            if (!dateVal) { alert("Selecciona una fecha"); throw new Error("Fecha inválida"); }
            endDate = new Date(dateVal);
        }

        // Actualizar Firebase
        await updateDoc(doc(db, "products", currentEditingId), {
            originalPrice: originalPrice, // Guardamos el precio antiguo para poder restaurarlo
            price: newPrice,
            promoEndsAt: endDate
        });

        alert("✅ Oferta aplicada correctamente.");
        closeDiscountModal();
        loadProducts();

    } catch (e) {
        console.error(e);
        if(e.message !== "Precio inválido" && e.message !== "Días inválidos" && e.message !== "Fecha inválida") {
            alert("Error al guardar oferta.");
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'APLICAR DESCUENTO';
    }
});

// Quitar Descuento
window.removeDiscount = async () => {
    if (!confirm("¿Deseas quitar la oferta y restaurar el precio original?")) return;
    
    try {
        const product = allProducts.find(p => p.id === currentEditingId);
        if (!product.originalPrice) return;

        await updateDoc(doc(db, "products", currentEditingId), {
            price: product.originalPrice, // Restaurar precio
            originalPrice: 0, // Limpiar
            promoEndsAt: null // Limpiar fecha
        });

        alert("Oferta removida.");
        closeDiscountModal();
        loadProducts();
    } catch (e) { console.error(e); }
};

// --- FILTROS (Igual que antes) ---
function applyFilters() {
    const term = searchInput.value.toLowerCase().trim();
    const status = statusFilter.value;
    const filtered = allProducts.filter(p => {
        const matchesText = p.name.toLowerCase().includes(term) || (p.sku && p.sku.toLowerCase().includes(term));
        let matchesStatus = true;
        if (status === 'active') matchesStatus = p.status === 'active';
        if (status === 'draft') matchesStatus = p.status !== 'active';
        if (status === 'lowstock') matchesStatus = (p.stock || 0) <= 5;
        return matchesText && matchesStatus;
    });
    renderTable(filtered);
}
searchInput.addEventListener('input', applyFilters);
statusFilter.addEventListener('change', applyFilters);

// --- ELIMINAR (Igual que antes) ---
window.deleteProduct = async (id) => {
    if (confirm("¿Eliminar producto?")) {
        try {
            await deleteDoc(doc(db, "products", id));
            loadProducts();
        } catch (e) { alert("Error al eliminar"); }
    }
};

loadProducts();