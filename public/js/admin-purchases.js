import { db, collection, query, orderBy, limit, startAfter, getDocs, onSnapshot, doc, getDoc, where } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// --- REFERENCIAS DOM ---
const tableBody = document.getElementById('purchases-table-body');
const loadMoreBtn = document.getElementById('load-more-container');
const searchInput = document.getElementById('search-input');

// --- ESTADO GLOBAL ---
let lastVisible = null;
let isLoading = false;
const DOCS_PER_PAGE = 50;

let unsubscribePurchasesList = null;
let adminPurchasesCache = []; // RAM Cache para búsquedas instantáneas

const formatMoney = (amount) => `$${Math.round(amount || 0).toLocaleString('es-CO')}`;

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE: LISTA DE COMPRAS
// ==========================================================================
function startPurchasesListener(isNextPage = false) {
    if (isLoading) return;
    isLoading = true;

    if (!isNextPage) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-cyan"></i><p class="mt-2 text-xs font-bold text-gray-400">Cargando historial...</p></td></tr>`;
        loadMoreBtn.classList.add('hidden');
        if (unsubscribePurchasesList) unsubscribePurchasesList();
    } else {
        const btn = loadMoreBtn.querySelector('button');
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
    }

    try {
        const purchasesRef = collection(db, "purchases");
        let constraints = [orderBy("createdAt", "desc")];

        // B. EJECUCIÓN HÍBRIDA (getDocs para paginación, onSnapshot para página 1)
        if (isNextPage && lastVisible) {
            constraints.push(startAfter(lastVisible));
            constraints.push(limit(DOCS_PER_PAGE));
            
            const q = query(purchasesRef, ...constraints);
            getDocs(q).then(snapshot => handleSnapshotResult(snapshot, true)).catch(e => {
                console.error("Error Paginación Compras:", e);
                isLoading = false;
            });
            
        } else {
            constraints.push(limit(DOCS_PER_PAGE));
            const q = query(purchasesRef, ...constraints);
            
            unsubscribePurchasesList = onSnapshot(q, (snapshot) => {
                handleSnapshotResult(snapshot, false);
            }, (error) => {
                console.error("Error Live Compras:", error);
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-red-400 font-bold p-10">Error de conexión en vivo.</td></tr>`;
            });
        }
    } catch (e) {
        console.error("Error configurando query de compras:", e);
        isLoading = false;
    }
}

function handleSnapshotResult(snapshot, isNextPage) {
    if (!isNextPage) {
        adminPurchasesCache = [];
    }

    if (snapshot.empty && !isNextPage) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-gray-400 font-bold uppercase text-xs">No hay compras registradas en el sistema.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        isLoading = false;
        return;
    }

    // Actualizamos lastVisible solo si NO es un repintado en vivo de un docChange
    if (snapshot.docs.length > 0 && !snapshot.metadata.hasPendingWrites) {
         lastVisible = snapshot.docs[snapshot.docs.length - 1];
    }

    // UI del botón "Cargar más"
    if (snapshot.docs.length === DOCS_PER_PAGE) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar Anteriores`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }

    snapshot.forEach(docSnap => {
        const data = { id: docSnap.id, ...docSnap.data() };
        // Evitar duplicados en la RAM al actualizar en tiempo real
        const index = adminPurchasesCache.findIndex(p => p.id === docSnap.id);
        if (index > -1) adminPurchasesCache[index] = data;
        else adminPurchasesCache.push(data);
    });

    applyFilters(); // Pintar la tabla usando la RAM
    isLoading = false;
}

window.loadMorePurchases = () => startPurchasesListener(true);

function renderRow(p) {
    const dateObj = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
    const dateStr = !isNaN(dateObj) ? dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
    
    // Contar total de unidades físicas que entraron
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
            <button onclick="window.viewPurchaseDetail('${p.id}')" title="Ver Factura" class="w-9 h-9 mx-auto rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan hover:shadow-md transition flex items-center justify-center">
                <i class="fa-solid fa-eye text-xs"></i>
            </button>
        </td>
    `;
    tableBody.appendChild(tr);
}

// --- BÚSQUEDA HÍBRIDA (RAM + SERVIDOR) ---
function applyFilters() {
    tableBody.innerHTML = "";
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const results = adminPurchasesCache.filter(p => {
        const idMatch = p.id.toLowerCase().includes(term);
        const nameMatch = (p.supplierName || "").toLowerCase().includes(term);
        return term === "" || idMatch || nameMatch;
    });

    if (results.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontraron resultados en caché local. Presiona ENTER para buscar a fondo.</td></tr>`;
    } else {
        results.forEach(p => renderRow(p));
    }
}

if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim().length > 0) {
            performServerSearch(searchInput.value.trim());
            return;
        }
        applyFilters();
    });
}

async function performServerSearch(term) {
    if(isLoading) return;
    isLoading = true;

    // Apagamos live listener para no interferir con la vista de búsqueda
    if(unsubscribePurchasesList) unsubscribePurchasesList();

    tableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-search fa-bounce text-brand-cyan"></i> Buscando a fondo...</td></tr>`;
    loadMoreBtn.classList.add('hidden');

    try {
        const purchasesRef = collection(db, "purchases");

        // 1. Por ID exacto
        const docRef = doc(db, "purchases", term);
        const p1 = getDoc(docRef).then(s => s.exists() ? [{ id: s.id, ...s.data() }] : []);
        
        // 2. Por Proveedor exacto
        const qName = query(purchasesRef, where("supplierName", "==", term));
        const p2 = getDocs(qName).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));

        const [r1, r2] = await Promise.all([p1, p2]);
        const allResults = [...r1, ...r2];
        
        const uniqueIds = new Set();
        const finalDocs = [];

        allResults.forEach(d => {
            if(!uniqueIds.has(d.id)) {
                uniqueIds.add(d.id);
                finalDocs.push(d);
            }
        });

        tableBody.innerHTML = "";
        
        if (finalDocs.length > 0) {
            // Reemplazamos la cache temporalmente para que el filtro funcione
            adminPurchasesCache = finalDocs;
            applyFilters();
        } else {
            tableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontró compra con ese ID o Proveedor exacto.<br><span class="text-[9px] text-brand-cyan cursor-pointer hover:underline mt-2 block" onclick="window.location.reload()">Recargar Lista Original</span></td></tr>`;
        }
    } catch(e) {
        console.error(e);
        startPurchasesListener(false); 
    } finally {
        isLoading = false;
    }
}

// ============================================================================
// VER DETALLE EN MODAL (CERO LECTURAS EXTRAS)
// ============================================================================
window.viewPurchaseDetail = (id) => {
    // Leemos el objeto completo directamente de la RAM
    const p = adminPurchasesCache.find(x => x.id === id);
    if (!p) return;

    document.getElementById('modal-purchase-id').textContent = `#${p.id.slice(0, 8).toUpperCase()}`;
    const dateObj = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
    document.getElementById('modal-purchase-date').textContent = !isNaN(dateObj) ? dateObj.toLocaleString('es-CO') : '--';

    document.getElementById('modal-supplier-name').textContent = p.supplierName || 'No registrado';
    document.getElementById('modal-admin-name').textContent = p.createdBy || 'Sistema';
    
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

// Arrancar el Listener en Tiempo Real
startPurchasesListener(false);