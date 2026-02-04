import { db, storage, collection, query, where, getDocs, doc, updateDoc, ref, uploadBytes, getDownloadURL, orderBy, limit, startAfter, getDoc } from './firebase-init.js';

// DOM Elements
const listContainer = document.getElementById('invoices-list');
const loadMoreBtn = document.getElementById('load-more-container');
const searchInput = document.getElementById('invoice-search');

// Modal Upload
const uploadModal = document.getElementById('upload-modal');
const uploadForm = document.getElementById('upload-form');
const fileInput = document.getElementById('invoice-file');
const fileNameDisplay = document.getElementById('file-name-display');
const targetOrderIdInput = document.getElementById('target-order-id');
const modalOrderIdDisplay = document.getElementById('modal-order-id');
const invoiceNumberInput = document.getElementById('invoice-number');

// Modal Detalles
const detailsModal = document.getElementById('details-modal');
const dtEls = {
    id: document.getElementById('dt-order-id'),
    cName: document.getElementById('dt-client-name'),
    cPhone: document.getElementById('dt-client-phone'),
    cEmail: document.getElementById('dt-client-email'),
    bName: document.getElementById('dt-bill-name'),
    bNit: document.getElementById('dt-bill-nit'),
    bPhone: document.getElementById('dt-bill-phone'),
    bAddress: document.getElementById('dt-bill-address'),
    bEmail: document.getElementById('dt-bill-email'),
    table: document.getElementById('dt-items-table'),
    base: document.getElementById('dt-calc-base'),
    iva: document.getElementById('dt-calc-iva'),
    total: document.getElementById('dt-calc-total')
};

// --- ESTADO GLOBAL ---
let currentFilter = 'PENDING';
let lastVisible = null;
let isLoading = false;
const DOCS_PER_PAGE = 50;

// --- 1. LÓGICA DE CARGA OPTIMIZADA ---
async function fetchOrders(isNextPage = false) {
    if (isLoading) return;
    isLoading = true;

    // UI Loading
    if (!isNextPage) {
        listContainer.innerHTML = `<div class="text-center py-20"><i class="fa-solid fa-circle-notch fa-spin text-4xl text-gray-200"></i><p class="mt-4 text-xs font-bold text-gray-400">Cargando facturas...</p></div>`;
        loadMoreBtn.classList.add('hidden');
    } else {
        const btn = loadMoreBtn.querySelector('button');
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
    }

    try {
        const ordersRef = collection(db, "orders");
        let constraints = [];

        // A. FILTROS DE SERVIDOR (Evita descargar basura)
        // Nota: Asumimos que la bandera principal moderna es 'requiresInvoice: true'
        constraints.push(where("requiresInvoice", "==", true));

        if (currentFilter === 'PENDING') {
            // Pendientes = Requiere factura Y NO está completado
            // Nota: Esto requerirá un índice compuesto en Firebase. Haz clic en el link de la consola si sale error.
            constraints.push(where("billingStatus", "!=", "COMPLETED"));
        } else if (currentFilter === 'COMPLETED') {
            constraints.push(where("billingStatus", "==", "COMPLETED"));
        } 
        // 'ALL' no agrega filtro extra de status, solo trae todo lo que requiere factura.

        // B. ORDENAMIENTO Y PAGINACIÓN
        constraints.push(orderBy("createdAt", "desc"));

        if (isNextPage && lastVisible) {
            constraints.push(startAfter(lastVisible));
        }

        constraints.push(limit(DOCS_PER_PAGE));

        // C. EJECUCIÓN
        const q = query(ordersRef, ...constraints);
        const snapshot = await getDocs(q);

        if (!isNextPage) listContainer.innerHTML = "";

        if (snapshot.empty) {
            if (!isNextPage) listContainer.innerHTML = `<div class="text-center py-16 opacity-50"><i class="fa-solid fa-folder-open text-4xl mb-4 text-gray-300"></i><p class="text-xs font-bold text-gray-400 uppercase">No hay facturas en esta sección</p></div>`;
            loadMoreBtn.classList.add('hidden');
            isLoading = false;
            return;
        }

        // Guardar cursor
        lastVisible = snapshot.docs[snapshot.docs.length - 1];

        // UI del botón "Cargar más"
        if (snapshot.docs.length === DOCS_PER_PAGE) {
            loadMoreBtn.classList.remove('hidden');
            loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar siguientes 50`;
        } else {
            loadMoreBtn.classList.add('hidden');
        }

        // Renderizar
        snapshot.forEach(d => {
            renderInvoiceCard({ id: d.id, ...d.data() });
        });

    } catch (e) {
        console.error("Error cargando facturas:", e);
        if(!isNextPage) listContainer.innerHTML = `<div class="text-center py-10"><p class="text-red-400 font-bold text-xs">Error: ${e.message}</p><p class="text-[9px] text-gray-400 mt-2">Si es un error de índice, revisa la consola (F12).</p></div>`;
    } finally {
        isLoading = false;
    }
}

// Global para el botón HTML
window.loadMoreInvoices = () => fetchOrders(true);

// --- 2. FILTROS (TABS) ---
window.filterTab = (status) => {
    if(isLoading) return;
    currentFilter = status;
    lastVisible = null; // Reset paginación
    searchInput.value = ""; // Limpiar busqueda
    
    // UI Tabs
    document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.classList.remove('border-b-2', 'border-brand-cyan', 'text-brand-black', 'bg-white');
        btn.classList.add('border-transparent', 'text-gray-400');
    });
    const activeBtn = document.getElementById(status === 'PENDING' ? 'tab-pending' : status === 'COMPLETED' ? 'tab-completed' : 'tab-all');
    if(activeBtn) {
        activeBtn.classList.remove('border-transparent', 'text-gray-400');
        activeBtn.classList.add('border-b-2', 'border-brand-cyan', 'text-brand-black', 'bg-white');
    }
    
    fetchOrders(false);
};

// --- 3. BÚSQUEDA HÍBRIDA ---
searchInput.addEventListener('keyup', (e) => {
    const term = searchInput.value.toLowerCase().trim();

    // Si da ENTER, buscamos en servidor (Búsqueda Real)
    if (e.key === 'Enter' && term.length > 0) {
        performServerSearch(term);
        return;
    }

    // Si solo escribe, filtramos lo que hay en pantalla (Búsqueda Local)
    const cards = listContainer.children;
    Array.from(cards).forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(term) ? '' : 'none';
    });
});

async function performServerSearch(term) {
    listContainer.innerHTML = `<div class="text-center py-10"><i class="fa-solid fa-search fa-bounce text-brand-cyan"></i> Buscando...</div>`;
    loadMoreBtn.classList.add('hidden');
    
    try {
        // Intento 1: Buscar por ID exacto de pedido
        const docRef = doc(db, "orders", term);
        const docSnap = await getDoc(docRef);

        listContainer.innerHTML = "";
        
        if(docSnap.exists() && (docSnap.data().requiresInvoice || docSnap.data().needsInvoice)) {
            renderInvoiceCard({ id: docSnap.id, ...docSnap.data() });
        } else {
            // Intento 2 (Opcional): Si tuviéramos índice de texto completo. 
            // Como no tenemos, mostramos aviso.
            listContainer.innerHTML = `<div class="text-center py-10"><p class="text-xs font-bold text-gray-400 uppercase">No se encontró orden con ID exacto: "${term}"</p></div>`;
        }
    } catch(e) {
        console.error(e);
        fetchOrders(false); // Restaurar si falla
    }
}

// --- 4. RENDER CARD ---
function renderInvoiceCard(order) {
    const billing = order.billingInfo || order.billingData || {};
    const isCompleted = order.invoiceUrl || order.billingStatus === 'COMPLETED';
    const date = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString('es-CO') : '---';
    const rowClass = isCompleted ? 'border-l-4 border-l-green-400' : 'border-l-4 border-l-yellow-400';
    
    const invoiceLabel = isCompleted && order.invoiceNumber 
        ? `<span class="block text-[9px] font-mono text-gray-500 mt-1">Ref: ${order.invoiceNumber}</span>` : '';

    const badgeHTML = isCompleted 
        ? `<div class="text-center"><span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-50 text-green-700 text-[9px] font-black uppercase border border-green-100"><i class="fa-solid fa-check"></i> Facturado</span>${invoiceLabel}</div>`
        : `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-yellow-50 text-yellow-700 text-[9px] font-black uppercase border border-yellow-100"><i class="fa-regular fa-clock"></i> Pendiente</span>`;

    const div = document.createElement('div');
    div.className = `bg-white p-4 md:px-6 md:py-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col md:grid md:grid-cols-12 gap-4 items-center fade-in ${rowClass}`;
    
    div.innerHTML = `
        <div class="w-full md:col-span-2 flex flex-row md:flex-col justify-between md:justify-center">
            <span class="text-[10px] font-black text-brand-black uppercase tracking-wider font-mono">#${order.id.slice(0, 8)}</span>
            <span class="text-[9px] text-gray-400 font-bold">${date}</span>
        </div>
        <div class="w-full md:col-span-4">
            <h4 class="text-xs font-black text-brand-black uppercase truncate" title="${billing.name}">${billing.name || order.userName || 'Sin Nombre'}</h4>
            <div class="flex gap-3 mt-1">
                <span class="text-[9px] font-bold text-gray-400 font-mono bg-gray-50 px-1 rounded">NIT: ${billing.taxId || order.clientDoc || '---'}</span>
            </div>
        </div>
        <div class="w-full md:col-span-2 md:text-right flex justify-between md:block">
            <span class="md:hidden text-[9px] font-bold text-gray-400 uppercase">Monto:</span>
            <span class="text-sm font-black text-brand-cyan">$${(order.total || 0).toLocaleString('es-CO')}</span>
        </div>
        <div class="w-full md:col-span-2 flex justify-center">${badgeHTML}</div>
        
        <div class="w-full md:col-span-2 flex justify-end gap-2">
            <button onclick="window.openDetailsModal('${order.id}')" class="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 text-blue-500 hover:bg-blue-100 hover:text-blue-700 flex items-center justify-center transition" title="Ver Datos para Facturar">
                <i class="fa-solid fa-magnifying-glass-plus"></i>
            </button>

            ${isCompleted && order.invoiceUrl ? `
                <a href="${order.invoiceUrl}" target="_blank" class="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 hover:text-brand-cyan hover:border-brand-cyan flex items-center justify-center transition" title="Ver PDF">
                    <i class="fa-solid fa-eye"></i>
                </a>
                <button onclick="window.openUploadModal('${order.id}', '${order.invoiceNumber || ''}')" class="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 text-gray-400 hover:text-brand-black hover:border-gray-300 flex items-center justify-center transition" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
            ` : `
                <button onclick="window.openUploadModal('${order.id}')" class="w-8 h-8 rounded-lg bg-brand-black text-white hover:bg-brand-cyan hover:text-brand-black transition flex items-center justify-center" title="Subir Factura">
                    <i class="fa-solid fa-cloud-arrow-up"></i>
                </button>
            `}
        </div>
    `;
    listContainer.appendChild(div);
}

// --- 5. MODALES (DETALLES Y UPLOAD) - Lógica de Negocio ---

// A. Abrir Detalles
window.openDetailsModal = async (orderId) => {
    // Pequeño truco: Si ya tenemos la data cargada en el DOM podríamos usarla, 
    // pero para asegurar datos frescos (especialmente si se editó desde otro lado), hacemos un getDoc rápido.
    // Como es interacción de usuario (1 clic), 1 lectura es aceptable.
    const docSnap = await getDoc(doc(db, "orders", orderId));
    if (!docSnap.exists()) return;
    
    const order = docSnap.data();
    const billing = order.billingInfo || order.billingData || {};
    const shipping = order.shippingData || {};

    dtEls.id.textContent = orderId.slice(0, 8).toUpperCase();
    dtEls.cName.textContent = order.userName || "---";
    dtEls.cPhone.textContent = order.phone || "---";
    dtEls.cEmail.textContent = order.userEmail || "---";
    dtEls.bName.textContent = billing.name || order.userName || "---";
    dtEls.bNit.textContent = billing.taxId || order.clientDoc || "---";
    dtEls.bPhone.textContent = billing.phone || order.phone || "---";
    dtEls.bAddress.textContent = billing.address || shipping.address || "---";
    dtEls.bEmail.textContent = billing.email || order.userEmail || "---";

    dtEls.table.innerHTML = (order.items || []).map(item => {
        const unitGross = item.price || item.unit_price || 0; 
        const quantity = item.quantity || 1;
        const unitBase = Math.round(unitGross / 1.19);
        const totalLine = unitGross * quantity;

        return `
        <tr class="hover:bg-slate-50 border-b border-gray-50 last:border-0 group">
            <td class="p-3"><p class="uppercase leading-tight font-bold text-xs">${item.name || item.title}</p></td>
            <td class="p-3 text-center font-bold">${quantity}</td>
            <td class="p-3 text-right bg-blue-50/30"><p class="font-black text-blue-600">$${unitBase.toLocaleString('es-CO')}</p></td>
            <td class="p-3 text-right"><p class="font-black text-brand-black">$${totalLine.toLocaleString('es-CO')}</p></td>
        </tr>`;
    }).join('');

    const total = order.total || 0;
    const base = Math.round(total / 1.19);
    const iva = total - base;

    dtEls.base.textContent = `$${base.toLocaleString('es-CO')}`;
    dtEls.iva.textContent = `$${iva.toLocaleString('es-CO')}`;
    dtEls.total.textContent = `$${total.toLocaleString('es-CO')}`;

    detailsModal.classList.remove('hidden');
    detailsModal.classList.add('flex');
};

window.closeDetailsModal = () => {
    detailsModal.classList.add('hidden');
    detailsModal.classList.remove('flex');
};

// B. Upload Logic
window.openUploadModal = (orderId, currentInvoiceNum = "") => {
    targetOrderIdInput.value = orderId;
    modalOrderIdDisplay.textContent = `Orden #${orderId.slice(0, 8).toUpperCase()}`;
    fileInput.value = ""; 
    fileNameDisplay.textContent = "";
    invoiceNumberInput.value = currentInvoiceNum; 
    uploadModal.classList.remove('hidden');
    uploadModal.classList.add('flex');
};

window.closeUploadModal = () => {
    uploadModal.classList.add('hidden');
    uploadModal.classList.remove('flex');
};

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) fileNameDisplay.textContent = fileInput.files[0].name;
});

uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderId = targetOrderIdInput.value;
    const file = fileInput.files[0];
    const invoiceNum = invoiceNumberInput.value.trim().toUpperCase(); 
    const btn = uploadForm.querySelector('button');
    const originalText = btn.innerHTML;

    if (!file && !invoiceNumberInput.value) return alert("Selecciona un PDF o ingresa un número"); 
    if (!invoiceNum) return alert("Ingresa el número de factura");

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

        let downloadURL = null;

        if (file) {
            const storageRef = ref(storage, `invoices/${orderId}_${Date.now()}.pdf`);
            await uploadBytes(storageRef, file);
            downloadURL = await getDownloadURL(storageRef);
        }

        const updateData = {
            invoiceNumber: invoiceNum,
            billingStatus: 'COMPLETED', // Esto mueve la orden a la pestaña "Facturados"
            invoicedAt: new Date()
        };
        if (downloadURL) updateData.invoiceUrl = downloadURL;

        const orderRef = doc(db, "orders", orderId);
        await updateDoc(orderRef, updateData);

        alert("✅ Factura guardada correctamente.");
        closeUploadModal();
        
        // Refrescar lista (Volver a cargar primera página para reflejar cambios)
        fetchOrders(false);

    } catch (error) {
        console.error("Error:", error);
        alert("Error al subir: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

// Iniciar
fetchOrders();