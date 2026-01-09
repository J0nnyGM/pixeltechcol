import { auth, db, onAuthStateChanged, collection, addDoc, doc, getDoc } from "./firebase-init.js";

// --- VARIABLES DE ESTADO ---
let currentUser = null;
let cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
let shippingConfig = null;

/**
 * 1. INICIALIZACIÓN Y CARGA DE DATOS
 */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;

        try {
            // Cargar Configuración de Envíos del Administrador
            const configSnap = await getDoc(doc(db, "config", "shipping"));
            if (configSnap.exists()) shippingConfig = configSnap.data();

            // Cargar datos del perfil del usuario
            const userSnap = await getDoc(doc(db, "users", user.uid));
            const userData = userSnap.data() || {};

            // Autocompletar datos básicos
            const nameInput = document.getElementById('cust-name');
            if (nameInput) nameInput.value = user.displayName || userData.name || "";

            // Llenar Selector de Direcciones Guardadas
            setupAddressSelector(userData.addresses);

            // Configurar Lógica de Facturación Legal
            setupBillingLogic(userData.billingInfo);

        } catch (error) {
            console.error("Error al inicializar checkout:", error);
        }

        renderSummary();
    } else {
        alert("Por favor inicia sesión para finalizar tu compra.");
        window.location.href = "/auth/login.html";
    }
});

/**
 * 2. LÓGICA DE DIRECCIONES Y FACTURACIÓN
 */
function setupAddressSelector(addresses) {
    const select = document.getElementById('saved-addresses-select');
    if (!select || !addresses) return;

    addresses.forEach(addr => {
        const opt = document.createElement('option');
        opt.value = JSON.stringify(addr);
        opt.textContent = `${addr.alias.toUpperCase()}: ${addr.address}`;
        select.appendChild(opt);
    });

    select.onchange = async (e) => {
        if (!e.target.value) return;
        const addr = JSON.parse(e.target.value);
        document.getElementById('cust-address').value = addr.address;
        document.getElementById('cust-city').value = addr.city;

        // Al cambiar la dirección, recalculamos el envío
        await updateTotals();
    };
}

function setupBillingLogic(savedBilling) {
    const checkInvoice = document.getElementById('check-need-invoice');
    const billForm = document.getElementById('billing-form-checkout');

    if (!checkInvoice || !billForm) return;

    checkInvoice.onchange = (e) => {
        billForm.classList.toggle('hidden', !e.target.checked);

        // Autocompletar si existen datos previos en el perfil
        if (e.target.checked && savedBilling) {
            document.getElementById('bill-name').value = savedBilling.name || "";
            document.getElementById('bill-taxid').value = savedBilling.taxId || "";
            document.getElementById('bill-address').value = savedBilling.address || "";
            document.getElementById('bill-city').value = savedBilling.city || "";
            document.getElementById('bill-email').value = savedBilling.email || "";
            document.getElementById('bill-phone').value = savedBilling.phone || "";
        }
    };
}

/**
 * 3. CÁLCULO DE ENVÍO DINÁMICO
 */
async function calculateShipping(targetCity, orderSubtotal) {
    if (!shippingConfig) return 0;

    // 1. Umbral de Envío Gratis
    if (orderSubtotal >= shippingConfig.freeThreshold) return 0;

    // 2. Buscar en grupos especiales
    let price = shippingConfig.defaultPrice || 0;
    if (shippingConfig.groups) {
        shippingConfig.groups.forEach(group => {
            if (group.cities && group.cities.includes(targetCity)) {
                price = group.price;
            }
        });
    }

    return price;
}

async function updateTotals() {
    const city = document.getElementById('cust-city').value;
    const subtotal = cart.reduce((acc, item) => acc + (item.price * (item.quantity || 1)), 0);

    const shippingCost = await calculateShipping(city, subtotal);

    const shippingEl = document.getElementById('check-shipping');
    const totalEl = document.getElementById('check-total');

    if (shippingEl) shippingEl.textContent = shippingCost === 0 ? "GRATIS" : `$${shippingCost.toLocaleString('es-CO')}`;
    if (totalEl) totalEl.textContent = `$${(subtotal + shippingCost).toLocaleString('es-CO')}`;

    return { subtotal, shippingCost };
}

// Detectar cambios manuales en la ciudad para actualizar el envío
document.getElementById('cust-city')?.addEventListener('blur', updateTotals);

/**
 * 4. RENDERIZAR RESUMEN DE CARRITO
 */
function renderSummary() {
    const container = document.getElementById('checkout-items');
    if (!container) return;

    if (cart.length === 0) {
        alert("El carrito está vacío.");
        window.location.href = "/index.html";
        return;
    }

    container.innerHTML = cart.map(item => `
        <div class="flex items-center gap-4 mb-6 border-b border-gray-50 pb-4">
            <div class="w-16 h-16 bg-white rounded-xl p-2 border border-gray-100 shrink-0">
                <img src="${item.mainImage || item.image}" class="w-full h-full object-contain">
            </div>
            <div class="flex-grow">
                <h4 class="font-bold text-[11px] line-clamp-1 uppercase text-brand-black">${item.name}</h4>
                <div class="flex flex-wrap gap-1.5 mt-1">
                    ${item.color ? `<span class="text-[7px] font-black uppercase text-gray-400 bg-slate-100 px-1.5 py-0.5 rounded">Color: ${item.color}</span>` : ''}
                    ${item.capacity ? `<span class="text-[7px] font-black uppercase text-brand-cyan bg-brand-cyan/5 px-1.5 py-0.5 rounded border border-brand-cyan/10">Cap: ${item.capacity}</span>` : ''}
                </div>
                <p class="text-[9px] font-black text-gray-300 uppercase mt-2">Cantidad: ${item.quantity || 1}</p>
            </div>
            <div class="text-right">
                <span class="font-black text-xs block text-brand-black">$${(item.price * (item.quantity || 1)).toLocaleString('es-CO')}</span>
            </div>
        </div>
    `).join('');

    const subtotal = cart.reduce((acc, item) => acc + (item.price * (item.quantity || 1)), 0);
    const subtotalEl = document.getElementById('check-subtotal');
    if (subtotalEl) subtotalEl.textContent = `$${subtotal.toLocaleString('es-CO')}`;

    updateTotals(); // Actualizar totales iniciales
}

/**
 * 5. PROCESO DE CONFIRMACIÓN
 */
const btnComplete = document.getElementById('btn-complete-order');
if (btnComplete) {
    btnComplete.onclick = async () => {
        const name = document.getElementById('cust-name').value;
        const phone = document.getElementById('cust-phone').value;
        const address = document.getElementById('cust-address').value;
        const city = document.getElementById('cust-city').value;
        const notes = document.getElementById('cust-notes').value || "";

        if (!name || !phone || !address || !city) {
            alert("🚨 Por favor completa los datos de envío obligatorios.");
            return;
        }

        // Lógica de Facturación Legal
        const checkInvoice = document.getElementById('check-need-invoice');
        let billingData = null;

        if (checkInvoice && checkInvoice.checked) {
            billingData = {
                name: document.getElementById('bill-name').value,
                taxId: document.getElementById('bill-taxid').value,
                address: document.getElementById('bill-address').value,
                city: document.getElementById('bill-city').value,
                email: document.getElementById('bill-email').value,
                phone: document.getElementById('bill-phone').value
            };

            if (!billingData.name || !billingData.taxId) {
                alert("🚨 Completa la Razón Social y el NIT para generar la factura.");
                return;
            }
        }

        btnComplete.disabled = true;
        btnComplete.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> PROCESANDO...';

        const { subtotal, shippingCost } = await updateTotals();

        const orderData = {
            userId: currentUser.uid,
            userName: name,
            userEmail: currentUser.email,
            phone,
            address,
            city,
            notes,
            items: cart,
            subtotal: subtotal,
            shippingCost: shippingCost,
            total: subtotal + shippingCost,
            requiresInvoice: !!billingData,
            billingInfo: billingData,
            status: 'PENDIENTE',
            source: 'TIENDA', // CORRECCIÓN: Identificado como venta web para el administrador
            createdAt: new Date()
        };

        try {
            // 1. Guardar Orden (Cliente)
            const orderRef = await addDoc(collection(db, "orders"), orderData);

            // 2. Crear Remisión (Logística)
            await addDoc(collection(db, "remissions"), {
                orderId: orderRef.id,
                source: 'TIENDA',
                clientName: name,
                clientPhone: phone,
                clientAddress: `${address}, ${city}`,
                items: cart,
                total: orderData.total,
                requiresInvoice: orderData.requiresInvoice,
                billingDetails: billingData,
                status: 'PENDIENTE_ALISTAMIENTO',
                createdAt: new Date(),
                type: 'WEB'
            });

            for (const item of cart) {
                await adjustStock(item.id, -(item.quantity || 1));
            }

            // 3. Finalizar
            localStorage.removeItem('pixeltech_cart');
            window.location.href = `success.html?order=${orderRef.id}`;

        } catch (error) {
            console.error("Error al procesar pedido:", error);
            alert("Ocurrió un error técnico. Por favor intenta de nuevo.");
            btnComplete.disabled = false;
            btnComplete.innerHTML = 'Confirmar Pedido';
        }
    };
}