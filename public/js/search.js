import { db, collection, getDocs, query, orderBy } from "./firebase-init.js";

/**
 * Lógica principal de búsqueda
 */
export async function initSearch() {
    const params = new URLSearchParams(window.location.search);
    const queryTerm = params.get('q')?.toLowerCase() || "";
    
    document.getElementById('search-term').textContent = `"${queryTerm}"`;
    
    const grid = document.getElementById('search-results-grid');
    const noResults = document.getElementById('no-results');

    if (!queryTerm) {
        window.location.href = "/";
        return;
    }

    try {
        // Obtenemos todos los productos (puedes optimizar esto después)
        const q = query(collection(db, "products"), orderBy("name", "asc"));
        const snapshot = await getDocs(q);
        
        let foundCount = 0;
        grid.innerHTML = "";

        snapshot.forEach(doc => {
            const p = doc.data();
            const name = p.name.toLowerCase();
            const description = (p.description || "").toLowerCase();
            const category = (p.category || "").toLowerCase();

            // Lógica de coincidencia: Nombre, Descripción o Categoría
            if (name.includes(queryTerm) || description.includes(queryTerm) || category.includes(queryTerm)) {
                renderProductCard(grid, { id: doc.id, ...p });
                foundCount++;
            }
        });

        if (foundCount === 0) {
            grid.classList.add('hidden');
            noResults.classList.remove('hidden');
        } else {
            grid.classList.remove('hidden');
            noResults.classList.add('hidden');
        }

    } catch (error) {
        console.error("Error en búsqueda:", error);
        grid.innerHTML = `<p class="col-span-full text-center text-red-500 font-bold">Error al conectar con la base de datos.</p>`;
    }
}

/**
 * Renderiza una tarjeta de producto con el estilo de PixelTech
 */
function renderProductCard(container, p) {
    const card = document.createElement('div');
    card.className = "group bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-brand-cyan/10 transition-all duration-500";
    
    card.innerHTML = `
        <div class="relative mb-6 overflow-hidden rounded-2xl bg-gray-50 aspect-square flex items-center justify-center">
            <img src="${p.image}" class="w-4/5 h-4/5 object-contain group-hover:scale-110 transition-transform duration-500">
            ${p.oldPrice ? `<span class="absolute top-4 left-4 bg-brand-red text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg">Oferta</span>` : ''}
        </div>
        
        <div class="space-y-3">
            <p class="text-[9px] font-black text-brand-cyan uppercase tracking-widest">${p.category || 'Tecnología'}</p>
            <h3 class="font-bold text-sm text-brand-black line-clamp-2 min-h-[40px] uppercase tracking-tighter">${p.name}</h3>
            
            <div class="flex items-end justify-between pt-4 border-t border-gray-50">
                <div>
                    ${p.oldPrice ? `<p class="text-gray-300 text-[10px] line-through font-bold">$${p.oldPrice.toLocaleString('es-CO')}</p>` : ''}
                    <p class="text-xl font-black text-brand-black tracking-tighter">$${p.price.toLocaleString('es-CO')}</p>
                </div>
                <a href="/shop/product.html?id=${p.id}" class="w-10 h-10 rounded-xl bg-brand-black text-white flex items-center justify-center hover:bg-brand-cyan transition shadow-lg">
                    <i class="fa-solid fa-arrow-right text-xs"></i>
                </a>
            </div>
        </div>
    `;
    container.appendChild(card);
}