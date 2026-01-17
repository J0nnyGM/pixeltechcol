import { auth, db, storage, onAuthStateChanged, doc, getDoc, addDoc, collection, query, where, getDocs, ref, uploadBytes, getDownloadURL } from "./firebase-init.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

if (!orderId) window.location.href = '/profile.html';

const els = {
    // Info General
    id: document.getElementById('order-id-display'),
    date: document.getElementById('order-date-display'),
    statusBadge: document.getElementById('order-status-badge'),
    address: document.getElementById('shipping-address'),
    city: document.getElementById('shipping-city'),
    guideContainer: document.getElementById('tracking-container'),
    guideText: document.getElementById('shipping-guide'),
    itemsCount: document.getElementById('items-count'),
    subtotal: document.getElementById('order-subtotal'), 
    shipping: document.getElementById('order-shipping'), 
    total: document.getElementById('order-total'),
    itemsList: document.getElementById('order-items-list'),

    // Facturación
    billingCard: document.getElementById('billing-info-card'),
    billName: document.getElementById('bill-name'),
    billTax: document.getElementById('bill-taxid'),
    billEmail: document.getElementById('bill-email'),

    // Modal Solicitud
    warrantyModal: document.getElementById('warranty-modal'),
    warrantyForm: document.getElementById('warranty-form'),
    modalProdName: document.getElementById('modal-product-name'),
    inpSn: document.getElementById('w-sn'),
    inpReason: document.getElementById('w-reason'),
    inpImages: document.getElementById('w-images'),
    filePreview: document.getElementById('file-preview'),

    // Modal Estado
    statusModal: document.getElementById('warranty-status-modal'),
    stDate: document.getElementById('st-date'),
    stBadge: document.getElementById('st-badge'),
    stReason: document.getElementById('st-reason'),
    stAdminBox: document.getElementById('st-admin-response-box'),
    stAdminResp: document.getElementById('st-admin-response'),
    stResolvedDate: document.getElementById('st-resolved-date'),
    stId: document.getElementById('st-id'),
    stPdfBtn: document.getElementById('st-tech-report-btn')
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

        const qW = query(
            collection(db, "warranties"),
            where("orderId", "==", orderId),
            where("userId", "==", auth.currentUser.uid)
        );

        const snapW = await getDocs(qW);
        activeWarranties = snapW.docs.map(d => ({ id: d.id, ...d.data() }));

        renderHeaderInfo(snap.id, currentOrder);
        renderItems(currentOrder);
    } catch (e) {
        console.error("Error cargando orden:", e);
    }
}

function renderHeaderInfo(displayId, order) {
    els.id.textContent = `ORDEN #${displayId.slice(0, 8).toUpperCase()}`;
    els.date.textContent = order.createdAt?.toDate().toLocaleDateString('es-CO');
    
    let statusClass = "bg-yellow-50 text-yellow-700 border-yellow-200";
    if (order.status === 'DESPACHADO' || order.status === 'ENTREGADO') statusClass = "bg-green-50 text-green-700 border-green-200";
    if (order.status === 'CANCELADO') statusClass = "bg-red-50 text-red-700 border-red-200";
    els.statusBadge.innerHTML = `<span class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border ${statusClass}">${order.status}</span>`;

    const ship = order.shippingData || {};
    els.address.textContent = ship.address || order.address || "Dirección no disponible";
    els.city.textContent = ship.city ? `${ship.city} (${ship.department || ''})` : (order.city || "");
    
    if (order.shippingTracking) {
        els.guideContainer.classList.remove('hidden');
        els.guideText.textContent = `${order.shippingCarrier || 'Transportadora'} - ${order.shippingTracking}`;
    }

    if (order.requiresInvoice && order.billingData) {
        els.billingCard.classList.remove('hidden');
        els.billName.textContent = order.billingData.name || "";
        els.billTax.textContent = order.billingData.taxId || "";
        els.billEmail.textContent = order.billingData.email || "";
    } else {
        els.billingCard.classList.add('hidden');
    }

    const totalItems = (order.items || []).reduce((acc, item) => acc + (item.quantity || 1), 0);
    els.itemsCount.textContent = totalItems;
    els.subtotal.textContent = `$${(order.subtotal || 0).toLocaleString('es-CO')}`;
    const shipCost = order.shippingCost || 0;
    els.shipping.textContent = shipCost === 0 ? "Gratis" : `$${shipCost.toLocaleString('es-CO')}`;
    els.total.textContent = `$${(order.total || 0).toLocaleString('es-CO')}`;
}

function renderItems(order) {
    els.itemsList.innerHTML = "";
    const shippedDate = order.shippedAt ? order.shippedAt.toDate() : null;
    const now = new Date();

    order.items.forEach((item, index) => {
        const warrantyDays = item.warrantyDays || 365;
        let isExpired = false;
        let daysLeft = 0;

        // 1. Calcular Vencimiento
        if (shippedDate) {
            const expirationDate = new Date(shippedDate);
            expirationDate.setDate(expirationDate.getDate() + warrantyDays);
            daysLeft = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));
            isExpired = daysLeft <= 0;
        }

        // 2. Filtrar Garantías Específicas
        const itemWarranties = activeWarranties.filter(w => 
            w.productId === item.id &&
            w.variantColor === (item.color || null) &&
            w.variantCapacity === (item.capacity || null)
        );

        // 3. Determinar Acción
        const canCreateNew = !isExpired && shippedDate && (itemWarranties.length < item.quantity);

        // 4. GENERAR INDICADOR DE TIEMPO (NUEVO)
        let timeBadgeHTML = "";
        if (!shippedDate) {
            timeBadgeHTML = `<span class="text-[9px] font-bold text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded flex items-center gap-1 w-fit"><i class="fa-regular fa-clock"></i> Inicia al recibir</span>`;
        } else if (isExpired) {
            timeBadgeHTML = `<span class="text-[9px] font-bold text-red-400 bg-red-50 border border-red-100 px-2 py-0.5 rounded flex items-center gap-1 w-fit"><i class="fa-solid fa-calendar-xmark"></i> Cobertura Finalizada</span>`;
        } else {
            // Activa
            timeBadgeHTML = `<span class="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded flex items-center gap-1 w-fit"><i class="fa-solid fa-hourglass-half"></i> Quedan ${daysLeft} días</span>`;
        }

        // 5. Botones
        let createBtnHTML = "";
        if (canCreateNew) {
            createBtnHTML = `
                <button onclick="window.openWarrantyModal(${index})" 
                    class="group flex items-center gap-2 bg-white border border-gray-200 hover:border-red-400 hover:bg-red-50 text-gray-600 hover:text-red-500 px-4 py-2 rounded-xl font-bold text-[10px] uppercase transition-all shadow-sm">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Reportar Fallo
                </button>
            `;
        }

        let existingCasesHTML = "";
        if (itemWarranties.length > 0) {
            existingCasesHTML = `<div class="flex flex-wrap gap-2 mt-3 w-full justify-end">`;
            itemWarranties.forEach((w, i) => {
                let colorClass = "bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100";
                let icon = "fa-spinner fa-spin-pulse";
                let label = "Revisión";

                if (w.status === 'APROBADO') { colorClass = "bg-green-50 text-green-600 border-green-100 hover:bg-green-100"; icon = "fa-check"; label = "Aprobado"; }
                if (w.status === 'RECHAZADO') { colorClass = "bg-red-50 text-red-600 border-red-100 hover:bg-red-100"; icon = "fa-xmark"; label = "Rechazado"; }
                if (w.status === 'FINALIZADO') { colorClass = "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200"; icon = "fa-archive"; label = "Cerrado"; }

                existingCasesHTML += `
                    <button onclick="window.openStatusModal('${w.id}')" 
                        class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase transition ${colorClass}">
                        <i class="fa-solid ${icon}"></i>
                        <span>Caso #${i + 1}: ${label}</span>
                    </button>
                `;
            });
            existingCasesHTML += `</div>`;
        }

        // Renderizado
        const div = document.createElement('div');
        div.className = "flex flex-col sm:flex-row gap-6 p-6 border border-gray-100 rounded-3xl hover:shadow-lg transition-all duration-300 group bg-white";

        div.innerHTML = `
            <div class="w-20 h-20 bg-slate-50 rounded-2xl border border-gray-100 p-2 flex items-center justify-center shrink-0">
                <img src="${item.mainImage || item.image || 'https://placehold.co/100'}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-500">
            </div>
            
            <div class="flex-grow min-w-0">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h4 class="font-black text-sm uppercase text-brand-black leading-tight mb-1">${item.name}</h4>
                        
                        <div class="flex flex-wrap gap-2 mb-2">
                            ${item.color ? `<span class="text-[8px] font-bold uppercase bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-500">${item.color}</span>` : ''}
                            ${item.capacity ? `<span class="text-[8px] font-bold uppercase bg-cyan-50 border border-cyan-100 px-2 py-0.5 rounded text-brand-cyan">${item.capacity}</span>` : ''}
                        </div>

                        ${timeBadgeHTML}
                    </div>

                    <div class="text-right shrink-0">
                        <p class="font-black text-brand-black text-base">$${(item.price * item.quantity).toLocaleString('es-CO')}</p>
                        <p class="text-[9px] font-bold text-gray-400 uppercase">Cant: ${item.quantity}</p>
                    </div>
                </div>
                
                <div class="mt-4 pt-3 border-t border-dashed border-gray-100 flex flex-col items-end gap-2">
                    ${createBtnHTML}
                    ${existingCasesHTML}
                </div>
            </div>
        `;
        els.itemsList.appendChild(div);
    });
}

// --- MODALES (IGUAL QUE ANTES) ---
window.openWarrantyModal = (index) => {
    selectedItemIndex = index;
    const item = currentOrder.items[index];
    els.modalProdName.textContent = `${item.name} (${item.color || ''} ${item.capacity || ''})`;
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

    els.stId.textContent = claim.id.slice(0,8).toUpperCase();
    els.stDate.textContent = "Radicado: " + claim.createdAt?.toDate().toLocaleDateString('es-CO');
    els.stReason.textContent = `"${claim.reason}"`;

    let badgeClass = "bg-blue-100 text-blue-700";
    let badgeText = "En Revisión";
    if (claim.status === 'APROBADO') { badgeClass = "bg-green-100 text-green-700"; badgeText = "Aprobada"; }
    else if (claim.status === 'RECHAZADO') { badgeClass = "bg-red-100 text-red-700"; badgeText = "Rechazada"; }
    else if (claim.status === 'FINALIZADO') { badgeClass = "bg-gray-100 text-gray-700"; badgeText = "Cerrado"; }
    
    els.stBadge.className = `inline-block px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest mb-2 ${badgeClass}`;
    els.stBadge.textContent = badgeText;

    if (claim.adminResponse) {
        els.stAdminBox.classList.remove('hidden');
        els.stAdminResp.textContent = claim.adminResponse;
        
        if (claim.technicalReportUrl && els.stPdfBtn) {
            els.stPdfBtn.href = claim.technicalReportUrl;
            els.stPdfBtn.classList.remove('hidden');
            els.stPdfBtn.classList.add('flex');
        } else if (els.stPdfBtn) {
            els.stPdfBtn.classList.add('hidden');
            els.stPdfBtn.classList.remove('flex');
        }
        els.stResolvedDate.textContent = claim.resolvedAt ? "Fecha: " + claim.resolvedAt.toDate().toLocaleString() : "";
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
        if (!currentOrder.shippedAt) throw new Error("Pedido no despachado aún.");

        if (item.sns && item.sns.length > 0) {
            const snFound = item.sns.some(sn => sn.trim().toUpperCase() === snInput.toUpperCase());
            if (!snFound) throw new Error("⛔ El Serial no coincide con este pedido.");
        }

        const qDup = query(
            collection(db, "warranties"),
            where("userId", "==", auth.currentUser.uid),
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
            
            variantColor: item.color || null,
            variantCapacity: item.capacity || null,

            snProvided: snInput,
            reason: reason,
            evidenceImages: evidenceUrls,
            status: 'PENDIENTE_REVISION',
            createdAt: new Date(),
            shippedAtDate: currentOrder.shippedAt
        });

        alert("✅ Solicitud enviada exitosamente.");
        window.closeWarrantyModal();
        location.reload();

    } catch (err) {
        console.error("Error:", err);
        alert(err.message);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
};