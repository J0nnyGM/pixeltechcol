import { db, collection, getDocs, query, orderBy, where } from "./firebase-init.js";

const mainGrid = document.getElementById('categories-grid');
const subGrid = document.getElementById('subcategories-grid');
const mainView = document.getElementById('main-view');
const subView = document.getElementById('sub-view');
const currentCatNameEl = document.getElementById('current-cat-name');
const btnViewAllSub = document.getElementById('btn-view-all-sub'); 

// Estado en memoria
let categoriesData = [];

// Claves de almacenamiento
const STORAGE_KEY = 'pixeltech_categories';
const SYNC_KEY = 'pixeltech_cat_last_sync';

// ==========================================================================
// 🧠 SMART DELTA SYNC (Sincronización Incremental Real)
// ==========================================================================
async function loadCategories() {
    // 1. CARGA INICIAL (CACHE)
    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    // Recuperamos la fecha de la última actualización (o 0 si es la primera vez)
    let lastSyncTime = parseInt(localStorage.getItem(SYNC_KEY) || '0');

    if (cachedRaw) {
        try {
            categoriesData = JSON.parse(cachedRaw);
            if (categoriesData.length > 0) {
                console.log(`⚡ [DeltaSync] Cargadas ${categoriesData.length} categorías de memoria.`);
                renderMainGrid(); // Mostramos inmediato
            }
        } catch (e) {
            console.warn("Caché corrupto, reiniciando...");
            categoriesData = [];
            lastSyncTime = 0;
        }
    }

    // 2. BUSCAR SOLO LO QUE CAMBIÓ (Deltas)
    await fetchIncrements(lastSyncTime);
}

async function fetchIncrements(lastSyncTime) {
    try {
        console.log("🕵️ [DeltaSync] Buscando actualizaciones desde:", new Date(lastSyncTime).toLocaleString());
        
        let q;
        const colRef = collection(db, "categories");

        if (lastSyncTime === 0 || categoriesData.length === 0) {
            // CASO A: Primera vez (Descarga Todo)
            console.log("☁️ Descarga completa inicial...");
            q = query(colRef); // Sin filtros, trae todo
        } else {
            // CASO B: Actualización Incremental (Solo cambios)
            // REQUISITO: Tus categorías deben tener campo 'updatedAt'
            q = query(colRef, where("updatedAt", ">", new Date(lastSyncTime)));
        }

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            console.log("✅ [DeltaSync] Todo al día. 0 cambios.");
            // Actualizamos el timestamp para que la próxima consulta sea desde "ahora"
            // aunque no haya habido cambios, para mantener la ventana de tiempo corta.
            localStorage.setItem(SYNC_KEY, Date.now().toString());
            return; 
        }

        console.log(`🔥 [DeltaSync] Recibidos ${snapshot.size} cambios.`);

        // 3. FUSIÓN (MERGE) EN MEMORIA
        snapshot.forEach(doc => {
            const newData = { id: doc.id, ...doc.data() };
            
            // Busamos si ya existe en nuestro array local
            const index = categoriesData.findIndex(c => c.id === newData.id);

            if (index > -1) {
                // ACTUALIZAR: Si existe, reemplazamos
                console.log(`🔄 Actualizando categoría: ${newData.name}`);
                categoriesData[index] = newData;
            } else {
                // INSERTAR: Si no existe, agregamos
                console.log(`✨ Nueva categoría: ${newData.name}`);
                categoriesData.push(newData);
            }
        });

        // 4. ORDENAR Y GUARDAR
        // Como mezclamos datos, el orden puede haberse perdido. Reordenamos alfabéticamente.
        categoriesData.sort((a, b) => a.name.localeCompare(b.name));

        // Guardamos el nuevo estado completo
        localStorage.setItem(STORAGE_KEY, JSON.stringify(categoriesData));
        localStorage.setItem(SYNC_KEY, Date.now().toString());

        // Re-renderizamos la vista con los datos frescos
        renderMainGrid();

    } catch (error) {
        console.error("Error en DeltaSync:", error);
        // Fallback: Si falla la query incremental (ej: falta índice), mostramos error en consola
        // pero el usuario sigue viendo lo que había en caché.
    }
}

// ==========================================================================
// RENDERIZADO (UI) - Sin cambios en lógica visual
// ==========================================================================

function renderMainGrid() {
    mainGrid.innerHTML = "";

    if (categoriesData.length === 0) {
        mainGrid.innerHTML = `<p class="col-span-full text-center text-gray-400">Sin departamentos disponibles.</p>`;
        return;
    }

    categoriesData.forEach((cat, index) => {
        const imageSrc = cat.image || 'https://placehold.co/400x300';
        const subCount = cat.subcategories ? cat.subcategories.length : 0;

        const card = document.createElement('div');
        card.onclick = () => showSubcategories(index);
        
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

window.showSubcategories = (index) => {
    const cat = categoriesData[index];
    const subcategories = cat.subcategories || [];

    if (btnViewAllSub) {
        btnViewAllSub.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
    }

    if (subcategories.length === 0) {
        window.location.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
        return;
    }

    currentCatNameEl.textContent = cat.name;
    subGrid.innerHTML = "";

    subcategories.forEach(sub => {
        const subName = typeof sub === 'string' ? sub : sub.name;
        const subImg = typeof sub === 'object' ? sub.image : 'https://placehold.co/300';

        const card = document.createElement('a');
        card.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}&subcategory=${encodeURIComponent(subName)}`;
        
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

    mainView.classList.add('hidden');
    subView.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.showMainCategories = () => {
    subView.classList.add('hidden');
    mainView.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

document.addEventListener('DOMContentLoaded', loadCategories);