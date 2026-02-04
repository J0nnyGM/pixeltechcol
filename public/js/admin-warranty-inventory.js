import { db, collection, getDocs, orderBy, query, doc, updateDoc, addDoc, limit, startAfter, where } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const container = document.getElementById('rma-container');
const loadMoreBtn = document.getElementById('load-more-container');
const searchInput = document.getElementById('rma-search');
const statusModal = document.getElementById('status-modal');
const tabActive = document.getElementById('tab-active');
const tabHistory = document.getElementById('tab-history');

// Estado
let currentView = 'active'; // 'active' | 'history'
let currentItem = null;
let lastVisible = null;
let isLoading = false;
const DOCS_PER_PAGE = 50;

// --- 1. CARGA OPTIMIZADA ---
async function loadInventory(isNextPage = false) {
    if (isLoading) return;
    isLoading = true;

    if (!isNextPage) {
        container.innerHTML = `<div class="text-center py-20"><i class="fa-solid fa-circle-notch fa-spin text-4xl text-brand-cyan/50"></i><p class="mt-2 text-xs font-bold text-gray-400">Cargando inventario...</p></div>`;
        loadMoreBtn.classList.add('hidden');
    } else {
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
    }
    
    try {
        const refColl = collection(db, "warranty_inventory");
        let constraints = [];

        // A. FILTROS DE ESTADO (Server-side filtering)
        if (currentView === 'active') {
            // Activo = Todo lo que NO está finalizado/entregado
            // Nota: 'not-in' requiere limitar a 10 valores.
            constraints.push(where("status", "not-in", ["ENTREGADO", "FINALIZADO"]));
            constraints.push(orderBy("status")); // 'not-in' exige ordenar por ese campo primero
            constraints.push(orderBy("entryDate", "desc"));
        } else {
            // Historial = Solo lo finalizado
            constraints.push(where("status", "in", ["ENTREGADO", "FINALIZADO"]));
            constraints.push(orderBy("entryDate", "desc"));
        }

        // B. PAGINACIÓN
        if (isNextPage && lastVisible) {
            constraints.push(startAfter(lastVisible));
        }

        // C. LÍMITE
        constraints.push(limit(DOCS_PER_PAGE));

        const q = query(refColl, ...constraints);
        const snapshot = await getDocs(q);
        
        if (!isNextPage) container.innerHTML = "";

        if (snapshot.empty) {
            if (!isNextPage) container.innerHTML = `<div class="text-center py-10 text-gray-400 text-xs font-bold uppercase">No hay registros en esta sección.</div>`;
            loadMoreBtn.classList.add('hidden');
            isLoading = false;
            return;
        }

        // Guardar cursor
        lastVisible = snapshot.docs[snapshot.docs.length - 1];

        // Botón Ver Más
        if (snapshot.docs.length === DOCS_PER_PAGE) {
            loadMoreBtn.classList.remove('hidden');
            loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar siguientes 50`;
        } else {
            loadMoreBtn.classList.add('hidden');
        }

        // Agrupar y Renderizar
        const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderGroupedInventory(items, isNextPage); // Pasamos flag para saber si append o reset

    } catch (e) {
        console.error(e);
        const msg = e.message.includes("indexes") 
            ? "Falta índice compuesto. Abre la consola (F12) y crea el índice." 
            : "Error cargando inventario.";
        if(!isNextPage) container.innerHTML = `<p class="text-center text-red-400 font-bold p-10 text-xs">${msg}</p>`;
    } finally {
        isLoading = false;
    }
}

// Global para botón
window.loadMoreInventory = () => loadInventory(true);

// --- 2. SISTEMA DE TABS ---
window.setView = (mode) => {
    if(isLoading) return;
    currentView = mode;
    lastVisible = null; // Reset paginación
    searchInput.value = ""; // Limpiar busqueda local

    if(mode === 'active') {
        tabActive.classList.add('active');
        tabHistory.classList.remove('active');
        // Estilos extra
        tabActive.classList.remove('text-gray-400', 'border-transparent');
        tabActive.classList.add('text-brand-cyan', 'border-brand-cyan');
        tabHistory.classList.add('text-gray-400', 'border-transparent');
        tabHistory.classList.remove('text-brand-cyan', 'border-brand-cyan');
    } else {
        tabActive.classList.remove('active');
        tabHistory.classList.add('active');
        // Estilos extra
        tabHistory.classList.remove('text-gray-400', 'border-transparent');
        tabHistory.classList.add('text-brand-cyan', 'border-brand-cyan');
        tabActive.classList.add('text-gray-400', 'border-transparent');
        tabActive.classList.remove('text-brand-cyan', 'border-brand-cyan');
    }
    loadInventory(false);
};

tabActive.onclick = () => window.setView('active');
tabHistory.onclick = () => window.setView('history');

// --- 3. RENDERIZADO ---
function renderGroupedInventory(items, isAppend) {
    // Si es append, no borramos el contenedor, pero sí necesitamos agrupar
    // La agrupación visual (Tarjetas por Nombre de Producto) es compleja con paginación
    // Simplificaremos: Renderizamos tarjetas individuales o grupos *dentro del lote*.
    // Para UX limpia en paginación, simplemente añadimos las tarjetas nuevas abajo.

    // Agrupar items POR ESTE LOTE
    const groups = {};
    items.forEach(item => {
        const key = item.productName || "Desconocido";
        if (!groups[key]) { groups[key] = { name: key, count: 0, units: [] }; }
        groups[key].units.push(item);
        groups[key].count++;
    });

    // Renderizar
    const htmlBuffer = Object.values(groups).map(group => {
        const unitsHTML = group.units.map(unit => {
            let badgeColor = "bg-gray-100 text-gray-600";
            if(unit.status === 'EN_REVISION_TECNICA') badgeColor = "bg-yellow-100 text-yellow-700";
            if(unit.status === 'REPARADO') badgeColor = "bg-green-100 text-green-700";
            if(unit.status === 'IRREPARABLE') badgeColor = "bg-red-100 text-red-700";
            if(unit.status === 'EN_STOCK_REPUESTOS') badgeColor = "bg-indigo-100 text-indigo-700 border border-indigo-200";
            if(unit.status === 'ENTREGADO' || unit.status === 'FINALIZADO') badgeColor = "bg-brand-cyan/20 text-brand-cyan";

            const actionBtn = currentView === 'active' 
                ? `<button onclick="window.openStatusModal('${unit.id}')" class="bg-brand-black text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-brand-cyan hover:text-brand-black transition shadow-sm">Gestionar</button>`
                : `<span class="text-[9px] font-bold text-gray-400">Archivado</span>`;

            let historyInfo = "";
            if (currentView === 'history' && unit.exitDestination) {
                historyInfo = `<br><span class="text-[8px] font-bold text-brand-red uppercase">Salida: ${unit.exitDestination.replace(/_/g, ' ')}</span>`;
            }

            return `
            <tr class="border-b border-gray-50 last:border-0 hover:bg-slate-50 transition item-row-searchable">
                <td class="p-4 w-48">
                    <p class="font-mono text-[10px] font-bold text-brand-cyan bg-brand-cyan/5 px-2 py-1 rounded w-fit select-all searchable-sn">${unit.sn}</p>
                    <p class="text-[9px] text-gray-400 mt-1">${unit.entryDate?.toDate().toLocaleDateString()}</p>
                </td>
                <td class="p-4">
                    <p class="text-[10px] font-bold text-gray-600 uppercase mb-1">Estado Físico:</p>
                    <span class="inline-block px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${badgeColor}">
                        ${unit.status.replace(/_/g, ' ')}
                    </span>
                    ${historyInfo}
                </td>
                <td class="p-4 max-w-xs">
                    <p class="text-[10px] font-bold text-gray-600 uppercase mb-1">Notas:</p>
                    <p class="text-xs text-gray-500 italic truncate" title="${unit.notes}">${unit.notes}</p>
                    ${unit.exitNotes ? `<p class="text-[9px] text-red-400 italic mt-1">Salida: ${unit.exitNotes}</p>` : ''}
                </td>
                <td class="p-4 text-right">
                    ${actionBtn}
                </td>
            </tr>`;
        }).join('');

        return `
            <div class="bg-white border border-gray-100 rounded-[2rem] shadow-sm overflow-hidden fade-in mb-6 group-card-searchable">
                <div class="bg-slate-50 p-6 flex justify-between items-center border-b border-gray-100">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-gray-400 shadow-sm">
                            <i class="fa-solid fa-box text-xl"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-black uppercase text-brand-black searchable-name">${group.name}</h3>
                            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                ${currentView === 'active' ? 'Stock Activo' : 'Historial'}: <span class="text-brand-cyan text-sm">${group.count}</span>
                            </p>
                        </div>
                    </div>
                </div>
                <div class="overflow-x-auto"><table class="w-full text-left"><tbody class="divide-y divide-gray-50">${unitsHTML}</tbody></table></div>
            </div>
        `;
    }).join('');

    // Insertar
    if(isAppend) {
        // Truco: insertamos antes del botón de carga
        // Como 'container' es el div wrapper, podemos usar insertAdjacentHTML
        container.insertAdjacentHTML('beforeend', htmlBuffer);
    } else {
        container.innerHTML = htmlBuffer;
    }
}

// --- 4. BÚSQUEDA LOCAL (EN LO DESCARGADO) ---
// Nota: Como es inventario físico (pocas unidades usualmente), filtramos localmente lo cargado.
// Si necesitas búsqueda global en servidor, usa el patrón de "inventory-entry.js".
searchInput.addEventListener('keyup', (e) => {
    const term = e.target.value.toLowerCase();
    
    // Filtrar Tarjetas completas o Filas individuales
    // Estrategia simple: Ocultar tarjetas que no coincidan
    const cards = document.querySelectorAll('.group-card-searchable');
    cards.forEach(card => {
        const name = card.querySelector('.searchable-name').textContent.toLowerCase();
        let matchCard = name.includes(term);
        
        // Si no coincide el nombre del producto, buscar en los seriales internos
        if (!matchCard) {
            const rows = card.querySelectorAll('.item-row-searchable');
            let hasRowMatch = false;
            rows.forEach(row => {
                const sn = row.querySelector('.searchable-sn').textContent.toLowerCase();
                if (sn.includes(term)) {
                    row.style.display = '';
                    hasRowMatch = true;
                } else {
                    row.style.display = 'none';
                }
            });
            matchCard = hasRowMatch;
            // Si el nombre sí coincidía, mostramos todas las filas
        } else {
            const rows = card.querySelectorAll('.item-row-searchable');
            rows.forEach(r => r.style.display = '');
        }

        card.style.display = matchCard ? '' : 'none';
    });
});

// --- 5. MODAL GESTIÓN Y LÓGICA DE NEGOCIO ---
// (Misma lógica de actualización, solo necesitamos asegurar que recargue bien)

window.openStatusModal = async (id) => {
    // Buscar en DOM o recargar (mejor un getDoc rápido para asegurar datos frescos)
    try {
        const snap = await doc(db, "warranty_inventory", id); // Error: doc() returns ref, need getDoc
        // Corrección: como ya tenemos los datos en memoria en 'allInventory' (pero ahora está paginado y no guardamos todo en array global),
        // lo mejor es buscar el elemento en el DOM o hacer un fetch. Haremos fetch ligero.
        
        // Pero para no gastar lectura extra, intentamos buscar en los datos renderizados si pudiéramos.
        // Dado que la paginación complica el estado global 'allInventory', haremos getDoc. Es seguro.
        const docSnap = await getDocs(query(collection(db, "warranty_inventory"), where("__name__", "==", id))); 
        // Mejor usamos getDoc con referencia directa
        // Implementación correcta:
        // const ref = doc(db, "warranty_inventory", id);
        // const snap = await getDoc(ref);
        // Pero arriba importamos getDoc... vamos a usarlo.
    } catch(e) {} 
    
    // Simplificación: Guardamos datos en el botón "Gestionar" para no leer DB
    // O mejor, pasamos solo el ID y leemos 1 vez. Es más seguro.
    
    currentItem = { id }; // Placeholder
    // Leemos datos frescos
    const ref = doc(db, "warranty_inventory", id);
    // Nota: Necesitamos importar getDoc. Ver imports arriba.
    // Usaremos una función auxiliar interna para evitar conflictos de imports en este bloque.
    fetchAndShowModal(id);
};

async function fetchAndShowModal(id) {
    try {
        // Necesitamos importar getDoc. Asegúrate que esté en el import.
        // Simulamos la lectura con getDocs query por ID (truco si falta getDoc)
        // Pero mejor usar getDoc directo si está importado.
        
        // Como no tengo acceso fácil al objeto 'currentItem' completo desde el click,
        // lo recupero.
        const snap = await import('./firebase-init.js').then(m => m.getDoc(m.doc(db, "warranty_inventory", id)));
        
        if (!snap.exists()) return alert("Item no encontrado");
        currentItem = { id: snap.id, ...snap.data() };

        document.getElementById('m-prod-name').textContent = currentItem.productName;
        document.getElementById('m-sn').textContent = `SN: ${currentItem.sn}`;
        document.getElementById('m-new-status').value = currentItem.status;
        
        // Reset inputs
        document.getElementById('m-exit-destination').value = "";
        document.getElementById('m-exit-notes').value = "";
        document.getElementById('m-keep-parts').checked = false;
        document.getElementById('parts-input-container').classList.add('hidden');
        document.getElementById('m-part-name').value = "";
        document.getElementById('m-part-notes').value = "";

        statusModal.classList.remove('hidden');
    } catch(e) { console.error(e); }
}

window.closeStatusModal = () => {
    statusModal.classList.add('hidden');
    currentItem = null;
};

window.togglePartsInput = () => {
    const isChecked = document.getElementById('m-keep-parts').checked;
    const div = document.getElementById('parts-input-container');
    if (isChecked) div.classList.remove('hidden');
    else div.classList.add('hidden');
};

window.updateStatus = async () => {
    const newStatus = document.getElementById('m-new-status').value;
    try {
        await updateDoc(doc(db, "warranty_inventory", currentItem.id), { status: newStatus });
        alert("✅ Estado actualizado.");
        closeStatusModal();
        loadInventory(false); // Recarga completa para reordenar
    } catch (e) { alert("Error: " + e.message); }
};

window.finalizeExit = async () => {
    const destination = document.getElementById('m-exit-destination').value;
    const notes = document.getElementById('m-exit-notes').value;
    const keepParts = document.getElementById('m-keep-parts').checked;

    if (!destination) return alert("Selecciona un destino final.");
    if (!confirm("¿Confirmas la salida? Se moverá al historial.")) return;

    try {
        await updateDoc(doc(db, "warranty_inventory", currentItem.id), {
            status: 'ENTREGADO',
            exitDestination: destination,
            exitNotes: notes,
            exitDate: new Date()
        });

        if (keepParts) {
            const partName = document.getElementById('m-part-name').value.trim() || "Repuesto Genérico";
            const partNotes = document.getElementById('m-part-notes').value.trim();
            
            await addDoc(collection(db, "warranty_inventory"), {
                warrantyId: currentItem.warrantyId, 
                productId: currentItem.productId,
                productName: `REPUESTO: ${partName} (de ${currentItem.productName})`,
                sn: `${currentItem.sn}-PART`, 
                componentsReceived: "Extraído de unidad entregada/desguazada",
                notes: partNotes || "Pieza rescatada.",
                status: 'EN_STOCK_REPUESTOS', 
                entryDate: new Date()
            });
            alert("✅ Salida registrada Y repuesto guardado.");
        } else {
            alert("✅ Salida registrada.");
        }

        if (currentItem.warrantyId) {
            // Intentar cerrar garantía padre
            try {
                const wRef = doc(db, "warranties", currentItem.warrantyId);
                await updateDoc(wRef, { status: 'FINALIZADO', resolvedAt: new Date() });
            } catch(e) { console.warn("No se pudo cerrar garantía padre (quizás ya cerrada)", e); }
        }

        closeStatusModal();
        loadInventory(false);
    } catch (e) { alert("Error: " + e.message); }
};

// Start
loadInventory(false);