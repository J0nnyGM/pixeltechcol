import { db, doc, getDoc, updateDoc, Timestamp, collection, getDocs, runTransaction, serverTimestamp, writeBatch, auth, query, where, functions, httpsCallable } from './firebase-init.js';
import { adjustStock } from './inventory-core.js'; 
import { AdminStore } from './admin-store.js';

// --- CACHÉ DE OPTIMIZACIÓN ---
let currentOrderData = null; 
let currentOrderId = null;
let accountsCache = null;    
let editProductsCache = []; 
let isProductsSubscribed = false; 

const getEl = (id) => document.getElementById(id);
const safeSetText = (id, text) => { const el = getEl(id); if (el) el.textContent = text; };

const formatCurrency = (num) => '$ ' + Number(num).toLocaleString('es-CO');
const parseCurrency = (str) => Number(String(str).replace(/[^0-9-]/g, '')) || 0;
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

export const isNoSerial = (sn) => {
    if (!sn) return false;
    const clean = String(sn).trim().toUpperCase().replace(/[\s\-_/.]/g, '');
    return ['SINSERIAL', 'NA', 'SN', 'NINGUNO', 'NOSERIAL', 'EXENTO', 'SINSN', 'NOAPLICA'].includes(clean);
};
window.isNoSerial = isNoSerial;

export const isRegularizedSerial = (data) => {
    if (!data) return false;
    const source = (data.source || '').toUpperCase();
    const supplier = (data.supplierName || '').toLowerCase();
    return source.includes('REGULARIZADO') || supplier.includes('regularizado');
};
window.isRegularizedSerial = isRegularizedSerial;

// --- SISTEMA DE BORRADORES LOCALES DE SERIALES (PERSISTENCIA LOCAL EN DISPOSITIVO) ---
const DRAFT_SERIALS_KEY_PREFIX = 'pixeltech_draft_serials_';

export function pruneOldDraftSerials() {
    try {
        const now = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 días de vigencia
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(DRAFT_SERIALS_KEY_PREFIX)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data && data.savedAt && (now - data.savedAt > maxAge)) {
                        localStorage.removeItem(key);
                    }
                } catch(e) {
                    localStorage.removeItem(key);
                }
            }
        }
    } catch(e) {}
}

export function getDraftSerials(orderId) {
    if (!orderId) return null;
    try {
        const raw = localStorage.getItem(`${DRAFT_SERIALS_KEY_PREFIX}${orderId}`);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.savedAt && (Date.now() - data.savedAt > 7 * 24 * 60 * 60 * 1000)) {
            localStorage.removeItem(`${DRAFT_SERIALS_KEY_PREFIX}${orderId}`);
            return null;
        }
        return data;
    } catch(e) {
        console.warn("Error leyendo borrador de seriales:", e);
        return null;
    }
}

export function hasDraftSerials(orderId) {
    if (!orderId) return false;
    try {
        return !!localStorage.getItem(`${DRAFT_SERIALS_KEY_PREFIX}${orderId}`);
    } catch(e) {
        return false;
    }
}

export function saveDraftSerials(orderId) {
    if (!orderId) return;
    try {
        const inputs = document.querySelectorAll('.sn-input');
        if (!inputs || inputs.length === 0) return;

        const serials = {};
        let count = 0;

        inputs.forEach(inp => {
            const itemIdx = inp.getAttribute('data-item-index');
            const unitIdx = inp.getAttribute('data-unit-index');
            const val = (inp.value || '').trim().toUpperCase();
            if (itemIdx !== null && unitIdx !== null) {
                serials[`${itemIdx}_${unitIdx}`] = val;
                if (val) count++;
            }
        });

        if (count > 0) {
            localStorage.setItem(`${DRAFT_SERIALS_KEY_PREFIX}${orderId}`, JSON.stringify({
                orderId,
                savedAt: Date.now(),
                count,
                serials
            }));
            updateDraftUI(orderId, true, count);
        } else {
            localStorage.removeItem(`${DRAFT_SERIALS_KEY_PREFIX}${orderId}`);
            updateDraftUI(orderId, false, 0);
        }
    } catch(e) {
        console.warn("Error guardando borrador de seriales:", e);
    }
}

export function clearDraftSerials(orderId) {
    if (!orderId) return;
    try {
        localStorage.removeItem(`${DRAFT_SERIALS_KEY_PREFIX}${orderId}`);
        updateDraftUI(orderId, false, 0);
    } catch(e) {}
}

export function discardDraftSerials(orderId) {
    if (!orderId) return;
    if (!confirm("¿Deseas descartar los seriales guardados localmente para este pedido y empezar de nuevo?")) return;
    clearDraftSerials(orderId);
    showActionToast("🗑️ Borrador local de seriales descartado.", "info");
    if (typeof window.viewOrderDetail === 'function') {
        window.viewOrderDetail(orderId);
    }
}

export function closeOrderModal() {
    if (currentOrderId) {
        saveDraftSerials(currentOrderId);
    }
    const modal = getEl('order-modal');
    if (modal) modal.classList.add('hidden');
}

function updateDraftUI(orderId, hasDraft, count = 0) {
    const banner = document.getElementById('draft-serials-banner');
    if (!banner) return;
    if (hasDraft && count > 0) {
        banner.classList.remove('hidden');
        banner.className = 'px-5 py-2.5 bg-cyan-500/10 border-b border-cyan-500/20 flex items-center justify-between flex-wrap gap-2 animate-fadeIn';
        const textEl = document.getElementById('draft-banner-text');
        const countEl = document.getElementById('draft-banner-count');
        if (textEl) textEl.textContent = 'Auto-guardado local activo';
        if (countEl) countEl.textContent = `(${count} serial${count > 1 ? 'es' : ''} en progreso)`;
    } else {
        banner.classList.add('hidden');
    }
}

// Ejecutar limpieza preventiva de borradores antiguos al cargar módulo
pruneOldDraftSerials();

window.toggleItemNoSerial = (idx) => {
    const inputs = document.querySelectorAll(`.sn-input[data-item-index="${idx}"]`);
    if (!inputs || inputs.length === 0) return;

    const allCurrentlyNoSerial = Array.from(inputs).every(inp => isNoSerial(inp.value));

    inputs.forEach(inp => {
        if (allCurrentlyNoSerial) {
            inp.value = '';
            inp.classList.remove('bg-amber-50', 'text-amber-800', 'border-amber-300');
            inp.classList.add('bg-white', 'text-brand-black', 'border-gray-200');
        } else {
            inp.value = 'SIN-SERIAL';
            inp.classList.remove('bg-white', 'text-brand-black', 'border-gray-200');
            inp.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-300');
        }
    });

    const lbl = document.getElementById(`label-noserial-${idx}`);
    if (lbl) {
        lbl.textContent = allCurrentlyNoSerial ? 'Marcar Sin Serial (N/A)' : 'Quitar Sin Serial';
    }

    if (currentOrderId) {
        saveDraftSerials(currentOrderId);
    }
};

// --- SISTEMA DE TOAST HUD NO BLOQUEANTE ---
export function showActionToast(msg, type = 'info', duration = 3500) {
    let container = document.getElementById('action-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'action-toast-container';
        container.className = 'fixed top-5 right-5 z-[99999] flex flex-col gap-2.5 pointer-events-none max-w-md w-full px-4';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const isError = type === 'error' || msg.includes('⚠️') || msg.includes('❌') || msg.toLowerCase().includes('error');
    const isSuccess = type === 'success' || msg.includes('✅') || msg.includes('🚚');

    const bgClass = isError 
        ? 'bg-slate-900 text-red-200 border-red-500/50 shadow-red-950/40' 
        : (isSuccess ? 'bg-slate-900 text-emerald-200 border-emerald-500/50 shadow-emerald-950/40' : 'bg-slate-900 text-slate-100 border-slate-700 shadow-black/40');
    
    const icon = isError 
        ? '<i class="fa-solid fa-triangle-exclamation text-red-400 text-base shrink-0 mt-0.5"></i>' 
        : (isSuccess ? '<i class="fa-solid fa-circle-check text-emerald-400 text-base shrink-0 mt-0.5"></i>' : '<i class="fa-solid fa-circle-info text-cyan-400 text-base shrink-0 mt-0.5"></i>');

    const cleanMsg = msg.replace(/^[⚠️✅🚚❌]\s*/, '');

    toast.className = `pointer-events-auto flex items-start gap-3 p-4 rounded-2xl shadow-2xl border ${bgClass} text-xs font-bold leading-snug transition-all duration-200 transform -translate-y-2 opacity-0`;
    toast.innerHTML = `
        ${icon}
        <div class="flex-1 whitespace-pre-line text-white">${cleanMsg}</div>
        <button class="text-gray-400 hover:text-white transition ml-2 text-base leading-none shrink-0">&times;</button>
    `;

    const closeBtn = toast.querySelector('button');
    if (closeBtn) {
        closeBtn.onclick = () => {
            toast.classList.add('opacity-0', '-translate-y-2');
            setTimeout(() => toast.remove(), 250);
        };
    }

    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', '-translate-y-2');
    });

    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('opacity-0', '-translate-y-2');
            setTimeout(() => toast.remove(), 250);
        }
    }, duration);
}
window.showActionToast = showActionToast;

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

// ==========================================================================
// 1. VER DETALLE DE LA ORDEN
// ==========================================================================
export async function viewOrderDetail(orderId) {
    currentOrderId = orderId;
    currentOrderData = null; 
    const modal = getEl('order-modal');
    
    try {
        let isAdmin = false;
        if (auth.currentUser) {
            const uDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (uDoc.exists() && uDoc.data().role === 'admin') isAdmin = true;
        }

        const snap = await getDoc(doc(db, "orders", orderId));
        if (!snap.exists()) return;
        const o = snap.data();
        currentOrderData = { id: snap.id, ...o };

        const isWeb = o.source === 'TIENDA' || o.source === 'TIENDA_WEB';
        const iconContainer = getEl('modal-source-icon');
        if (iconContainer) {
            iconContainer.innerHTML = isWeb ? '<i class="fa-solid fa-globe"></i>' : '<i class="fa-solid fa-store"></i>';
            iconContainer.className = `w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-gray-100 ${isWeb ? 'text-brand-cyan' : 'text-brand-black'}`;
        }

        safeSetText('modal-order-id', `#${o.internalOrderNumber || snap.id.slice(0, 8).toUpperCase()}`);
        safeSetText('modal-order-date', o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('es-CO') : '---');

        const badge = getEl('modal-order-status-badge');
        if (badge) {
            badge.textContent = o.status || 'PENDIENTE';
            let bClass = 'bg-yellow-100 text-yellow-700 border-yellow-200';
            if (o.status === 'ALISTADO') bClass = 'bg-blue-100 text-blue-700 border-blue-200';
            if (o.status === 'DESPACHADO') bClass = 'bg-slate-800 text-white border-slate-900';
            if (o.status === 'PAGADO') bClass = 'bg-green-100 text-green-700 border-green-200'; 
            if (o.status === 'DEVOLUCION_PARCIAL') bClass = 'bg-orange-100 text-orange-700 border-orange-200';
            if (o.status === 'DEVUELTO') bClass = 'bg-purple-100 text-purple-700 border-purple-200';
            if (['CANCELADO', 'RECHAZADO'].includes(o.status)) bClass = 'bg-red-100 text-red-700 border-red-200';
            badge.className = `px-3 py-1 rounded-full text-[10px] font-black uppercase border ${bClass}`;
        }

        const paymentSection = getEl('modal-payment-info');
        const isML = (o.source && o.source.startsWith('MERCADOLIBRE')) || o.channel === 'MERCADOLIBRE' || (o.paymentMethod && o.paymentMethod.startsWith('MERCADOLIBRE')) || String(orderId).startsWith('ML');
        if (paymentSection) {
            const methods = {
                'MERCADOPAGO': { label: 'MercadoPago', icon: 'fa-regular fa-credit-card', color: 'text-blue-500' },
                'ONLINE': { label: 'MercadoPago', icon: 'fa-regular fa-credit-card', color: 'text-blue-500' }, 
                'CONTRAENTREGA': { label: 'Contra Entrega', icon: 'fa-solid fa-truck-fast', color: 'text-brand-black' },
                'COD': { label: 'Contra Entrega', icon: 'fa-solid fa-truck-fast', color: 'text-brand-black' }, 
                'ADDI': { label: 'Crédito ADDI', icon: 'fa-solid fa-hand-holding-dollar', color: 'text-[#00D6D6]' },
                'SISTECREDITO': { label: 'Sistecrédito', icon: 'fa-solid fa-money-check-dollar', color: 'text-emerald-500' },
                'PSE': { label: 'Pago con PSE', icon: 'fa-solid fa-building-columns', color: 'text-blue-600' },
                'MERCADOLIBRE': { label: 'MercadoLibre (Tienda 1)', icon: 'fa-solid fa-handshake', color: 'text-yellow-600' },
                'MERCADOLIBRE_STORE2': { label: 'MercadoLibre (Tienda 2)', icon: 'fa-solid fa-handshake', color: 'text-yellow-600' },
                'MERCADOLIBRE_2': { label: 'MercadoLibre (Tienda 2)', icon: 'fa-solid fa-handshake', color: 'text-yellow-600' },
                'MERCADOLIBRE_STORE3': { label: 'MercadoLibre (Tienda 3)', icon: 'fa-solid fa-handshake', color: 'text-yellow-600' },
                'MERCADOLIBRE_3': { label: 'MercadoLibre (Tienda 3)', icon: 'fa-solid fa-handshake', color: 'text-yellow-600' },
                'MANUAL': { label: 'Venta Manual', icon: 'fa-solid fa-cash-register', color: 'text-gray-500' }
            };
            const methodKey = (o.paymentMethod || 'MANUAL').toUpperCase();
            const mInfo = methods[methodKey] || (isML ? methods['MERCADOLIBRE'] : methods['MANUAL']);
            const isPaid = o.paymentStatus === 'PAID' || o.status === 'PAGADO'; 
            const statusHtml = isPaid ? `<span class="px-2 py-1 rounded bg-green-50 text-green-600 border border-green-100 text-[9px] font-black uppercase"><i class="fa-solid fa-check"></i> Pagado</span>` : `<span class="px-2 py-1 rounded bg-orange-50 text-orange-600 border border-orange-100 text-[9px] font-black uppercase"><i class="fa-regular fa-clock"></i> Pendiente</span>`;
            
            // Tarjeta de Desglose Financiero exclusivo de MercadoLibre
            let mlBreakdownHtml = '';
            if (isML) {
                let mlStoreLabel = 'Tienda 1';
                if (o.source === 'MERCADOLIBRE_STORE2' || o.source === 'MERCADOLIBRE_2' || o.mlStore === 2 || String(orderId).startsWith('ML2-')) mlStoreLabel = 'Tienda 2';
                else if (o.source === 'MERCADOLIBRE_STORE3' || o.source === 'MERCADOLIBRE_3' || o.mlStore === 3 || String(orderId).startsWith('ML3-')) mlStoreLabel = 'Tienda 3';

                const gross = Number(o.grossTotal) || Number(o.total) || 0;
                const fee = Number(o.mlFee) || 0;
                const taxes = Number(o.mlTaxes) || 0;
                const shipping = Number(o.mlShipping) || 0;
                const bonus = Number(o.mlShippingBonus) || 0;
                const net = Number(o.netAmount) || Number(o.total) || 0;

                mlBreakdownHtml = `
                    <div class="mt-3 p-3.5 rounded-xl bg-amber-50/90 border border-amber-200 text-xs">
                        <div class="flex items-center justify-between font-black text-amber-900 mb-2 border-b border-amber-200/80 pb-1.5">
                            <span class="flex items-center gap-1.5 text-xs uppercase tracking-wider"><i class="fa-solid fa-handshake text-yellow-600"></i> Liquidación MercadoLibre (${mlStoreLabel})</span>
                            <button type="button" onclick="window.recalcMLFinances('${orderId}')" id="btn-recalc-ml-${orderId}" class="text-[9px] font-black text-amber-900 hover:text-black bg-amber-200 hover:bg-amber-300 px-2 py-0.5 rounded-md border border-amber-300 transition flex items-center gap-1 active:scale-95 cursor-pointer uppercase tracking-wider shadow-2xs" title="Consultar a la API de MercadoLibre para actualizar comisiones y deducciones exactas">
                                <i class="fa-solid fa-rotate text-[8px]"></i> Recalcular
                            </button>
                        </div>
                        <div class="space-y-1.5 text-slate-700">
                            <div class="flex justify-between font-semibold">
                                <span>Venta Bruta (Pagado en ML):</span>
                                <span class="font-bold text-brand-black">$${gross.toLocaleString('es-CO')}</span>
                            </div>
                            <div class="flex justify-between text-red-600 font-medium">
                                <span>Comisión ML (Sale Fee):</span>
                                <span>-$${fee.toLocaleString('es-CO')}</span>
                            </div>
                            ${taxes > 0 ? `
                            <div class="flex justify-between text-red-600 font-medium">
                                <span>Retenciones (Retefuente / ICA):</span>
                                <span>-$${taxes.toLocaleString('es-CO')}</span>
                            </div>` : ''}
                            ${shipping > 0 ? `
                            <div class="flex justify-between text-red-600 font-medium">
                                <span>Costo Envío Vendedor:</span>
                                <span>-$${shipping.toLocaleString('es-CO')}</span>
                            </div>` : ''}
                            ${bonus > 0 ? `
                            <div class="flex justify-between text-emerald-700 font-medium">
                                <span>Bonificación Envío Flex:</span>
                                <span>+$${bonus.toLocaleString('es-CO')}</span>
                            </div>` : ''}
                            <div class="border-t border-amber-200 pt-1.5 flex justify-between font-black text-brand-black text-sm">
                                <span>Neto Liquidado en Cuenta:</span>
                                <span class="text-emerald-700 font-black">$${net.toLocaleString('es-CO')}</span>
                            </div>
                        </div>
                    </div>
                `;
            }

            paymentSection.innerHTML = `<div class="flex justify-between items-start"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center ${mInfo.color} text-lg"><i class="${mInfo.icon}"></i></div><div><p class="text-[10px] font-black uppercase text-gray-400 leading-none mb-1">Método de Pago</p><p class="text-xs font-black text-brand-black uppercase">${mInfo.label}</p></div></div>${statusHtml}</div>${o.paymentId ? `<div class="mt-2 pt-2 border-t border-gray-100 text-[9px] text-gray-400 font-mono">Ref: ${o.paymentId}</div>` : ''}${mlBreakdownHtml}`;
            paymentSection.classList.remove('hidden');
        }

        safeSetText('modal-client-name', o.userName || 'Cliente');
        safeSetText('modal-client-doc', o.clientDoc || '---');
        safeSetText('modal-client-contact', o.phone || o.userEmail || '');

        const addr = o.shippingData?.address || o.address || 'Retiro en Tienda / Local';
        const city = o.shippingData?.city || o.city || 'Bogotá';
        const dept = o.shippingData?.department || "";
        safeSetText('modal-delivery-address', addr);
        safeSetText('modal-delivery-city', `${city}${dept ? ', ' + dept : ''}`);

        const trackingContainer = getEl('modal-tracking-info');
        if (trackingContainer) {
            if (o.shippingCarrier && o.shippingTracking) {
                safeSetText('modal-carrier', o.shippingCarrier);
                safeSetText('modal-tracking-number', o.shippingTracking);
                trackingContainer.classList.remove('hidden');
            } else trackingContainer.classList.add('hidden');
        }

        // Rótulos de Envío MercadoLibre
        const mlLabelContainer = getEl('modal-ml-label-container');
        const printBtn = getEl('btn-print-ml-label');
        if (mlLabelContainer && printBtn) {
            const shipmentId = o.shippingId || o.shippingData?.shipmentId;
            if (isML && (shipmentId || orderId)) {
                let functionsUrl = "https://us-central1-pixeltechcol.cloudfunctions.net/getMercadoLibreLabel";
                if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
                    functionsUrl = "http://localhost:5001/pixeltechcol/us-central1/getMercadoLibreLabel";
                }
                let store = String(o.mlStore || '');
                if (!store) {
                    if (o.source === 'MERCADOLIBRE_STORE2' || o.source === 'MERCADOLIBRE_2' || String(orderId).startsWith('ML2-')) store = '2';
                    else if (o.source === 'MERCADOLIBRE_STORE3' || o.source === 'MERCADOLIBRE_3' || String(orderId).startsWith('ML3-')) store = '3';
                    else store = '1';
                }
                const queryStr = shipmentId ? `shipmentId=${shipmentId}&store=${store}&orderId=${orderId}` : `orderId=${orderId}&store=${store}`;
                printBtn.href = `${functionsUrl}?${queryStr}`;
                printBtn.target = "_blank";
                mlLabelContainer.classList.remove('hidden');
            } else {
                mlLabelContainer.classList.add('hidden');
                printBtn.href = "#";
            }
        }

        const notesEl = getEl('modal-order-notes');
        if(notesEl) {
            if (o.notes || o.shippingData?.notes) { getEl('note-text').textContent = o.notes || o.shippingData.notes; notesEl.classList.remove('hidden'); } 
            else notesEl.classList.add('hidden'); 
        }

        const billingSec = getEl('modal-billing-section');
        if (billingSec) {
            const bill = o.billingInfo || o.billingData;
            if (o.requiresInvoice && bill) {
                billingSec.classList.remove('hidden');
                safeSetText('bill-modal-name', bill.name);
                safeSetText('bill-modal-id', bill.taxId);
                safeSetText('bill-modal-email', bill.email);
            } else billingSec.classList.add('hidden');
        }

        const isLocked = ['DESPACHADO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO', 'DEVUELTO', 'DEVOLUCION_PARCIAL'].includes(o.status);
        const itemsList = getEl('modal-items-list-responsive');
        
        if (itemsList) {
            // Cargar borrador local si aplica
            const draftData = (!isLocked) ? getDraftSerials(orderId) : null;
            const draftSerials = draftData?.serials || null;
            let restoredDraftCount = 0;

            if (isLocked) {
                clearDraftSerials(orderId);
            }

            const itemsHtml = (o.items || []).map((item, idx) => {
                const img = item.mainImage || item.image || '/img/placeholder-tech.webp';
                let snInputs = '';
                let itemAllNoSerial = true;
                const totalUnits = item.quantity || 1;

                for (let i = 0; i < totalUnits; i++) {
                    const serverVal = (item.sns && item.sns[i]) ? item.sns[i] : '';
                    const draftVal = draftSerials ? draftSerials[`${idx}_${i}`] : undefined;

                    let val = serverVal;
                    if (draftVal !== undefined && draftVal !== '') {
                        val = draftVal;
                        if (val !== serverVal) restoredDraftCount++;
                    }

                    const isValNoSerial = isNoSerial(val);
                    if (!isValNoSerial) itemAllNoSerial = false;
                    const isReturned = Array.isArray(item.returnedSns) && item.returnedSns.includes(val);
                    const lockClass = isLocked 
                        ? (isReturned 
                            ? 'bg-purple-50 text-purple-700 border-purple-200 cursor-not-allowed line-through font-semibold' 
                            : (isValNoSerial ? 'bg-amber-50 text-amber-800 border-amber-200 cursor-not-allowed' : 'bg-gray-100 text-gray-500 cursor-not-allowed border-gray-200')) 
                        : (isValNoSerial ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-white text-brand-black border-gray-200 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/20');
                    const placeholder = isLocked ? (val || 'No registrado') : (isValNoSerial ? 'SIN-SERIAL' : 'Escanea Serial (o N/A)');
                    const badgeHtml = isReturned 
                        ? `<span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 border border-purple-200 flex items-center gap-1 shadow-2xs"><i class="fa-solid fa-rotate-left text-[7px]"></i> Devuelto</span>` 
                        : '';
                    snInputs += `<div class="relative mb-2">
                        <i class="fa-solid fa-barcode absolute left-3 top-3 text-brand-black text-xs"></i>
                        <input type="text" placeholder="${placeholder}" value="${val}" data-item-index="${idx}" data-unit-index="${i}" class="sn-input w-full rounded-xl py-2 pl-8 ${isReturned ? 'pr-24' : 'pr-3'} text-xs font-mono font-bold outline-none transition-all uppercase border ${lockClass}" ${isLocked ? 'readonly' : ''}>
                        ${badgeHtml}
                    </div>`;
                }

                const itemHasAllNoSerial = itemAllNoSerial && totalUnits > 0;
                return `
                    <div class="p-6 border-b border-gray-100 last:border-0 flex flex-col md:flex-row gap-6 items-start">
                        <div class="w-16 h-16 rounded-xl bg-white border border-gray-100 p-2 shrink-0 flex items-center justify-center shadow-xs">
                            <img src="${img}" class="max-w-full max-h-full object-contain">
                        </div>
                        <div class="flex-grow w-full">
                            <div class="flex justify-between mb-2">
                                <h5 class="font-black text-xs uppercase text-brand-black">${item.name || item.title}</h5>
                                <span class="text-xs font-black text-brand-cyan">x${item.quantity}</span>
                            </div>
                            <div class="flex gap-2 mb-3">
                                ${item.color ? `<span class="text-[8px] font-black uppercase bg-slate-100 px-2 py-1 rounded text-brand-black border border-gray-200">${item.color}</span>` : ''}
                                ${item.capacity ? `<span class="text-[8px] font-black uppercase bg-slate-100 px-2 py-1 rounded text-brand-black border border-gray-200">${item.capacity}</span>` : ''}
                            </div>
                            <div class="bg-slate-100/60 p-3.5 rounded-2xl border border-gray-200/80">
                                <div class="flex items-center justify-between mb-2.5">
                                    <p class="text-[9px] font-black text-brand-black uppercase tracking-widest flex items-center gap-1.5">
                                        <i class="fa-solid fa-barcode text-brand-cyan"></i> Seriales (SN)
                                    </p>
                                    ${!isLocked ? `
                                        <button type="button" onclick="window.toggleItemNoSerial(${idx})" 
                                            id="btn-toggle-noserial-${idx}"
                                            class="text-[9px] font-bold text-gray-600 hover:text-brand-black bg-white hover:bg-slate-100 px-2.5 py-1 rounded-lg border border-gray-200 transition flex items-center gap-1 shadow-2xs">
                                            <i class="fa-solid fa-ban text-[8px] text-amber-500"></i>
                                            <span id="label-noserial-${idx}">${itemHasAllNoSerial ? 'Quitar Sin Serial' : 'Marcar Sin Serial (N/A)'}</span>
                                        </button>
                                    ` : ''}
                                </div>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${snInputs}</div>
                            </div>
                        </div>
                    </div>`;
            }).join('');

            let draftBannerHtml = '';
            if (restoredDraftCount > 0 && !isLocked) {
                draftBannerHtml = `
                    <div id="draft-serials-banner" class="px-5 py-2.5 bg-cyan-500/10 border-b border-cyan-500/20 flex items-center justify-between flex-wrap gap-2 animate-fadeIn">
                        <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
                            <span class="text-[10px] font-black uppercase text-cyan-950 tracking-wider flex items-center gap-1.5">
                                <i class="fa-solid fa-clock-rotate-left text-brand-cyan"></i> Borrador local restaurado
                            </span>
                            <span id="draft-banner-count" class="text-[9px] font-bold text-cyan-700">(${restoredDraftCount} serial${restoredDraftCount > 1 ? 'es' : ''} recuperado${restoredDraftCount > 1 ? 's' : ''})</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-[8px] font-bold text-cyan-700 uppercase tracking-wider hidden sm:inline"><i class="fa-solid fa-check text-emerald-600"></i> Guardado en este equipo</span>
                            <button type="button" onclick="window.discardDraftSerials('${orderId}')" class="text-[9px] font-black uppercase text-rose-600 hover:text-white hover:bg-rose-500 bg-white px-2.5 py-1 rounded-lg border border-rose-200 transition shadow-2xs cursor-pointer active:scale-95" title="Borrar seriales temporales de este equipo">
                                <i class="fa-solid fa-trash-can mr-1"></i> Descartar
                            </button>
                        </div>
                    </div>
                `;
            } else if (!isLocked) {
                draftBannerHtml = `
                    <div id="draft-serials-banner" class="px-5 py-2.5 bg-cyan-500/10 border-b border-cyan-500/20 flex items-center justify-between flex-wrap gap-2 text-[9px] text-gray-500 font-bold hidden animate-fadeIn">
                        <div class="flex items-center gap-2">
                            <i class="fa-solid fa-floppy-disk text-brand-cyan"></i>
                            <span id="draft-banner-text" class="text-cyan-950 uppercase font-black tracking-wider">Auto-guardado local activo</span>
                            <span id="draft-banner-count" class="text-cyan-700 font-bold"></span>
                        </div>
                        <button type="button" onclick="window.discardDraftSerials('${orderId}')" class="text-[9px] font-black uppercase text-rose-600 hover:text-white hover:bg-rose-500 bg-white px-2.5 py-1 rounded-lg border border-rose-200 transition shadow-2xs cursor-pointer active:scale-95" title="Limpiar seriales no guardados">
                            <i class="fa-solid fa-trash-can mr-1"></i> Descartar
                        </button>
                    </div>
                `;
            }

            itemsList.innerHTML = draftBannerHtml + itemsHtml;

            if (!isLocked) {
                setTimeout(() => {
                    const allInputs = Array.from(document.querySelectorAll('.sn-input'));
                    const updateInputStyle = (el, val) => {
                        const noSn = isNoSerial(val);
                        if (noSn) {
                            el.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-300');
                            el.classList.remove('bg-white', 'text-brand-black', 'border-gray-200');
                        } else {
                            el.classList.remove('bg-amber-50', 'text-amber-800', 'border-amber-300');
                            el.classList.add('bg-white', 'text-brand-black', 'border-gray-200');
                        }
                    };

                    allInputs.forEach((input, currentIndex) => {
                        updateInputStyle(input, input.value.trim().toUpperCase());

                        let debounceTimer = null;
                        input.addEventListener('input', function() {
                            clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(() => {
                                updateInputStyle(this, this.value.trim().toUpperCase());
                                saveDraftSerials(currentOrderId);
                            }, 150);
                        });

                        input.addEventListener('change', function(e) {
                            clearTimeout(debounceTimer);
                            let val = this.value.trim().toUpperCase();
                            this.value = val;
                            if (!val) {
                                updateInputStyle(this, '');
                                saveDraftSerials(currentOrderId);
                                return; 
                            }
                            if (isNoSerial(val)) {
                                this.value = 'SIN-SERIAL';
                                updateInputStyle(this, 'SIN-SERIAL');
                                saveDraftSerials(currentOrderId);
                                return;
                            }
                            updateInputStyle(this, val);

                            const isDuplicate = allInputs.some(otherInput => otherInput !== this && !isNoSerial(otherInput.value) && otherInput.value.trim().toUpperCase() === val);
                            if (isDuplicate) {
                                showActionToast(`⚠️ El serial "${val}" ya fue escaneado en esta orden. Por favor revisa.`, 'error');
                                this.value = ""; 
                                this.focus(); 
                                this.classList.add('border-red-500', 'bg-red-50');
                                setTimeout(() => this.classList.remove('border-red-500', 'bg-red-50'), 2000);
                            }
                            saveDraftSerials(currentOrderId);
                        });

                        input.addEventListener('blur', function() {
                            saveDraftSerials(currentOrderId);
                        });

                        input.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter') {
                                e.preventDefault(); 
                                this.dispatchEvent(new Event('change'));
                                saveDraftSerials(currentOrderId);
                                if (this.value.trim() !== "") {
                                    const nextInput = allInputs[currentIndex + 1];
                                    if (nextInput) {
                                        nextInput.focus();
                                        nextInput.select();
                                    } else { 
                                        const btnSave = getEl('btn-save-alistado'); 
                                        if(btnSave && !btnSave.classList.contains('hidden')) btnSave.focus(); 
                                    }
                                }
                            }
                        });
                    });
                }, 100); 
            }
        }

        // 🔥 LÓGICA DE VISUALIZACIÓN DE TOTALES CON 4X1000
        const subtotal = o.subtotal || o.total;
        const shipping = o.shippingCost || 0;
        const tax4x1000 = o.tax4x1000 || 0; // Sacamos el 4x1000 de Firebase
        const totalOriginal = o.total || 0;
        const refunded = o.refundedAmount || 0;
        const netTotal = totalOriginal - refunded;

        safeSetText('modal-order-subtotal', `$${subtotal.toLocaleString('es-CO')}`);
        
        const isFleteAlCobro = o.shippingType === 'FLETE_AL_COBRO' || o.shippingData?.shippingType === 'FLETE_AL_COBRO';
        const shippingEl = getEl('modal-order-shipping');
        if (shippingEl) {
            if (isFleteAlCobro) {
                shippingEl.innerHTML = `<span class="bg-amber-100 text-amber-800 text-[10px] font-black uppercase px-2.5 py-1 rounded-md border border-amber-200"><i class="fa-solid fa-hand-holding-dollar mr-1"></i> Flete al Cobro</span>`;
            } else {
                shippingEl.textContent = shipping === 0 ? "GRATIS" : `$${shipping.toLocaleString('es-CO')}`;
            }
        }
        
        const totalContainer = getEl('modal-total-container');
        if (totalContainer) {
            let taxHtml = tax4x1000 > 0 ? `<p class="text-[9px] font-black text-purple-600 uppercase tracking-widest mb-0.5">4x1000: +$${tax4x1000.toLocaleString('es-CO')}</p>` : '';
            
            if (refunded > 0) {
                totalContainer.innerHTML = `<div class="flex flex-col items-start"><p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Total Original</p><p class="text-xs font-bold text-gray-400 line-through decoration-red-300">$${totalOriginal.toLocaleString('es-CO')}</p>${taxHtml}<p class="text-[9px] font-black text-red-500 uppercase tracking-widest mt-1 mb-0.5">Devolución</p><p class="text-xs font-bold text-red-500">-$${refunded.toLocaleString('es-CO')}</p><div class="w-full h-px bg-gray-200 my-1.5"></div><p class="text-[9px] font-black text-brand-black uppercase tracking-widest mb-0.5">Total Neto</p><h4 class="text-2xl md:text-3xl font-black text-brand-black leading-none">$${netTotal.toLocaleString('es-CO')}</h4></div>`;
            } else {
                totalContainer.innerHTML = `<div class="flex flex-col items-start">${taxHtml}<p class="text-[9px] font-black text-brand-black uppercase tracking-widest mb-0.5">Total Neto</p><h4 id="modal-order-total" class="text-2xl md:text-3xl font-black text-brand-black leading-none">$${totalOriginal.toLocaleString('es-CO')}</h4></div>`;
            }
        }

        const footerActions = getEl('modal-footer-actions');
        const footerMsg = getEl('modal-footer-msg');
        
        ['btn-refund-action', 'btn-cancel-action', 'btn-edit-action'].forEach(id => {
            const btn = document.getElementById(id); if(btn) btn.remove();
        });

        if (footerActions) {
            footerActions.classList.add('hidden');
            footerActions.classList.remove('flex-col');
            footerActions.classList.add('flex-row', 'flex-wrap', 'justify-end', 'items-center', 'gap-2.5');
        }
        if (footerMsg) footerMsg.classList.add('hidden');
        
        const btnAlistar = getEl('btn-save-alistado');
        const btnDespachar = getEl('btn-set-despachado');
        if(btnAlistar) {
            btnAlistar.className = "w-11 h-11 bg-brand-black text-white hover:bg-slate-800 rounded-xl transition-all flex items-center justify-center shadow-sm shrink-0 hidden";
            btnAlistar.title = "Guardar Alistamiento";
            btnAlistar.innerHTML = '<i class="fa-solid fa-floppy-disk text-base"></i>';
            btnAlistar.classList.add('hidden');
        }
        if(btnDespachar) {
            btnDespachar.className = "h-11 px-4 sm:px-5 bg-emerald-500 text-white hover:bg-emerald-600 rounded-xl font-black uppercase text-[10px] tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm shrink-0 hidden";
            btnDespachar.innerHTML = '<i class="fa-solid fa-truck-fast mr-1.5"></i> Marcar Despachado';
            btnDespachar.classList.add('hidden');
        }

        const isFinished = ['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status);

        if (o.status === 'PENDIENTE_PAGO') {
            if (footerMsg) { footerMsg.innerHTML = '<span class="text-orange-500 font-bold flex items-center gap-2"><i class="fa-solid fa-clock"></i> Esperando pago...</span>'; footerMsg.classList.remove('hidden'); }
        } else if (isLocked && !['DESPACHADO', 'ENTREGADO', 'DEVOLUCION_PARCIAL'].includes(o.status)) {
            if (footerMsg) { footerMsg.innerHTML = `<span class="text-red-500 font-bold flex items-center gap-2"><i class="fa-solid fa-ban"></i> Pedido ${o.status}</span>`; footerMsg.classList.remove('hidden'); }
        } else if (o.status === 'ALISTADO') {
            if (footerActions) footerActions.classList.remove('hidden');
            if (btnAlistar) {
                btnAlistar.classList.remove('hidden');
                btnAlistar.title = "Actualizar Alistamiento";
                btnAlistar.innerHTML = '<i class="fa-solid fa-floppy-disk text-base"></i>';
            }
            if (btnDespachar) btnDespachar.classList.remove('hidden');
        } else if (['DESPACHADO', 'ENTREGADO', 'DEVOLUCION_PARCIAL'].includes(o.status)) { 
             if (btnAlistar) btnAlistar.classList.add('hidden');
             if (btnDespachar) btnDespachar.classList.add('hidden');
             if (footerActions) {
                 footerActions.classList.remove('hidden');
                 const btnRefund = document.createElement('button');
                 btnRefund.id = 'btn-refund-action';
                 btnRefund.className = "h-11 px-4 bg-white text-red-500 border border-red-200 hover:bg-red-50 rounded-xl font-black uppercase text-[10px] tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm shrink-0";
                 btnRefund.innerHTML = `<i class="fa-solid fa-rotate-left text-xs"></i> <span>Devolución</span>`;
                 btnRefund.onclick = () => openRefundModal(currentOrderData);
                 footerActions.prepend(btnRefund);
             }
        } else {
            if (footerActions) footerActions.classList.remove('hidden');
            if (btnAlistar) {
                btnAlistar.classList.remove('hidden');
                btnAlistar.title = "Guardar Alistamiento";
                btnAlistar.innerHTML = '<i class="fa-solid fa-floppy-disk text-base"></i>';
            }
        }

        if (isAdmin && !isFinished) {
            if (footerActions) {
                footerActions.classList.remove('hidden');

                // Permitir editar órdenes PENDIENTES (manuales) y órdenes ALISTADAS
                if ((o.status === 'PENDIENTE' && o.source === 'MANUAL') || o.status === 'ALISTADO') {
                    const btnEdit = document.createElement('button');
                    btnEdit.id = 'btn-edit-action';
                    btnEdit.className = "w-11 h-11 bg-cyan-50 text-brand-black border border-brand-cyan/40 hover:bg-brand-cyan rounded-xl transition-all flex items-center justify-center shadow-2xs shrink-0";
                    btnEdit.innerHTML = `<i class="fa-solid fa-pen-to-square text-base"></i>`;
                    btnEdit.title = "Editar Orden";
                    btnEdit.onclick = () => openEditOrderModal(currentOrderData);
                    footerActions.prepend(btnEdit);
                }

                const btnCancel = document.createElement('button');
                btnCancel.id = 'btn-cancel-action';
                btnCancel.className = "w-11 h-11 bg-red-50 text-red-600 border border-red-200/80 hover:bg-red-500 hover:text-white rounded-xl transition-all flex items-center justify-center shadow-2xs shrink-0";
                btnCancel.innerHTML = `<i class="fa-solid fa-ban text-base"></i>`;
                btnCancel.title = "Anular Venta";
                btnCancel.onclick = () => cancelManualOrder(currentOrderData);
                footerActions.prepend(btnCancel);
            }
        }

        modal.classList.remove('hidden');

    } catch (e) { console.error(e); }
}

// ==========================================================================
// ANULAR ORDEN MANUAL/ONLINE (ADMIN)
// ==========================================================================
async function cancelManualOrder(order) {
    if (!confirm("🚨 ATENCIÓN ADMINISTRADOR 🚨\n\n¿Estás seguro de ANULAR esta venta?\n\n- Los productos regresarán automáticamente al inventario (si fueron descontados).\n- El dinero se restará de la cuenta de tesorería (si aplica).\n- La orden quedará como CANCELADA.\n\nEsta acción es irreversible.")) return;

    const btn = getEl('btn-cancel-action');
    if(btn) { btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'; btn.disabled = true; }

    try {
        let isStockDeducted = false;

        await runTransaction(db, async (t) => {
            const oRef = doc(db, "orders", order.id);
            const oSnap = await t.get(oRef);
            if (!oSnap.exists()) throw new Error("La orden no existe.");
            const oData = oSnap.data();

            if (oData.status === 'CANCELADO') throw new Error("La orden ya estaba cancelada.");
            
            isStockDeducted = oData.isStockDeducted === true || oData.source === 'MANUAL';

            let accSnap = null;
            let accRef = null;
            if (oData.amountPaid > 0 && oData.paymentAccountId) {
                accRef = doc(db, "accounts", oData.paymentAccountId);
                accSnap = await t.get(accRef);
            }

            const remRef = doc(db, "remissions", order.id);
            const remSnap = await t.get(remRef);

            if (accSnap && accSnap.exists()) {
                const newBalance = (accSnap.data().balance || 0) - oData.amountPaid;
                t.update(accRef, { balance: newBalance });

                const expenseRef = doc(collection(db, "expenses"));
                t.set(expenseRef, {
                    amount: oData.amountPaid,
                    category: "Anulación de Venta",
                    description: `Reverso por anulación de Orden #${order.id.slice(0,8)}`,
                    paymentMethod: accSnap.data().name,
                    supplierName: oData.userName || "Cliente",
                    date: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    type: 'EXPENSE',
                    orderId: order.id,
                    isRefund: true
                });
            }

            const updateObj = {
                status: 'CANCELADO',
                isStockDeducted: false,
                paymentStatus: oData.amountPaid > 0 ? 'REFUNDED' : 'CANCELLED',
                refundedAmount: (oData.refundedAmount || 0) + (oData.amountPaid || 0),
                cancelReason: 'Anulada por Administrador',
                updatedAt: serverTimestamp()
            };
            if (oData.requiresInvoice) {
                updateObj.billingStatus = 'CANCELLED';
            }
            t.update(oRef, updateObj);

            if (remSnap.exists()) {
                t.update(remRef, { status: 'CANCELADO', updatedAt: serverTimestamp() });
            }
        });

        if (isStockDeducted && order.items && order.items.length > 0) {
            const ordNum = order.internalOrderNumber || order.id;
            for (const item of order.items) {
                await safeAdjustStock(item.id, item.quantity, item.color, item.capacity, 'DEVOLUCION_CANCELACION', `Devolución por anulación del pedido #${ordNum}`);
            }
        }

        // Liberar seriales legítimos a AVAILABLE o eliminar seriales regularizados
        try {
            const linkedSerials = await getDocs(query(collection(db, "product_serials"), where("orderId", "==", order.id)));
            if (!linkedSerials.empty) {
                const batchSerials = writeBatch(db);
                linkedSerials.forEach(d => {
                    const data = d.data();
                    if (isRegularizedSerial(data)) {
                        // Serial regularizado en alistamiento: se elimina para evitar asignarlo al producto incorrecto
                        batchSerials.delete(d.ref);
                    } else {
                        // Serial legítimo de compras: vuelve a estar DISPONIBLE
                        batchSerials.update(d.ref, {
                            status: 'AVAILABLE',
                            orderId: null,
                            orderInternalNumber: null,
                            clientName: null,
                            clientPhone: null,
                            dispatchedAt: null,
                            returnedAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        });
                    }
                });
                await batchSerials.commit();
            }
        } catch(errSerials) {
            console.warn("Error procesando seriales en anulación:", errSerials);
        }

        clearDraftSerials(order.id);
        alert("✅ Venta anulada exitosamente. \nEl stock fue devuelto al catálogo (si corresponde) y el dinero fue revertido de la cuenta (si aplica).");
        getEl('order-modal').classList.add('hidden');
        currentOrderData = null;

    } catch (error) {
        console.error(error); alert("Error al anular: " + error.message);
        if(btn) { btn.innerHTML = '<i class="fa-solid fa-ban"></i> Anular Venta'; btn.disabled = false; }
    }
}

// ==========================================================================
// 🔥 NUEVO: EDITAR ORDEN MANUAL (ADMIN) + 4x1000
// ==========================================================================
let editOrderOriginal = null;
let editItems = [];

async function safeAdjustStock(id, delta, color, capacity, reason = null, details = null, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await adjustStock(id, delta, color, capacity, reason, details);
            return; 
        } catch(e) {
            if (i === retries - 1) throw e;
            console.warn(`[Stock] Reintento por choque con Centinela para ${id}...`);
            await new Promise(r => setTimeout(r, 800)); 
        }
    }
}

function injectEditModalHtml() {
    if (getEl('edit-order-modal')) return;
    const html = `
    <div id="edit-order-modal" class="fixed inset-0 z-[100] hidden flex items-center justify-center p-4 sm:p-6 bg-slate-900/95">
        <div class="relative bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[95vh] overflow-hidden">
            <div class="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-brand-cyan shrink-0">
                <h3 class="text-xl font-black uppercase text-brand-black flex items-center gap-2">
                    <i class="fa-solid fa-pen-to-square"></i> <span id="eo-modal-title-text">Editar Orden</span>
                </h3>
                <button onclick="document.getElementById('edit-order-modal').classList.add('hidden')" class="w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 text-brand-black transition flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div class="p-8 flex-1 overflow-y-auto custom-scroll space-y-6">
                
                <!-- Datos del Cliente y Entrega -->
                <div class="bg-slate-50 rounded-2xl border border-gray-100 p-4">
                    <h4 class="text-[9px] font-black text-brand-black uppercase tracking-widest mb-3 border-b border-gray-200 pb-2 flex items-center gap-1.5">
                        <i class="fa-solid fa-user text-brand-cyan"></i> Información del Cliente y Entrega
                    </h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                        <div>
                            <label class="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">Nombre Cliente</label>
                            <input type="text" id="eo-client-name" placeholder="Nombre completo" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 font-bold outline-none focus:border-brand-cyan text-brand-black">
                        </div>
                        <div>
                            <label class="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">Teléfono / WhatsApp</label>
                            <input type="text" id="eo-client-phone" placeholder="Ej: 3001234567" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 font-bold outline-none focus:border-brand-cyan text-brand-black">
                        </div>
                        <div>
                            <label class="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">Ciudad</label>
                            <input type="text" id="eo-client-city" placeholder="Ciudad de entrega" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 font-bold outline-none focus:border-brand-cyan text-brand-black">
                        </div>
                        <div class="sm:col-span-2">
                            <label class="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">Dirección de Entrega</label>
                            <input type="text" id="eo-client-address" placeholder="Dirección completa" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 font-bold outline-none focus:border-brand-cyan text-brand-black">
                        </div>
                        <div class="sm:col-span-2 lg:col-span-1">
                            <label class="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">Notas / Observaciones</label>
                            <input type="text" id="eo-order-notes" placeholder="Notas internas o entrega" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 font-bold outline-none focus:border-brand-cyan text-brand-black">
                        </div>
                    </div>
                </div>

                <div class="relative">
                    <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Agregar Producto al Pedido</label>
                    <input type="text" id="eo-search-prod" placeholder="Buscar por nombre o SKU..." class="w-full bg-slate-50 border border-gray-200 rounded-xl p-3 text-xs font-bold outline-none focus:border-brand-cyan">
                    <div id="eo-search-results" class="absolute top-full left-0 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl hidden max-h-48 overflow-y-auto z-50 p-2"></div>
                </div>

                <div class="bg-slate-50 rounded-2xl border border-gray-100 p-4">
                    <h4 class="text-[9px] font-black text-brand-black uppercase tracking-widest mb-3 border-b border-gray-200 pb-2">Contenido de la Orden</h4>
                    <div id="eo-items-list" class="space-y-3"></div>
                </div>

                <div class="flex justify-end gap-6 items-start pt-4">
                    <div class="flex items-center gap-2 mt-[26px]">
                        <input type="checkbox" id="eo-apply-4x1000" class="w-4 h-4 rounded text-brand-cyan border-gray-300 cursor-pointer">
                        <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest cursor-pointer" for="eo-apply-4x1000">Cobrar 4x1000</label>
                    </div>
                    <div>
                        <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Costo de Envío</label>
                        <input type="text" id="eo-shipping-cost" class="w-32 bg-slate-50 border border-gray-200 rounded-lg p-2 text-sm font-black text-right outline-none focus:border-brand-cyan">
                    </div>
                    <div class="text-right">
                        <p class="text-[9px] font-black text-brand-black uppercase tracking-widest mb-1">Nuevo Total</p>
                        <h4 id="eo-total-display" class="text-3xl font-black text-brand-cyan leading-none">$0</h4>
                    </div>
                </div>
            </div>
            
            <div class="p-6 bg-slate-50 border-t border-gray-100 flex justify-end gap-3 shrink-0">
                <button onclick="document.getElementById('edit-order-modal').classList.add('hidden')" class="px-6 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest hover:text-brand-black transition">Cancelar</button>
                <button id="btn-save-edited-order" class="px-8 py-3 bg-brand-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:shadow-lg hover:bg-brand-cyan hover:text-brand-black transition flex items-center gap-2">
                    <i class="fa-solid fa-save"></i> Guardar Cambios
                </button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    
    getEl('eo-shipping-cost').addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = formatCurrency(val);
        calculateEditTotals();
    });
    
    getEl('eo-apply-4x1000').addEventListener('change', calculateEditTotals);
    getEl('btn-save-edited-order').onclick = saveEditedOrder;

    const sInp = getEl('eo-search-prod');
    const sRes = getEl('eo-search-results');
    sInp.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        sRes.innerHTML = "";
        const words = term.split(/\s+/).filter(Boolean);
        const filtered = editProductsCache.filter(p => {
            const str = normalizeText(`${p.name || ''} ${p.sku || ''} ${p.brand || ''} ${p.searchStr || ''}`);
            return words.every(w => str.includes(w));
        });
        if(filtered.length === 0) sRes.innerHTML = `<p class="p-3 text-[10px] font-bold text-gray-400 text-center uppercase">No encontrado</p>`;
        else {
            filtered.slice(0,10).forEach(p => {
                const isOutOfStock = p.stock <= 0;
                const d = document.createElement('div');
                d.className = `p-2 flex items-center justify-between border-b border-gray-50 last:border-0 ${isOutOfStock ? 'opacity-50' : 'hover:bg-cyan-50 cursor-pointer'}`;
                d.innerHTML = `<div class="text-[10px] font-black uppercase text-brand-black truncate">${p.name} <span class="text-[9px] text-gray-400 font-bold block">Stock: ${p.stock||0}</span></div><div class="text-[10px] font-bold">${formatCurrency(p.price)}</div>`;
                if(!isOutOfStock) {
                    d.onmousedown = () => {
                        editItems.push({
                            id: p.id, name: p.name, price: p.price, quantity: 1, 
                            image: p.mainImage || p.image || (p.images ? p.images[0] : ''),
                            color: p.definedColors && p.definedColors.length > 0 ? p.definedColors[0] : null,
                            capacity: p.definedCapacities && p.definedCapacities.length > 0 ? p.definedCapacities[0] : null
                        });
                        sInp.value = ""; sRes.classList.add('hidden');
                        renderEditItems();
                    };
                }
                sRes.appendChild(d);
            });
        }
        sRes.classList.remove('hidden');
    });
    document.addEventListener('click', (e) => { if (!sInp.contains(e.target) && !sRes.contains(e.target)) sRes.classList.add('hidden'); });
}

function openEditOrderModal(order) {
    if (!isProductsSubscribed) {
        AdminStore.subscribeToProducts(p => editProductsCache = p);
        isProductsSubscribed = true;
    }

    injectEditModalHtml();
    editOrderOriginal = JSON.parse(JSON.stringify(order));
    editItems = JSON.parse(JSON.stringify(order.items || []));
    
    // Título dinámico
    const titleEl = getEl('eo-modal-title-text');
    if (titleEl) {
        const num = order.internalOrderNumber ? `#${order.internalOrderNumber}` : (order.id ? `#${order.id.slice(0,6)}` : '');
        const isAlistado = order.status === 'ALISTADO';
        titleEl.innerHTML = `Editar Orden ${num} ${isAlistado ? '<span class="text-[10px] bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-md ml-2 font-black uppercase tracking-wider">Alistada</span>' : ''}`;
    }

    // Cargar datos de cliente y entrega
    if (getEl('eo-client-name')) getEl('eo-client-name').value = order.userName || order.clientName || order.buyerInfo?.name || '';
    if (getEl('eo-client-phone')) getEl('eo-client-phone').value = order.phone || order.clientPhone || order.buyerInfo?.phone || '';
    const addr = order.shippingData?.address || order.address || '';
    if (getEl('eo-client-address')) getEl('eo-client-address').value = (addr === 'Retiro en Tienda / Local' || addr === 'Retiro en Local') ? '' : addr;
    if (getEl('eo-client-city')) getEl('eo-client-city').value = order.shippingData?.city || order.city || '';
    if (getEl('eo-order-notes')) getEl('eo-order-notes').value = order.notes || order.shippingData?.notes || '';

    getEl('eo-shipping-cost').value = formatCurrency(order.shippingCost || 0);
    getEl('eo-apply-4x1000').checked = (order.tax4x1000 > 0);

    renderEditItems();
    getEl('edit-order-modal').classList.remove('hidden');
}

function renderEditItems() {
    const list = getEl('eo-items-list');
    list.innerHTML = "";
    if(editItems.length === 0) list.innerHTML = `<p class="text-xs text-gray-400 text-center py-4 font-bold">No hay productos. Busca uno arriba para agregar.</p>`;
    
    editItems.forEach((item, idx) => {
        const product = editProductsCache.find(p => p.id === item.id);
        
        let colorHtml = '';
        if (product) {
            let colors = product.definedColors || [];
            if (colors.length === 0 && product.combinations) colors = product.combinations.map(c => c.color).filter(c=>c);
            colors = [...new Set(colors)];
            
            if (colors.length > 0) {
                colorHtml = `<select data-idx="${idx}" class="e-color w-full bg-slate-50 border border-gray-200 rounded p-1.5 text-[9px] font-bold text-gray-600 outline-none focus:border-brand-cyan mb-1 cursor-pointer appearance-none">
                    <option value="">Color...</option>
                    ${colors.map(c => `<option value="${c}" ${c === item.color ? 'selected' : ''}>${c}</option>`).join('')}
                </select>`;
            }
        }

        let capHtml = '';
        if (product) {
            let caps = product.definedCapacities || [];
            if (caps.length === 0 && product.capacities) caps = product.capacities.map(c => c.label);
            caps = [...new Set(caps)];
            
            if (caps.length > 0) {
                capHtml = `<select data-idx="${idx}" class="e-capacity w-full bg-slate-50 border border-gray-200 rounded p-1.5 text-[9px] font-bold text-gray-600 outline-none focus:border-brand-cyan cursor-pointer appearance-none">
                    <option value="">Capacidad...</option>
                    ${caps.map(c => `<option value="${c}" ${c === item.capacity ? 'selected' : ''}>${c}</option>`).join('')}
                </select>`;
            }
        }

        const div = document.createElement('div');
        div.className = "flex items-start gap-3 bg-white p-3 rounded-xl border border-gray-200 shadow-sm";
        div.innerHTML = `
            <img src="${item.image || item.mainImage || 'https://placehold.co/40'}" class="w-12 h-12 rounded border border-gray-100 object-cover shrink-0">
            <div class="flex-1 min-w-0">
                <p class="text-[10px] font-black uppercase text-brand-black truncate mb-2">${item.name}</p>
                <div class="grid grid-cols-2 gap-2">
                    ${colorHtml}
                    ${capHtml}
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 self-center">
                <div>
                    <label class="text-[8px] text-gray-400 font-bold block text-center mb-1">Cant.</label>
                    <input type="number" min="1" value="${item.quantity}" data-idx="${idx}" class="e-qty w-12 bg-slate-50 border border-gray-200 rounded p-2 text-xs font-black text-center outline-none focus:border-brand-cyan">
                </div>
                <div>
                    <label class="text-[8px] text-gray-400 font-bold block text-center mb-1">Precio Uni.</label>
                    <input type="text" value="${formatCurrency(item.price)}" data-idx="${idx}" class="e-price w-24 bg-slate-50 border border-gray-200 rounded p-2 text-xs font-bold text-right outline-none focus:border-brand-cyan">
                </div>
                <button class="e-remove w-8 h-8 mt-[18px] bg-red-50 text-red-500 rounded hover:bg-red-500 hover:text-white transition flex items-center justify-center shadow-sm" data-idx="${idx}"><i class="fa-solid fa-trash-can text-xs"></i></button>
            </div>
        `;
        list.appendChild(div);
    });

    document.querySelectorAll('.e-color').forEach(sel => sel.onchange = (e) => editItems[e.target.dataset.idx].color = e.target.value);
    document.querySelectorAll('.e-capacity').forEach(sel => sel.onchange = (e) => editItems[e.target.dataset.idx].capacity = e.target.value);

    document.querySelectorAll('.e-qty').forEach(inp => inp.onchange = (e) => {
        const val = parseInt(e.target.value);
        editItems[e.target.dataset.idx].quantity = val > 0 ? val : 1;
        e.target.value = editItems[e.target.dataset.idx].quantity;
        calculateEditTotals();
    });

    document.querySelectorAll('.e-price').forEach(inp => {
        inp.oninput = (e) => {
            const val = parseCurrency(e.target.value);
            e.target.value = formatCurrency(val);
            editItems[e.target.dataset.idx].price = val;
            calculateEditTotals();
        };
        inp.onfocus = (e) => e.target.select();
    });

    document.querySelectorAll('.e-remove').forEach(btn => btn.onclick = (e) => {
        const idx = e.currentTarget.dataset.idx;
        editItems.splice(idx, 1);
        renderEditItems();
    });

    calculateEditTotals();
}

function calculateEditTotals() {
    const shipping = parseCurrency(getEl('eo-shipping-cost').value);
    const subtotal = editItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    let baseTotal = subtotal + shipping;
    
    let tax4x1000 = 0;
    if (getEl('eo-apply-4x1000').checked) {
        tax4x1000 = Math.round(baseTotal * 0.004);
    }
    
    const total = baseTotal + tax4x1000;
    
    const display = getEl('eo-total-display');
    if (tax4x1000 > 0) {
        display.innerHTML = `${formatCurrency(total)} <span class="block text-[12px] font-bold text-purple-500 mt-2 tracking-widest">+ ${formatCurrency(tax4x1000)} (Impuesto 4x1000)</span>`;
    } else {
        display.textContent = formatCurrency(total);
    }
}

async function saveEditedOrder() {
    if(editItems.length === 0) return alert("La orden debe tener al menos un producto.");
    if(!confirm("¿Estás seguro de modificar esta orden?\n\nEl stock de los productos y los valores se ajustarán automáticamente.")) return;

    const btn = getEl('btn-save-edited-order');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Ajustando Inventario...';
    btn.disabled = true;

    try {
        const oldItems = editOrderOriginal.items || [];
        const newItems = editItems;
        const newShipping = parseCurrency(getEl('eo-shipping-cost').value);
        const newSubtotal = newItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        let baseTotal = newSubtotal + newShipping;
        let newTax4x1000 = getEl('eo-apply-4x1000').checked ? Math.round(baseTotal * 0.004) : 0;
        const newTotal = baseTotal + newTax4x1000;

        const deltaMap = {};
        
        oldItems.forEach(item => {
            const k = `${item.id}|${item.color||''}|${item.capacity||''}`;
            if(!deltaMap[k]) deltaMap[k] = { id: item.id, color: item.color, capacity: item.capacity, delta: 0 };
            deltaMap[k].delta += item.quantity; 
        });

        newItems.forEach(item => {
            const k = `${item.id}|${item.color||''}|${item.capacity||''}`;
            if(!deltaMap[k]) deltaMap[k] = { id: item.id, color: item.color, capacity: item.capacity, delta: 0 };
            deltaMap[k].delta -= item.quantity; 
        });

        const editOrdNum = editOrderOriginal.internalOrderNumber || editOrderOriginal.id;
        for (const key in deltaMap) {
            const sd = deltaMap[key];
            if (sd.delta !== 0) {
                const editReason = sd.delta < 0 ? 'VENTA_PEDIDO' : 'DEVOLUCION_CANCELACION';
                const editDetails = sd.delta < 0 
                    ? `Modificación de pedido #${editOrdNum} (unidades adicionales vendidas: ${Math.abs(sd.delta)})`
                    : `Devolución de stock por modificación de pedido #${editOrdNum} (+${sd.delta} ud(s))`;
                await safeAdjustStock(sd.id, sd.delta, sd.color, sd.capacity, editReason, editDetails);
            }
        }

        const newClientName = getEl('eo-client-name')?.value.trim();
        const newClientPhone = getEl('eo-client-phone')?.value.trim();
        const newClientAddress = getEl('eo-client-address')?.value.trim();
        const newClientCity = getEl('eo-client-city')?.value.trim();
        const newOrderNotes = getEl('eo-order-notes')?.value.trim();

        // Ajustar seriales si se redujo la cantidad de algún producto
        newItems.forEach(item => {
            if (item.sns && Array.isArray(item.sns)) {
                item.sns = item.sns.slice(0, item.quantity);
            }
        });

        const updates = {
            items: newItems,
            subtotal: newSubtotal,
            shippingCost: newShipping,
            tax4x1000: newTax4x1000,
            total: newTotal,
            updatedAt: serverTimestamp(),
            lastEditedBy: auth.currentUser?.email || 'admin'
        };

        if (newClientName) {
            updates.userName = newClientName;
            updates.clientName = newClientName;
            if (editOrderOriginal.buyerInfo) {
                updates.buyerInfo = { ...(editOrderOriginal.buyerInfo || {}), name: newClientName };
            }
        }
        if (newClientPhone) {
            updates.phone = newClientPhone;
            updates.clientPhone = newClientPhone;
            if (editOrderOriginal.buyerInfo) {
                updates.buyerInfo = { ...(editOrderOriginal.buyerInfo || updates.buyerInfo || {}), phone: newClientPhone };
            }
        }
        if (newClientAddress) {
            updates.address = newClientAddress;
            updates.shippingData = { ...(editOrderOriginal.shippingData || {}), address: newClientAddress };
        }
        if (newClientCity) {
            updates.city = newClientCity;
            if (!updates.shippingData) updates.shippingData = { ...(editOrderOriginal.shippingData || {}) };
            updates.shippingData.city = newClientCity;
        }
        if (newOrderNotes !== undefined) {
            updates.notes = newOrderNotes;
            if (!updates.shippingData) updates.shippingData = { ...(editOrderOriginal.shippingData || {}) };
            updates.shippingData.notes = newOrderNotes;
        }

        await updateDoc(doc(db, "orders", editOrderOriginal.id), updates);
        
        const remRef = doc(db, "remissions", editOrderOriginal.id);
        const remSnap = await getDoc(remRef);
        if(remSnap.exists()) {
            const remUpdates = { items: newItems, total: newTotal, updatedAt: serverTimestamp() };
            if (newClientName) remUpdates.clientName = newClientName;
            if (newClientPhone) remUpdates.clientPhone = newClientPhone;
            if (newClientAddress) remUpdates.address = newClientAddress;
            if (newClientCity) remUpdates.city = newClientCity;
            await updateDoc(remRef, remUpdates);
        }

        alert("✅ Orden editada y stock cuadrado con éxito.");
        getEl('edit-order-modal').classList.add('hidden');
        getEl('order-modal').classList.add('hidden'); 

        currentOrderData = null;

        if (window.switchTab) window.switchTab(window.currentTab || 'ACTIONABLE');
        else if (window.renderOrdersMemory) window.renderOrdersMemory();

    } catch(e) {
        console.error(e);
        const errMsg = e?.message || (typeof e === 'string' ? e : "Error inesperado");
        alert("Error al editar la orden: " + errMsg);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}


// --- 2. ACCIONES (ALISTAR / DESPACHAR) ---
export async function saveAlistamiento(onSuccess) {
    if (!currentOrderId) return;
    const btn = getEl('btn-save-alistado');
    const originalText = btn ? btn.innerHTML : '<i class="fa-solid fa-floppy-disk text-base"></i>';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'; }
    try {
        const snap = await getDoc(doc(db, "orders", currentOrderId));
        if (!snap.exists()) throw new Error("La orden no existe en la base de datos.");
        const orderData = snap.data();
        const items = orderData.items || [];

        const allSnsInOrder = [];
        const updatedItems = [];

        // 1. Recoger y validar que todos los campos de serial tengan un valor
        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            const qty = item.quantity || 1;
            const inputs = document.querySelectorAll(`.sn-input[data-item-index="${idx}"]`);
            const sns = Array.from(inputs).map(i => {
                const val = i.value.trim().toUpperCase();
                return isNoSerial(val) ? 'SIN-SERIAL' : val;
            });

            if (sns.length < qty) {
                throw new Error(`Debes ingresar los ${qty} seriales para el producto "${item.name}".`);
            }

            const emptyIdx = sns.findIndex(s => !s);
            if (emptyIdx !== -1) {
                throw new Error(`⚠️ Falta ingresar el serial (SN) de la unidad #${emptyIdx + 1} para "${item.name}". (Si el producto no tiene serial físico, pulsa "Marcar Sin Serial").`);
            }

            for (const sn of sns) {
                if (!isNoSerial(sn)) {
                    if (allSnsInOrder.some(x => !isNoSerial(x.sn) && x.sn === sn)) {
                        throw new Error(`⚠️ El serial "${sn}" está duplicado en este pedido. Cada unidad debe tener un serial diferente.`);
                    }
                }
                allSnsInOrder.push({ 
                    sn, 
                    itemId: item.id, 
                    itemName: item.name || item.title || 'Producto', 
                    itemColor: item.color || null, 
                    itemCapacity: item.capacity || null,
                    sku: item.sku || ''
                });
            }

            updatedItems.push({ ...item, sns });
        }

        // 2. Validación estricta y detección de seriales a actualizar o regularizar
        const serialDocsToUpdate = [];
        const unregisteredSerials = [];

        for (const itemSn of allSnsInOrder) {
            // Opción 3: Si es SIN-SERIAL, no se consulta en product_serials ni genera documento individual
            if (isNoSerial(itemSn.sn)) {
                continue;
            }

            const q = query(
                collection(db, "product_serials"),
                where("serialNumber", "==", itemSn.sn)
            );
            const serialSnap = await getDocs(q);

            if (serialSnap.empty) {
                // Opción 1: Serial de inventario antiguo no registrado previamente en compras
                unregisteredSerials.push(itemSn);
                continue;
            }

            // Buscar si coincide con el productId del ítem
            const matchingDoc = serialSnap.docs.find(d => d.data().productId === itemSn.itemId);
            if (!matchingDoc) {
                const otherProduct = serialSnap.docs[0].data();
                throw new Error(`🚨 Error de Alistamiento:\nEl serial "${itemSn.sn}" pertenece a otro producto ("${otherProduct.productName || 'otro equipo'}"), no a "${itemSn.itemName}".`);
            }

            const sData = matchingDoc.data();

            // Si ya está despachado y no es esta misma orden
            if (sData.status === 'DISPATCHED' && sData.orderId && sData.orderId !== currentOrderId) {
                const prevOrderNum = sData.orderInternalNumber || sData.orderId.slice(0, 6).toUpperCase();
                const clientInfo = sData.clientName ? ` (Cliente: ${sData.clientName})` : '';
                throw new Error(`🚨 Error de Alistamiento:\nEl serial "${itemSn.sn}" ya fue despachado en la orden #${prevOrderNum}${clientInfo}. No se puede volver a despachar.`);
            }

            serialDocsToUpdate.push({ ref: matchingDoc.ref, sn: itemSn.sn });
        }

        // Opción 1: Si hay seriales no registrados en compras, confirmar su regularización sobre la marcha
        if (unregisteredSerials.length > 0) {
            const listMsg = unregisteredSerials.map(u => `• [${u.sn}] → ${u.itemName}`).join('\n');
            const confirmMsg = `⚠️ REGULARIZACIÓN DE SERIALES ANTIGUOS:\n\nLos siguientes seriales no se encontraron registrados en compras previas:\n\n${listMsg}\n\n¿Deseas registrarlos automáticamente como "Inventario Inicial / Regularizado" y despacharlos en este pedido?`;
            
            const confirmed = window.confirm(confirmMsg);
            if (!confirmed) {
                throw new Error("Alistamiento cancelado por el usuario para verificar los seriales.");
            }
        }

        // 3. Si todo es válido: actualizar orden y seriales
        const now = new Date();
        const orderInternal = orderData.orderNumber || orderData.internalOrderNumber || currentOrderId.slice(0, 8).toUpperCase();
        const clientName = orderData.shippingData?.name || orderData.userName || orderData.customerName || 'Cliente';
        const clientPhone = orderData.shippingData?.phone || orderData.userPhone || '';

        // Buscar si esta orden tenía seriales previos que ya no están en esta lista (para liberarlos a AVAILABLE)
        const previousLinkedSerialsSnap = await getDocs(
            query(collection(db, "product_serials"), where("orderId", "==", currentOrderId))
        );

        const currentSnsList = allSnsInOrder.map(s => s.sn);
        const batch = writeBatch(db);

        // Liberar o eliminar los seriales previos que se hayan quitado o reemplazado
        previousLinkedSerialsSnap.docs.forEach(docSnap => {
            const data = docSnap.data();
            if (!currentSnsList.includes(data.serialNumber)) {
                if (isRegularizedSerial(data)) {
                    batch.delete(docSnap.ref);
                } else {
                    batch.update(docSnap.ref, {
                        status: 'AVAILABLE',
                        orderId: null,
                        orderInternalNumber: null,
                        clientName: null,
                        clientPhone: null,
                        dispatchedAt: null,
                        updatedAt: now
                    });
                }
            }
        });

        // Vincular los seriales existentes válidos a esta venta
        serialDocsToUpdate.forEach(item => {
            batch.update(item.ref, {
                status: 'DISPATCHED',
                orderId: currentOrderId,
                orderInternalNumber: orderInternal,
                clientName: clientName,
                clientPhone: clientPhone,
                dispatchedAt: now,
                updatedAt: now
            });
        });

        // Opción 1: Registrar los seriales de inventario antiguo sobre la marcha
        unregisteredSerials.forEach(item => {
            const newDocRef = doc(collection(db, "product_serials"));
            batch.set(newDocRef, {
                serialNumber: item.sn,
                productId: item.itemId,
                productName: item.itemName,
                sku: item.sku || '',
                color: item.itemColor || null,
                capacity: item.itemCapacity || null,
                status: 'DISPATCHED',
                supplierName: 'Inventario Inicial / Regularizado',
                source: 'REGULARIZADO_ALISTAMIENTO',
                orderId: currentOrderId,
                orderInternalNumber: orderInternal,
                clientName: clientName,
                clientPhone: clientPhone,
                dispatchedAt: now,
                createdAt: now,
                updatedAt: now
            });
        });

        // Actualizar la orden
        batch.update(doc(db, "orders", currentOrderId), {
            items: updatedItems,
            status: 'ALISTADO',
            updatedAt: now
        });

        await batch.commit();

        // 🔥 Limpiar borrador local ya que quedó persistido en la base de datos
        clearDraftSerials(currentOrderId);

        showActionToast("✅ Alistamiento guardado con éxito y seriales vinculados a la venta.", "success");
        getEl('order-modal').classList.add('hidden');
        if (onSuccess) onSuccess();
        else if (window.switchTab) window.switchTab(window.currentTab || 'ACTIONABLE');
        else if (window.renderOrdersMemory) window.renderOrdersMemory();

    } catch(e) { 
        console.error(e); 
        const msg = e?.message || (typeof e === 'string' ? e : "Error al guardar alistamiento");
        showActionToast(msg, "error");
    } finally { 
        if (btn) { btn.disabled = false; btn.innerHTML = originalText; } 
    }
}

export async function openDispatchModal() {
    if (!currentOrderId) return;
    
    // Obtener los datos de envío
    const address = (currentOrderData?.shippingData?.address || currentOrderData?.address || 'Retiro en Tienda / Local').toLowerCase();
    const isPickup = address.includes('recogida en local') || 
                     address.includes('retiro en local') || 
                     address.includes('retiro en tienda') || 
                     address.includes('recoger') ||
                     address.includes('retiro en tienda / local') ||
                     address.includes('retiro en local / tienda');
                     
    if (isPickup) {
        if (confirm("¿Seguro desea realizar la entrega?")) {
            const btn = getEl('btn-set-despachado');
            const originalText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Entregando...';
            }
            try {
                await updateDoc(doc(db, "orders", currentOrderId), { 
                    status: 'DESPACHADO', 
                    shippingCarrier: 'Retiro en Local', 
                    shippingTracking: 'Entregado en Local', 
                    shippedAt: new Date(), 
                    updatedAt: new Date() 
                });
                showActionToast("🚚 Pedido entregado y despachado con éxito", "success");
                getEl('order-modal').classList.add('hidden');
                if (window.switchTab) window.switchTab('ACTIONABLE');
            } catch(e) { 
                console.error(e); 
                showActionToast("⚠️ Error al realizar la entrega: " + e.message, "error");
            } finally { 
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        }
    } else {
        // Limpiamos los campos del modal de envío antes de mostrarlo
        const carrierEl = getEl('dispatch-carrier');
        const trackingEl = getEl('dispatch-tracking');
        if (carrierEl) carrierEl.value = "";
        if (trackingEl) trackingEl.value = "";
        getEl('dispatch-modal').classList.remove('hidden');
    }
}

export async function confirmDispatch(onSuccess) {
    if (!currentOrderId) return;
    const btn = getEl('btn-confirm-dispatch');
    const carrier = getEl('dispatch-carrier').value;
    const tracking = getEl('dispatch-tracking').value;
    
    if (!carrier || !tracking) return showActionToast("⚠️ Faltan datos de envío (Transportadora o Guía)", "error");
    
    btn.disabled = true;
    try {
        await updateDoc(doc(db, "orders", currentOrderId), { 
            status: 'DESPACHADO', shippingCarrier: carrier, shippingTracking: tracking, shippedAt: new Date(), updatedAt: new Date() 
        });
        showActionToast("🚚 Despachado exitosamente", "success");
        getEl('dispatch-modal').classList.add('hidden');
        getEl('order-modal').classList.add('hidden');
        if(onSuccess) onSuccess();
    } catch(e) { 
        console.error(e); 
        showActionToast("Error al despachar: " + e.message, "error");
    } finally { btn.disabled = false; }
}

// --- 3. VER RECIBO / REMISIÓN EN NUEVA PESTAÑA (SIN AUTO-PRINT Y SIN BLOQUEAR PÁGINA) ---
export async function viewReceipt(orderId) {
    try {
        let o = null;
        const cache = window.adminOrdersCache || [];
        const foundInCache = cache.find(item => item.id === orderId);
        if (foundInCache) {
            o = foundInCache;
        } else {
            const snap = await getDoc(doc(db, "orders", orderId));
            if (!snap.exists()) return alert("Error al encontrar los datos del pedido para generar el recibo");
            o = { id: snap.id, ...snap.data() };
        }
        
        const dateStr = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('es-CO') : (o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000).toLocaleString('es-CO') : '--');
        const remissionNumber = o.internalOrderNumber ? `#${o.internalOrderNumber}` : (o.id ? `#${o.id.slice(0, 8).toUpperCase()}` : 'S/N');
        const shortId = (o.id || orderId).slice(0, 8).toUpperCase();
        
        let address = o.shippingData?.address || o.address || 'Retiro en Local / Tienda';
        if (o.shippingData?.city) address += `, ${o.shippingData.city}`;
        if (o.shippingData?.department) address += ` - ${o.shippingData.department}`;

        const clientName = o.userName || o.buyerInfo?.name || o.shippingData?.name || 'Cliente';
        const clientPhone = o.phone || o.buyerInfo?.phone || o.shippingData?.phone || 'N/A';
        const clientDoc = o.clientDoc || o.buyerInfo?.document || o.shippingData?.clientDoc || 'N/A';

        const itemsHtml = (o.items || []).map(i => {
            let variantText = '';
            if(i.color || i.capacity) {
                variantText = `<br><span style="color:#64748b; font-size:11px;">${i.capacity ? i.capacity + ' ' : ''}${i.color ? i.color : ''}</span>`;
            }
            const unitPrice = Number(i.grossPrice) || Number(i.price) || 0;
            const itemQty = Number(i.quantity) || 1;
            const itemTotal = unitPrice * itemQty;
            
            return `
            <tr>
                <td><strong>${i.name || i.title || 'Producto'}</strong>${variantText}</td>
                <td style="text-align:center">${itemQty}</td>
                <td style="text-align:right">$${unitPrice.toLocaleString('es-CO')}</td>
                <td style="text-align:right; font-weight:bold;">$${itemTotal.toLocaleString('es-CO')}</td>
            </tr>`;
        }).join('');

        const subtotal = Number(o.grossTotal) || Number(o.subtotal) || Number(o.total) || 0;
        const shipping = Number(o.shippingCost) || 0;
        const tax4x1000 = Number(o.tax4x1000) || 0;
        const total = Number(o.total) || (subtotal + shipping + tax4x1000);

        let taxRow = tax4x1000 > 0 ? `<tr><td>Impuesto 4x1000</td><td>$${tax4x1000.toLocaleString('es-CO')}</td></tr>` : '';
        let shippingRow = shipping > 0 ? `<tr><td>Envío</td><td>$${shipping.toLocaleString('es-CO')}</td></tr>` : '<tr><td>Envío</td><td>Gratis</td></tr>';

        let notesHtml = '';
        const noteText = o.notes || o.shippingData?.notes;
        if (noteText && String(noteText).trim().length > 0) {
            notesHtml = `
            <div style="margin-bottom: 25px; background: #fffbeb; border: 1px solid #fef3c7; padding: 12px 16px; border-radius: 8px; font-size: 12px; color: #92400e;">
                <strong>Nota / Observación:</strong> ${noteText}
            </div>`;
        }

        const receiptHtml = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Recibo de Venta ${remissionNumber} - PixelTech</title>
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
                <style>
                    * { box-sizing: border-box; }
                    body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 0; font-size: 13px; color: #111827; }
                    .receipt-wrapper { max-width: 820px; margin: 25px auto 50px auto; background: #ffffff; padding: 45px 50px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
                    
                    /* Barra superior de acciones (no imprimible) */
                    .top-action-bar {
                        position: sticky;
                        top: 0;
                        z-index: 999;
                        background: rgba(15, 23, 42, 0.95);
                        backdrop-filter: blur(8px);
                        color: #ffffff;
                        padding: 12px 24px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 1px solid rgba(255,255,255,0.1);
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    }
                    .btn-print {
                        background: #00AEC7;
                        color: #000000;
                        border: none;
                        padding: 9px 20px;
                        border-radius: 10px;
                        font-weight: 800;
                        font-size: 12px;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                        transition: all 0.2s;
                        letter-spacing: 0.5px;
                        text-transform: uppercase;
                    }
                    .btn-print:hover { background: #33c2d6; transform: translateY(-1px); }
                    .btn-close {
                        background: rgba(255,255,255,0.1);
                        color: #ffffff;
                        border: 1px solid rgba(255,255,255,0.2);
                        padding: 9px 16px;
                        border-radius: 10px;
                        font-weight: 700;
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.2s;
                    }
                    .btn-close:hover { background: rgba(255,255,255,0.2); }

                    h1, h2, h3, h4 { color: #111827; margin: 0 0 5px 0; line-height: 1.2; }
                    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 2px solid #0f172a; padding-bottom: 20px; }
                    .store-info h1 { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; margin-bottom: 3px; color: #0f172a; }
                    .store-info p { margin: 2px 0; color: #64748b; font-size: 12px; font-weight: 500; }
                    .remission-info { text-align: right; }
                    .remission-info h2 { font-size: 20px; font-weight: 900; letter-spacing: 2px; color: #0f172a; }
                    .remission-info .consecutivo { font-size: 18px; font-weight: 900; color: #00AEC7; margin-bottom: 5px; display: block; }
                    .remission-info p { margin: 2px 0; font-size: 12px; color: #64748b; }
                    .badge { display: inline-block; background: #f1f5f9; padding: 4px 10px; border-radius: 6px; font-family: monospace; margin-top: 6px; font-weight: 800; font-size: 11px; color: #334155; border: 1px solid #e2e8f0; }
                    
                    .section-title { font-size: 10px; font-weight: 900; color: #94a3b8; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
                    .customer-info { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 30px; background: #f8fafc; padding: 20px 24px; border-radius: 14px; border: 1px solid #edf2f7; }
                    .customer-box p { margin: 0; font-size: 13px; font-weight: 700; color: #0f172a; }
                    .customer-box label { font-size: 9px; font-weight: 900; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 3px; letter-spacing: 0.8px; }
                    
                    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                    th { text-align: left; background: #f8fafc; padding: 12px 14px; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; color: #475569; border-bottom: 2px solid #e2e8f0; }
                    td { padding: 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
                    
                    .totals-container { display: flex; justify-content: flex-end; margin-bottom: 35px; }
                    .totals-table { width: 320px; border-collapse: collapse; }
                    .totals-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
                    .totals-table tr:last-child td { border-bottom: none; font-size: 17px; font-weight: 900; border-top: 2px solid #0f172a; padding-top: 12px; color: #0f172a; }
                    .totals-table td:last-child { text-align: right; font-weight: 800; color: #0f172a; }
                    .totals-table td:first-child { text-align: left; color: #64748b; font-weight: 700; }
                    
                    .footer { margin-top: 40px; text-align: center; color: #64748b; font-size: 11px; border-top: 1px solid #e2e8f0; padding-top: 22px; line-height: 1.6; }
                    .footer strong { color: #0f172a; font-size: 12px; }

                    @media print {
                        .no-print { display: none !important; }
                        body { background: #ffffff !important; padding: 0 !important; font-size: 12px; }
                        .receipt-wrapper { max-width: 100% !important; margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; border-radius: 0 !important; }
                        table { page-break-inside: auto; }
                        tr { page-break-inside: avoid; page-break-after: auto; }
                    }
                </style>
            </head>
            <body>
                <div class="top-action-bar no-print">
                    <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 13px;">
                        <span style="width: 10px; height: 10px; border-radius: 50%; background: #10B981; display: inline-block;"></span>
                        Recibo de Venta / Remisión ${remissionNumber}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button onclick="window.print()" class="btn-print" title="Imprimir o Guardar como PDF">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
                            Imprimir / PDF
                        </button>
                        <button onclick="window.close()" class="btn-close">
                            ✕ Cerrar
                        </button>
                    </div>
                </div>

                <div class="receipt-wrapper">
                    <div class="header">
                        <div class="store-info">
                            <h1>PIXELTECH</h1>
                            <p>Pixel Tech Col SAS • NIT: 901.561.037-7</p>
                            <p>Calle 31 # 13A - 51 Oficina 223 • Bogotá, Colombia</p>
                            <p>Contacto: 300 904 6450 • pixeltechsas@gmail.com</p>
                        </div>
                        <div class="remission-info">
                            <h2>RECIBO / REMISIÓN</h2>
                            <span class="consecutivo">${remissionNumber}</span>
                            <p>${dateStr}</p>
                            <div class="badge">Pedido: ${shortId}</div>
                        </div>
                    </div>

                    <div class="section-title">Información del Comprador y Envío</div>
                    <div class="customer-info">
                        <div class="customer-box"><label>Cliente</label><p>${clientName}</p></div>
                        <div class="customer-box"><label>Teléfono</label><p>${clientPhone}</p></div>
                        <div class="customer-box"><label>Identificación</label><p>${clientDoc}</p></div>
                        <div class="customer-box"><label>Dirección de Entrega</label><p>${address}</p></div>
                    </div>

                    ${notesHtml}

                    <table>
                        <thead>
                            <tr>
                                <th>Descripción del Producto</th>
                                <th style="text-align:center">Cant</th>
                                <th style="text-align:right">Precio Unitario</th>
                                <th style="text-align:right">Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>

                    <div class="totals-container">
                        <table class="totals-table">
                            <tr><td>Subtotal</td><td>$${subtotal.toLocaleString('es-CO')}</td></tr>
                            ${shippingRow}
                            ${taxRow}
                            <tr><td>TOTAL</td><td>$${total.toLocaleString('es-CO')}</td></tr>
                        </table>
                    </div>

                    <div class="footer">
                        Este documento es una remisión comercial de entrega de mercancía y soporte de garantía oficial.<br>
                        <strong>Para solicitud de factura electrónica con código CUFE o soporte técnico, contáctanos al WhatsApp 300 904 6450.</strong>
                    </div>
                </div>
            </body>
            </html>
        `;

        const blob = new Blob([receiptHtml], { type: 'text/html;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);
        const newTab = window.open(blobUrl, '_blank');
        if (newTab) {
            try {
                newTab.opener = null;
            } catch(e) {}
        }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    } catch(e) {
        console.error("Error al abrir recibo:", e);
        if (typeof showActionToast === 'function') {
            showActionToast("⚠️ Error al abrir el recibo: " + e.message, "error");
        } else {
            alert("Error al abrir el recibo: " + e.message);
        }
    }
}
export const printRemission = viewReceipt;

// --- 4. SOLICITAR FACTURA ---
export async function requestInvoice(orderId) {
    if(!confirm("¿Marcar este pedido para Facturación Electrónica?")) return;
    try {
        await updateDoc(doc(db, "orders", orderId), { requiresInvoice: true, billingStatus: 'PENDING', updatedAt: new Date() });
        alert("✅ Solicitud enviada al Módulo de Facturación.");
        location.reload();
    } catch (e) { alert("Error al actualizar: " + e.message); }
}

// --- 5. EXPORTAR AL WINDOW ---
window.viewOrderDetail = viewOrderDetail;
window.viewReceipt = viewReceipt;
window.printRemission = viewReceipt;
window.requestInvoice = requestInvoice;
window.saveAlistamiento = saveAlistamiento; 
window.openDispatchModal = openDispatchModal;
window.confirmDispatch = confirmDispatch;
window.closeOrderModal = closeOrderModal;
window.getDraftSerials = getDraftSerials;
window.hasDraftSerials = hasDraftSerials;
window.saveDraftSerials = saveDraftSerials;
window.clearDraftSerials = clearDraftSerials;
window.discardDraftSerials = discardDraftSerials;

// --- 6. REGISTRAR PAGO MANUAL ---
export async function openPaymentModal(orderId, amountDue) {
    const modal = getEl('payment-modal');
    getEl('pay-modal-order-id').textContent = `Orden #${orderId.slice(0,8).toUpperCase()}`;
    getEl('pay-target-id').value = orderId;
    getEl('pay-amount').value = `$${Number(amountDue).toLocaleString('es-CO')}`;
    getEl('pay-amount').dataset.max = amountDue;
    
    try {
        const selectAcc = getEl('pay-account-select');
        if (selectAcc.options.length <= 1) { 
            selectAcc.innerHTML = '<option value="">Cargando...</option>';
            const accounts = await loadAccountsCached();
            let ops = '<option value="">Seleccione Cuenta...</option>';
            accounts.forEach(acc => ops += `<option value="${acc.id}">${acc.name} (${acc.type})</option>`);
            selectAcc.innerHTML = ops;
        }
    } catch (e) {}

    modal.classList.remove('hidden');
    getEl('pay-amount').oninput = (e) => {
        let val = e.target.value.replace(/\D/g, "");
        e.target.value = val ? "$" + parseInt(val, 10).toLocaleString('es-CO') : "";
    };
}

// =============================================================================
// LÓGICA DEVOLUCIONES
// =============================================================================
async function openRefundModal(orderInput) {
    if (!orderInput) return;

    let o = orderInput;
    if (typeof orderInput === 'string') {
        if (currentOrderData && currentOrderData.id === orderInput) o = currentOrderData; 
        else {
            const snap = await getDoc(doc(db, "orders", orderInput)); 
            if (!snap.exists()) return;
            o = { id: snap.id, ...snap.data() };
            currentOrderData = o; 
        }
    }

    const modal = getEl('refund-modal');
    getEl('refund-modal-order-id').textContent = `Orden #${o.id.slice(0,8).toUpperCase()}`;
    getEl('refund-target-id').value = o.id;
    getEl('refund-amount').value = "$ 0";
    getEl('refund-items-container').innerHTML = '<div class="text-center py-4"><i class="fa-solid fa-circle-notch fa-spin text-gray-300"></i></div>';
    
    try {
        const totalPaid = o.total || 0;
        const alreadyRefunded = o.refundedAmount || 0;
        const moneyAvailable = totalPaid - alreadyRefunded;
        const isPaid = (o.paymentStatus === 'PAID') || (o.status === 'PAGADO') || ((o.amountPaid || 0) >= totalPaid);
        
        getEl('refund-was-paid').value = isPaid ? "true" : "false";

        if (isPaid) {
            getEl('refund-financial-section').classList.remove('hidden');
            getEl('refund-no-payment-msg').classList.add('hidden');
            
            const existingInfo = getEl('refund-financial-section').querySelector('.info-badge');
            if(existingInfo) existingInfo.remove();
            
            const infoDiv = document.createElement('div');
            infoDiv.className = "info-badge mb-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-[10px] text-blue-800 flex justify-between";
            infoDiv.innerHTML = `<span><strong>Total:</strong> $${totalPaid.toLocaleString()}</span><span><strong>Devuelto:</strong> $${alreadyRefunded.toLocaleString()}</span><span class="font-black text-brand-cyan"><strong>Disponible:</strong> $${moneyAvailable.toLocaleString()}</span>`;
            getEl('refund-financial-section').prepend(infoDiv);

            const selectAcc = getEl('refund-account-select');
            if (selectAcc.options.length <= 1) {
                const accounts = await loadAccountsCached();
                let html = '<option value="">Seleccione Cuenta de Origen...</option>';
                accounts.forEach(acc => html += `<option value="${acc.id}">${acc.name} (Saldo: $${(acc.balance || 0).toLocaleString()})</option>`);
                selectAcc.innerHTML = html;
            }
        } else {
            getEl('refund-financial-section').classList.add('hidden');
            getEl('refund-no-payment-msg').classList.remove('hidden');
        }

        const items = o.items || [];
        getEl('refund-items-container').innerHTML = "";
        let hasItemsToReturn = false;

        // Sincronizar seriales vinculados a esta orden desde product_serials si hiciera falta
        try {
            const linkedSerialsSnap = await getDocs(query(collection(db, "product_serials"), where("orderId", "==", o.id)));
            if (!linkedSerialsSnap.empty) {
                const serialsByProd = {};
                linkedSerialsSnap.forEach(d => {
                    const data = d.data();
                    if (data.status === 'DISPATCHED') {
                        if (!serialsByProd[data.productId]) serialsByProd[data.productId] = [];
                        serialsByProd[data.productId].push(data.serialNumber);
                    }
                });
                items.forEach(item => {
                    if ((!item.sns || item.sns.length === 0) && serialsByProd[item.id]) {
                        item.sns = serialsByProd[item.id];
                    }
                });
            }
        } catch(err) {
            console.warn("No se pudieron precargar seriales vinculados a la orden:", err);
        }

        items.forEach((item, index) => {
            const img = item.mainImage || item.image || '/img/placeholder-tech.webp';
            const originalQty = item.quantity || 0;
            const alreadyReturnedQty = item.returnedQty || 0; 
            const availableQty = originalQty - alreadyReturnedQty;

            if (availableQty <= 0) return; 
            hasItemsToReturn = true;

            const itemSns = Array.isArray(item.sns) ? item.sns : [];
            const returnedSns = Array.isArray(item.returnedSns) ? item.returnedSns : [];
            const activeSns = itemSns.filter(sn => sn && !isNoSerial(sn) && !returnedSns.includes(sn));
            const hasSerials = activeSns.length > 0;
            
            let serialsHtml = '';
            if (hasSerials) {
                serialsHtml = `
                    <div class="refund-serials-box mt-3 pt-2.5 border-t border-gray-100 hidden">
                        <div class="flex items-center justify-between mb-1.5 px-0.5">
                            <span class="text-[9px] font-black uppercase text-gray-500 tracking-wider flex items-center gap-1.5">
                                <i class="fa-solid fa-barcode text-brand-cyan text-[10px]"></i> Seriales que regresan a bodega:
                            </span>
                            <span class="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-50 text-brand-cyan border border-cyan-100 serials-counter">
                                ${availableQty} selec.
                            </span>
                        </div>
                        <div class="flex flex-wrap gap-1.5 serials-chips-container">
                            ${activeSns.map((sn, sIdx) => `
                                <label class="refund-sn-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono font-black cursor-pointer transition-all select-none bg-slate-100 border-gray-200 text-gray-700 hover:bg-slate-200" title="Serial ${sn}">
                                    <input type="checkbox" class="refund-sn-check accent-brand-cyan w-3.5 h-3.5 rounded cursor-pointer" data-item-index="${index}" value="${sn}" ${sIdx < availableQty ? 'checked' : ''}>
                                    <span>${sn}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            const div = document.createElement('div');
            div.className = "refund-item-row p-3.5 border border-gray-100 rounded-2xl hover:bg-slate-50/70 transition bg-white shadow-2xs";
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="flex items-center h-full">
                        <input type="checkbox" class="refund-check w-5 h-5 text-red-500 rounded border-gray-300 focus:ring-red-500 cursor-pointer" data-index="${index}">
                    </div>
                    <img src="${img}" class="w-11 h-11 rounded-xl object-contain bg-slate-50 border border-gray-200 p-1 shrink-0">
                    <div class="flex-grow min-w-0">
                        <p class="text-xs font-black text-brand-black uppercase truncate">${item.name}</p>
                        <div class="flex items-center gap-2 mt-0.5">
                            <p class="text-[10px] text-gray-400 font-bold">$${(item.price || 0).toLocaleString('es-CO')} c/u</p>
                            ${item.color ? `<span class="text-[8px] font-black uppercase px-1.5 py-0.2 rounded bg-gray-100 text-gray-600">${item.color}</span>` : ''}
                            ${item.capacity ? `<span class="text-[8px] font-black uppercase px-1.5 py-0.2 rounded bg-cyan-50 text-brand-cyan">${item.capacity}</span>` : ''}
                            ${alreadyReturnedQty > 0 ? `<span class="text-[8px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">Devueltos: ${alreadyReturnedQty}</span>` : ''}
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider">Cant.</span>
                        <input type="number" min="1" max="${availableQty}" value="${availableQty}" class="refund-qty w-12 p-2 text-center text-xs font-black border border-gray-200 rounded-xl outline-none focus:border-red-500 disabled:opacity-50 disabled:bg-slate-50 transition" disabled>
                    </div>
                </div>
                ${serialsHtml}
            `;
            getEl('refund-items-container').appendChild(div);

            const checkbox = div.querySelector('.refund-check');
            const qtyInput = div.querySelector('.refund-qty');
            const serialsBox = div.querySelector('.refund-serials-box');
            const snChecks = div.querySelectorAll('.refund-sn-check');
            const counterLabel = div.querySelector('.serials-counter');

            const updateChipStyles = () => {
                let checkedCount = 0;
                snChecks.forEach(ch => {
                    const label = ch.closest('label');
                    if (ch.checked) {
                        checkedCount++;
                        if (label) {
                            label.className = "refund-sn-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono font-black cursor-pointer transition-all select-none bg-cyan-50 text-brand-cyan border-cyan-300 shadow-2xs";
                        }
                    } else {
                        if (label) {
                            label.className = "refund-sn-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono font-black cursor-pointer transition-all select-none bg-slate-100 border-gray-200 text-gray-500 hover:bg-slate-200 opacity-60";
                        }
                    }
                });
                if (counterLabel) {
                    counterLabel.textContent = `${checkedCount} selec.`;
                }
            };

            const syncChipsWithQty = (targetQty) => {
                let count = 0;
                snChecks.forEach(ch => {
                    if (count < targetQty) {
                        ch.checked = true;
                        count++;
                    } else {
                        ch.checked = false;
                    }
                });
                updateChipStyles();
            };

            checkbox.addEventListener('change', () => {
                qtyInput.disabled = !checkbox.checked;
                div.classList.toggle('border-red-200', checkbox.checked);
                div.classList.toggle('bg-red-50/20', checkbox.checked);
                
                if (serialsBox) {
                    serialsBox.classList.toggle('hidden', !checkbox.checked);
                    if (checkbox.checked) {
                        syncChipsWithQty(parseInt(qtyInput.value) || 1);
                    }
                }

                if (isPaid) recalcRefundTotal(items);
            });

            qtyInput.addEventListener('input', () => {
                let val = parseInt(qtyInput.value) || 1;
                if (val > availableQty) { val = availableQty; qtyInput.value = val; }
                if (val < 1) { val = 1; qtyInput.value = 1; }
                if (hasSerials) syncChipsWithQty(val);
                if (isPaid) recalcRefundTotal(items);
            });

            snChecks.forEach(ch => {
                ch.addEventListener('change', () => {
                    const checkedTotal = div.querySelectorAll('.refund-sn-check:checked').length;
                    if (checkedTotal > 0) {
                        qtyInput.value = checkedTotal;
                    } else {
                        ch.checked = true;
                        qtyInput.value = 1;
                    }
                    updateChipStyles();
                    if (isPaid) recalcRefundTotal(items);
                });
            });
        });

        if (!hasItemsToReturn) {
            getEl('refund-items-container').innerHTML = '<div class="text-center p-4 bg-green-50 rounded-xl text-green-700 text-xs font-bold border border-green-100"><i class="fa-solid fa-check-circle"></i> Todos los productos de esta orden ya han sido devueltos.</div>';
        }
    } catch (e) { console.error(e); }
    modal.classList.remove('hidden');
}

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
    getEl('refund-amount').value = `$ ${total.toLocaleString('es-CO')}`;
}

const refundForm = getEl('refund-form');
if (refundForm) {
    refundForm.onsubmit = async (e) => {
        e.preventDefault();
        const btn = refundForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const orderId = getEl('refund-target-id').value;
        const wasPaid = getEl('refund-was-paid').value === "true";
        const reason = getEl('refund-reason').value || "Devolución Cliente";
        
        let accountId = null;
        let amount = 0;

        if (wasPaid) {
            accountId = getEl('refund-account-select').value;
            const amountStr = getEl('refund-amount').value.replace(/[^0-9]/g, "");
            amount = parseInt(amountStr) || 0;
            if (!accountId && amount > 0) { alert("Selecciona una cuenta de origen."); btn.disabled = false; btn.innerHTML = originalText; return; }
        }

        try {
            let itemsToRestoreStock = [];
            let serialsToRelease = [];
            let finalOrderStatus = '';

            await runTransaction(db, async (t) => {
                const orderRef = doc(db, "orders", orderId);
                const orderDoc = await t.get(orderRef);
                if(!orderDoc.exists()) throw "Orden no encontrada";
                
                const oData = orderDoc.data();
                
                if (wasPaid && amount > 0) {
                    const currentRefunded = oData.refundedAmount || 0;
                    const maxRefundable = (oData.total || 0) - currentRefunded;
                    if (amount > maxRefundable) throw `El monto excede el saldo disponible ($${maxRefundable.toLocaleString()}).`;
                }

                const originalItems = oData.items || [];
                const updatedItems = JSON.parse(JSON.stringify(originalItems)); 
                
                let totalOriginalQty = 0;
                let totalReturnedQtySoFar = 0;

                document.querySelectorAll('.refund-item-row').forEach(row => {
                    const check = row.querySelector('.refund-check');
                    if (check && check.checked) {
                        const idx = parseInt(check.dataset.index);
                        const qtyToReturn = parseInt(row.querySelector('.refund-qty').value);
                        
                        if (qtyToReturn > 0) {
                            updatedItems[idx].returnedQty = (updatedItems[idx].returnedQty || 0) + qtyToReturn;
                            itemsToRestoreStock.push({ id: updatedItems[idx].id, qty: qtyToReturn, color: updatedItems[idx].color, capacity: updatedItems[idx].capacity });

                            // Recoger seriales seleccionados para liberar en esta fila
                            const checkedSnInputs = row.querySelectorAll('.refund-sn-check:checked');
                            const rowReturnedSns = Array.from(checkedSnInputs).map(i => i.value.trim()).filter(Boolean);

                            if (rowReturnedSns.length > 0) {
                                updatedItems[idx].returnedSns = [
                                    ...(updatedItems[idx].returnedSns || []),
                                    ...rowReturnedSns
                                ];
                                serialsToRelease.push(...rowReturnedSns);
                            } else if (updatedItems[idx].sns && Array.isArray(updatedItems[idx].sns)) {
                                // Fallback por si la UI no tenía chips pero el ítem tiene sns:
                                const prevRet = updatedItems[idx].returnedSns || [];
                                const avail = updatedItems[idx].sns.filter(s => !isNoSerial(s) && !prevRet.includes(s));
                                const autoSns = avail.slice(0, qtyToReturn);
                                if (autoSns.length > 0) {
                                    updatedItems[idx].returnedSns = [...prevRet, ...autoSns];
                                    serialsToRelease.push(...autoSns);
                                }
                            }
                        }
                    }
                });

                updatedItems.forEach(i => {
                    totalOriginalQty += (i.quantity || 0);
                    totalReturnedQtySoFar += (i.returnedQty || 0);
                });

                let newStatus = oData.status;
                if (totalReturnedQtySoFar > 0) {
                    newStatus = (totalReturnedQtySoFar >= totalOriginalQty) ? 'DEVUELTO' : 'DEVOLUCION_PARCIAL';
                }
                finalOrderStatus = newStatus;

                if (wasPaid && amount > 0) {
                    const accRef = doc(db, "accounts", accountId);
                    const accDoc = await t.get(accRef);
                    if (!accDoc.exists()) throw "Cuenta no existe";
                    const currentBalance = accDoc.data().balance || 0;
                    if (currentBalance < amount) throw "Saldo insuficiente en cuenta";

                    t.update(accRef, { balance: currentBalance - amount });

                    const expenseRef = doc(collection(db, "expenses"));
                    t.set(expenseRef, { amount: amount, category: "Devoluciones", description: `Reembolso ${newStatus === 'DEVUELTO' ? 'Total' : 'Parcial'} Orden #${orderId.slice(0,8)}`, paymentMethod: accDoc.data().name, supplierName: oData.userName || "Cliente", date: serverTimestamp(), createdAt: serverTimestamp(), type: 'EXPENSE', orderId: orderId, isRefund: true });
                }

                t.update(orderRef, { items: updatedItems, status: newStatus, refundedAmount: (oData.refundedAmount || 0) + amount, hasRefunds: true, lastRefundDate: serverTimestamp(), refundReason: reason, updatedAt: serverTimestamp() });
            });

            if (itemsToRestoreStock.length > 0) {
                for (const item of itemsToRestoreStock) {
                    await adjustStock(item.id, item.qty, item.color, item.capacity, 'DEVOLUCION_CANCELACION', `Devolución de stock por reembolso en pedido #${orderId.slice(0, 8)}`);
                }
            }

            // 🔥 Liberar seriales legítimos a AVAILABLE o eliminar regularizados en devolución
            let countUpdated = 0;
            let countDeleted = 0;

            if (serialsToRelease.length > 0) {
                try {
                    const chunks = [];
                    for (let i = 0; i < serialsToRelease.length; i += 30) {
                        chunks.push(serialsToRelease.slice(i, i + 30));
                    }
                    const batchSerials = writeBatch(db);

                    for (const chunk of chunks) {
                        const q = query(
                            collection(db, "product_serials"),
                            where("serialNumber", "in", chunk)
                        );
                        const snap = await getDocs(q);
                        snap.forEach(docSnap => {
                            const data = docSnap.data();
                            if (data.orderId === orderId || !data.orderId || data.status === 'DISPATCHED') {
                                if (isRegularizedSerial(data)) {
                                    // Regularizado en alistamiento: se elimina para evitar asignarlo al producto equivocado
                                    batchSerials.delete(docSnap.ref);
                                    countDeleted++;
                                } else {
                                    // Compra legítima: vuelve a disponible
                                    batchSerials.update(docSnap.ref, {
                                        status: 'AVAILABLE',
                                        orderId: null,
                                        orderInternalNumber: null,
                                        clientName: null,
                                        clientPhone: null,
                                        dispatchedAt: null,
                                        returnedAt: serverTimestamp(),
                                        updatedAt: serverTimestamp()
                                    });
                                    countUpdated++;
                                }
                            }
                        });
                    }

                    if (countUpdated > 0 || countDeleted > 0) {
                        await batchSerials.commit();
                        console.log(`✅ [Devolución] Seriales procesados: ${countUpdated} liberados a AVAILABLE, ${countDeleted} regularizados eliminados.`);
                    }
                } catch (errSerials) {
                    console.error("Error liberando/eliminando seriales en devolución:", errSerials);
                }
            }

            // Si la orden quedó completamente DEVUELTA, liberar cualquier serial residual vinculado o eliminar si fue regularizado
            if (finalOrderStatus === 'DEVUELTO') {
                try {
                    const remainingLinkedSnap = await getDocs(query(collection(db, "product_serials"), where("orderId", "==", orderId)));
                    if (!remainingLinkedSnap.empty) {
                        const b = writeBatch(db);
                        remainingLinkedSnap.forEach(d => {
                            const data = d.data();
                            if (isRegularizedSerial(data)) {
                                b.delete(d.ref);
                                countDeleted++;
                            } else {
                                b.update(d.ref, {
                                    status: 'AVAILABLE',
                                    orderId: null,
                                    orderInternalNumber: null,
                                    clientName: null,
                                    clientPhone: null,
                                    dispatchedAt: null,
                                    returnedAt: serverTimestamp(),
                                    updatedAt: serverTimestamp()
                                });
                                countUpdated++;
                            }
                        });
                        await b.commit();
                    }
                } catch(e) {
                    console.warn("Error en cleanup de seriales para devolución completa:", e);
                }
            }

            let serialMsg = '';
            if (countUpdated > 0 || countDeleted > 0) {
                const parts = [];
                if (countUpdated > 0) parts.push(`${countUpdated} liberado(s) a disponible`);
                if (countDeleted > 0) parts.push(`${countDeleted} regularizado(s) eliminado(s)`);
                serialMsg = `\nSeriales: ${parts.join(', ')}.`;
            }
            alert(`✅ Devolución procesada correctamente.${serialMsg}`);
            currentOrderData = null; accountsCache = null;
            getEl('refund-modal').classList.add('hidden'); 
            getEl('order-modal').classList.add('hidden');

            if (window.switchTab) window.switchTab(window.currentTab || 'ALL');
            else if (window.renderOrdersMemory) window.renderOrdersMemory();

        } catch (e) { alert("Error: " + (e.message || e)); } finally { btn.disabled = false; btn.innerHTML = originalText; }
    };
}

const payForm = document.getElementById('payment-form');
if (payForm) {
    payForm.onsubmit = async (e) => {
        e.preventDefault();
        const btn = payForm.querySelector('button');
        const originalText = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const orderId = document.getElementById('pay-target-id').value;
        const accId = document.getElementById('pay-account-select').value;
        const amount = parseInt(document.getElementById('pay-amount').value.replace(/\D/g, ""), 10);
        const maxAmount = parseInt(document.getElementById('pay-amount').dataset.max || 0);

        if (!accId || amount <= 0) { alert("Verifica la cuenta y el monto."); btn.disabled = false; btn.innerHTML = originalText; return; }
        if (amount > maxAmount) { alert(`El monto excede el saldo pendiente ($${maxAmount.toLocaleString()}).`); btn.disabled = false; btn.innerHTML = originalText; return; }

        try {
            await runTransaction(db, async (t) => {
                const orderRef = doc(db, "orders", orderId);
                const orderDoc = await t.get(orderRef);
                if (!orderDoc.exists()) throw "La orden no existe.";
                const oData = orderDoc.data();

                const currentPending = (oData.total || 0) - (oData.amountPaid || 0) - (oData.refundedAmount || 0);
                if (amount > currentPending) throw `El monto excede el saldo real pendiente ($${currentPending.toLocaleString()}).`;

                const accRef = doc(db, "accounts", accId);
                const accDoc = await t.get(accRef);
                if (!accDoc.exists()) throw "La cuenta no existe.";

                t.update(accRef, { balance: (accDoc.data().balance || 0) + amount });

                const expenseRef = doc(collection(db, "expenses"));
                t.set(expenseRef, { amount: amount, category: "Ingreso Ventas Manual", description: `Cobro Orden #${orderId.slice(0,8)}`, paymentMethod: accDoc.data().name, supplierName: oData.userName || "Cliente", date: serverTimestamp(), createdAt: serverTimestamp(), type: 'INCOME', orderId: orderId });

                const newAmountPaid = (oData.amountPaid || 0) + amount;
                const isFullyPaid = newAmountPaid >= ((oData.total || 0) - (oData.refundedAmount || 0));
                
                let nextStatus = oData.status; 
                if (isFullyPaid && ['PENDIENTE', 'PENDIENTE_PAGO', 'CANCELADO'].includes(oData.status)) nextStatus = 'PAGADO';

                t.update(orderRef, { status: nextStatus, paymentStatus: isFullyPaid ? 'PAID' : 'PARTIAL', amountPaid: newAmountPaid, paymentMethod: oData.paymentMethod || 'MANUAL', paymentAccountId: accId, paymentDate: serverTimestamp(), updatedAt: serverTimestamp() });
            });

            alert("✅ Pago registrado exitosamente.");
            document.getElementById('payment-modal').classList.add('hidden');
            currentOrderData = null; accountsCache = null;

        } catch (error) { alert("Error: " + (error.message || error)); } finally { btn.disabled = false; btn.innerHTML = originalText; }
    };
}

// --- 6. GENERAR RÓTULOS DE ENVÍO ---
export function generateLabels(ordersArray) {
    const w = window.open('', '_blank', 'width=900,height=800');
    
    const chunkArray = (arr, size) => {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    };

    const pagesOfOrders = chunkArray(ordersArray, 4);

    const allPagesHtml = pagesOfOrders.map(pageGroup => {
        const labelsHtml = pageGroup.map(o => {
            const clientName = o.shippingData?.name || o.buyerInfo?.name || o.userName || '';
            const clientDoc = o.shippingData?.clientDoc || o.clientDoc || o.buyerInfo?.document || '';
            const clientPhone = o.shippingData?.phone || o.phone || o.buyerInfo?.phone || '';
            
            let address = o.shippingData?.address || o.address || '';
            let city = o.shippingData?.city || o.city || '';
            let dept = o.shippingData?.department || '';

            return `
            <div class="label-box">
                <div class="header-logo">
                    <img src="https://pixeltechcol.com/img/logo.webp" alt="PixelTech">
                </div>
                <div class="company-info">
                    <div>
                        PIXEL TECH COL SAS<br>
                        NIT: 901.561.037-7<br>
                        CL. 31 #13A-51 OFICINA 223<br>
                        PIXELTECHSAS@GMAIL.COM
                    </div>
                    <div style="text-align: right;">
                        (PIXELTECH.COL)<br>
                        TEL: 300 904 6450<br>
                        BOGOTÁ
                    </div>
                </div>
                
                <h3 class="dest-title">DESTINATARIO</h3>
                
                <div class="dest-info">
                    <div class="info-line">
                        <strong>NOMBRE:</strong> <span>${clientName.toUpperCase()}</span>
                    </div>
                    
                    <div class="info-row">
                        <div class="info-line" style="width: 55%;">
                            <strong>CC/NIT:</strong> <span>${clientDoc}</span>
                        </div>
                        <div class="info-line" style="width: 45%;">
                            <strong>TEL:</strong> <span>${clientPhone}</span>
                        </div>
                    </div>
                    
                    <div class="info-line">
                        <strong>DIRECCIÓN:</strong> <span>${address.toUpperCase()}</span>
                    </div>
                    
                    <div class="info-line">
                        <strong>CIUDAD:</strong> <span>${city.toUpperCase()} ${dept ? '- ' + dept.toUpperCase() : ''}</span>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        return `<div class="print-page">${labelsHtml}</div>`;
        
    }).join(''); 

    w.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Impresión de Rótulos</title>
            <style>
                @page {
                    size: letter;
                    margin: 8mm; 
                }
                
                body { 
                    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
                    margin: 0; 
                    padding: 0; 
                    background: white; 
                }
                
                .print-page {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr); 
                    grid-template-rows: repeat(2, 1fr);    
                    gap: 8mm; 
                    width: 100%;
                    height: 255mm; 
                    box-sizing: border-box;
                    page-break-after: always; 
                }

                .print-page:last-child {
                    page-break-after: auto; 
                }
                
                .label-box { 
                    border: 3px solid #111827; 
                    border-radius: 16px; 
                    padding: 25px; 
                    box-sizing: border-box; 
                    color: #111827;
                    display: flex;
                    flex-direction: column;
                    justify-content: flex-start; 
                    overflow: hidden; 
                }
                
                .header-logo { text-align: center; margin-bottom: 25px; }
                .header-logo img { height: 60px; object-fit: contain; }
                
                .company-info { 
                    display: flex; 
                    justify-content: space-between; 
                    font-size: 11px; 
                    font-weight: 900; 
                    margin-bottom: 35px; 
                    line-height: 1.5;
                }
                
                .dest-title { 
                    font-size: 18px; 
                    font-weight: 900; 
                    margin: 0 0 15px 0; 
                }
                
                .dest-info { font-size: 14px; line-height: 1.6; }
                
                /* 🔥 CORRECCIÓN DE CORTES (TEXTO MULTILÍNEA) 🔥 */
                .info-line { 
                    margin-bottom: 12px; 
                    border-bottom: 2px solid #111827; 
                    display: flex; 
                    align-items: flex-start; /* Cambiado a flex-start para que el título no se baje */
                    padding-bottom: 3px;
                }
                .info-line strong { 
                    font-weight: 900; 
                    margin-right: 8px; 
                    font-size: 13px; 
                    white-space: nowrap; /* El título "DIRECCIÓN:" nunca se rompe */
                    margin-top: 2px;
                }
                .info-line span { 
                    flex-grow: 1; 
                    font-weight: 700; 
                    font-size: 13px; 
                    text-align: left; 
                    white-space: normal; /* 🔥 Permite múltiples líneas */
                    word-break: break-word; /* 🔥 Rompe la palabra si es exageradamente larga */
                    line-height: 1.2;
                }
                .info-row { display: flex; gap: 15px; }
            </style>
        </head>
        <body>
            ${allPagesHtml}
            <script>
                setTimeout(() => { window.print(); window.close(); }, 800);
            <\/script>
        </body>
        </html>
    `);
    w.document.close();
}

// =============================================================================
// 7. LÓGICA DE ACCIONES MASIVAS
// =============================================================================

let currentBulkOrdersToPay = []; 
let currentBulkOrdersToDispatch = [];
let currentBulkOrdersToPack = [];

// --- A. ALISTAMIENTO MASIVO ---
export async function openBulkPackingModal() {
    const checkboxes = document.querySelectorAll('.order-cb:checked');
    if(checkboxes.length === 0) return alert("⚠️ Selecciona al menos un pedido de la tabla.");

    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    currentBulkOrdersToPack = [];
    let omittedCount = 0;

    const cachedOrders = window.adminOrdersCache || [];

    for (const id of selectedIds) {
        const o = cachedOrders.find(order => order.id === id);
        if (o) {
            if (['ALISTADO', 'DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'CANCELADO', 'RECHAZADO', 'DEVUELTO', 'DEVOLUCION_PARCIAL'].includes(o.status)) {
                omittedCount++;
                continue;
            }
            currentBulkOrdersToPack.push(o);
        }
    }

    getEl('bulk-packing-modal').classList.remove('hidden');
    const btnConfirm = getEl('btn-confirm-bulk-pack');

    getEl('bulk-pack-valid').textContent = currentBulkOrdersToPack.length;

    const warningEl = getEl('bulk-pack-warning');
    if (omittedCount > 0) {
        warningEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Se omitieron ${omittedCount} pedidos porque ya estaban alistados, despachados o cancelados.`;
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }

    if (currentBulkOrdersToPack.length === 0) {
        btnConfirm.disabled = true;
        btnConfirm.innerHTML = "No hay pedidos válidos";
        return; 
    }

    btnConfirm.disabled = false;
    btnConfirm.innerHTML = '<i class="fa-solid fa-box-open"></i> Confirmar Alistamiento Masivo';
}

export async function processBulkPacking() {
    const btn = getEl('btn-confirm-bulk-pack');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

    try {
        let batch = writeBatch(db); 
        let opsCount = 0;

        for (const order of currentBulkOrdersToPack) {
            const oRef = doc(db, "orders", order.id);
            // 🔥 Trigger al Store
            batch.update(oRef, {
                status: 'ALISTADO',
                updatedAt: serverTimestamp()
            });
            opsCount++;

            if (opsCount >= 450) {
                await batch.commit();
                batch = writeBatch(db); 
                opsCount = 0;
            }
        }

        if (opsCount > 0) await batch.commit();

        alert(`✅ ${currentBulkOrdersToPack.length} pedidos marcados como ALISTADOS.`);
        getEl('bulk-packing-modal').classList.add('hidden');
        document.querySelectorAll('.order-cb').forEach(cb => cb.checked = false);

    } catch (e) {
        console.error(e);
        alert("Error alistando: " + (e.message || e));
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}

// --- B. COBRO MASIVO ---
export async function openBulkPaymentModal() {
    const checkboxes = document.querySelectorAll('.order-cb:checked');
    if(checkboxes.length === 0) return alert("⚠️ Selecciona al menos un pedido.");
    
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    currentBulkOrdersToPay = [];
    let totalToCollect = 0;
    let omittedCount = 0;

    const cachedOrders = window.adminOrdersCache || [];

    for (const id of selectedIds) {
        const o = cachedOrders.find(order => order.id === id);
        if (o) {
            const total = Number(o.total) || 0;
            const paid = Number(o.amountPaid) || 0;
            const refunded = Number(o.refundedAmount) || 0;
            let pending = total - paid - refunded;
            
            if (pending > 0 && !['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) {
                currentBulkOrdersToPay.push({ pendingAmt: pending, ...o });
                totalToCollect += pending;
            } else {
                omittedCount++;
            }
        }
    }

    getEl('bulk-payment-modal').classList.remove('hidden');

    const warningEl = getEl('bulk-pay-warning');
    if (omittedCount > 0) {
        warningEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Se omitieron ${omittedCount} pedidos porque ya están 100% pagados o fueron cancelados.`;
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }

    if (currentBulkOrdersToPay.length === 0) {
        getEl('bulk-pay-total').textContent = "$0";
        getEl('btn-confirm-bulk-pay').disabled = true;
        return alert("❌ Ninguno de los pedidos seleccionados tiene saldo pendiente por cobrar.");
    }

    getEl('bulk-pay-count').textContent = currentBulkOrdersToPay.length;
    getEl('bulk-pay-total').textContent = `$${totalToCollect.toLocaleString('es-CO')}`;
    
    const selectAcc = getEl('bulk-pay-account-select');
    const accounts = await loadAccountsCached();
    let ops = '<option value="">Seleccione Cuenta...</option>';
    accounts.forEach(acc => {
        ops += `<option value="${acc.id}">${acc.name} (${acc.type})</option>`;
    });
    selectAcc.innerHTML = ops;
    
    getEl('btn-confirm-bulk-pay').disabled = false;
}

export async function processBulkPayment() {
    const accId = getEl('bulk-pay-account-select').value;
    if (!accId) return alert("⚠️ Debes seleccionar una cuenta de destino.");

    const btn = getEl('btn-confirm-bulk-pay');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando Transacción...';

    try {
        await runTransaction(db, async (t) => {
            const accRef = doc(db, "accounts", accId);
            const accDoc = await t.get(accRef);
            if (!accDoc.exists()) throw "La cuenta seleccionada no existe.";
            
            const orderRefs = currentBulkOrdersToPay.map(o => doc(db, "orders", o.id));
            const oSnaps = await Promise.all(orderRefs.map(ref => t.get(ref)));

            const orderDocsToUpdate = [];
            let totalAmountCollected = 0;

            oSnaps.forEach((oSnap) => {
                if(oSnap.exists()) {
                    const oData = oSnap.data();
                    const pending = (oData.total || 0) - (oData.amountPaid || 0) - (oData.refundedAmount || 0);
                    if (pending > 0) {
                        orderDocsToUpdate.push({ ref: oSnap.ref, data: oData, payAmt: pending });
                        totalAmountCollected += pending;
                    }
                }
            });

            if (totalAmountCollected <= 0) throw "No hay saldos por cobrar confirmados por el servidor.";

            const newBalance = (accDoc.data().balance || 0) + totalAmountCollected;
            t.update(accRef, { balance: newBalance });

            for (const o of orderDocsToUpdate) {
                const newAmountPaid = (o.data.amountPaid || 0) + o.payAmt;
                
                let nextStatus = o.data.status; 
                if (['PENDIENTE', 'PENDIENTE_PAGO'].includes(o.data.status)) {
                    nextStatus = 'PAGADO';
                }

                // 🔥 Trigger al Store (updatedAt)
                t.update(o.ref, {
                    status: nextStatus,
                    paymentStatus: 'PAID',
                    amountPaid: newAmountPaid, 
                    paymentMethod: o.data.paymentMethod || 'MANUAL', 
                    paymentAccountId: accId,
                    paymentDate: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });

                const expenseRef = doc(collection(db, "expenses"));
                t.set(expenseRef, {
                    amount: o.payAmt,
                    category: "Ingreso Ventas Manual (Masivo)",
                    description: `Cobro Masivo Orden #${o.ref.id.slice(0,8)}`,
                    paymentMethod: accDoc.data().name,
                    supplierName: o.data.userName || "Cliente",
                    date: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    type: 'INCOME',
                    orderId: o.ref.id
                });
            }
        });

        alert("✅ Cobro masivo registrado exitosamente.");
        getEl('bulk-payment-modal').classList.add('hidden');
        document.querySelectorAll('.order-cb').forEach(cb => cb.checked = false);

    } catch (e) {
        console.error(e);
        alert("Error procesando cobros: " + (e.message || e));
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}

// --- C. DESPACHO MASIVO ---
export async function openBulkDispatchModal() {
    const checkboxes = document.querySelectorAll('.order-cb:checked');
    if(checkboxes.length === 0) return alert("⚠️ Selecciona al menos un pedido.");

    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    currentBulkOrdersToDispatch = [];
    let omittedCount = 0;

    const listContainer = getEl('bulk-dispatch-list');
    getEl('bulk-dispatch-modal').classList.remove('hidden');

    const cachedOrders = window.adminOrdersCache || [];
    let htmlList = '';

    for (const id of selectedIds) {
        const o = cachedOrders.find(order => order.id === id);
        if (o) {
            if (['DESPACHADO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) {
                omittedCount++;
                continue; 
            }

            currentBulkOrdersToDispatch.push(o);
            
            const clientName = o.buyerInfo?.name || o.userName || 'Cliente';
            const orderNum = o.internalOrderNumber ? `#${o.internalOrderNumber}` : o.id.slice(0,6);
            
            htmlList += `
            <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-3 bg-slate-50 border border-gray-100 rounded-xl mb-2">
                <div>
                    <p class="font-black text-xs text-brand-black">${orderNum} - ${clientName.toUpperCase()}</p>
                    <p class="text-[9px] font-bold text-gray-400">${o.shippingData?.city || 'Ciudad no definida'}</p>
                </div>
                <input type="text" id="bulk-track-${o.id}" placeholder="Escanear/Escribir Guía" class="w-full md:w-48 bg-white border border-gray-200 text-xs font-mono font-bold p-2 rounded-lg outline-none focus:border-blue-500">
            </div>
            `;
        }
    }

    const warningEl = getEl('bulk-disp-warning');
    if (omittedCount > 0) {
        warningEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Se omitieron ${omittedCount} pedidos porque ya fueron despachados, entregados o cancelados.`;
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }

    if (currentBulkOrdersToDispatch.length === 0) {
        listContainer.innerHTML = `<p class="text-center text-red-500 font-bold py-4">❌ Ninguno de los pedidos seleccionados es válido para despachar.</p>`;
        getEl('btn-confirm-bulk-dispatch').disabled = true;
        return;
    }

    getEl('btn-confirm-bulk-dispatch').disabled = false;
    getEl('bulk-disp-count').textContent = currentBulkOrdersToDispatch.length;
    listContainer.innerHTML = htmlList;
}

export async function processBulkDispatch() {
    const carrier = getEl('bulk-dispatch-carrier').value;
    if (!carrier) return alert("⚠️ Por favor, selecciona una Transportadora Global.");

    const updatesToApply = [];
    for (const order of currentBulkOrdersToDispatch) {
        const trackInput = getEl(`bulk-track-${order.id}`);
        const trackingNum = trackInput ? trackInput.value.trim() : "";
        
        if (!trackingNum) {
            return alert(`⚠️ Te falta asignar el número de guía para la orden ${order.internalOrderNumber || order.id.slice(0,6)}.`);
        }
        
        updatesToApply.push({ id: order.id, tracking: trackingNum });
    }

    const btn = getEl('btn-confirm-bulk-dispatch');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Despachando...';

    try {
        let batch = writeBatch(db); 
        let opsCount = 0;

        for (const update of updatesToApply) {
            const oRef = doc(db, "orders", update.id);
            // 🔥 Trigger al Store
            batch.update(oRef, {
                status: 'DESPACHADO', 
                shippingCarrier: carrier, 
                shippingTracking: update.tracking, 
                shippedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            opsCount++;

            if (opsCount >= 450) {
                await batch.commit();
                batch = writeBatch(db); 
                opsCount = 0;
            }
        }

        if (opsCount > 0) await batch.commit();

        alert("🚚 ¡Despacho Masivo Exitoso!");
        getEl('bulk-dispatch-modal').classList.add('hidden');
        document.querySelectorAll('.order-cb').forEach(cb => cb.checked = false); 

    } catch (e) {
        console.error(e);
        alert("Error despachando: " + (e.message || e));
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}

// --- EXPORTAR AL WINDOW ---
window.generateLabels = generateLabels;
window.openBulkPaymentModal = openBulkPaymentModal;
window.processBulkPayment = processBulkPayment;
window.openBulkDispatchModal = openBulkDispatchModal;
window.processBulkDispatch = processBulkDispatch;
window.openBulkPackingModal = openBulkPackingModal;
window.processBulkPacking = processBulkPacking;
window.openPaymentModal = openPaymentModal;
window.printSelectedLabels = (ordersArray) => {
    if (ordersArray && Array.isArray(ordersArray) && ordersArray.length > 0) {
        generateLabels(ordersArray);
        return;
    }
    const checkboxes = document.querySelectorAll('.order-cb:checked');
    if (checkboxes.length === 0) {
        alert("⚠️ Por favor, selecciona al menos un pedido marcando las casillas de la tabla.");
        return;
    }
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    const cache = window.adminOrdersCache || [];
    const selectedOrders = cache.filter(o => selectedIds.includes(o.id));
    if (selectedOrders.length === 0) {
        alert("⚠️ No se encontraron los datos de los pedidos seleccionados en la memoria.");
        return;
    }
    generateLabels(selectedOrders);
};

window.recalcMLFinances = async function(orderId) {
    const btn = document.getElementById(`btn-recalc-ml-${orderId}`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-[8px]"></i> Recalculando...';
    }
    try {
        const recalcFn = httpsCallable(functions, 'recalcMLOrderFinances');
        await recalcFn({ orderId });
        if (typeof showActionToast === 'function') {
            showActionToast('✅ Comisiones recalculadas con éxito desde MercadoLibre', 'success', 3000);
        } else {
            alert('✅ Comisiones recalculadas con éxito desde MercadoLibre');
        }
        if (typeof window.viewOrderDetail === 'function') {
            window.viewOrderDetail(orderId);
        }
    } catch (e) {
        console.error("Error recalculando finanzas ML:", e);
        if (typeof showActionToast === 'function') {
            showActionToast('⚠️ Error al recalcular: ' + e.message, 'error', 4000);
        } else {
            alert('⚠️ Error al recalcular: ' + e.message);
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate text-[8px]"></i> Recalcular';
        }
    }
};

window.openMercadoLibreLabel = function(orderId) {
    let functionsUrl = "https://us-central1-pixeltechcol.cloudfunctions.net/getMercadoLibreLabel";
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        functionsUrl = "http://localhost:5001/pixeltechcol/us-central1/getMercadoLibreLabel";
    }
    window.open(`${functionsUrl}?orderId=${orderId}`, '_blank');
};