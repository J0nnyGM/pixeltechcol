import { auth, db, onAuthStateChanged, collection, addDoc } from "./firebase-init.js";

let currentUser = null;
// IMPORTANTE: Usamos la misma clave que en cart.html
let cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];

// 1. Verificar Sesión
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const nameInput = document.getElementById('cust-name');
        if(nameInput) nameInput.value = user.displayName || "";
        renderSummary(); // Llamamos a renderizar aquí para asegurar que hay datos
    } else {
        alert("Por favor inicia sesión para finalizar tu compra.");
        window.location.href = "/auth/login.html";
    }
});

// 2. Renderizar Resumen
function renderSummary() {
    const container = document.getElementById('checkout-items');
    if (!container) return;
    
    let total = 0;

    if (cart.length === 0) {
        alert("El carrito está vacío.");
        window.location.href = "/index.html";
        return;
    }

    container.innerHTML = cart.map(item => {
        total += item.price * (item.quantity || 1);
        return `
            <div class="flex items-center gap-4 mb-4">
                <div class="w-16 h-16 bg-white rounded-xl p-2 border border-gray-100 shrink-0">
                    <img src="${item.image}" class="w-full h-full object-contain">
                </div>
                <div class="flex-grow">
                    <h4 class="font-bold text-xs line-clamp-2">${item.name}</h4>
                    <p class="text-[10px] font-black text-brand-cyan uppercase">Cant: ${item.quantity || 1}</p>
                </div>
                <span class="font-black text-sm">$${(item.price * (item.quantity || 1)).toLocaleString('es-CO')}</span>
            </div>
        `;
    }).join('');

    const subtotalEl = document.getElementById('check-subtotal');
    const totalEl = document.getElementById('check-total');
    
    if(subtotalEl) subtotalEl.textContent = `$${total.toLocaleString('es-CO')}`;
    if(totalEl) totalEl.textContent = `$${total.toLocaleString('es-CO')}`;
}

// 3. Acción del Botón
const btnComplete = document.getElementById('btn-complete-order');
if (btnComplete) {
    btnComplete.onclick = async () => {
        const name = document.getElementById('cust-name').value;
        const phone = document.getElementById('cust-phone').value;
        const address = document.getElementById('cust-address').value;
        const city = document.getElementById('cust-city').value;

        if (!name || !phone || !address || !city) {
            alert("Completa los datos de envío.");
            return;
        }

        btnComplete.disabled = true;
        btnComplete.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const orderData = {
            userId: currentUser.uid,
            userName: name,
            userEmail: currentUser.email,
            phone: phone,
            address: address,
            city: city,
            items: cart,
            total: cart.reduce((acc, item) => acc + (item.price * (item.quantity || 1)), 0),
            status: 'PENDIENTE',
            source: 'TIENDA', // <--- Clave para tus filtros
            createdAt: new Date()
        };

        try {
            // Guardar Pedido
            const orderRef = await addDoc(collection(db, "orders"), orderData);

            // Guardar Remisión
            await addDoc(collection(db, "remissions"), {
                orderId: orderRef.id,
                source: 'TIENDA',
                clientName: name,
                clientPhone: phone,
                items: cart,
                total: orderData.total,
                status: 'PENDIENTE_ALISTAMIENTO',
                createdAt: new Date(),
                type: 'WEB'
            });

            // LIMPIAR CARRITO
            localStorage.removeItem('pixeltech_cart');
            
            alert("¡Pedido Realizado! 🎉");
            window.location.href = "/profile.html";

        } catch (error) {
            console.error(error);
            alert("Error: " + error.message);
            btnComplete.disabled = false;
            btnComplete.innerHTML = 'Confirmar Pedido';
        }
    };
}