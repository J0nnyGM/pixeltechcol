import { db, collection, getDocs, query, orderBy } from "./firebase-init.js";

const grid = document.getElementById('brands-grid');

async function loadBrands() {
    try {
        const q = query(collection(db, "brands"), orderBy("name", "asc"));
        const querySnapshot = await getDocs(q);

        grid.innerHTML = ""; 

        if (querySnapshot.empty) {
            grid.innerHTML = `<p class="col-span-full text-center text-gray-400 font-bold uppercase py-10">No hay marcas registradas.</p>`;
            return;
        }

        querySnapshot.forEach((doc) => {
            const brand = doc.data();
            const imageSrc = brand.image || 'https://placehold.co/400x300?text=' + brand.name;
            
            const card = document.createElement('a');
            // Al hacer click, filtra por marca en el buscador
            card.href = `/shop/search.html?category=${encodeURIComponent(brand.name)}`;
            
            // Clases para tarjeta cuadrada y elegante
            card.className = "group relative bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl hover:border-brand-cyan/30 transition-all duration-300 hover:-translate-y-2 cursor-pointer h-56 flex flex-col";

            card.innerHTML = `
                <div class="absolute inset-0 bg-gray-50 flex items-center justify-center p-8 group-hover:bg-white transition duration-500">
                    <img src="${imageSrc}" alt="${brand.name}" class="max-w-full max-h-full object-contain filter grayscale group-hover:grayscale-0 group-hover:scale-110 transition duration-500 opacity-80 group-hover:opacity-100">
                </div>

                <div class="relative z-10 mt-auto p-4 w-full bg-white/90 backdrop-blur-sm border-t border-gray-50 flex justify-between items-center translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                    <h3 class="text-brand-black font-black text-xs uppercase tracking-wider">
                        ${brand.name}
                    </h3>
                    <i class="fa-solid fa-arrow-right text-[10px] text-brand-cyan"></i>
                </div>
                
                <div class="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition duration-300">
                    <span class="bg-brand-black text-white text-[8px] font-bold px-2 py-1 rounded-md uppercase tracking-widest">Ver Productos</span>
                </div>
            `;

            grid.appendChild(card);
        });

    } catch (error) {
        console.error("Error cargando marcas:", error);
        grid.innerHTML = `<p class="col-span-full text-center text-red-400 font-bold">Error al cargar marcas.</p>`;
    }
}

document.addEventListener('DOMContentLoaded', loadBrands);