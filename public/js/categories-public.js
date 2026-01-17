import { db, collection, getDocs, query, orderBy } from "./firebase-init.js";

const mainGrid = document.getElementById('categories-grid');
const subGrid = document.getElementById('subcategories-grid');
const mainView = document.getElementById('main-view');
const subView = document.getElementById('sub-view');
const currentCatNameEl = document.getElementById('current-cat-name');
const btnViewAllSub = document.getElementById('btn-view-all-sub'); // Referencia al nuevo botón

// Variable global para guardar datos
let categoriesData = [];

// 1. CARGA INICIAL
async function loadCategories() {
    try {
        const q = query(collection(db, "categories"), orderBy("name", "asc"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            mainGrid.innerHTML = `<p class="col-span-full text-center text-gray-400">Sin departamentos.</p>`;
            return;
        }

        categoriesData = [];
        snapshot.forEach(doc => {
            categoriesData.push({ id: doc.id, ...doc.data() });
        });

        renderMainGrid();

    } catch (error) {
        console.error("Error loading categories:", error);
        mainGrid.innerHTML = `<p class="col-span-full text-center text-red-400">Error de conexión.</p>`;
    }
}

// 2. RENDER PRINCIPAL (Departamentos)
function renderMainGrid() {
    mainGrid.innerHTML = "";

    categoriesData.forEach((cat, index) => {
        const imageSrc = cat.image || 'https://placehold.co/400x300';
        const subCount = cat.subcategories ? cat.subcategories.length : 0;

        const card = document.createElement('div');
        card.onclick = () => showSubcategories(index);
        
        // Estilo Base (h-72, efectos hover premium)
        card.className = "group relative bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-brand-cyan/20 hover:border-brand-cyan/50 transition-all duration-500 hover:-translate-y-2 cursor-pointer h-72 flex flex-col";

        card.innerHTML = `
            <div class="absolute inset-0 bg-gray-100 overflow-hidden">
                <img src="${imageSrc}" alt="${cat.name}" class="w-full h-full object-cover group-hover:scale-110 transition duration-700 ease-out opacity-90 group-hover:opacity-100">
                <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity"></div>
            </div>
            
            <div class="relative z-10 mt-auto p-6">
                <div class="w-8 h-1 bg-brand-cyan mb-3 w-0 group-hover:w-8 transition-all duration-300 ease-out"></div>
                <h3 class="text-white font-black text-2xl uppercase tracking-tighter leading-none mb-1 drop-shadow-md group-hover:text-brand-cyan transition-colors">
                    ${cat.name}
                </h3>
                <p class="text-gray-300 text-[10px] font-bold uppercase tracking-widest opacity-80 group-hover:opacity-100 transition flex items-center gap-2 transform translate-y-2 group-hover:translate-y-0 duration-300">
                    ${subCount} Colecciones <i class="fa-solid fa-arrow-right"></i>
                </p>
            </div>
        `;
        mainGrid.appendChild(card);
    });
}

// 3. RENDER SECUNDARIO (Subcategorías)
window.showSubcategories = (index) => {
    const cat = categoriesData[index];
    const subcategories = cat.subcategories || [];

    // Actualizar enlace del botón superior "Ver Todo"
    if (btnViewAllSub) {
        btnViewAllSub.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
    }

    // Si no tiene subcategorías, ir directo al catálogo
    if (subcategories.length === 0) {
        window.location.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
        return;
    }

    // Configurar Vista
    currentCatNameEl.textContent = cat.name;
    subGrid.innerHTML = "";

    // Renderizar tarjetas de subcategorías (Igual diseño que Main)
    subcategories.forEach(sub => {
        const subName = typeof sub === 'string' ? sub : sub.name;
        const subImg = typeof sub === 'object' ? sub.image : 'https://placehold.co/300';

        const card = document.createElement('a');
        card.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}&subcategory=${encodeURIComponent(subName)}`;
        
        // Mismo tamaño (h-72) y clases que el grid principal
        card.className = "group relative bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-brand-cyan/20 hover:border-brand-cyan/50 transition-all duration-500 hover:-translate-y-2 cursor-pointer h-72 flex flex-col";

        card.innerHTML = `
            <div class="absolute inset-0 bg-gray-100 overflow-hidden">
                <img src="${subImg}" class="w-full h-full object-cover group-hover:scale-110 transition duration-700 ease-out opacity-90 group-hover:opacity-100">
                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-50 group-hover:opacity-70 transition-colors"></div>
            </div>
            
            <div class="relative z-10 mt-auto p-6 text-center w-full">
                <div class="w-8 h-1 bg-white mx-auto mb-3 w-0 group-hover:w-8 transition-all duration-300 ease-out"></div>
                <h4 class="text-white font-black text-xl uppercase tracking-tight leading-none group-hover:text-brand-cyan transition text-shadow-md">${subName}</h4>
                <span class="mt-2 inline-block text-[8px] font-bold text-gray-300 uppercase tracking-widest opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition duration-300">Explorar</span>
            </div>
        `;
        subGrid.appendChild(card);
    });

    // Transición de Vistas
    mainView.classList.add('hidden');
    subView.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// 4. VOLVER A PRINCIPAL
window.showMainCategories = () => {
    subView.classList.add('hidden');
    mainView.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

document.addEventListener('DOMContentLoaded', loadCategories);