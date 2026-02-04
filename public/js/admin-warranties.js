import { db, storage, collection, getDocs, orderBy, query, doc, updateDoc, addDoc, getDoc, runTransaction, ref, uploadBytes, getDownloadURL, limit, startAfter, where } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// Elementos del DOM
const table = document.getElementById('warranties-table');
const manageModal = document.getElementById('manage-modal');
const resolutionModal = document.getElementById('resolution-modal');
const loadMoreBtn = document.getElementById('load-more-container');
const searchInput = document.getElementById('search-input');

// Estado Global
let currentWarranty = null; 
let lastVisible = null;
let isLoading = false;
let currentFilter = 'PENDING'; // Estado inicial: Solo pendientes
const DOCS_PER_PAGE = 50;

// --- 1. CARGAR LISTA (OPTIMIZADA + FILTROS) ---
async function fetchWarranties(isNextPage = false) {
    if (isLoading) return;
    isLoading = true;

    // UI Loading
    if (!isNextPage) {
        table.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i><p class="mt-2 text-xs font-bold text-gray-400">Cargando solicitudes...</p></td></tr>`;
        loadMoreBtn.classList.add('hidden');
    } else {
        const btn = loadMoreBtn.querySelector('button');
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
    }
    
    try {
        const refColl = collection(db, "warranties");
        let constraints = [];

        // A. FILTROS DE ESTADO (Ahorro de lecturas)
        if (currentFilter === 'PENDING') {
            // Buscamos tanto 'PENDIENTE' como 'PENDIENTE_REVISION' para asegurar compatibilidad
            constraints.push(where("status", "in", ["PENDIENTE", "PENDIENTE_REVISION"]));
        } else if (currentFilter === 'APPROVED') {
            constraints.push(where("status", "==", "APROBADO"));
        } else if (currentFilter === 'REJECTED') {
            constraints.push(where("status", "==", "RECHAZADO"));
        }
        // 'ALL' no agrega filtro, trae todo el historial.

        // B. ORDENAMIENTO
        constraints.push(orderBy("createdAt", "desc"));

        // C. PAGINACIÓN
        if (isNextPage && lastVisible) {
            constraints.push(startAfter(lastVisible));
        }

        // D. LÍMITE
        constraints.push(limit(DOCS_PER_PAGE));

        const q = query(refColl, ...constraints);
        const snapshot = await getDocs(q); // Variable correcta: snapshot

        if (!isNextPage) table.innerHTML = "";

        if (snapshot.empty) {
            if (!isNextPage) table.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No hay solicitudes en esta sección.</td></tr>`;
            loadMoreBtn.classList.add('hidden');
            isLoading = false;
            return;
        }

        // --- CORRECCIÓN DEL ERROR ---
        // Antes decía 'snap.docs', ahora usamos 'snapshot.docs' correctamente.
        lastVisible = snapshot.docs[snapshot.docs.length - 1];

        // Botón Ver Más
        if (snapshot.docs.length === DOCS_PER_PAGE) {
            loadMoreBtn.classList.remove('hidden');
            loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar siguientes 50`;
        } else {
            loadMoreBtn.classList.add('hidden');
        }

        // Renderizar
        snapshot.forEach(d => {
            renderWarrantyRow({ id: d.id, ...d.data() });
        });

    } catch (e) { 
        console.error(e);
        const msg = e.message.includes("indexes") 
            ? "Falta un índice en Firebase. Abre la consola (F12) y haz clic en el enlace." 
            : "Error de conexión.";
        if(!isNextPage) table.innerHTML = `<tr><td colspan="6" class="text-center text-red-400 font-bold p-10 text-xs">${msg}</td></tr>`;
    } finally {
        isLoading = false;
    }
}

// Globales
window.loadMoreWarranties = () => fetchWarranties(true);

window.filterTab = (status) => {
    if(isLoading) return;
    currentFilter = status;
    lastVisible = null; // Reiniciar paginación
    searchInput.value = ""; // Limpiar busqueda visual

    // Actualizar UI de botones
    document.querySelectorAll('.tab-btn').forEach(btn => {
        // Reset estilos inactivos
        btn.className = "tab-btn px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest bg-white text-gray-400 border border-gray-200 hover:text-brand-black hover:border-gray-300 transition-all whitespace-nowrap cursor-pointer";
    });
    
    // Estilo activo
    const activeId = status === 'PENDING' ? 'tab-pending' : 
                     status === 'APPROVED' ? 'tab-approved' : 
                     status === 'REJECTED' ? 'tab-rejected' : 'tab-all';
    
    const activeBtn = document.getElementById(activeId);
    if(activeBtn) {
        let colorClass = "bg-brand-black text-white shadow-lg"; // Default ALL
        if(status === 'PENDING') colorClass = "bg-brand-cyan text-white shadow-lg shadow-cyan-500/30 border-transparent";
        if(status === 'APPROVED') colorClass = "bg-green-500 text-white shadow-lg shadow-green-500/30 border-transparent";
        if(status === 'REJECTED') colorClass = "bg-red-500 text-white shadow-lg shadow-red-500/30 border-transparent";
        
        activeBtn.className = `tab-btn px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap cursor-default ${colorClass}`;
    }

    fetchWarranties(false);
};

function renderWarrantyRow(w) {
    // Badges de Estado
    let statusBadge = `<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-yellow-200">Pendiente</span>`;
    if (w.status === 'APROBADO') statusBadge = `<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-green-200">Aprobado</span>`;
    if (w.status === 'RECHAZADO') statusBadge = `<span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-red-200">Rechazado</span>`;
    if (w.status === 'FINALIZADO') statusBadge = `<span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-gray-200">Finalizado</span>`;

    // Botón de Acción
    let actionBtn = `<button onclick="window.openManageModal('${w.id}')" class="bg-brand-black text-white px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-brand-cyan hover:text-brand-black transition shadow-md">Gestionar</button>`;
    if (w.status !== 'PENDIENTE_REVISION' && w.status !== 'PENDIENTE') {
        actionBtn = `<button onclick="window.openManageModal('${w.id}')" class="bg-slate-100 text-gray-400 px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-slate-200 transition">Ver Detalle</button>`;
    }

    const dateStr = w.createdAt?.toDate ? w.createdAt.toDate().toLocaleDateString() : '---';

    table.innerHTML += `
        <tr class="hover:bg-slate-50 transition border-b border-gray-50 last:border-0 fade-in group">
            <td class="px-8 py-6">
                <p class="text-xs font-bold text-brand-black">${dateStr}</p>
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">#${w.orderId ? w.orderId.slice(0,6) : '---'}</p>
            </td>
            <td class="px-8 py-6">
                <p class="text-xs font-black uppercase text-brand-black">${w.userName}</p>
                <p class="text-[9px] text-gray-400 font-bold">${w.userEmail}</p>
            </td>
            <td class="px-8 py-6">
                <div class="flex items-center gap-2">
                    <img src="${w.productImage || 'https://placehold.co/50'}" class="w-8 h-8 rounded-md object-contain bg-white border border-gray-100">
                    <div>
                        <p class="text-xs font-bold text-brand-black uppercase truncate max-w-[120px]" title="${w.productName}">${w.productName}</p>
                        <p class="text-[9px] font-mono text-brand-cyan font-bold">${w.snProvided}</p>
                    </div>
                </div>
            </td>
            <td class="px-8 py-6 max-w-xs">
                <p class="text-xs text-gray-600 italic line-clamp-1" title="${w.reason}">${w.reason}</p>
            </td>
            <td class="px-8 py-6 text-center">${statusBadge}</td>
            <td class="px-8 py-6 text-center">${actionBtn}</td>
        </tr>
    `;
}

// --- 2. BÚSQUEDA HÍBRIDA (CORREGIDO: SENSITIVIDAD DE CASO) ---
if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
        const rawTerm = e.target.value.trim(); // Texto original (para servidor)
        const lowerTerm = rawTerm.toLowerCase(); // Texto minúscula (para filtro visual)

        // A. BÚSQUEDA REAL EN SERVIDOR (ENTER)
        if (e.key === 'Enter' && rawTerm.length > 0) {
            performServerSearch(rawTerm); // Enviamos el término EXACTO
            return;
        }

        // B. FILTRO LOCAL (Mientras escribe)
        const rows = document.querySelectorAll('#warranties-table tr');
        rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(lowerTerm) ? '' : 'none';
        });
    });
}

async function performServerSearch(term) {
    if(isLoading) return;
    isLoading = true;

    table.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-search fa-bounce text-brand-cyan"></i> Buscando...</td></tr>`;
    loadMoreBtn.classList.add('hidden');

    try {
        const refColl = collection(db, "warranties");
        const promises = [];

        // 1. Por ID directo (Sensible a mayúsculas/minúsculas)
        promises.push(getDoc(doc(db, "warranties", term)).then(s => s.exists() ? [s] : []));
        
        // 2. Por Order ID (Exacto)
        const qOrder = query(refColl, where("orderId", "==", term));
        promises.push(getDocs(qOrder).then(s => s.docs));

        // 3. Por Serial (Exacto)
        const qSn = query(refColl, where("snProvided", "==", term));
        promises.push(getDocs(qSn).then(s => s.docs));

        const results = await Promise.all(promises);
        const flatResults = results.flat();

        // Eliminar duplicados
        const unique = new Map();
        flatResults.forEach(d => unique.set(d.id, d));
        
        table.innerHTML = "";
        
        if (unique.size > 0) {
            unique.forEach(d => renderWarrantyRow({ id: d.id, ...d.data() }));
        } else {
            table.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontró solicitud con ese ID, Orden o Serial exacto.</td></tr>`;
        }

    } catch(e) {
        console.error(e);
        fetchWarranties(false);
    } finally {
        isLoading = false;
    }
}

// --- 3. FUNCIONES AUXILIARES (PDF y WhatsApp) ---
async function uploadPDF(warrantyId) {
    const fileInput = document.getElementById('m-tech-report');
    if (!fileInput || fileInput.files.length === 0) return null;

    const file = fileInput.files[0];
    const storageRef = ref(storage, `warranty_reports/${warrantyId}_${Date.now()}.pdf`);
    
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
}

// --- 4. ABRIR MODAL DE GESTIÓN ---
window.openManageModal = async (id) => {
    const snap = await getDoc(doc(db, "warranties", id));
    if(!snap.exists()) return;
    
    currentWarranty = { id: snap.id, ...snap.data() };
    const w = currentWarranty;

    // Llenar UI Básica
    document.getElementById('m-id').textContent = w.id;
    document.getElementById('m-prod-img').src = w.productImage || 'https://placehold.co/100';
    document.getElementById('m-prod-name').textContent = w.productName;
    document.getElementById('m-sn').textContent = w.snProvided;
    
    document.getElementById('m-user-name').textContent = w.userName;
    document.getElementById('m-user-email').textContent = w.userEmail;
    document.getElementById('m-order-id').textContent = `ORDEN: #${w.orderId ? w.orderId.slice(0,8) : 'NA'}`;
    document.getElementById('m-reason').textContent = `"${w.reason}"`;

    // WhatsApp
    const phoneEl = document.getElementById('m-user-phone');
    const waLink = document.getElementById('m-whatsapp-link');
    phoneEl.textContent = "Buscando...";
    waLink.classList.add('hidden');

    try {
        if (w.userId) {
            const userSnap = await getDoc(doc(db, "users", w.userId));
            if (userSnap.exists()) {
                const phone = userSnap.data().phone || "";
                if (phone) {
                    phoneEl.textContent = phone;
                    let cleanPhone = phone.replace(/\D/g, '');
                    if(cleanPhone.length === 10) cleanPhone = '57' + cleanPhone; 
                    waLink.href = `https://wa.me/${cleanPhone}?text=Hola ${w.userName.split(' ')[0]}, te contactamos de PixelTech respecto a tu garantía #${w.id}`;
                    waLink.classList.remove('hidden');
                } else {
                    phoneEl.textContent = "Sin teléfono registrado";
                }
            } else {
                phoneEl.textContent = "Perfil no encontrado";
            }
        }
    } catch (err) { console.error(err); }

    // Limpiar Inputs
    document.getElementById('m-received').value = w.receivedItems || "";
    document.getElementById('m-admin-notes').value = w.adminResponse || "";
    document.getElementById('m-tech-report').value = ""; 

    // Evidencia
    const evidenceContainer = document.getElementById('m-evidence-container');
    evidenceContainer.innerHTML = "";
    if (w.evidenceImages && w.evidenceImages.length > 0) {
        w.evidenceImages.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.className = "w-full h-24 object-cover rounded-xl border border-gray-200 cursor-zoom-in hover:scale-105 transition";
            img.onclick = () => window.open(url, '_blank');
            evidenceContainer.appendChild(img);
        });
    } else {
        evidenceContainer.innerHTML = `<p class="text-xs text-gray-400 col-span-3 text-center py-4 italic">El usuario no adjuntó imágenes.</p>`;
    }

    // Control de Estado (Bloqueo)
    const btnApprove = document.querySelector('button[onclick="approveWarranty()"]');
    const btnReject = document.querySelector('button[onclick="rejectWarranty()"]');
    
    const inputs = [
        document.getElementById('m-received'), 
        document.getElementById('m-admin-notes'),
        document.getElementById('m-tech-report') 
    ];

    if (w.status !== 'PENDIENTE_REVISION' && w.status !== 'PENDIENTE') {
        btnApprove.classList.add('hidden');
        btnReject.classList.add('hidden');
        inputs.forEach(i => { i.disabled = true; i.classList.add('bg-gray-100', 'cursor-not-allowed'); });

        if(w.technicalReportUrl) {
            let linkLabel = document.getElementById('admin-pdf-link-preview');
            if(!linkLabel) {
                linkLabel = document.createElement('a');
                linkLabel.id = 'admin-pdf-link-preview';
                linkLabel.target = '_blank';
                linkLabel.className = "text-[10px] font-bold text-brand-cyan hover:underline mt-1 block";
                document.getElementById('m-tech-report').parentNode.appendChild(linkLabel);
            }
            linkLabel.href = w.technicalReportUrl;
            linkLabel.textContent = "Ver informe adjunto actual";
            linkLabel.classList.remove('hidden');
        }
    } else {
        btnApprove.classList.remove('hidden');
        btnReject.classList.remove('hidden');
        inputs.forEach(i => { i.disabled = false; i.classList.remove('bg-gray-100', 'cursor-not-allowed'); });
        const linkLabel = document.getElementById('admin-pdf-link-preview');
        if(linkLabel) linkLabel.classList.add('hidden');
    }

    manageModal.classList.remove('hidden');
};

window.closeManageModal = () => {
    manageModal.classList.add('hidden');
    currentWarranty = null;
};

// --- 5. APROBAR Y RECHAZAR (Lógica Transaccional) ---

window.approveWarranty = () => {
    const received = document.getElementById('m-received').value.trim();
    if(!received) return alert("⚠️ Debes listar los componentes físicos recibidos antes de aprobar.");
    currentWarranty._tempReceived = received;
    currentWarranty._tempNotes = document.getElementById('m-admin-notes').value.trim();
    resolutionModal.classList.remove('hidden');
};

window.confirmResolution = async () => {
    const btn = document.querySelector('button[onclick="confirmResolution()"]');
    const originalText = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    const resolutionType = document.querySelector('input[name="res-type"]:checked').value;
    const received = currentWarranty._tempReceived;
    const notes = currentWarranty._tempNotes;

    try {
        const pdfUrl = await uploadPDF(currentWarranty.id);

        await runTransaction(db, async (transaction) => {
            if (resolutionType === 'REPLACEMENT') {
                if (!currentWarranty.productId) throw "Error: No hay ID de producto.";
                const prodRef = doc(db, "products", currentWarranty.productId);
                const prodSnap = await transaction.get(prodRef);
                if (!prodSnap.exists()) throw "Producto no existe.";
                const currentStock = prodSnap.data().stock || 0;
                if (currentStock < 1) throw "⛔ No hay stock disponible para reemplazo.";
                transaction.update(prodRef, { stock: currentStock - 1 });
            }

            const warrantyRef = doc(db, "warranties", currentWarranty.id);
            transaction.update(warrantyRef, {
                status: 'APROBADO',
                resolutionType: resolutionType,
                receivedItems: received,
                adminResponse: notes || "Garantía aprobada.",
                technicalReportUrl: pdfUrl || null,
                resolvedAt: new Date()
            });

            const rmaRef = doc(collection(db, "warranty_inventory"));
            transaction.set(rmaRef, {
                warrantyId: currentWarranty.id,
                productId: currentWarranty.productId || 'unknown',
                productName: currentWarranty.productName,
                sn: currentWarranty.snProvided,
                componentsReceived: received,
                notes: `Resolución: ${resolutionType}. ${notes}`,
                status: 'EN_REVISION_TECNICA',
                entryDate: new Date()
            });
        });

        alert("✅ Garantía procesada.");
        resolutionModal.classList.add('hidden');
        closeManageModal();
        fetchWarranties(false); // Recargar lista

    } catch (e) {
        console.error(e);
        alert("Error: " + e);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
};

window.rejectWarranty = async () => {
    const notes = document.getElementById('m-admin-notes').value.trim();
    if(!notes) return alert("⚠️ Escribe la razón del rechazo.");

    if(!confirm("¿Rechazar garantía?")) return;

    const btn = document.querySelector('button[onclick="rejectWarranty()"]');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Subiendo...';

    try {
        const pdfUrl = await uploadPDF(currentWarranty.id);
        await updateDoc(doc(db, "warranties", currentWarranty.id), {
            status: 'RECHAZADO',
            adminResponse: notes,
            technicalReportUrl: pdfUrl || null,
            resolvedAt: new Date()
        });

        alert("⛔ Garantía Rechazada.");
        closeManageModal();
        fetchWarranties(false);

    } catch (e) { 
        console.error(e); 
        alert("Error: " + e.message); 
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
};

// Iniciar
fetchWarranties();