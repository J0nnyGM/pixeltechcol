import { db, collection, getDocs, orderBy, query, doc, updateDoc, addDoc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const container = document.getElementById('rma-container');
const searchInput = document.getElementById('rma-search');
const statusModal = document.getElementById('status-modal');
const tabActive = document.getElementById('tab-active');
const tabHistory = document.getElementById('tab-history');

let allInventory = [];
let currentView = 'active'; // 'active' | 'history'
let currentItem = null;

// --- 1. CARGA INICIAL ---
async function loadInventory() {
    container.innerHTML = `<div class="text-center py-20"><i class="fa-solid fa-circle-notch fa-spin text-4xl text-brand-cyan/50"></i></div>`;
    
    try {
        const q = query(collection(db, "warranty_inventory"), orderBy("entryDate", "desc"));
        const snap = await getDocs(q);
        
        allInventory = [];
        snap.forEach(d => {
            allInventory.push({ id: d.id, ...d.data() });
        });

        filterAndRender();

    } catch (e) {
        console.error(e);
        container.innerHTML = `<p class="text-center text-red-400 font-bold">Error cargando inventario.</p>`;
    }
}

// --- 2. SISTEMA DE TABS ---
tabActive.onclick = () => { setView('active'); };
tabHistory.onclick = () => { setView('history'); };

function setView(mode) {
    currentView = mode;
    // Estilos visuales de tabs
    if(mode === 'active') {
        tabActive.classList.add('active');
        tabHistory.classList.remove('active');
    } else {
        tabActive.classList.remove('active');
        tabHistory.classList.add('active');
    }
    filterAndRender();
}

// --- 3. FILTRADO Y RENDERIZADO ---
function filterAndRender() {
    const term = searchInput.value.toLowerCase();
    
    // Filtrar por Texto y por Estado (Activo vs Historial)
    const filtered = allInventory.filter(item => {
        const matchesText = item.productName.toLowerCase().includes(term) || item.sn.toLowerCase().includes(term);
        
        // Lógica de Tabs
        const isFinished = ['ENTREGADO', 'FINALIZADO'].includes(item.status); // Estados finales
        // Si view='active', mostramos lo que NO esté finalizado.
        // Si view='history', mostramos SOLO lo finalizado.
        const matchesTab = currentView === 'active' ? !isFinished : isFinished;

        return matchesText && matchesTab;
    });

    renderGroupedInventory(filtered);
}

function renderGroupedInventory(items) {
    container.innerHTML = "";
    if (items.length === 0) {
        container.innerHTML = `<div class="text-center py-10 text-gray-400 text-xs font-bold uppercase">No hay registros.</div>`;
        return;
    }

    const groups = {};
    items.forEach(item => {
        const key = item.productName || "Desconocido";
        if (!groups[key]) { groups[key] = { name: key, count: 0, units: [] }; }
        groups[key].units.push(item);
        groups[key].count++;
    });

    Object.values(groups).forEach(group => {
        const card = document.createElement('div');
        card.className = "bg-white border border-gray-100 rounded-[2rem] shadow-sm overflow-hidden fade-in mb-6";
        
        let unitsHTML = group.units.map(unit => {
            let badgeColor = "bg-gray-100 text-gray-600";
            if(unit.status === 'EN_REVISION_TECNICA') badgeColor = "bg-yellow-100 text-yellow-700";
            if(unit.status === 'REPARADO') badgeColor = "bg-green-100 text-green-700";
            if(unit.status === 'IRREPARABLE') badgeColor = "bg-red-100 text-red-700";
            if(unit.status === 'EN_STOCK_REPUESTOS') badgeColor = "bg-indigo-100 text-indigo-700 border border-indigo-200"; // Nuevo
            if(unit.status === 'ENTREGADO' || unit.status === 'FINALIZADO') badgeColor = "bg-brand-cyan/20 text-brand-cyan";

            const actionBtn = currentView === 'active' 
                ? `<button onclick="window.openStatusModal('${unit.id}')" class="bg-brand-black text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-brand-cyan hover:text-brand-black transition shadow-sm">Gestionar</button>`
                : `<span class="text-[9px] font-bold text-gray-400">Archivado</span>`;

            let historyInfo = "";
            if (currentView === 'history' && unit.exitDestination) {
                historyInfo = `<br><span class="text-[8px] font-bold text-brand-red uppercase">Salida: ${unit.exitDestination.replace(/_/g, ' ')}</span>`;
            }

            return `
            <tr class="border-b border-gray-50 last:border-0 hover:bg-slate-50 transition">
                <td class="p-4 w-48">
                    <p class="font-mono text-[10px] font-bold text-brand-cyan bg-brand-cyan/5 px-2 py-1 rounded w-fit select-all">${unit.sn}</p>
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

        card.innerHTML = `
            <div class="bg-slate-50 p-6 flex justify-between items-center border-b border-gray-100">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-gray-400 shadow-sm">
                        <i class="fa-solid fa-box text-xl"></i>
                    </div>
                    <div>
                        <h3 class="text-lg font-black uppercase text-brand-black">${group.name}</h3>
                        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            ${currentView === 'active' ? 'Stock Activo' : 'Historial'}: <span class="text-brand-cyan text-sm">${group.count}</span>
                        </p>
                    </div>
                </div>
            </div>
            <div class="overflow-x-auto"><table class="w-full text-left"><tbody class="divide-y divide-gray-50">${unitsHTML}</tbody></table></div>
        `;
        container.appendChild(card);
    });
}

searchInput.addEventListener('input', filterAndRender);

// --- 4. MODAL GESTIÓN ---
window.openStatusModal = (id) => {
    currentItem = allInventory.find(i => i.id === id);
    if (!currentItem) return;

    document.getElementById('m-prod-name').textContent = currentItem.productName;
    document.getElementById('m-sn').textContent = `SN: ${currentItem.sn}`;
    document.getElementById('m-new-status').value = currentItem.status;
    
    // Resetear campos de salida
    document.getElementById('m-exit-destination').value = "";
    document.getElementById('m-exit-notes').value = "";
    document.getElementById('m-keep-parts').checked = false;
    document.getElementById('parts-input-container').classList.add('hidden');
    document.getElementById('m-part-name').value = "";
    document.getElementById('m-part-notes').value = "";

    statusModal.classList.remove('hidden');
};

window.closeStatusModal = () => {
    statusModal.classList.add('hidden');
    currentItem = null;
};

// UI Toggle para repuestos
window.togglePartsInput = () => {
    const isChecked = document.getElementById('m-keep-parts').checked;
    const div = document.getElementById('parts-input-container');
    if (isChecked) div.classList.remove('hidden');
    else div.classList.add('hidden');
};

// Acción 1: Actualizar estado técnico
window.updateStatus = async () => {
    const newStatus = document.getElementById('m-new-status').value;
    try {
        await updateDoc(doc(db, "warranty_inventory", currentItem.id), { status: newStatus });
        alert("✅ Estado actualizado.");
        closeStatusModal();
        loadInventory();
    } catch (e) { alert("Error: " + e.message); }
};

// Acción 2: FINALIZAR / DAR SALIDA (Lógica Modificada)
window.finalizeExit = async () => {
    const destination = document.getElementById('m-exit-destination').value;
    const notes = document.getElementById('m-exit-notes').value;
    const keepParts = document.getElementById('m-keep-parts').checked;

    if (!destination) return alert("Selecciona un destino final.");
    if (!confirm("¿Confirmas la salida de este producto? Se moverá al historial.")) return;

    try {
        // 1. Marcar el original como ENTREGADO (Se va al historial)
        await updateDoc(doc(db, "warranty_inventory", currentItem.id), {
            status: 'ENTREGADO',
            exitDestination: destination,
            exitNotes: notes,
            exitDate: new Date()
        });

        // 2. Si se guardaron repuestos, crear NUEVO ítem en inventario activo
        if (keepParts) {
            const partName = document.getElementById('m-part-name').value.trim() || "Repuesto Genérico";
            const partNotes = document.getElementById('m-part-notes').value.trim();
            
            await addDoc(collection(db, "warranty_inventory"), {
                warrantyId: currentItem.warrantyId, // Vinculo a la garantía origen
                productId: currentItem.productId,
                productName: `REPUESTO: ${partName} (de ${currentItem.productName})`,
                sn: `${currentItem.sn}-PART`, // SN modificado para identificar
                componentsReceived: "Extraído de unidad entregada/desguazada",
                notes: partNotes || "Pieza rescatada.",
                status: 'EN_STOCK_REPUESTOS', // Queda ACTIVO
                entryDate: new Date()
            });
            alert("✅ Salida registrada Y repuesto guardado en stock activo.");
        } else {
            alert("✅ Salida registrada correctamente.");
        }

        // 3. Cerrar ciclo de la garantía original si existe
        if (currentItem.warrantyId) {
            await updateDoc(doc(db, "warranties", currentItem.warrantyId), {
                status: 'FINALIZADO',
                resolvedAt: new Date()
            });
        }

        closeStatusModal();
        loadInventory();
    } catch (e) { alert("Error: " + e.message); }
};

loadInventory();