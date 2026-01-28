import { db, doc, getDoc, updateDoc, Timestamp } from './firebase-init.js';
import { collection, getDocs, runTransaction, serverTimestamp } from './firebase-init.js'; // Asegúrate de importar esto

// Estado interno del módulo
let currentOrderId = null;

// Referencias DOM
const getEl = (id) => document.getElementById(id);
const safeSetText = (id, text) => { const el = getEl(id); if (el) el.textContent = text; };

// --- 1. VER DETALLE (MODAL) ---
export async function viewOrderDetail(orderId) {
    currentOrderId = orderId;
    const modal = getEl('order-modal');
    
    try {
        const snap = await getDoc(doc(db, "orders", orderId));
        if (!snap.exists()) return;
        const o = snap.data();

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
            if (o.status === 'PAGADO') bClass = 'bg-green-100 text-green-700 border-green-200'; // Legacy fallback
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
        const isLocked = ['DESPACHADO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO'].includes(o.status);
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

        // 8. Totales
        safeSetText('modal-order-subtotal', `$${(o.subtotal || o.total).toLocaleString('es-CO')}`);
        safeSetText('modal-order-shipping', o.shippingCost === 0 ? "GRATIS" : `$${(o.shippingCost || 0).toLocaleString('es-CO')}`);
        safeSetText('modal-order-total', `$${o.total.toLocaleString('es-CO')}`);

        // 9. Lógica de Botones (Igual que antes)
        const footerActions = getEl('modal-footer-actions');
        const footerMsg = getEl('modal-footer-msg');
        const btnAlistar = getEl('btn-save-alistado');
        const btnDespachar = getEl('btn-set-despachado');

        if (footerActions) footerActions.classList.add('hidden');
        if (footerMsg) footerMsg.classList.add('hidden');
        if (btnAlistar) btnAlistar.classList.add('hidden');
        if (btnDespachar) btnDespachar.classList.add('hidden');

        // Lógica visual del Footer según estado
        if (o.status === 'PENDIENTE_PAGO') {
            if (footerMsg) {
                footerMsg.innerHTML = '<span class="text-orange-500 font-black flex items-center gap-2"><i class="fa-solid fa-clock"></i> Esperando pago online...</span>';
                footerMsg.classList.remove('hidden');
            }
        } else if (['RECHAZADO', 'CANCELADO'].includes(o.status)) {
            if (footerMsg) {
                footerMsg.innerHTML = '<span class="text-red-500 font-black flex items-center gap-2"><i class="fa-solid fa-ban"></i> Pedido Cancelado</span>';
                footerMsg.classList.remove('hidden');
            }
        } else if (o.status === 'ALISTADO') {
            if (footerActions) footerActions.classList.remove('hidden');
            if (btnDespachar) btnDespachar.classList.remove('hidden');
        } else if (['DESPACHADO', 'ENTREGADO'].includes(o.status)) {
             if (footerMsg) {
                 footerMsg.innerHTML = '<span class="text-green-600 font-black flex items-center gap-2"><i class="fa-solid fa-check-circle"></i> Pedido Finalizado</span>';
                 footerMsg.classList.remove('hidden');
             }
        } else {
            // PENDIENTE o PAGADO (Listo para alistar)
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

export function openDispatchModal() {
    getEl('dispatch-modal').classList.remove('hidden');
}

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
export async function openPaymentModal(orderId, totalAmount) {
    const modal = document.getElementById('payment-modal');
    const idDisplay = document.getElementById('pay-modal-order-id');
    const inputId = document.getElementById('pay-target-id');
    const inputAmount = document.getElementById('pay-amount');
    const selectAcc = document.getElementById('pay-account-select');

    if(!modal) return console.error("No se encontró el modal de pago");

    // Reset UI
    idDisplay.textContent = `Orden #${orderId.slice(0,8).toUpperCase()}`;
    inputId.value = orderId;
    
    // Formatear monto inicial
    inputAmount.value = `$${Number(totalAmount).toLocaleString('es-CO')}`;
    
    // Cargar Cuentas
    try {
        selectAcc.innerHTML = '<option value="">Cargando...</option>';
        const snap = await getDocs(collection(db, "accounts"));
        selectAcc.innerHTML = '<option value="">Seleccione Cuenta...</option>';
        
        snap.forEach(doc => {
            const acc = doc.data();
            selectAcc.innerHTML += `<option value="${doc.id}">${acc.name} (${acc.type})</option>`;
        });
    } catch (e) {
        console.error("Error cargando cuentas:", e);
        selectAcc.innerHTML = '<option value="">Error al cargar</option>';
    }

    modal.classList.remove('hidden');
    
    // Auto-focus y formateo moneda
    inputAmount.oninput = (e) => {
        let val = e.target.value.replace(/\D/g, "");
        e.target.value = val ? "$" + parseInt(val, 10).toLocaleString('es-CO') : "";
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

        if (!accId || amount <= 0) {
            alert("Verifica la cuenta y el monto.");
            btn.disabled = false; btn.innerHTML = originalText;
            return;
        }

        try {
            await runTransaction(db, async (t) => {
                // 1. Leer Cuenta
                const accRef = doc(db, "accounts", accId);
                const accDoc = await t.get(accRef);
                if (!accDoc.exists()) throw "La cuenta seleccionada no existe.";
                
                // 2. Leer Orden
                const orderRef = doc(db, "orders", orderId);
                const orderDoc = await t.get(orderRef);
                if (!orderDoc.exists()) throw "La orden no existe.";

                // 3. Actualizar Saldo Cuenta
                const newBalance = (accDoc.data().balance || 0) + amount;
                t.update(accRef, { balance: newBalance });

                // 4. Crear Registro Historial (Ingreso)
                const expenseRef = doc(collection(db, "expenses"));
                t.set(expenseRef, {
                    amount: amount,
                    category: "Ingreso Ventas Manual",
                    description: `Cobro Orden #${orderId.slice(0,8)}`,
                    paymentMethod: accDoc.data().name,
                    supplierName: orderDoc.data().userName || "Cliente",
                    date: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    type: 'INCOME',
                    orderId: orderId
                });

                // 5. Actualizar Orden
                t.update(orderRef, {
                    status: 'PAGADO', // Opcional: Si quieres que pase a pagado de una
                    paymentStatus: 'PAID',
                    amountPaid: amount, // Guardamos cuánto pagó
                    paymentMethod: 'MANUAL', // O mantener el que tenía
                    paymentAccountId: accId,
                    paymentDate: serverTimestamp()
                });
            });

            alert("✅ Pago registrado exitosamente.");
            document.getElementById('payment-modal').classList.add('hidden');
            
            // Recargar tabla si existe la función
            if(window.fetchOrders) window.fetchOrders(); 
            // O recargar página
            else location.reload();

        } catch (error) {
            console.error(error);
            alert("Error: " + error.message || error);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };
}

// Exportar al window para usar en HTML
window.openPaymentModal = openPaymentModal;