import { db, collection, getDocs, query, orderBy, deleteDoc, doc, updateDoc, where, limit, startAfter } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// --- ELEMENTOS DEL DOM ---
const tableBody = document.getElementById('products-table-body');
const searchInput = document.getElementById('inventory-search');
const searchForm = document.getElementById('search-form');
const noResultsMsg = document.getElementById('no-results');
const pageCountSpan = document.getElementById('page-count');
const btnNext = document.getElementById('btn-next-page');
const btnPrev = document.getElementById('btn-prev-page');

// Elementos del Modal de Descuento
const discountModal = document.getElementById('discount-modal');
const discountForm = document.getElementById('discount-form');
const dInputDays = document.getElementById('input-days-container');
const dInputDate = document.getElementById('input-date-container');
const btnTypeDays = document.getElementById('btn-type-days');
const btnTypeDate = document.getElementById('btn-type-date');

// --- ESTADO DE LA APLICACIÓN ---
const PAGE_SIZE = 20;
let currentViewProducts = []; // Almacena los 20 productos visibles actualmente
let lastVisibleDoc = null;    // Cursor para paginación Firebase
let pageStack = [];           // Historial de navegación para "Volver atrás"
let currentFilterType = 'all'; // 'all', 'active', 'draft', 'lowstock', 'search'
let currentSearchTerm = '';
let currentEditingId = null;
let currentDurationType = 'days';

// =============================================================================
// 1. LÓGICA DE CARGA Y PAGINACIÓN (BACKEND)
// =============================================================================

// Reiniciar y cargar la primera página
async function loadFirstPage(filterType = 'all', searchTerm = '') {
    currentFilterType = filterType;
    currentSearchTerm = searchTerm;
    pageStack = []; 
    lastVisibleDoc = null;
    
    // Loader visual
    tableBody.innerHTML = `<tr><td colspan="7" class="p-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-3xl text-brand-cyan/30"></i></td></tr>`;
    
    await fetchProducts();
}

// Consultar Firebase
async function fetchProducts(direction = 'next') {
    try {
        let q;
        const productsRef = collection(db, "products");

        // A. Construir la Query según el filtro
        if (currentFilterType === 'search' && currentSearchTerm) {
            // Búsqueda por prefijo (Ej: "iPh" encuentra "iPhone")
            // Nota: Firebase distingue mayúsculas/minúsculas.
            q = query(
                productsRef, 
                orderBy('name'), 
                where('name', '>=', currentSearchTerm),
                where('name', '<=', currentSearchTerm + '\uf8ff'),
                limit(PAGE_SIZE)
            );
        } else if (currentFilterType === 'active') {
            q = query(productsRef, where('status', '==', 'active'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE));
        } else if (currentFilterType === 'draft') {
            // Borradores son status 'draft' o cualquier cosa que no sea 'active'
            q = query(productsRef, where('status', '!=', 'active'), orderBy('status'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE));
        } else if (currentFilterType === 'lowstock') {
            q = query(productsRef, where('stock', '<=', 5), orderBy('stock'), limit(PAGE_SIZE));
        } else {
            // Todos
            q = query(productsRef, orderBy('createdAt', 'desc'), limit(PAGE_SIZE));
        }

        // B. Aplicar Paginación (Cursor)
        if (direction === 'next' && lastVisibleDoc) {
            q = query(q, startAfter(lastVisibleDoc));
        } 
        
        // Nota sobre "Anterior": Firebase no tiene un método simple "prev".
        // La estrategia común es reiniciar si se va atrás o guardar snapshots.
        // Aquí simplificamos: Si es 'prev' y estamos en stack, recargamos reset o gestionamos stack en memoria.
        
        const snapshot = await getDocs(q);
        
        const products = [];
        snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));

        // Guardar estado actual
        currentViewProducts = products;

        // Actualizar cursores para la siguiente página
        if (snapshot.docs.length > 0) {
            const firstDoc = snapshot.docs[0];
            const lastDoc = snapshot.docs[snapshot.docs.length - 1];
            
            if (direction === 'next') {
                if (lastVisibleDoc) pageStack.push(lastVisibleDoc); // Guardar donde estábamos
                lastVisibleDoc = lastDoc;
            }
        }

        renderTable(products);
        updatePaginationButtons(products.length);

    } catch (error) {
        console.error("Error fetching products:", error);
        let msg = "Error cargando datos.";
        // Ayuda para el desarrollador si falta el índice
        if (error.message.includes("indexes")) msg = "⚠️ Faltan índices en Firebase. Abre la consola (F12) y haz clic en el enlace del error.";
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center p-10 text-red-400 font-bold">${msg}</td></tr>`;
    }
}

function updatePaginationButtons(count) {
    if (pageCountSpan) pageCountSpan.textContent = count;
    
    // Si hay menos items que el tamaño de página, es el final
    if (btnNext) btnNext.disabled = (count < PAGE_SIZE);
    
    // Si el stack está vacío, estamos en el inicio
    if (btnPrev) btnPrev.disabled = (pageStack.length === 0);
}

// Funciones globales para botones HTML
window.changePage = (dir) => {
    if (dir === -1) {
        // Volver atrás simple: Reiniciar vista (para evitar complejidad de cursores inversos)
        // O si quieres implementar pop del stack:
        if (pageStack.length > 0) {
            lastVisibleDoc = pageStack.pop(); // Sacar el anterior
            // Truco: Para volver a ver esa página, necesitamos el cursor ANTERIOR a ese.
            // Para simplificar en este ejemplo: Recargamos desde el inicio si da atrás.
            loadFirstPage(currentFilterType, currentSearchTerm);
        }
    } else {
        fetchProducts('next');
    }
};

window.filterByTab = (status) => {
    // 1. Actualizar UI de botones
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-brand-black', 'text-white', 'shadow-lg', 'border-transparent');
        btn.classList.add('bg-white', 'text-gray-400', 'border-gray-100');
    });
    const activeBtn = document.getElementById(`tab-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-400', 'border-gray-100');
        activeBtn.classList.add('bg-brand-black', 'text-white', 'shadow-lg', 'border-transparent');
    }

    // 2. Resetear buscador y cargar
    if(searchInput) searchInput.value = '';
    loadFirstPage(status);
};

if(searchForm) {
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const term = searchInput.value.trim();
        if(term) {
            // Quitar estilo activo de tabs
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('bg-brand-black', 'text-white'));
            loadFirstPage('search', term);
        } else {
            loadFirstPage('all');
        }
    });
}

// =============================================================================
// 2. RENDERIZADO (DISEÑO GRANDE)
// =============================================================================

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
        row.className = "hover:bg-slate-50 transition-colors group fade-in border-b border-gray-50 last:border-0";
        row.style.animationDelay = `${index * 30}ms`;

        const img = product.mainImage || product.image || 'https://placehold.co/100';

        // Badge Estado
        let statusBadge = '';
        if (product.status === 'active') {
            statusBadge = `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-100"><div class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.4)]"></div> Activo</span>`;
        } else {
            statusBadge = `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-50 text-gray-500 border border-gray-200"><div class="w-2 h-2 rounded-full bg-gray-400"></div> Borrador</span>`;
        }
        
        // Precio / Descuento
        let priceDisplay = `<span class="text-base font-black text-gray-800">$${(product.price || 0).toLocaleString('es-CO')}</span>`;
        if (product.originalPrice && product.price < product.originalPrice) {
            const discountPercent = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
            statusBadge += `<span class="ml-2 px-2 py-1 rounded-md text-[9px] font-black uppercase bg-purple-50 text-purple-600 border border-purple-100" title="Oferta activa">-${discountPercent}%</span>`;
            priceDisplay = `
                <div class="flex flex-col">
                    <span class="text-[10px] text-gray-300 line-through font-bold">$${product.originalPrice.toLocaleString('es-CO')}</span>
                    <span class="text-base font-black text-brand-red">$${product.price.toLocaleString('es-CO')}</span>
                </div>
            `;
        }

        row.innerHTML = `
            <td class="p-6 pl-8 text-center align-middle">
                <div class="w-20 h-20 rounded-2xl bg-white border border-gray-100 p-2 shadow-sm mx-auto group-hover:scale-105 transition-transform duration-300">
                    <img src="${img}" class="w-full h-full object-contain rounded-lg">
                </div>
            </td>
            <td class="p-6 align-middle">
                <p class="font-black text-brand-black text-sm mb-1 leading-tight group-hover:text-brand-cyan transition-colors cursor-pointer" onclick="window.location.href='edit-product.html?id=${product.id}'">${product.name}</p>
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">SKU: ${product.sku || '---'}</p>
            </td>
            <td class="p-6 align-middle">
                <span class="text-[10px] font-bold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100 uppercase tracking-wide">${product.category || 'General'}</span>
            </td>
            <td class="p-6 align-middle">
                <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">${product.brand || '---'}</p>
            </td>
            <td class="p-6 align-middle">
                <div class="flex flex-col gap-1">
                    ${priceDisplay}
                    <p class="text-[10px] font-bold uppercase ${ (product.stock || 0) < 5 ? 'text-red-400' : 'text-emerald-500' } flex items-center gap-1">
                        <i class="fa-solid fa-layer-group"></i> ${product.stock || 0} unid.
                    </p>
                </div>
            </td>
            <td class="p-6 text-center align-middle">
                <div class="flex flex-col items-center justify-center gap-2">
                    ${statusBadge}
                </div>
            </td>
            <td class="p-6 pr-8 text-right align-middle">
                <div class="flex items-center justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button onclick="openDiscountModal('${product.id}')" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-500 transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="Aplicar Oferta">
                        <i class="fa-solid fa-tags"></i>
                    </button>
                    <button onclick="window.location.href='edit-product.html?id=${product.id}'" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="Editar Producto">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="deleteProduct('${product.id}')" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-red hover:border-brand-red transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="Eliminar">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

// =============================================================================
// 3. FUNCIONES DE MODAL Y ACCIONES
// =============================================================================

window.openDiscountModal = (id) => {
    // Buscamos en el array local de la página actual
    const product = currentViewProducts.find(p => p.id === id);
    if (!product) return;

    currentEditingId = id;
    
    document.getElementById('d-prod-name').textContent = product.name;
    const originalPrice = product.originalPrice || product.price;
    document.getElementById('d-original-price').value = `$${originalPrice.toLocaleString('es-CO')}`;
    
    if (product.originalPrice && product.originalPrice > product.price) {
        document.getElementById('d-new-price').value = product.price;
        document.getElementById('btn-remove-discount').classList.remove('hidden');
    } else {
        document.getElementById('d-new-price').value = "";
        document.getElementById('btn-remove-discount').classList.add('hidden');
    }

    // Reset inputs
    document.getElementById('d-duration-days').value = "";
    document.getElementById('d-duration-date').value = "";
    
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

discountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = discountForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

    try {
        const product = currentViewProducts.find(p => p.id === currentEditingId);
        const originalPrice = product.originalPrice || product.price;
        const newPrice = parseFloat(document.getElementById('d-new-price').value);
        
        if (newPrice >= originalPrice) throw new Error("Precio inválido");

        let endDate = new Date();
        if (currentDurationType === 'days') {
            const days = parseInt(document.getElementById('d-duration-days').value);
            if (!days) throw new Error("Días inválidos");
            endDate.setDate(endDate.getDate() + days);
        } else {
            const dateVal = document.getElementById('d-duration-date').value;
            if (!dateVal) throw new Error("Fecha inválida");
            endDate = new Date(dateVal);
        }

        await updateDoc(doc(db, "products", currentEditingId), {
            originalPrice: originalPrice,
            price: newPrice,
            promoEndsAt: endDate
        });

        alert("✅ Oferta aplicada correctamente.");
        closeDiscountModal();
        loadFirstPage(currentFilterType); // Recargar para ver cambios

    } catch (e) {
        console.error(e);
        if(!['Precio inválido','Días inválidos','Fecha inválida'].includes(e.message)) alert("Error al guardar oferta.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'APLICAR DESCUENTO';
    }
});

window.removeDiscount = async () => {
    if (!confirm("¿Deseas quitar la oferta y restaurar el precio?")) return;
    
    try {
        const product = currentViewProducts.find(p => p.id === currentEditingId);
        if (!product.originalPrice) return;

        await updateDoc(doc(db, "products", currentEditingId), {
            price: product.originalPrice,
            originalPrice: 0,
            promoEndsAt: null
        });

        alert("Oferta removida.");
        closeDiscountModal();
        loadFirstPage(currentFilterType);
    } catch (e) { console.error(e); }
};

window.deleteProduct = async (id) => {
    if (confirm("¿Eliminar producto permanentemente?")) {
        try {
            await deleteDoc(doc(db, "products", id));
            loadFirstPage(currentFilterType);
        } catch (e) { alert("Error al eliminar"); }
    }
};

// --- INICIALIZAR ---
loadFirstPage('all');