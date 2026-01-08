import { db, collection, getDocs, updateDoc, doc, query, orderBy } from "./firebase-init.js";

const tableBody = document.getElementById('admin-products-list');

async function loadProductsAdmin() {
    tableBody.innerHTML = `<tr><td colspan="3" class="p-20 text-center"><i class="fa-solid fa-spinner fa-spin text-2xl text-brand-cyan"></i></td></tr>`;
    
    try {
        const snap = await getDocs(query(collection(db, "products"), orderBy("name", "asc")));
        tableBody.innerHTML = "";

        snap.forEach(docSnap => {
            const p = docSnap.data();
            const id = docSnap.id;

            const tr = document.createElement('tr');
            tr.className = "border-b border-gray-50 hover:bg-gray-50/50 transition";
            tr.innerHTML = `
                <td class="p-6">
                    <div class="flex items-center gap-4">
                        <img src="${p.image}" class="w-12 h-12 rounded-xl object-contain bg-gray-100 p-1">
                        <div>
                            <p class="font-bold text-sm text-brand-black uppercase tracking-tighter">${p.name}</p>
                            <p class="text-[9px] font-black text-brand-cyan uppercase">${p.category || 'Sin Categoría'}</p>
                        </div>
                    </div>
                </td>
                <td class="p-6 text-center">
                    <button onclick="updateFlag('${id}', 'isHeroPromo', ${!p.isHeroPromo})" 
                            class="w-10 h-10 rounded-full transition ${p.isHeroPromo ? 'bg-brand-red text-white shadow-lg shadow-red-500/30' : 'bg-gray-100 text-gray-300 hover:text-gray-500'}">
                        <i class="fa-solid fa-fire text-sm"></i>
                    </button>
                </td>
                <td class="p-6 text-center">
                    <button onclick="updateFlag('${id}', 'isNewLaunch', ${!p.isNewLaunch})" 
                            class="w-10 h-10 rounded-full transition ${p.isNewLaunch ? 'bg-brand-cyan text-brand-black shadow-lg shadow-cyan-500/30' : 'bg-gray-100 text-gray-300 hover:text-gray-500'}">
                        <i class="fa-solid fa-star text-sm"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (e) { console.error(e); }
}

// Función global para actualizar los campos en Firebase
window.updateFlag = async (id, field, value) => {
    try {
        const productRef = doc(db, "products", id);
        await updateDoc(productRef, { [field]: value });
        loadProductsAdmin(); // Recargar tabla
    } catch (e) {
        alert("Error al actualizar: " + e.message);
    }
};

loadProductsAdmin();