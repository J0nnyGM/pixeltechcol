import { db, collection, getDocs, query, orderBy } from "./firebase-init.js";

const grid = document.getElementById('categories-grid');

async function loadCategories() {
    try {
        // Consultamos la colección 'categories'
        // Intentamos ordenar por nombre si existe ese campo, si no, traemos todo por defecto
        const q = query(collection(db, "categories"), orderBy("name", "asc"));
        const querySnapshot = await getDocs(q);

        grid.innerHTML = ""; // Limpiar loader

        if (querySnapshot.empty) {
            grid.innerHTML = `<p class="col-span-full text-center text-gray-400 font-bold uppercase">No hay categorías disponibles.</p>`;
            return;
        }

        querySnapshot.forEach((doc) => {
            const cat = doc.data();
            const catId = doc.id;
            
            // Usamos una imagen por defecto si la categoría no tiene una
            // Puedes cambiar esta URL por un logo genérico de PixelTech
            const imageSrc = cat.image || 'https://placehold.co/400x300?text=PixelTech';
            
            // Creamos la tarjeta
            const card = document.createElement('a');
            // Redirigir a la búsqueda con el filtro de categoría
            card.href = `/shop/search.html?category=${encodeURIComponent(cat.name)}`;
            card.className = "group relative bg-slate-50 rounded-[2rem] border border-gray-100 overflow-hidden hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 cursor-pointer h-64 flex flex-col";

            card.innerHTML = `
                <div class="absolute inset-0 bg-white">
                    <img src="${imageSrc}" alt="${cat.name}" class="w-full h-full object-cover opacity-90 group-hover:scale-110 transition duration-700">
                    <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                </div>

                <div class="relative z-10 mt-auto p-6">
                    <div class="w-10 h-1 bg-brand-cyan mb-3 w-0 group-hover:w-10 transition-all duration-300"></div>
                    <h3 class="text-white font-black text-xl uppercase tracking-tight leading-none mb-1 group-hover:text-brand-cyan transition-colors">${cat.name}</h3>
                    <p class="text-gray-300 text-[10px] font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0">Ver Productos <i class="fa-solid fa-arrow-right ml-1"></i></p>
                </div>
            `;

            grid.appendChild(card);
        });

        // Agregamos una tarjeta extra para "Ver Todo"
        const allCard = document.createElement('a');
        allCard.href = `/shop/search.html`;
        allCard.className = "group relative bg-brand-black rounded-[2rem] overflow-hidden hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 cursor-pointer h-64 flex flex-col items-center justify-center border border-brand-black";
        allCard.innerHTML = `
            <div class="text-center p-6 relative z-10">
                <div class="w-16 h-16 rounded-full bg-brand-cyan flex items-center justify-center mx-auto mb-4 text-brand-black group-hover:scale-110 transition duration-300">
                    <i class="fa-solid fa-layer-group text-2xl"></i>
                </div>
                <h3 class="text-white font-black text-xl uppercase tracking-tight">Ver Todo</h3>
                <p class="text-gray-400 text-[10px] font-bold uppercase tracking-widest mt-2">El catálogo completo</p>
            </div>
        `;
        grid.appendChild(allCard);

    } catch (error) {
        console.error("Error cargando categorías:", error);
        grid.innerHTML = `<p class="col-span-full text-center text-red-400 font-bold">Error al cargar categorías.</p>`;
    }
}

document.addEventListener('DOMContentLoaded', loadCategories);