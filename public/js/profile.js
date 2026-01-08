import { auth, db, onAuthStateChanged, doc, getDoc, updateDoc, collection, getDocs, query, where, orderBy, signOut } from "./firebase-init.js";

// Variables de estado
let currentUserId = null;

// 1. CONTROL DE SESIÓN Y CARGA INICIAL
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        
        // Actualizar interfaz básica (Header y Sidebar)
        updateUserUI(user);
        
        // Cargar datos extendidos (Firestore) y Pedidos
        await loadUserData();
        await loadUserOrders();
        
        // Inicializar contador de carrito (opcional si tienes la lógica)
        updateCartCounter();
    } else {
        // Si no hay sesión, redirigir al login
        window.location.href = "auth/login.html";
    }
});

// 2. ACTUALIZAR INTERFAZ DE USUARIO (Iniciales y Nombres)
function updateUserUI(user) {
    const nameSide = document.getElementById('user-name-side');
    const emailSide = document.getElementById('user-email-side');
    const avatar = document.getElementById('user-avatar');
    
    const name = user.displayName || "Usuario PixelTech";
    
    if (nameSide) nameSide.textContent = name;
    if (emailSide) emailSide.textContent = user.email;
    if (avatar) avatar.textContent = name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
}

// 3. CARGAR DATOS PERSONALES DESDE FIRESTORE
async function loadUserData() {
    try {
        const userSnap = await getDoc(doc(db, "users", currentUserId));
        
        if (userSnap.exists()) {
            const data = userSnap.data();
            
            // Llenar formulario de la sección "Mis Datos"
            if (document.getElementById('form-name')) document.getElementById('form-name').value = data.name || auth.currentUser.displayName || "";
            if (document.getElementById('form-id')) document.getElementById('form-id').value = data.document || "";
            if (document.getElementById('form-phone')) document.getElementById('form-phone').value = data.phone || "";
            if (document.getElementById('form-birth')) document.getElementById('form-birth').value = data.birthdate || "";
        }
    } catch (error) {
        console.error("Error al cargar datos de usuario:", error);
    }
}

// 4. CARGAR HISTORIAL DE COMPRAS
async function loadUserOrders() {
    const container = document.getElementById('orders-container');
    if (!container) return;

    try {
        const q = query(
            collection(db, "orders"), 
            where("userId", "==", currentUserId),
            orderBy("createdAt", "desc")
        );
        
        const snap = await getDocs(q);
        container.innerHTML = "";

        if (snap.empty) {
            container.innerHTML = `
                <div class="bg-white p-12 rounded-[2.5rem] text-center border border-dashed border-gray-200">
                    <i class="fa-solid fa-box-open text-4xl text-gray-200 mb-4"></i>
                    <p class="text-gray-400 font-black uppercase text-[10px] tracking-widest">Aún no tienes compras registradas</p>
                    <a href="/" class="inline-block mt-6 bg-brand-cyan text-brand-black px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-brand-black hover:text-white transition">Explorar Tienda</a>
                </div>`;
            return;
        }

        snap.forEach(docSnap => {
            const order = docSnap.data();
            const date = order.createdAt.toDate().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
            
            // Lógica de colores por estado
            let statusStyle = "bg-yellow-500 shadow-yellow-500/20";
            let statusText = "Recibido";
            if(order.status === 'ALISTADO') { statusStyle = "bg-brand-cyan shadow-cyan-500/20"; statusText = "Alistado"; }
            if(order.status === 'DESPACHADO') { statusStyle = "bg-emerald-500 shadow-emerald-500/20"; statusText = "Enviado"; }

            const card = document.createElement('div');
            card.className = "bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all duration-300";
            card.innerHTML = `
                <div class="p-8">
                    <div class="flex justify-between items-start mb-6">
                        <div>
                            <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Orden #${docSnap.id.slice(0,8).toUpperCase()}</p>
                            <h3 class="text-xl font-black text-brand-black">${date}</h3>
                        </div>
                        <span class="${statusStyle} text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">
                            ${statusText}
                        </span>
                    </div>

                    <div class="space-y-4 mb-6">
                        ${order.items.map(item => `
                            <div class="flex items-center gap-4 bg-slate-50/50 p-3 rounded-2xl">
                                <img src="${item.image}" class="w-12 h-12 rounded-xl object-contain bg-white border border-gray-100 p-1">
                                <div class="flex-grow">
                                    <p class="font-bold text-sm text-brand-black line-clamp-1">${item.name}</p>
                                    <p class="text-[10px] font-bold text-brand-cyan uppercase">Cantidad: ${item.quantity}</p>
                                    ${item.sns ? `<p class="text-[9px] font-mono text-gray-400 mt-1">S/N: ${item.sns.join(', ')}</p>` : ''}
                                </div>
                                <span class="font-black text-sm">$${(item.price * item.quantity).toLocaleString('es-CO')}</span>
                            </div>
                        `).join('')}
                    </div>

                    ${order.status === 'DESPACHADO' ? `
                        <div class="bg-brand-black rounded-2xl p-5 text-white flex items-center gap-4 border-l-4 border-brand-cyan">
                            <div class="w-10 h-10 bg-brand-cyan/20 text-brand-cyan rounded-xl flex items-center justify-center">
                                <i class="fa-solid fa-truck-fast"></i>
                            </div>
                            <div class="flex-grow">
                                <p class="text-[9px] font-black text-brand-cyan uppercase tracking-widest">Seguimiento</p>
                                <p class="text-xs font-bold">${order.shippingCarrier} — <span class="font-mono text-gray-300">${order.shippingTracking}</span></p>
                            </div>
                            <button onclick="navigator.clipboard.writeText('${order.shippingTracking}'); alert('¡Guía copiada!')" class="text-brand-cyan hover:text-white transition">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                        </div>
                    ` : ''}

                    <div class="mt-6 pt-6 border-t border-gray-50 flex justify-between items-center">
                        <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total de la compra</span>
                        <span class="text-2xl font-black text-brand-black">$${order.total.toLocaleString('es-CO')}</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });

    } catch (error) {
        console.error("Error al cargar pedidos:", error);
    }
}

// 5. NAVEGACIÓN ENTRE SECCIONES (SIDEBAR)
document.querySelectorAll('.nav-link').forEach(btn => {
    btn.onclick = () => {
        // Actualizar botones del sidebar
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active', 'bg-brand-cyan', 'text-brand-black'));
        btn.classList.add('active');

        // Cambiar sección visible
        const targetId = btn.dataset.target;
        document.querySelectorAll('.page-section').forEach(sec => sec.classList.remove('active'));
        const targetSec = document.getElementById(targetId);
        if (targetSec) targetSec.classList.add('active');
    };
});

// 6. ACTUALIZAR DATOS PERSONALES (FORMULARIO)
const profileForm = document.getElementById('profile-form');
if (profileForm) {
    profileForm.onsubmit = async (e) => {
        e.preventDefault();
        const btn = profileForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

        try {
            const userRef = doc(db, "users", currentUserId);
            await updateDoc(userRef, {
                name: document.getElementById('form-name').value,
                document: document.getElementById('form-id').value,
                phone: document.getElementById('form-phone').value,
                birthdate: document.getElementById('form-birth').value,
                updatedAt: new Date()
            });

            alert("¡Tus datos han sido actualizados con éxito! ✨");
        } catch (error) {
            console.error("Error al actualizar perfil:", error);
            alert("Hubo un error al guardar los cambios.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };
}

// 7. CERRAR SESIÓN
const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
    btnLogout.onclick = async () => {
        if (confirm("¿Estás seguro de que deseas cerrar tu sesión en PixelTech?")) {
            try {
                await signOut(auth);
                window.location.href = "/";
            } catch (error) {
                console.error("Error al cerrar sesión:", error);
            }
        }
    };
}

// 8. UTILIDAD: CONTADOR DE CARRITO (Header Global)
function updateCartCounter() {
    const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
    const countEl = document.getElementById('cart-count');
    if (countEl) {
        countEl.textContent = cart.reduce((acc, item) => acc + (item.quantity || 1), 0);
    }
}