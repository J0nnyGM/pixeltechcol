import { db, collection, getDocs, query, orderBy } from "./firebase-init.js";

/**
 * Lógica principal de búsqueda y filtrado inteligente
 */
export async function initSearch() {
    const params = new URLSearchParams(window.location.search);
    
    // Obtenemos los términos de búsqueda o filtros
    const queryTerm = params.get('q')?.toLowerCase().trim() || "";
    const categoryFilter = params.get('category')?.toLowerCase().trim() || ""; 
    
    // Referencias al DOM
    const titlePrefix = document.getElementById('search-title-prefix');
    const termLabel = document.getElementById('search-term');
    const subtitle = document.getElementById('search-subtitle');
    const grid = document.getElementById('search-results-grid');
    const noResults = document.getElementById('no-results');

    // 1. Configurar Títulos según el modo
    if (categoryFilter) {
        subtitle.textContent = "Filtrando por";
        titlePrefix.textContent = "Categoría:";
        // Capitalizamos la primera letra para que se vea bien
        termLabel.textContent = categoryFilter.charAt(0).toUpperCase() + categoryFilter.slice(1);
        document.title = `${categoryFilter} | PixelTech`;
    } else if (queryTerm) {
        subtitle.textContent = "Resultados de búsqueda";
        titlePrefix.textContent = "Buscando:";
        termLabel.textContent = `"${queryTerm}"`;
        document.title = `Buscar: ${queryTerm} | PixelTech`;
    } else {
        // Modo "Ver Todo"
        subtitle.textContent = "Inventario Global";
        titlePrefix.textContent = "Catálogo";
        termLabel.textContent = "Completo";
        document.title = `Catálogo | PixelTech`;
    }

    try {
        // Traemos todo el inventario
        // NOTA: Para producción con miles de productos, esto debería filtrarse desde Firebase directamente.
        const q = query(collection(db, "products"), orderBy("name", "asc"));
        const snapshot = await getDocs(q);
        
        let foundCount = 0;
        grid.innerHTML = "";

        snapshot.forEach(doc => {
            const p = doc.data();
            const pId = doc.id;

            // --- NORMALIZACIÓN DE DATOS (NUEVA LÓGICA) ---
            const name = (p.name || "").toLowerCase();
            const desc = (p.description || "").toLowerCase();
            const tags = (p.tags || []).join(" ").toLowerCase();
            
            // Aquí está la clave: Leemos AMBOS campos
            const mainCategory = (p.category || "").toLowerCase();      // Ej: "Celulares"
            const subCategory = (p.subcategory || "").toLowerCase();    // Ej: "Xiaomi"
            
            // Campo legacy (por si tienes productos viejos donde category es la marca)
            const legacyCheck = mainCategory; 

            let match = false;

            if (categoryFilter) {
                // MODO FILTRO: 
                // El producto pasa si el filtro coincide con la Categoría Principal O la Subcategoría
                // Ejemplo: Filtro="Celulares" -> Coincide con p.category
                // Ejemplo: Filtro="Xiaomi" -> Coincide con p.subcategory
                if (mainCategory === categoryFilter || subCategory === categoryFilter) {
                    match = true;
                }
            } else if (queryTerm) {
                // MODO BÚSQUEDA GENERAL:
                // Buscamos en nombre, descripción, tags, categoría y subcategoría
                if (name.includes(queryTerm) || 
                    desc.includes(queryTerm) || 
                    mainCategory.includes(queryTerm) || 
                    subCategory.includes(queryTerm) ||
                    tags.includes(queryTerm)) {
                    match = true;
                }
            } else {
                // MODO TODO: Mostrar todo
                match = true;
            }

            if (match) {
                renderProductCard(grid, { id: pId, ...p });
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
        grid.innerHTML = `<p class="col-span-full text-center text-red-500 font-bold">Error de conexión. Intenta recargar.</p>`;
    }
}

/**
 * Renderiza una tarjeta de producto
 */
function renderProductCard(container, p) {
    const card = document.createElement('div');
    card.className = "group bg-white rounded-[2rem] p-5 border border-gray-100 shadow-sm hover:shadow-2xl hover:border-brand-cyan/30 hover:-translate-y-1 transition-all duration-300 flex flex-col";
    
    // Imagen segura
    const imageSrc = p.mainImage || p.image || 'https://placehold.co/300x300?text=Sin+Imagen';

    card.innerHTML = `
        <div class="relative mb-5 overflow-hidden rounded-2xl bg-brand-surface h-56 flex items-center justify-center p-4">
            <img src="${imageSrc}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-500">
            ${p.originalPrice && p.price < p.originalPrice ? 
                `<span class="absolute top-3 left-3 bg-brand-red text-white text-[8px] font-black px-2 py-1 rounded-full uppercase tracking-widest shadow-lg">Oferta</span>` 
                : ''}
        </div>
        
        <div class="flex flex-col flex-grow">
            <p class="text-[9px] font-black text-brand-cyan uppercase tracking-widest mb-1">${p.subcategory || p.category || 'Tecnología'}</p>
            <h3 class="font-black text-sm text-brand-black line-clamp-2 uppercase leading-tight mb-4 min-h-[2.5em] group-hover:text-brand-cyan transition-colors">${p.name}</h3>
            
            <div class="mt-auto pt-4 border-t border-gray-50 flex items-end justify-between">
                <div>
                    ${p.originalPrice && p.price < p.originalPrice ? 
                        `<p class="text-gray-300 text-[10px] line-through font-bold leading-none">$${p.originalPrice.toLocaleString('es-CO')}</p>` 
                        : ''}
                    <p class="text-lg font-black text-brand-black tracking-tight">$${p.price.toLocaleString('es-CO')}</p>
                </div>
                <a href="/shop/product.html?id=${p.id}" class="w-10 h-10 rounded-xl bg-brand-black text-white flex items-center justify-center hover:bg-brand-cyan hover:text-brand-black transition shadow-lg group-hover:scale-105">
                    <i class="fa-solid fa-arrow-right text-xs"></i>
                </a>
            </div>
        </div>
    `;
    container.appendChild(card);
}