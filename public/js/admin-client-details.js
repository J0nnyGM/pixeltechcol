import { db, doc, getDoc, collection, getDocs, query, where, updateDoc, orderBy } from "./firebase-init.js";
import { loadAdminSidebar } from "./admin-ui.js";

loadAdminSidebar();

const urlParams = new URLSearchParams(window.location.search);
const clientId = urlParams.get('id');

if (!clientId) window.location.href = 'clients.html';

// 1. Lógica de Pestañas
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    };
});

// 2. Cargar Datos del Cliente
async function loadClientInfo() {
    const snap = await getDoc(doc(db, "users", clientId));
    if (snap.exists()) {
        const c = snap.data();
        
        // UI Cabecera
        document.getElementById('client-name-big').textContent = c.name || c.userName || 'Sin Nombre';
        document.getElementById('client-email-big').textContent = c.email || 'Sin Email';
        document.getElementById('client-initials').textContent = (c.name || 'X').substring(0,2).toUpperCase();
        
        // Formulario
        document.getElementById('edit-doc').value = c.document || '';
        document.getElementById('edit-phone').value = c.phone || '';
        document.getElementById('edit-address').value = c.address || '';
        document.getElementById('edit-notes').value = c.notes || '';

        loadOrders();
    }
}

// 3. Cargar Pedidos y Seriales
async function loadOrders() {
    const q = query(collection(db, "orders"), where("userId", "==", clientId), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    
    const ordersList = document.getElementById('client-orders-list');
    const snList = document.getElementById('client-sn-list');
    let totalSpent = 0;

    ordersList.innerHTML = "";
    snList.innerHTML = "";

    snap.forEach(d => {
        const o = d.data();
        totalSpent += o.total;

        // Fila de Pedido
        ordersList.innerHTML += `
            <tr class="hover:bg-slate-50 transition">
                <td class="px-8 py-5 font-mono text-xs uppercase text-gray-400">#${d.id.slice(0,8)}</td>
                <td class="px-8 py-5 font-bold">${o.createdAt.toDate().toLocaleDateString()}</td>
                <td class="px-8 py-5"><span class="px-3 py-1 bg-brand-cyan/10 text-brand-cyan rounded-full text-[9px] font-black uppercase">${o.status}</span></td>
                <td class="px-8 py-5 text-right font-black">$${o.total.toLocaleString()}</td>
            </tr>
        `;

        // Extraer Seriales para la pestaña de Garantía
        o.items.forEach(item => {
            if(item.sns && item.sns.length > 0) {
                item.sns.forEach(sn => {
                    snList.innerHTML += `
                        <div class="bg-white p-6 rounded-2xl border border-gray-100 flex justify-between items-center shadow-sm">
                            <div class="flex items-center gap-4">
                                <div class="w-12 h-12 bg-slate-50 rounded-xl p-2 border border-gray-50"><img src="${item.image}" class="w-full h-full object-contain"></div>
                                <div>
                                    <p class="font-black text-xs">${item.name}</p>
                                    <p class="text-[10px] font-mono text-brand-cyan font-bold uppercase tracking-widest mt-1">SN: ${sn}</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="text-[9px] font-black text-gray-400 uppercase">Comprado en</p>
                                <p class="text-[10px] font-bold">#${d.id.slice(0,5)}</p>
                            </div>
                        </div>
                    `;
                });
            }
        });
    });

    document.getElementById('stat-ltv').textContent = `$${totalSpent.toLocaleString()}`;
    document.getElementById('stat-orders-count').textContent = snap.size;
}

loadClientInfo();