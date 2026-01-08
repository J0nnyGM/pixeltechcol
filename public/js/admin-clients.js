// admin-clients.js
import { db, collection, getDocs, addDoc, query, orderBy } from "./firebase-init.js";

async function fetchClients() {
    const tableBody = document.getElementById('clients-table-body');
    if (!tableBody) return;

    // Indicador de carga
    tableBody.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-cyan"></i></td></tr>`;

    const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    
    tableBody.innerHTML = "";
    
    snapshot.forEach(doc => {
        const c = doc.data();
        const date = c.createdAt ? c.createdAt.toDate().toLocaleDateString() : '---';
        
        // Etiqueta de Origen
        const sourceTag = c.source === 'MANUAL' ? 
            `<span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-slate-200">Manual</span>` : 
            `<span class="bg-brand-cyan/10 text-brand-cyan px-3 py-1 rounded-full text-[9px] font-black uppercase border border-brand-cyan/20">Web</span>`;

        tableBody.innerHTML += `
            <tr class="hover:bg-slate-50/80 transition border-b border-gray-50 group">
                <td class="px-8 py-5">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center font-black text-brand-cyan text-xs group-hover:bg-brand-cyan group-hover:text-white transition">
                            ${(c.name || c.userName || 'U').substring(0,1).toUpperCase()}
                        </div>
                        <div class="font-black text-brand-black text-sm">${c.name || c.userName || 'Sin nombre'}</div>
                    </div>
                </td>
                <td class="px-8 py-5">
                    <div class="text-xs font-bold text-gray-600">${c.phone || '---'}</div>
                    <div class="text-[10px] text-gray-400 font-medium">${c.email || ''}</div>
                </td>
                <td class="px-8 py-5">${sourceTag}</td>
                <td class="px-8 py-5 text-xs text-gray-400 font-bold">${date}</td>
                <td class="px-8 py-5 text-center">
                    <a href="client-details.html?id=${doc.id}" class="inline-flex w-10 h-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400 hover:bg-brand-black hover:text-white transition shadow-sm">
                        <i class="fa-solid fa-eye text-xs"></i>
                    </a>
                </td>
            </tr>
        `;
    });
}

// Guardar Cliente Manual
document.getElementById('save-client').onclick = async () => {
    const name = document.getElementById('new-client-name').value;
    const phone = document.getElementById('new-client-phone').value;
    const email = document.getElementById('new-client-email').value;
    const address = document.getElementById('new-client-address').value;

    if(!name || !phone) return alert("Nombre y teléfono son obligatorios");

    try {
        await addDoc(collection(db, "users"), {
            name, phone, email, address,
            source: 'MANUAL',
            role: 'client',
            createdAt: new Date()
        });
        alert("Cliente guardado");
        document.getElementById('client-modal').classList.add('hidden');
        fetchClients();
    } catch (e) { alert(e.message); }
};

// Buscador en tiempo real
document.getElementById('search-client').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#clients-table-body tr');
    
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(term) ? '' : 'none';
    });
};

fetchClients();