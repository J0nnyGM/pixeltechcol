import { db, collection, getDocs, query, orderBy, deleteDoc, doc, updateDoc, where, limit, startAfter, getAggregateFromServer, count } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// --- DOM ---
const tableBody = document.getElementById('products-table-body');
const searchInput = document.getElementById('inventory-search');
const searchForm = document.getElementById('search-form');
const noResultsMsg = document.getElementById('no-results');
const rangeSpan = document.getElementById('view-range');
const totalSpan = document.getElementById('total-count');
const btnNext = document.getElementById('btn-next-page');
const btnPrev = document.getElementById('btn-prev-page');
const pageCountSpan = document.getElementById('page-count'); // Elemento antiguo por si acaso

// --- MODAL DOM ---
const discountModal = document.getElementById('discount-modal');
const discountForm = document.getElementById('discount-form');
const dInputDays = document.getElementById('input-days-container');
const dInputDate = document.getElementById('input-date-container');
const btnTypeDays = document.getElementById('btn-type-days');
const btnTypeDate = document.getElementById('btn-type-date');

// --- ESTADO OPTIMIZADO ---
const PAGE_SIZE = 20;
let currentPage = 1;
let totalDocs = 0;
// Eliminamos variables de cursor global innecesarias porque usamos el caché para paginar
let pagesCache = {}; // { 1: [docs], 2: [docs] }
let currentFilterType = 'all'; 
let currentSearchTerm = '';
let currentEditingId = null;
let currentDurationType = 'days';
let isLoading = false;

// =============================================================================
// 1. LÓGICA CORE (CARGA INTELIGENTE)
// =============================================================================

async function initTable(filterType = 'all', searchTerm = '') {
    currentFilterType = filterType;
    currentSearchTerm = searchTerm;
    currentPage = 1;
    pagesCache = {}; // Limpiamos caché al cambiar filtros
    
    // 1. Obtener Total (Lectura de Agregación = Muy Barato)
    await fetchTotalCount();
    
    // 2. Cargar Página 1
    await fetchPage(1);
}

// Obtener conteo total para paginación precisa
async function fetchTotalCount() {
    try {
        const coll = collection(db, "products");
        let q = query(coll);
        
        // Aplicar los mismos filtros que la tabla para contar bien
        if (currentFilterType === 'active') q = query(coll, where('status', '==', 'active'));
        else if (currentFilterType === 'draft') q = query(coll, where('status', '!=', 'active'));
        else if (currentFilterType === 'lowstock') q = query(coll, where('stock', '<=', 5));
        else if (currentFilterType === 'search' && currentSearchTerm) {
            totalSpan.textContent = "..."; // No contamos en búsqueda por texto (muy costoso/complejo)
            return; 
        }

        const snapshot = await getAggregateFromServer(q, { count: count() });
        totalDocs = snapshot.data().count;
        if(totalSpan) totalSpan.textContent = totalDocs;
        if(pageCountSpan) pageCountSpan.textContent = totalDocs;
        
    } catch (e) {
        console.error("Error contando:", e);
        if(totalSpan) totalSpan.textContent = "-";
    }
}

async function fetchPage(page) {
    if (isLoading) return;
    isLoading = true;
    tableBody.innerHTML = `<tr><td colspan="7" class="p-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-3xl text-brand-cyan/30"></i></td></tr>`;

    // A. ¿ESTÁ EN CACHÉ? (Velocidad Luz)
    if (pagesCache[page]) {
        renderTable(pagesCache[page]);
        updatePaginationUI(page);
        isLoading = false;
        return;
    }

    // B. NO ESTÁ EN CACHÉ -> IR A FIREBASE
    try {
        const productsRef = collection(db, "products");
        let constraints = [];

        // Filtros
        if (currentFilterType === 'search' && currentSearchTerm) {
            // Truco para búsqueda de prefijo (Case Sensitive en Firebase)
            // Para case-insensitive real se requiere guardar un campo 'name_lower' en BD
            constraints.push(orderBy('name'));
            constraints.push(where('name', '>=', currentSearchTerm));
            constraints.push(where('name', '<=', currentSearchTerm + '\uf8ff'));
        } else if (currentFilterType === 'active') {
            constraints.push(where('status', '==', 'active'));
            constraints.push(orderBy('createdAt', 'desc'));
        } else if (currentFilterType === 'draft') {
            constraints.push(where('status', '!=', 'active')); 
            constraints.push(orderBy('status'), orderBy('createdAt', 'desc'));
        } else if (currentFilterType === 'lowstock') {
            constraints.push(where('stock', '<=', 5));
            constraints.push(orderBy('stock'));
        } else {
            constraints.push(orderBy('createdAt', 'desc'));
        }

        // Paginación: Usamos el último doc de la página ANTERIOR (que debe estar en caché)
        if (page > 1) {
            const prevPageDocs = pagesCache[page - 1];
            if (prevPageDocs && prevPageDocs.length > 0) {
                const lastDoc = prevPageDocs[prevPageDocs.length - 1].doc; 
                constraints.push(startAfter(lastDoc));
            } else {
                // Si no tenemos la página anterior (ej: recarga forzada), volvemos a la 1
                isLoading = false;
                initTable(currentFilterType, currentSearchTerm);
                return;
            }
        }
        
        constraints.push(limit(PAGE_SIZE));

        const q = query(productsRef, ...constraints);
        const snapshot = await getDocs(q);
        
        const products = [];
        snapshot.forEach(doc => {
            products.push({ id: doc.id, ...doc.data(), doc: doc });
        });

        // GUARDAR EN CACHÉ
        pagesCache[page] = products;

        renderTable(products);
        updatePaginationUI(page);

    } catch (error) {
        console.error(error);
        let msg = "Error cargando datos.";
        if (error.message.includes("indexes")) msg = "⚠️ Faltan índices. Abre la consola (F12) y crea el índice desde el link.";
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center p-10 text-red-400 font-bold text-xs">${msg}</td></tr>`;
    } finally {
        isLoading = false;
    }
}

function updatePaginationUI(page) {
    currentPage = page;
    
    const currentCount = pagesCache[page]?.length || 0;
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = start + currentCount - 1;
    
    if(rangeSpan) rangeSpan.textContent = currentCount > 0 ? `${start}-${end}` : "0-0";

    if(btnPrev) btnPrev.disabled = page === 1;
    
    // Desactivar Next si trajimos menos de lo pedido O si alcanzamos el total
    if(btnNext) {
        if (currentCount < PAGE_SIZE || (totalDocs > 0 && end >= totalDocs)) {
            btnNext.disabled = true;
        } else {
            btnNext.disabled = false;
        }
    }
}

// Funciones globales para HTML
window.changePage = (dir) => {
    const newPage = currentPage + dir;
    if (newPage < 1) return;
    fetchPage(newPage);
};

window.filterByTab = (status) => {
    // UI Botones
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-brand-black', 'text-white', 'shadow-lg', 'border-transparent');
        btn.classList.add('bg-white', 'text-gray-400', 'border-gray-100');
    });
    const activeBtn = document.getElementById(`tab-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-400', 'border-gray-100');
        activeBtn.classList.add('bg-brand-black', 'text-white', 'shadow-lg', 'border-transparent');
    }

    if(searchInput) searchInput.value = '';
    initTable(status);
};

if(searchForm) {
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const term = searchInput.value.trim();
        if(term) {
            // Reset tabs visualmente
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('bg-brand-black', 'text-white');
                btn.classList.add('bg-white', 'text-gray-400');
            });
            initTable('search', term);
        } else {
            window.filterByTab('all');
        }
    });
}

// =============================================================================
// 2. RENDERIZADO
// =============================================================================

function renderTable(products) {
    tableBody.innerHTML = "";

    if (products.length === 0) {
        tableBody.classList.add('hidden');
        if(noResultsMsg) noResultsMsg.classList.remove('hidden');
        return;
    }
    
    tableBody.classList.remove('hidden');
    if(noResultsMsg) noResultsMsg.classList.add('hidden');

    products.forEach((product, index) => {
        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50 transition-colors group fade-in border-b border-gray-50 last:border-0";
        row.style.animationDelay = `${index * 20}ms`;

        const img = product.mainImage || product.image || 'https://placehold.co/100?text=Sin+Foto';

        let statusBadge = '';
        if (product.status === 'active') {
            statusBadge = `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-100"><div class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.4)]"></div> Activo</span>`;
        } else {
            statusBadge = `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-50 text-gray-500 border border-gray-200"><div class="w-2 h-2 rounded-full bg-gray-400"></div> Borrador</span>`;
        }
        
        let priceDisplay = `<span class="text-base font-black text-gray-800">$${(product.price || 0).toLocaleString('es-CO')}</span>`;
        if (product.originalPrice && product.price < product.originalPrice) {
            const discountPercent = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
            statusBadge += `<span class="ml-2 px-2 py-1 rounded-md text-[9px] font-black uppercase bg-purple-50 text-purple-600 border border-purple-100" title="Oferta activa">-${discountPercent}%</span>`;
            priceDisplay = `
                <div class="flex flex-col">
                    <span class="text-[10px] text-gray-300 line-through font-bold">$${product.originalPrice.toLocaleString('es-CO')}</span>
                    <span class="text-base font-black text-brand-red">$${product.price.toLocaleString('es-CO')}</span>
                </div>`;
        }

        row.innerHTML = `
            <td class="p-6 pl-8 text-center align-middle">
                <div class="w-20 h-20 rounded-2xl bg-white border border-gray-100 p-2 shadow-sm mx-auto group-hover:scale-105 transition-transform duration-300">
                    <img src="${img}" loading="lazy" class="w-full h-full object-contain rounded-lg">
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
                <div class="flex flex-col items-center justify-center gap-2">${statusBadge}</div>
            </td>
            <td class="p-6 pr-8 text-right align-middle">
                <div class="flex items-center justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button onclick="openDiscountModal('${product.id}')" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-500 transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="Aplicar Oferta"><i class="fa-solid fa-tags"></i></button>
                    <button onclick="window.location.href='edit-product.html?id=${product.id}'" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteProduct('${product.id}')" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-red hover:border-brand-red transition shadow-sm flex items-center justify-center hover:-translate-y-1" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
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
    // Buscar en el caché de la página actual
    const products = pagesCache[currentPage] || [];
    let product = products.find(p => p.id === id);
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

if(discountForm) {
    discountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = discountForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

        try {
            const products = pagesCache[currentPage] || [];
            const product = products.find(p => p.id === currentEditingId);
            
            // SANITIZACIÓN DE DATOS (IMPORTANTE)
            // Aseguramos que originalPrice sea un número válido
            const originalPrice = parseFloat(product.originalPrice || product.price) || 0;
            const newPrice = parseFloat(document.getElementById('d-new-price').value) || 0;
            
            if (newPrice <= 0 || newPrice >= originalPrice) throw new Error("Precio inválido: Debe ser menor al original y mayor a 0.");

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

            // Enviamos la actualización limpia
            await updateDoc(doc(db, "products", currentEditingId), {
                originalPrice: originalPrice,
                price: newPrice,
                promoEndsAt: endDate,
                updatedAt: new Date() // Buena práctica: actualizar fecha de edición
            });

            alert("✅ Oferta aplicada correctamente.");
            closeDiscountModal();
            
            // Refrescar tabla
            pagesCache = {};
            fetchPage(currentPage);

        } catch (e) {
            console.error(e);
            let msg = "Error al guardar oferta.";
            if (e.code === 'permission-denied') msg = "⛔ No tienes permisos (¿Expiró tu sesión?). Recarga la página.";
            else if(['Precio inválido','Días inválidos','Fecha inválida'].some(m => e.message.includes(m))) msg = e.message;
            
            alert(msg);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });
}

window.removeDiscount = async () => {
    if (!confirm("¿Deseas quitar la oferta y restaurar el precio?")) return;
    try {
        const products = pagesCache[currentPage] || [];
        const product = products.find(p => p.id === currentEditingId);
        if (!product.originalPrice) return;

        await updateDoc(doc(db, "products", currentEditingId), {
            price: product.originalPrice,
            originalPrice: 0,
            promoEndsAt: null
        });

        alert("Oferta removida.");
        closeDiscountModal();
        pagesCache = {};
        fetchPage(currentPage);
    } catch (e) { console.error(e); }
};

window.deleteProduct = async (id) => {
    if (confirm("¿Eliminar producto permanentemente?")) {
        try {
            await deleteDoc(doc(db, "products", id));
            pagesCache = {}; 
            fetchTotalCount(); // Actualizar contador
            fetchPage(currentPage);
        } catch (e) { alert("Error al eliminar"); }
    }
};

// --- INICIALIZAR ---
initTable('all');