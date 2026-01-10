import { auth, db, storage, onAuthStateChanged, doc, getDoc, addDoc, collection, query, where, getDocs, ref, uploadBytes, getDownloadURL } from "./firebase-init.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

if (!orderId) window.location.href = '/profile.html';

const els = {
    id: document.getElementById('order-id-display'),
    date: document.getElementById('order-date-display'),
    statusBadge: document.getElementById('order-status-badge'),
    address: document.getElementById('shipping-address'),
    city: document.getElementById('shipping-city'),
    guideContainer: document.getElementById('tracking-container'),
    guideText: document.getElementById('shipping-guide'),
    itemsCount: document.getElementById('items-count'),
    subtotal: document.getElementById('order-subtotal'), 
    total: document.getElementById('order-total'),
    itemsList: document.getElementById('order-items-list'),

    warrantyModal: document.getElementById('warranty-modal'),
    warrantyForm: document.getElementById('warranty-form'),
    modalProdName: document.getElementById('modal-product-name'),
    inpSn: document.getElementById('w-sn'),
    inpReason: document.getElementById('w-reason'),
    inpImages: document.getElementById('w-images'),
    filePreview: document.getElementById('file-preview'),

    statusModal: document.getElementById('warranty-status-modal'),
    stDate: document.getElementById('st-date'),
    stBadge: document.getElementById('st-badge'),
    stReason: document.getElementById('st-reason'),
    stAdminBox: document.getElementById('st-admin-response-box'),
    stAdminResp: document.getElementById('st-admin-response'),
    stResolvedDate: document.getElementById('st-resolved-date'),
    stId: document.getElementById('st-id'),
    stPdfBtn: document.getElementById('st-tech-report-btn') // Referencia al botón PDF
};

let currentOrder = null;
let activeWarranties = [];
let selectedItemIndex = null;

if (els.inpImages) {
    els.inpImages.onchange = () => {
        els.filePreview.textContent = els.inpImages.files.length > 0
            ? `${els.inpImages.files.length} archivo(s) seleccionado(s)`
            : "";
    };
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        loadOrderDetails();
    } else {
        window.location.href = "/auth/login.html";
    }
});

async function loadOrderDetails() {
    try {
        const snap = await getDoc(doc(db, "orders", orderId));
        if (!snap.exists()) { window.location.href = '/profile.html'; return; }
        currentOrder = snap.data();

        // --- CORRECCIÓN AQUÍ ---
        // Agregamos where("userId", "==", auth.currentUser.uid) para cumplir con las reglas de seguridad
        const qW = query(
            collection(db, "warranties"),
            where("orderId", "==", orderId),
            where("userId", "==", auth.currentUser.uid) // <--- FILTRO OBLIGATORIO
        );

        const snapW = await getDocs(qW);
        activeWarranties = snapW.docs.map(d => ({ id: d.id, ...d.data() }));

        renderHeaderInfo(snap.id, currentOrder);
        renderItems(currentOrder);
    } catch (e) {
        console.error("Error cargando orden/garantías:", e);
        // No mostrar alerta intrusiva si es solo un error de permisos de lectura de garantías,
        // pero sí loguearlo. Si falla la orden, el usuario verá datos vacíos.
    }
}

function renderHeaderInfo(displayId, order) {
    els.id.textContent = `ORDEN #${displayId.slice(0, 8).toUpperCase()}`;
    els.date.textContent = order.createdAt?.toDate().toLocaleDateString('es-CO');
    
    let statusClass = "bg-yellow-100 text-yellow-700 border-yellow-200";
    if (order.status === 'DESPACHADO') statusClass = "bg-green-100 text-green-700 border-green-200";
    if (order.status === 'CANCELADO') statusClass = "bg-red-100 text-red-700 border-red-200";
    els.statusBadge.innerHTML = `<span class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border ${statusClass}">${order.status}</span>`;

    els.address.textContent = order.address || "---";
    els.city.textContent = order.city || "---";
    
    if (order.shippingTracking) {
        els.guideContainer.classList.remove('hidden');
        els.guideText.textContent = `${order.shippingCarrier || ''} - ${order.shippingTracking}`;
    }

    // Precios
    const totalVal = (order.total || 0).toLocaleString('es-CO');
    els.itemsCount.textContent = order.items.length;
    
    // Aquí llenamos ambos campos
    if (els.subtotal) els.subtotal.textContent = `$${totalVal}`;
    els.total.textContent = `$${totalVal}`;
}

function renderItems(order) {
    els.itemsList.innerHTML = "";
    const shippedDate = order.shippedAt ? order.shippedAt.toDate() : null;
    const now = new Date();

    order.items.forEach((item, index) => {
        const warrantyDays = item.warrantyDays || 365;
        let actionBtnHTML = "";
        let warrantyStatusHTML = "";
        let isExpired = false;
        let daysLeft = 0;

        // 1. Calcular Tiempos
        if (shippedDate) {
            const expirationDate = new Date(shippedDate);
            expirationDate.setDate(expirationDate.getDate() + warrantyDays);
            daysLeft = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));
            isExpired = daysLeft <= 0;
        }

        // 2. Verificar si YA tiene garantía (INCLUYENDO RECHAZADAS)
        // CAMBIO: Quitamos el filtro !== 'RECHAZADO' para que detecte también las rechazas
        const existingClaim = activeWarranties.find(w => w.productId === item.id);

        // 3. Determinar Estado Visual
        if (!shippedDate) {
            // Caso: No despachado
            warrantyStatusHTML = `<span class="text-[9px] font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded">Inicia al despachar</span>`;
            actionBtnHTML = `<button disabled class="mt-4 w-full md:w-auto bg-gray-100 text-gray-400 px-6 py-3 rounded-xl font-bold text-[10px] uppercase cursor-not-allowed">No disponible</button>`;

        } else if (existingClaim) {
            // CASO: YA TIENE SOLICITUD (Sea Pendiente, Aprobada o Rechazada)
            let statusLabel = "En Revisión";
            let statusColor = "bg-blue-50 text-blue-600 border-blue-200";
            let icon = "fa-eye";

            if (existingClaim.status === 'APROBADO') {
                statusLabel = "Aprobada";
                statusColor = "bg-green-50 text-green-600 border-green-200";
            } else if (existingClaim.status === 'RECHAZADO') {
                // CAMBIO: Estado visual para Rechazado
                statusLabel = "Rechazada";
                statusColor = "bg-red-50 text-red-600 border-red-200";
                icon = "fa-circle-exclamation";
            }

            warrantyStatusHTML = `<span class="text-[9px] font-black uppercase ${statusColor} px-2 py-1 rounded border">Estado: ${statusLabel}</span>`;

            // El botón lleva a VER DETALLES (para ver el motivo de rechazo) en lugar de abrir nueva solicitud
            actionBtnHTML = `
                <button onclick="window.openStatusModal('${existingClaim.id}')" class="mt-4 w-full md:w-auto bg-white border-2 border-brand-black text-brand-black px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-brand-black hover:text-white transition shadow-sm transform active:scale-95">
                    <i class="fa-solid ${icon} mr-2"></i> Ver Detalles
                </button>`;

        } else if (!isExpired) {
            // CASO: DISPONIBLE PARA SOLICITAR
            warrantyStatusHTML = `<span class="text-[9px] font-black text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100 flex items-center gap-1"><i class="fa-solid fa-shield-check"></i> Garantía Activa (${daysLeft} días)</span>`;

            actionBtnHTML = `
                <button onclick="window.openWarrantyModal(${index})" class="mt-4 w-full md:w-auto bg-brand-black text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-brand-cyan hover:text-brand-black transition shadow-lg transform active:scale-95">
                    Solicitar Garantía
                </button>`;
        } else {
            // CASO: EXPIRADA
            warrantyStatusHTML = `<span class="text-[9px] font-black text-red-400 bg-red-50 px-2 py-1 rounded border border-red-100">Garantía Expirada</span>`;
            actionBtnHTML = `<button disabled class="mt-4 w-full md:w-auto bg-gray-50 text-gray-300 px-6 py-3 rounded-xl font-bold text-[10px] uppercase cursor-not-allowed">Expirada</button>`;
        }

        const div = document.createElement('div');
        div.className = "flex flex-col md:flex-row gap-6 p-6 border-b border-gray-50 last:border-0 hover:bg-slate-50 transition rounded-3xl group";

        // CAMBIO: Se eliminó el bloque que mostraba los SNs (item.sns.map...)
        div.innerHTML = `
            <div class="w-24 h-24 bg-white rounded-2xl border border-gray-100 p-2 flex items-center justify-center shrink-0">
                <img src="${item.mainImage || item.image}" class="max-w-full max-h-full object-contain">
            </div>
            <div class="flex-grow">
                <div class="flex justify-between items-start">
                    <div>
                        <h4 class="font-black text-sm uppercase text-brand-black group-hover:text-brand-cyan transition-colors cursor-pointer" onclick="window.location.href='/shop/product.html?id=${item.id}'">${item.name}</h4>
                        <p class="text-[10px] font-bold text-gray-400 uppercase mt-1">${item.color || ''} ${item.capacity || ''}</p>
                    </div>
                    <p class="font-black text-brand-cyan text-lg">$${(item.price || 0).toLocaleString('es-CO')}</p>
                </div>
                
                <div class="mt-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div class="flex items-center gap-3">
                        ${warrantyStatusHTML}
                    </div>
                    ${actionBtnHTML}
                </div>
            </div>
        `;
        els.itemsList.appendChild(div);
    });
}
window.openWarrantyModal = (index) => {
    selectedItemIndex = index;
    const item = currentOrder.items[index];
    els.modalProdName.textContent = item.name;
    els.inpSn.value = "";
    els.inpReason.value = "";
    els.inpImages.value = "";
    els.filePreview.textContent = "";
    els.warrantyModal.classList.remove('hidden');
    els.warrantyModal.classList.add('flex');
};

window.closeWarrantyModal = () => {
    els.warrantyModal.classList.add('hidden');
    els.warrantyModal.classList.remove('flex');
};

window.openStatusModal = (warrantyId) => {
    const claim = activeWarranties.find(w => w.id === warrantyId);
    if (!claim) return;

    els.stId.textContent = claim.id;
    els.stDate.textContent = "Radicado: " + claim.createdAt?.toDate().toLocaleDateString('es-CO');
    els.stReason.textContent = `"${claim.reason}"`;

    let badgeClass = "bg-blue-100 text-blue-700";
    let badgeText = "En Revisión";
    if (claim.status === 'APROBADO') {
        badgeClass = "bg-green-100 text-green-700";
        badgeText = "Aprobada - En Proceso";
    } else if (claim.status === 'RECHAZADO') {
        badgeClass = "bg-red-100 text-red-700";
        badgeText = "Rechazada";
    } else if (claim.status === 'FINALIZADO') {
        badgeClass = "bg-gray-100 text-gray-700";
        badgeText = "Caso Cerrado";
    }
    
    els.stBadge.className = `inline-block px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest mb-2 ${badgeClass}`;
    els.stBadge.textContent = badgeText;

    if (claim.adminResponse) {
        els.stAdminBox.classList.remove('hidden');
        els.stAdminResp.textContent = claim.adminResponse;
        
        // LÓGICA PDF CORREGIDA
        if (claim.technicalReportUrl && els.stPdfBtn) {
            els.stPdfBtn.href = claim.technicalReportUrl;
            // Forzamos visibilidad quitando hidden y poniendo flex
            els.stPdfBtn.classList.remove('hidden');
            els.stPdfBtn.classList.add('flex');
        } else if (els.stPdfBtn) {
            els.stPdfBtn.classList.add('hidden');
            els.stPdfBtn.classList.remove('flex');
        }

        els.stResolvedDate.textContent = claim.resolvedAt ? "Actualizado: " + claim.resolvedAt.toDate().toLocaleString() : "";
    } else {
        els.stAdminBox.classList.add('hidden');
    }

    els.statusModal.classList.remove('hidden');
    els.statusModal.classList.add('flex');
};

els.warrantyForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = els.warrantyForm.querySelector('button');
    const originalText = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

    const snInput = els.inpSn.value.trim();
    const reason = els.inpReason.value.trim();
    const item = currentOrder.items[selectedItemIndex];
    const imageFiles = els.inpImages.files;

    try {
        if (!currentOrder.shippedAt) throw new Error("Fecha de despacho no encontrada.");

        if (item.sns && item.sns.length > 0) {
            const snFound = item.sns.some(sn => sn.trim().toUpperCase() === snInput.toUpperCase());
            if (!snFound) throw new Error("⛔ El Serial no coincide con este pedido.");
        }

        const qDup = query(
            collection(db, "warranties"),
            where("userId", "==", auth.currentUser.uid), // <-- FILTRO OBLIGATORIO
            where("snProvided", "==", snInput)
        );
        const dupSnap = await getDocs(qDup);
        const activeDup = dupSnap.docs.find(d => d.data().status !== 'RECHAZADO');
        if (activeDup) throw new Error("⛔ Ya existe una solicitud activa para este serial.");

        const evidenceUrls = [];
        if (imageFiles.length > 0) {
            for (const file of imageFiles) {
                const storageRef = ref(storage, `warranties/${orderId}/${Date.now()}_${file.name}`);
                await uploadBytes(storageRef, file);
                const url = await getDownloadURL(storageRef);
                evidenceUrls.push(url);
            }
        }

        await addDoc(collection(db, "warranties"), {
            orderId: orderId,
            userId: auth.currentUser.uid,
            userEmail: auth.currentUser.email,
            userName: auth.currentUser.displayName || "Cliente",
            productId: item.id || 'unknown',
            productName: item.name,
            productImage: item.mainImage || item.image || '',
            snProvided: snInput,
            reason: reason,
            evidenceImages: evidenceUrls,
            status: 'PENDIENTE_REVISION',
            createdAt: new Date(),
            shippedAtDate: currentOrder.shippedAt
        });

        alert("✅ Solicitud creada exitosamente.");
        window.closeWarrantyModal();
        location.reload();

    } catch (err) {
        console.error("Error:", err);
        alert(err.message);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
};