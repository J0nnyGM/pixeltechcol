import { db, doc, getDoc, updateDoc, Timestamp, collection, getDocs, runTransaction, serverTimestamp } from './firebase-init.js';
import { adjustStock } from './inventory-core.js'; 

// --- CACHÉ DE OPTIMIZACIÓN ---
let currentOrderData = null; // Guardamos la orden completa en memoria
let currentOrderId = null;
let accountsCache = null;    // Guardamos las cuentas para no releerlas

const getEl = (id) => document.getElementById(id);
const safeSetText = (id, text) => { const el = getEl(id); if (el) el.textContent = text; };

// Helper para cargar cuentas solo una vez (Ahorro de lecturas)
async function loadAccountsCached() {
    if (accountsCache) return accountsCache;
    try {
        const snap = await getDocs(collection(db, "accounts"));
        accountsCache = [];
        snap.forEach(doc => accountsCache.push({ id: doc.id, ...doc.data() }));
        return accountsCache;
    } catch (e) {
        console.error("Error cache cuentas:", e);
        return [];
    }
}

// --- 1. VER DETALLE (Optimizado) ---
export async function viewOrderDetail(orderId) {
    currentOrderId = orderId;
    currentOrderData = null; // Reset caché local
    const modal = getEl('order-modal');
    
    try {
        // Lectura Principal (Inevitable si es la primera vez)
        const snap = await getDoc(doc(db, "orders", orderId));
        if (!snap.exists()) return;
        const o = snap.data();
        
        // Guardamos en caché para usar en Devolución/Pago sin releer
        currentOrderData = { id: snap.id, ...o };

        // 1. Icono Canal
        const isWeb = o.source === 'TIENDA' || o.source === 'TIENDA_WEB';
        const iconContainer = getEl('modal-source-icon');
        if (iconContainer) {
            iconContainer.innerHTML = isWeb ? '<i class="fa-solid fa-globe"></i>' : '<i class="fa-solid fa-store"></i>';
            iconContainer.className = `w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-gray-100 ${isWeb ? 'text-brand-cyan' : 'text-brand-black'}`;
        }

        // 2. Datos Cabecera
        safeSetText('modal-order-id', `#${snap.id.slice(0, 8).toUpperCase()}`);
        safeSetText('modal-order-date', o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('es-CO') : '---');

        // 3. Estado Logístico (Badge)
        const badge = getEl('modal-order-status-badge');
        if (badge) {
            badge.textContent = o.status || 'PENDIENTE';
            let bClass = 'bg-yellow-100 text-yellow-700 border-yellow-200';
            if (o.status === 'ALISTADO') bClass = 'bg-blue-100 text-blue-700 border-blue-200';
            if (o.status === 'DESPACHADO') bClass = 'bg-slate-800 text-white border-slate-900';
            if (o.status === 'PAGADO') bClass = 'bg-green-100 text-green-700 border-green-200'; 
            if (o.status === 'DEVOLUCION_PARCIAL') bClass = 'bg-orange-100 text-orange-700 border-orange-200';
            if (o.status === 'DEVUELTO') bClass = 'bg-purple-100 text-purple-700 border-purple-200';
            badge.className = `px-3 py-1 rounded-full text-[10px] font-black uppercase border ${bClass}`;
        }

        // --- NUEVO: INFORMACIÓN DE PAGO ---
        const paymentSection = getEl('modal-payment-info');
        if (paymentSection) {
            // Diccionario de Métodos
            const methods = {
                'MERCADOPAGO': { label: 'MercadoPago', icon: 'fa-regular fa-credit-card', color: 'text-blue-500' },
                'CONTRAENTREGA': { label: 'Contra Entrega', icon: 'fa-solid fa-truck-fast', color: 'text-brand-black' },
                'ADDI': { label: 'Crédito ADDI', icon: 'fa-solid fa-hand-holding-dollar', color: 'text-[#00D6D6]' },
                'MANUAL': { label: 'Venta Manual', icon: 'fa-solid fa-cash-register', color: 'text-gray-500' }
            };
            
            const methodKey = o.paymentMethod || 'MANUAL';
            const mInfo = methods[methodKey] || methods['MANUAL'];

            // Estado del Pago
            const isPaid = o.paymentStatus === 'PAID' || o.status === 'PAGADO'; // Compatibilidad
            const statusHtml = isPaid 
                ? `<span class="px-2 py-1 rounded bg-green-50 text-green-600 border border-green-100 text-[9px] font-black uppercase"><i class="fa-solid fa-check"></i> Pagado</span>`
                : `<span class="px-2 py-1 rounded bg-orange-50 text-orange-600 border border-orange-100 text-[9px] font-black uppercase"><i class="fa-regular fa-clock"></i> Pendiente</span>`;

            const refHtml = o.paymentId 
                ? `<div class="mt-2 pt-2 border-t border-gray-100 text-[9px] text-gray-400 font-mono">Ref: ${o.paymentId}</div>` 
                : '';

            paymentSection.innerHTML = `
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center ${mInfo.color} text-lg">
                            <i class="${mInfo.icon}"></i>
                        </div>
                        <div>
                            <p class="text-[10px] font-black uppercase text-gray-400 leading-none mb-1">Método de Pago</p>
                            <p class="text-xs font-black text-brand-black uppercase">${mInfo.label}</p>
                        </div>
                    </div>
                    ${statusHtml}
                </div>
                ${refHtml}
            `;
            paymentSection.classList.remove('hidden');
        }

        // 4. Datos Cliente
        safeSetText('modal-client-name', o.userName || 'Cliente');
        safeSetText('modal-client-doc', o.clientDoc || '---');
        safeSetText('modal-client-contact', o.phone || o.userEmail || '');

        // 5. Dirección y Notas
        const addr = o.shippingData?.address || o.address || 'Retiro en Tienda / Local';
        const city = o.shippingData?.city || o.city || 'Bogotá';
        const dept = o.shippingData?.department || "";
        safeSetText('modal-delivery-address', addr);
        safeSetText('modal-delivery-city', `${city}${dept ? ', ' + dept : ''}`);

        const notesEl = getEl('modal-order-notes');
        if(notesEl) {
            if (o.notes || o.shippingData?.notes) { 
                getEl('note-text').textContent = o.notes || o.shippingData.notes; 
                notesEl.classList.remove('hidden'); 
            } else { 
                notesEl.classList.add('hidden'); 
            }
        }

        // 6. Facturación
        const billingSec = getEl('modal-billing-section');
        if (billingSec) {
            const bill = o.billingInfo || o.billingData;
            if (o.requiresInvoice && bill) {
                billingSec.classList.remove('hidden');
                safeSetText('bill-modal-name', bill.name);
                safeSetText('bill-modal-id', bill.taxId);
                safeSetText('bill-modal-email', bill.email);
            } else {
                billingSec.classList.add('hidden');
            }
        }

        // 7. Items (Sin cambios en tu lógica)
        const isLocked = ['DESPACHADO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO', 'DEVUELTO', 'DEVOLUCION_PARCIAL'].includes(o.status);
        const itemsList = getEl('modal-items-list-responsive');
        
        if (itemsList) {
            itemsList.innerHTML = (o.items || []).map((item, idx) => {
                const img = item.mainImage || item.image || '/img/placeholder-tech.png';
                let snInputs = '';
                for (let i = 0; i < (item.quantity || 1); i++) {
                    const val = (item.sns && item.sns[i]) ? item.sns[i] : '';
                    const lockClass = isLocked 
                        ? 'bg-gray-100 text-gray-500 cursor-not-allowed border-gray-200' 
                        : 'bg-white text-brand-black border-gray-200 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/20';
                    
                    snInputs += `<div class="relative mb-2"><i class="fa-solid fa-barcode absolute left-3 top-3 text-brand-black text-xs"></i><input type="text" placeholder="${isLocked ? (val || 'No registrado') : 'Escanea Serial'}" value="${val}" data-item-index="${idx}" data-unit-index="${i}" class="sn-input w-full rounded-xl py-2 pl-8 pr-3 text-xs font-mono font-bold outline-none transition-all uppercase border ${lockClass}" ${isLocked ? 'readonly' : ''}></div>`;
                }
                return `<div class="p-6 border-b border-gray-100 last:border-0 flex flex-col md:flex-row gap-6 items-start"><div class="w-16 h-16 rounded-xl bg-white border border-gray-100 p-2 shrink-0 flex items-center justify-center"><img src="${img}" class="max-w-full max-h-full object-contain"></div><div class="flex-grow w-full"><div class="flex justify-between mb-2"><h5 class="font-black text-xs uppercase text-brand-black">${item.name || item.title}</h5><span class="text-xs font-black text-brand-cyan">x${item.quantity}</span></div><div class="flex gap-2 mb-4">${item.color ? `<span class="text-[8px] font-black uppercase bg-slate-100 px-2 py-1 rounded text-brand-black border border-gray-200">${item.color}</span>` : ''}</div><div class="bg-slate-100/50 p-3 rounded-xl border border-dashed border-gray-200"><p class="text-[8px] font-black text-brand-black uppercase tracking-widest mb-2">Seriales</p><div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${snInputs}</div></div></div></div>`;
            }).join('');
        }

        // 8. Totales (CORREGIDO Y BLINDADO)
        const subtotal = o.subtotal || o.total;
        const shipping = o.shippingCost || 0;
        const totalOriginal = o.total || 0;
        const refunded = o.refundedAmount || 0;
        const netTotal = totalOriginal - refunded;

        safeSetText('modal-order-subtotal', `$${subtotal.toLocaleString('es-CO')}`);
        safeSetText('modal-order-shipping', shipping === 0 ? "GRATIS" : `$${shipping.toLocaleString('es-CO')}`);
        
        // Referencia al contenedor padre (que acabamos de nombrar en el HTML)
        const totalContainer = getEl('modal-total-container');
        
        if (totalContainer) {
            if (refunded > 0) {
                // Caso con Devolución: Mostramos desglose
                totalContainer.innerHTML = `
                    <div class="flex flex-col items-end">
                        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Original</p>
                        <p class="text-xs font-bold text-gray-400 line-through decoration-red-300">$${totalOriginal.toLocaleString('es-CO')}</p>
                        
                        <p class="text-[9px] font-black text-red-500 uppercase tracking-widest mt-1">Devolución</p>
                        <p class="text-xs font-bold text-red-500">-$${refunded.toLocaleString('es-CO')}</p>
                        
                        <div class="w-full h-px bg-gray-200 my-2"></div>
                        
                        <p class="text-[9px] font-black text-brand-black uppercase tracking-widest">Total Neto</p>
                        <h4 class="text-3xl font-black text-brand-black leading-none">$${netTotal.toLocaleString('es-CO')}</h4>
                    </div>
                `;
            } else {
                // Caso Normal: Restauramos vista estándar
                totalContainer.innerHTML = `
                    <p class="text-[9px] font-black text-brand-black uppercase tracking-widest">Total Neto</p>
                    <h4 id="modal-order-total" class="text-3xl font-black text-brand-black leading-none">$${totalOriginal.toLocaleString('es-CO')}</h4>
                `;
            }
        }

        // 9. Lógica de Botones (CORREGIDA)
        const footerActions = getEl('modal-footer-actions');
        const footerMsg = getEl('modal-footer-msg');
        
        // Limpiar botón previo
        const oldRefundBtn = document.getElementById('btn-refund-action');
        if(oldRefundBtn) oldRefundBtn.remove();

        if (footerActions) footerActions.classList.add('hidden');
        if (footerMsg) footerMsg.classList.add('hidden');
        
        const btnAlistar = getEl('btn-save-alistado');
        const btnDespachar = getEl('btn-set-despachado');
        if(btnAlistar) btnAlistar.classList.add('hidden');
        if(btnDespachar) btnDespachar.classList.add('hidden');

        if (o.status === 'PENDIENTE_PAGO') {
            if (footerMsg) { footerMsg.innerHTML = '<span class="text-orange-500 font-bold flex items-center gap-2"><i class="fa-solid fa-clock"></i> Esperando pago...</span>'; footerMsg.classList.remove('hidden'); }
        } else if (['RECHAZADO', 'CANCELADO', 'DEVUELTO'].includes(o.status)) {
            if (footerMsg) { footerMsg.innerHTML = `<span class="text-red-500 font-bold flex items-center gap-2"><i class="fa-solid fa-ban"></i> Pedido ${o.status}</span>`; footerMsg.classList.remove('hidden'); }
        } else if (o.status === 'ALISTADO') {
            if (footerActions) footerActions.classList.remove('hidden');
            if (btnDespachar) btnDespachar.classList.remove('hidden');
        } else if (['DESPACHADO', 'ENTREGADO', 'DEVOLUCION_PARCIAL'].includes(o.status)) { 
             // ^^^ AQUÍ: Agregamos DEVOLUCION_PARCIAL para permitir seguir devolviendo
             if (footerActions) {
                 footerActions.classList.remove('hidden');
                 
                 const btnRefund = document.createElement('button');
                 btnRefund.id = 'btn-refund-action';
                 btnRefund.className = "flex-1 md:flex-none bg-white text-red-500 border border-red-200 px-6 py-4 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-red-50 transition-all shadow-sm flex items-center gap-2";
                 btnRefund.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Gestionar Devolución`;
                 
                 // OPTIMIZACIÓN CLAVE: Pasamos el objeto completo en memoria
                 // Esto evita una lectura adicional en openRefundModal
                 btnRefund.onclick = () => openRefundModal(currentOrderData);
                 
                 footerActions.prepend(btnRefund);
             }
        } else {
            // PENDIENTE o PAGADO
            if (footerActions) footerActions.classList.remove('hidden');
            if (btnAlistar) btnAlistar.classList.remove('hidden');
        }

        modal.classList.remove('hidden');

    } catch (e) { console.error(e); }
}

// --- 2. ACCIONES (ALISTAR / DESPACHAR) ---
export async function saveAlistamiento(onSuccess) {
    if (!currentOrderId) return;
    const btn = getEl('btn-save-alistado');
    btn.disabled = true; btn.innerHTML = "Guardando...";
    try {
        const snap = await getDoc(doc(db, "orders", currentOrderId));
        const items = snap.data().items;
        const updatedItems = items.map((item, idx) => {
            const inputs = document.querySelectorAll(`.sn-input[data-item-index="${idx}"]`);
            return { ...item, sns: Array.from(inputs).map(i => i.value.trim()) };
        });
        await updateDoc(doc(db, "orders", currentOrderId), { items: updatedItems, status: 'ALISTADO' });
        alert("✅ Orden Alistada");
        getEl('order-modal').classList.add('hidden');
        if(onSuccess) onSuccess();
    } catch(e) { console.error(e); } finally { btn.disabled = false; btn.innerHTML = "Guardar Alistamiento"; }
}

export function openDispatchModal() { getEl('dispatch-modal').classList.remove('hidden'); }

export async function confirmDispatch(onSuccess) {
    if (!currentOrderId) return;
    const btn = getEl('btn-confirm-dispatch');
    const carrier = getEl('dispatch-carrier').value;
    const tracking = getEl('dispatch-tracking').value;
    
    if (!carrier || !tracking) return alert("⚠️ Faltan datos de envío");
    
    btn.disabled = true;
    try {
        await updateDoc(doc(db, "orders", currentOrderId), { 
            status: 'DESPACHADO', shippingCarrier: carrier, shippingTracking: tracking, shippedAt: new Date() 
        });
        alert("🚚 Despachado");
        getEl('dispatch-modal').classList.add('hidden');
        getEl('order-modal').classList.add('hidden');
        if(onSuccess) onSuccess();
    } catch(e) { console.error(e); } finally { btn.disabled = false; }
}

// --- 3. IMPRIMIR PDF ---
export async function printRemission(orderId) {
    try {
        const snap = await getDoc(doc(db, "orders", orderId));
        if (!snap.exists()) return alert("Error");
        const o = snap.data();
        const dateStr = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString() : '--';
        
        let address = o.shippingData?.address || o.address || 'Local';
        if (o.shippingData?.city) address += `, ${o.shippingData.city}`;

        const itemsHtml = (o.items || []).map(i => `
            <tr>
                <td><strong>${i.name}</strong>${i.sns?.length ? '<br><small>SN: '+i.sns.join(', ')+'</small>' : ''}</td>
                <td style="text-align:center">${i.quantity}</td>
                <td style="text-align:right">$${(i.price || 0).toLocaleString()}</td>
                <td style="text-align:right">$${((i.price || 0) * i.quantity).toLocaleString()}</td>
            </tr>`).join('');

        const w = window.open('', '_blank', 'width=800,height=600');
        w.document.write(`
            <html><head><title>Cotización #${snap.id.slice(0,8)}</title>
            <style>body{font-family:sans-serif;padding:20px;font-size:12px} table{width:100%;border-collapse:collapse;margin-top:20px} th{text-align:left;background:#eee;padding:5px} td{padding:5px;border-bottom:1px solid #eee} .box{background:#f9f9f9;padding:15px;border-radius:10px;margin-bottom:20px} .cufe{margin-top:40px;padding:10px;background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;border-radius:5px;text-align:center;font-weight:bold}</style>
            </head><body>
                <div style="display:flex;justify-content:space-between;margin-bottom:20px">
                    <div><h1 style="margin:0;color:#00AEC7">PixelTech</h1><p>NIT: 900.123.456</p></div>
                    <div style="text-align:right"><h2>Remisión de Venta</h2><p>#${snap.id.slice(0,8).toUpperCase()}</p><p>${dateStr}</p></div>
                </div>
                <div class="box">
                    <strong>Cliente:</strong> ${o.userName}<br>
                    <strong>ID:</strong> ${o.clientDoc || 'N/A'}<br>
                    <strong>Tel:</strong> ${o.phone || 'N/A'}<br>
                    <strong>Dir:</strong> ${address}
                </div>
                <table><thead><tr><th>Producto</th><th style="text-align:center">Cant</th><th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead>
                <tbody>${itemsHtml}</tbody></table>
                <div style="text-align:right;margin-top:20px">
                    <p>Envío: $${(o.shippingCost || 0).toLocaleString()}</p>
                    <h3>Total: $${(o.total || 0).toLocaleString()}</h3>
                </div>
                <div class="cufe">Para solicitud de factura con código CUFE contáctanos al 3009046450</div>
                <script>setTimeout(()=>{window.print();window.close()},500)</script>
            </body></html>`);
        w.document.close();
    } catch(e) { console.error(e); }
}

// --- 4. SOLICITAR FACTURA (CORREGIDO) ---
export async function requestInvoice(orderId) {
    if(!confirm("¿Marcar este pedido para Facturación Electrónica?")) return;
    
    try {
        // Solo actualizamos la orden. No usamos addDoc.
        // Invoices.js ya lee orders donde requiresInvoice == true.
        await updateDoc(doc(db, "orders", orderId), { 
            requiresInvoice: true,
            billingStatus: 'PENDING', // Aseguramos que tenga estado
            updatedAt: new Date()
        });

        alert("✅ Solicitud enviada al Módulo de Facturación.");
        
        // Recargar para actualizar icono en tabla
        location.reload();

    } catch (e) {
        console.error(e);
        alert("Error al actualizar: " + e.message);
    }
}

// --- 5. EXPORTAR AL WINDOW ---
window.viewOrderDetail = viewOrderDetail;
window.printRemission = printRemission;
window.requestInvoice = requestInvoice;
window.saveAlistamiento = saveAlistamiento; 
window.openDispatchModal = openDispatchModal;
window.confirmDispatch = confirmDispatch;

// --- 5. REGISTRAR PAGO MANUAL (NUEVO) ---
export async function openPaymentModal(orderId, amountDue) {
    const modal = getEl('payment-modal');
    const idDisplay = getEl('pay-modal-order-id');
    const inputId = getEl('pay-target-id');
    const inputAmount = getEl('pay-amount');
    const selectAcc = getEl('pay-account-select');

    if(!modal) return console.error("No modal");

    // Reset UI
    idDisplay.textContent = `Orden #${orderId.slice(0,8).toUpperCase()}`;
    inputId.value = orderId;
    
    // Mostramos el saldo pendiente calculado
    inputAmount.value = `$${Number(amountDue).toLocaleString('es-CO')}`;
    // Guardamos el máximo permitido en un atributo data para validación
    inputAmount.dataset.max = amountDue;
    
    // Cargar Cuentas (Optimizado con Caché)
    try {
        if (selectAcc.options.length <= 1) { 
            selectAcc.innerHTML = '<option value="">Cargando...</option>';
            const accounts = await loadAccountsCached();
            
            let ops = '<option value="">Seleccione Cuenta...</option>';
            accounts.forEach(acc => {
                ops += `<option value="${acc.id}">${acc.name} (${acc.type})</option>`;
            });
            selectAcc.innerHTML = ops;
        }
    } catch (e) {
        console.error("Error cuentas:", e);
        selectAcc.innerHTML = '<option value="">Error al cargar</option>';
    }

    modal.classList.remove('hidden');
    
    // Auto-focus y formateo moneda
    inputAmount.oninput = (e) => {
        let val = e.target.value.replace(/\D/g, "");
        e.target.value = val ? "$" + parseInt(val, 10).toLocaleString('es-CO') : "";
    };
}

// =============================================================================
// LÓGICA DEVOLUCIONES (OPTIMIZADA)
// =============================================================================

// Ahora acepta el OBJETO completo o el ID. Si es objeto, ahorra lectura.
async function openRefundModal(orderInput) {
    if (!orderInput) return;

    let o = orderInput;
    // Si recibimos un ID (string), intentamos usar caché o descargamos
    if (typeof orderInput === 'string') {
        if (currentOrderData && currentOrderData.id === orderInput) {
            o = currentOrderData; // Usar memoria (0 lecturas)
        } else {
            const snap = await getDoc(doc(db, "orders", orderInput)); // Fallback lectura
            if (!snap.exists()) return;
            o = { id: snap.id, ...snap.data() };
            currentOrderData = o; 
        }
    }

    const modal = getEl('refund-modal');
    const idDisplay = getEl('refund-modal-order-id');
    const inputId = getEl('refund-target-id');
    const wasPaidInput = getEl('refund-was-paid');
    const container = getEl('refund-items-container');
    const inputAmount = getEl('refund-amount');
    const selectAcc = getEl('refund-account-select');
    const financialSection = getEl('refund-financial-section');
    const noPaymentMsg = getEl('refund-no-payment-msg');

    // 1. Reset UI
    idDisplay.textContent = `Orden #${o.id.slice(0,8).toUpperCase()}`;
    inputId.value = o.id;
    inputAmount.value = "$ 0";
    container.innerHTML = '<div class="text-center py-4"><i class="fa-solid fa-circle-notch fa-spin text-gray-300"></i></div>';
    
    try {
        // 2. Calcular Dinero Disponible
        const totalPaid = o.total || 0;
        const alreadyRefunded = o.refundedAmount || 0;
        const moneyAvailable = totalPaid - alreadyRefunded;

        // Validar si fue pagada
        const isPaid = (o.paymentStatus === 'PAID') || (o.status === 'PAGADO') || ((o.amountPaid || 0) >= totalPaid);
        
        wasPaidInput.value = isPaid ? "true" : "false";

        if (isPaid) {
            financialSection.classList.remove('hidden');
            noPaymentMsg.classList.add('hidden');
            
            // Mostrar Info Financiera
            const existingInfo = financialSection.querySelector('.info-badge');
            if(existingInfo) existingInfo.remove();
            
            const infoDiv = document.createElement('div');
            infoDiv.className = "info-badge mb-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-[10px] text-blue-800 flex justify-between";
            infoDiv.innerHTML = `
                <span><strong>Total:</strong> $${totalPaid.toLocaleString()}</span>
                <span><strong>Devuelto:</strong> $${alreadyRefunded.toLocaleString()}</span>
                <span class="font-black text-brand-cyan"><strong>Disponible:</strong> $${moneyAvailable.toLocaleString()}</span>
            `;
            financialSection.prepend(infoDiv);

            // Cargar Cuentas (Usando Caché)
            if (selectAcc.options.length <= 1) {
                const accounts = await loadAccountsCached();
                let html = '<option value="">Seleccione Cuenta de Origen...</option>';
                accounts.forEach(acc => {
                    html += `<option value="${acc.id}">${acc.name} (Saldo: $${(acc.balance || 0).toLocaleString()})</option>`;
                });
                selectAcc.innerHTML = html;
            }
        } else {
            financialSection.classList.add('hidden');
            noPaymentMsg.classList.remove('hidden');
        }

        // 3. Render Items (Lógica de Stock Restante)
        const items = o.items || [];
        container.innerHTML = "";
        
        let hasItemsToReturn = false;

        items.forEach((item, index) => {
            const img = item.mainImage || item.image || '[https://placehold.co/50](https://placehold.co/50)';
            
            // Calcular Disponibilidad
            const originalQty = item.quantity || 0;
            const alreadyReturnedQty = item.returnedQty || 0; 
            const availableQty = originalQty - alreadyReturnedQty;

            if (availableQty <= 0) return; // Ya devuelto totalmente

            hasItemsToReturn = true;
            
            const div = document.createElement('div');
            div.className = "refund-item-row flex items-center gap-4 p-3 border border-gray-100 rounded-xl hover:bg-slate-50 transition bg-white";
            div.innerHTML = `
                <div class="flex items-center h-full">
                    <input type="checkbox" class="refund-check w-5 h-5 text-red-500 rounded border-gray-300 focus:ring-red-500 cursor-pointer" data-index="${index}">
                </div>
                <img src="${img}" class="w-10 h-10 rounded-lg object-contain bg-gray-50 border border-gray-200">
                <div class="flex-grow min-w-0">
                    <p class="text-[10px] font-black text-brand-black uppercase truncate">${item.name}</p>
                    <p class="text-[9px] text-gray-400 font-bold">$${(item.price || 0).toLocaleString()} c/u</p>
                    ${alreadyReturnedQty > 0 ? `<p class="text-[8px] text-orange-500 font-bold">Devueltos antes: ${alreadyReturnedQty}</p>` : ''}
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-[8px] font-bold text-gray-400 uppercase">Cant.</span>
                    <input type="number" min="1" max="${availableQty}" value="${availableQty}" class="refund-qty w-12 p-2 text-center text-xs font-bold border border-gray-200 rounded-lg outline-none focus:border-red-500" disabled>
                </div>
            `;
            container.appendChild(div);

            const checkbox = div.querySelector('.refund-check');
            const qtyInput = div.querySelector('.refund-qty');

            checkbox.addEventListener('change', () => {
                qtyInput.disabled = !checkbox.checked;
                div.classList.toggle('border-red-200', checkbox.checked);
                div.classList.toggle('bg-red-50/30', checkbox.checked);
                if (isPaid) recalcRefundTotal(items);
            });

            qtyInput.addEventListener('input', () => { if(isPaid) recalcRefundTotal(items); });
        });

        if (!hasItemsToReturn) {
            container.innerHTML = '<div class="text-center p-4 bg-green-50 rounded-xl text-green-700 text-xs font-bold border border-green-100"><i class="fa-solid fa-check-circle"></i> Todos los productos de esta orden ya han sido devueltos.</div>';
        }

    } catch (e) { console.error(e); }

    modal.classList.remove('hidden');
}

// Función auxiliar de cálculo
function recalcRefundTotal(items) {
    let total = 0;
    document.querySelectorAll('.refund-item-row').forEach(row => {
        const checkbox = row.querySelector('.refund-check');
        if (checkbox.checked) {
            const index = checkbox.dataset.index;
            const qty = parseInt(row.querySelector('.refund-qty').value) || 0;
            const price = items[index].price || 0;
            total += (price * qty);
        }
    });
    const input = getEl('refund-amount');
    input.value = `$ ${total.toLocaleString('es-CO')}`;
}


// PROCESAR DEVOLUCIÓN
const refundForm = getEl('refund-form');
if (refundForm) {
    refundForm.onsubmit = async (e) => {
        e.preventDefault();
        const btn = refundForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true; 
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const orderId = getEl('refund-target-id').value;
        const wasPaid = getEl('refund-was-paid').value === "true";
        const reason = getEl('refund-reason').value || "Devolución Cliente";
        
        let accountId = null;
        let amount = 0;

        if (wasPaid) {
            accountId = getEl('refund-account-select').value;
            const amountStr = getEl('refund-amount').value.replace(/[^0-9]/g, "");
            amount = parseInt(amountStr) || 0;

            if (!accountId && amount > 0) {
                alert("Selecciona una cuenta de origen.");
                btn.disabled = false; btn.innerHTML = originalText;
                return;
            }
        }

        try {
            // Variable temporal para sacar datos de la transacción
            let itemsToRestoreStock = [];

            await runTransaction(db, async (t) => {
                const orderRef = doc(db, "orders", orderId);
                const orderDoc = await t.get(orderRef);
                if(!orderDoc.exists()) throw "Orden no encontrada";
                
                const oData = orderDoc.data();
                
                // Validaciones financieras
                if (wasPaid && amount > 0) {
                    const currentRefunded = oData.refundedAmount || 0;
                    const maxRefundable = (oData.total || 0) - currentRefunded;
                    if (amount > maxRefundable) throw `El monto excede el saldo disponible ($${maxRefundable.toLocaleString()}).`;
                }

                // Lógica de Items (Actualizar array en BD)
                const originalItems = oData.items || [];
                const updatedItems = JSON.parse(JSON.stringify(originalItems)); 
                
                let totalOriginalQty = 0;
                let totalReturnedQtySoFar = 0;

                const rows = document.querySelectorAll('.refund-item-row');
                rows.forEach(row => {
                    const check = row.querySelector('.refund-check');
                    if (check.checked) {
                        const idx = parseInt(check.dataset.index);
                        const qtyToReturn = parseInt(row.querySelector('.refund-qty').value);
                        
                        if (qtyToReturn > 0) {
                            // Sumar al contador de devueltos de este item
                            const currentReturned = updatedItems[idx].returnedQty || 0;
                            updatedItems[idx].returnedQty = currentReturned + qtyToReturn;
                            
                            // Guardar para adjustStock (post-transacción)
                            itemsToRestoreStock.push({ 
                                id: updatedItems[idx].id, 
                                qty: qtyToReturn, 
                                color: updatedItems[idx].color, 
                                capacity: updatedItems[idx].capacity 
                            });
                        }
                    }
                });

                // Calcular nuevo estado global de la orden
                updatedItems.forEach(i => {
                    totalOriginalQty += (i.quantity || 0);
                    totalReturnedQtySoFar += (i.returnedQty || 0);
                });

                let newStatus = oData.status;
                if (totalReturnedQtySoFar > 0) {
                    if (totalReturnedQtySoFar >= totalOriginalQty) newStatus = 'DEVUELTO';
                    else newStatus = 'DEVOLUCION_PARCIAL';
                }

                // Transacción Financiera (Solo si hubo pago y hay monto)
                if (wasPaid && amount > 0) {
                    const accRef = doc(db, "accounts", accountId);
                    const accDoc = await t.get(accRef);
                    if (!accDoc.exists()) throw "Cuenta no existe";
                    const currentBalance = accDoc.data().balance || 0;
                    if (currentBalance < amount) throw "Saldo insuficiente en cuenta";

                    t.update(accRef, { balance: currentBalance - amount });

                    const expenseRef = doc(collection(db, "expenses"));
                    t.set(expenseRef, {
                        amount: amount,
                        category: "Devoluciones",
                        description: `Reembolso ${newStatus === 'DEVUELTO' ? 'Total' : 'Parcial'} Orden #${orderId.slice(0,8)}`,
                        paymentMethod: accDoc.data().name,
                        supplierName: oData.userName || "Cliente",
                        date: serverTimestamp(),
                        createdAt: serverTimestamp(),
                        type: 'EXPENSE',
                        orderId: orderId,
                        isRefund: true
                    });
                }

                // Update Orden
                t.update(orderRef, {
                    items: updatedItems,
                    status: newStatus,
                    refundedAmount: (oData.refundedAmount || 0) + amount,
                    hasRefunds: true,
                    lastRefundDate: serverTimestamp(),
                    refundReason: reason
                });
            });

            // 4. Restaurar Inventario (Fuera de transacción)
            if (itemsToRestoreStock.length > 0) {
                for (const item of itemsToRestoreStock) {
                    await adjustStock(item.id, item.qty, item.color, item.capacity);
                }
            }

            alert("✅ Devolución procesada correctamente.");
            
            // Invalidar cachés
            currentOrderData = null; 
            accountsCache = null;

            getEl('refund-modal').classList.add('hidden');
            getEl('order-modal').classList.add('hidden');
            
            if(window.fetchOrders) window.fetchOrders(); 
            else location.reload();

        } catch (e) {
            console.error(e);
            alert("Error: " + (e.message || e));
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };
}

// Lógica del Submit del Formulario
const payForm = document.getElementById('payment-form');
if (payForm) {
    payForm.onsubmit = async (e) => {
        e.preventDefault();
        const btn = payForm.querySelector('button');
        const originalText = btn.innerHTML;
        btn.disabled = true; 
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const orderId = document.getElementById('pay-target-id').value;
        const accId = document.getElementById('pay-account-select').value;
        const amountStr = document.getElementById('pay-amount').value.replace(/\D/g, "");
        const amount = parseInt(amountStr, 10);
        
        // Validación contra el máximo permitido (data-max)
        const maxAmount = parseInt(document.getElementById('pay-amount').dataset.max || 0);

        if (!accId || amount <= 0) {
            alert("Verifica la cuenta y el monto.");
            btn.disabled = false; btn.innerHTML = originalText;
            return;
        }

        if (amount > maxAmount) {
            alert(`El monto excede el saldo pendiente ($${maxAmount.toLocaleString()}).`);
            btn.disabled = false; btn.innerHTML = originalText;
            return;
        }

        try {
            await runTransaction(db, async (t) => {
                // 1. Leer Datos (Lectura Fresca para seguridad)
                const orderRef = doc(db, "orders", orderId);
                const orderDoc = await t.get(orderRef);
                if (!orderDoc.exists()) throw "La orden no existe.";
                const oData = orderDoc.data();

                // Validación de servidor (Doble seguridad)
                const currentPending = (oData.total || 0) - (oData.amountPaid || 0) - (oData.refundedAmount || 0);
                if (amount > currentPending) throw `El monto excede el saldo real pendiente ($${currentPending.toLocaleString()}).`;

                const accRef = doc(db, "accounts", accId);
                const accDoc = await t.get(accRef);
                if (!accDoc.exists()) throw "La cuenta no existe.";

                // 3. Actualizar Saldo Cuenta
                const newBalance = (accDoc.data().balance || 0) + amount;
                t.update(accRef, { balance: newBalance });

                // 4. Crear Registro Historial
                const expenseRef = doc(collection(db, "expenses"));
                t.set(expenseRef, {
                    amount: amount,
                    category: "Ingreso Ventas Manual",
                    description: `Cobro Orden #${orderId.slice(0,8)}`,
                    paymentMethod: accDoc.data().name,
                    supplierName: oData.userName || "Cliente",
                    date: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    type: 'INCOME',
                    orderId: orderId
                });

                // 5. Actualizar Orden (CON CORRECCIÓN DE ESTADO)
                const newAmountPaid = (oData.amountPaid || 0) + amount;
                const isFullyPaid = newAmountPaid >= ((oData.total || 0) - (oData.refundedAmount || 0));
                
                // Determinar el nuevo estado
                let nextStatus = oData.status; // Por defecto mantenemos el estado actual
                
                // Solo si el estado era 'PENDIENTE' y se pagó completo, pasamos a 'PAGADO'.
                // Si estaba en 'DEVOLUCION_PARCIAL', 'DESPACHADO', etc., NO LO CAMBIAMOS.
                if (isFullyPaid && oData.status === 'PENDIENTE') {
                    nextStatus = 'PAGADO';
                }

                t.update(orderRef, {
                    status: nextStatus,
                    paymentStatus: isFullyPaid ? 'PAID' : 'PARTIAL',
                    amountPaid: newAmountPaid, 
                    paymentMethod: 'MANUAL', 
                    paymentAccountId: accId,
                    paymentDate: serverTimestamp()
                });
            });

            alert("✅ Pago registrado exitosamente.");
            document.getElementById('payment-modal').classList.add('hidden');
            
            // Invalidar caché
            currentOrderData = null; 
            accountsCache = null;

            if(window.fetchOrders) window.fetchOrders(); 
            else location.reload();

        } catch (error) {
            console.error(error);
            alert("Error: " + (error.message || error));
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };
}

// Exportar al window para usar en HTML
window.openPaymentModal = openPaymentModal;