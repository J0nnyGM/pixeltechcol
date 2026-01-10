import { db, storage, collection, getDocs, orderBy, query, doc, updateDoc, addDoc, getDoc, runTransaction, ref, uploadBytes, getDownloadURL } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// Elementos del DOM
const table = document.getElementById('warranties-table');
const manageModal = document.getElementById('manage-modal');
const resolutionModal = document.getElementById('resolution-modal');

let currentWarranty = null; // Almacena datos temporales durante la gestión

// --- 1. CARGAR LISTA DE GARANTÍAS ---
async function loadWarranties() {
    table.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i></td></tr>`;
    
    try {
        const q = query(collection(db, "warranties"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);

        if (snap.empty) {
            table.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">Sin solicitudes pendientes.</td></tr>`;
            return;
        }

        table.innerHTML = "";
        snap.forEach(d => {
            const w = d.data();
            
            // Badges de Estado
            let statusBadge = `<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-[9px] font-black uppercase">Pendiente</span>`;
            if (w.status === 'APROBADO') statusBadge = `<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[9px] font-black uppercase">Aprobado</span>`;
            if (w.status === 'RECHAZADO') statusBadge = `<span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[9px] font-black uppercase">Rechazado</span>`;
            if (w.status === 'FINALIZADO') statusBadge = `<span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-[9px] font-black uppercase">Finalizado</span>`;

            // Botón de Acción
            let actionBtn = `<button onclick="window.openManageModal('${d.id}')" class="bg-brand-black text-white px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-brand-cyan hover:text-brand-black transition">Gestionar</button>`;
            if (w.status !== 'PENDIENTE_REVISION') {
                actionBtn = `<button onclick="window.openManageModal('${d.id}')" class="bg-slate-100 text-gray-400 px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-slate-200 transition">Ver Detalle</button>`;
            }

            table.innerHTML += `
                <tr class="hover:bg-slate-50 transition border-b border-gray-50 last:border-0">
                    <td class="px-8 py-6">
                        <p class="text-xs font-bold text-brand-black">${w.createdAt?.toDate().toLocaleDateString()}</p>
                        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">#${w.orderId.slice(0,6)}</p>
                    </td>
                    <td class="px-8 py-6">
                        <p class="text-xs font-black uppercase">${w.userName}</p>
                        <p class="text-[9px] text-gray-400 font-bold">${w.userEmail}</p>
                    </td>
                    <td class="px-8 py-6">
                        <div class="flex items-center gap-2">
                            <img src="${w.productImage || 'https://placehold.co/50'}" class="w-8 h-8 rounded-md object-contain bg-white border">
                            <div>
                                <p class="text-xs font-bold text-brand-black uppercase truncate max-w-[120px]">${w.productName}</p>
                                <p class="text-[9px] font-mono text-brand-cyan font-bold">${w.snProvided}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-8 py-6 max-w-xs">
                        <p class="text-xs text-gray-600 italic line-clamp-1">${w.reason}</p>
                    </td>
                    <td class="px-8 py-6 text-center">${statusBadge}</td>
                    <td class="px-8 py-6 text-center">${actionBtn}</td>
                </tr>
            `;
        });
    } catch (e) { console.error(e); }
}

// --- 2. FUNCIONES AUXILIARES (PDF y WhatsApp) ---

// Subir PDF a Storage
async function uploadPDF(warrantyId) {
    const fileInput = document.getElementById('m-tech-report');
    if (!fileInput || fileInput.files.length === 0) return null;

    const file = fileInput.files[0];
    // Ruta: warranty_reports/ID_TIMESTAMP.pdf
    const storageRef = ref(storage, `warranty_reports/${warrantyId}_${Date.now()}.pdf`);
    
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
}

// --- 3. ABRIR MODAL DE GESTIÓN ---
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
    document.getElementById('m-order-id').textContent = `ORDEN: #${w.orderId.slice(0,8)}`;
    document.getElementById('m-reason').textContent = `"${w.reason}"`;

    // Lógica WhatsApp (Buscar teléfono)
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
                    // Limpiar y formatear para WA
                    let cleanPhone = phone.replace(/\D/g, '');
                    if(cleanPhone.length === 10) cleanPhone = '57' + cleanPhone; // Default Colombia
                    
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

    // Limpiar Inputs de Gestión
    document.getElementById('m-received').value = w.receivedItems || "";
    document.getElementById('m-admin-notes').value = w.adminResponse || "";
    document.getElementById('m-tech-report').value = ""; // Reset file input

    // Renderizar Evidencia (Imágenes del usuario)
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

    // Control de Botones e Inputs (Solo editable si está PENDIENTE)
// 7. CONTROL DE ESTADO (Bloquear edición si no es Pendiente)
    const btnApprove = document.querySelector('button[onclick="approveWarranty()"]');
    const btnReject = document.querySelector('button[onclick="rejectWarranty()"]');
    
    // AQUÍ AGREGAMOS 'm-tech-report' PARA QUE SE BLOQUEE TAMBIÉN
    const inputs = [
        document.getElementById('m-received'), 
        document.getElementById('m-admin-notes'),
        document.getElementById('m-tech-report') // <--- CORRECCIÓN: Agregado
    ];

    if (w.status !== 'PENDIENTE_REVISION') {
        // CASO: Finalizado / Resuelto
        btnApprove.classList.add('hidden');
        btnReject.classList.add('hidden');
        
        // Deshabilitar todos los inputs (incluyendo el PDF)
        inputs.forEach(i => {
            i.disabled = true;
            i.classList.add('bg-gray-100', 'cursor-not-allowed'); // Feedback visual opcional
        });

        // Opcional: Si ya hay PDF, mostrar un link para que el admin lo vea
        if(w.technicalReportUrl) {
            // Buscamos si ya existe el link visual, si no lo creamos temporalmente
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
        // CASO: Pendiente (Editable)
        btnApprove.classList.remove('hidden');
        btnReject.classList.remove('hidden');
        
        inputs.forEach(i => {
            i.disabled = false;
            i.classList.remove('bg-gray-100', 'cursor-not-allowed');
        });

        // Ocultar link de preview si estamos editando nuevo
        const linkLabel = document.getElementById('admin-pdf-link-preview');
        if(linkLabel) linkLabel.classList.add('hidden');
    }

    manageModal.classList.remove('hidden');
};

window.closeManageModal = () => {
    manageModal.classList.add('hidden');
    currentWarranty = null;
};

// --- 4. INICIAR APROBACIÓN (Paso 1: Validar recepción) ---
window.approveWarranty = () => {
    const received = document.getElementById('m-received').value.trim();
    if(!received) return alert("⚠️ Debes listar los componentes físicos recibidos (Ej: Equipo, Caja, Cargador) antes de aprobar.");

    // Guardar datos temporales para el paso 2
    currentWarranty._tempReceived = received;
    currentWarranty._tempNotes = document.getElementById('m-admin-notes').value.trim();

    // Abrir modal de decisión (Reemplazo / Dinero)
    resolutionModal.classList.remove('hidden');
};

// --- 5. CONFIRMAR RESOLUCIÓN (Paso 2: Transacción y PDF) ---
window.confirmResolution = async () => {
    const btn = document.querySelector('button[onclick="confirmResolution()"]');
    const originalText = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    const resolutionType = document.querySelector('input[name="res-type"]:checked').value;
    const received = currentWarranty._tempReceived;
    const notes = currentWarranty._tempNotes;

    try {
        // 1. Subir PDF (si existe)
        const pdfUrl = await uploadPDF(currentWarranty.id);

        // 2. Ejecutar Transacción (Atomicidad: Stock + Garantía + Inventario RMA)
        await runTransaction(db, async (transaction) => {
            
            // A. DESCONTAR STOCK (Solo si es Reemplazo Físico)
            if (resolutionType === 'REPLACEMENT') {
                if (!currentWarranty.productId) throw "Error: No hay ID de producto asociado.";
                
                const prodRef = doc(db, "products", currentWarranty.productId);
                const prodSnap = await transaction.get(prodRef);
                
                if (!prodSnap.exists()) throw "El producto original ya no existe en el catálogo.";
                
                const currentStock = prodSnap.data().stock || 0;
                if (currentStock < 1) throw "⛔ No hay stock disponible en inventario para realizar el reemplazo físico.";

                // Descontar 1 unidad
                transaction.update(prodRef, { stock: currentStock - 1 });
            }

            // B. ACTUALIZAR GARANTÍA
            const warrantyRef = doc(db, "warranties", currentWarranty.id);
            transaction.update(warrantyRef, {
                status: 'APROBADO',
                resolutionType: resolutionType,
                receivedItems: received,
                adminResponse: notes || "Garantía aprobada.",
                technicalReportUrl: pdfUrl || null, // Guardar URL del PDF
                resolvedAt: new Date()
            });

            // C. CREAR ENTRADA EN INVENTARIO RMA (Logística Inversa)
            // Se registra el producto dañado que ingresa a la empresa
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

        alert("✅ Garantía procesada exitosamente.");
        resolutionModal.classList.add('hidden');
        closeManageModal();
        loadWarranties();

    } catch (e) {
        console.error(e);
        alert("Error: " + e); // Muestra mensaje si falla stock o subida
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
};

// --- 6. RECHAZAR GARANTÍA ---
window.rejectWarranty = async () => {
    const notes = document.getElementById('m-admin-notes').value.trim();
    if(!notes) return alert("⚠️ Para rechazar, debes escribir la razón en 'Notas / Respuesta al Cliente'.");

    if(!confirm("¿Rechazar garantía y finalizar proceso?")) return;

    const btn = document.querySelector('button[onclick="rejectWarranty()"]');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Subiendo...';

    try {
        // 1. Subir PDF (si existe)
        const pdfUrl = await uploadPDF(currentWarranty.id);

        // 2. Actualizar Documento
        await updateDoc(doc(db, "warranties", currentWarranty.id), {
            status: 'RECHAZADO',
            adminResponse: notes,
            technicalReportUrl: pdfUrl || null,
            resolvedAt: new Date()
        });

        alert("⛔ Garantía Rechazada.");
        closeManageModal();
        loadWarranties();

    } catch (e) { 
        console.error(e); 
        alert("Error: " + e.message); 
        btn.disabled = false; btn.innerHTML = originalText;
    }
};

// Carga inicial
loadWarranties();