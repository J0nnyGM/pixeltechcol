import { db, collection, getDocs, query, orderBy, where } from "./firebase-init.js";

const grid = document.getElementById('brands-grid');

// Variables de estado
let brandsData = [];
const STORAGE_KEY = 'pixeltech_brands';
const SYNC_KEY = 'pixeltech_brands_last_sync';

// CONFIGURACIÓN DE AHORRO
const SYNC_TTL = 1000 * 60 * 10; // 10 Minutos (Tiempo de vida de la caché)

// ==========================================================================
// 🧠 SMART DELTA SYNC + TTL (Máxima Eficiencia)
// ==========================================================================
async function loadBrands() {
    // 1. CARGA INICIAL
    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    let lastSyncTime = parseInt(localStorage.getItem(SYNC_KEY) || '0');
    const now = Date.now();

    if (cachedRaw) {
        try {
            const parsed = JSON.parse(cachedRaw);
            
            // Validación de integridad
            const isCacheValid = parsed.length === 0 || (parsed[0] && parsed[0].id);
            
            if (!isCacheValid) {
                console.warn("⚠️ Caché antigua. Limpiando...");
                brandsData = [];
                lastSyncTime = 0; 
                localStorage.removeItem(STORAGE_KEY);
            } else {
                brandsData = parsed;
                if (brandsData.length > 0) {
                    console.log(`⚡ [Brands] Cargadas ${brandsData.length} marcas de memoria.`);
                    renderGrid(); 
                }
            }
        } catch (e) {
            brandsData = [];
            lastSyncTime = 0;
        }
    }

    // 🚀 OPTIMIZACIÓN FINAL (TTL): 
    // Si la última verificación fue hace menos de 10 mins, NO preguntamos a Firebase.
    if (now - lastSyncTime < SYNC_TTL && brandsData.length > 0) {
        console.log("⏳ [Brands] Caché reciente. Omitiendo verificación de red.");
        return;
    }

    // 2. BUSCAR ACTUALIZACIONES
    await fetchIncrements(lastSyncTime);
}

async function fetchIncrements(lastSyncTime) {
    try {
        let q;
        const colRef = collection(db, "brands");

        if (lastSyncTime === 0 || brandsData.length === 0) {
            console.log("☁️ [Brands] Descarga completa inicial...");
            q = query(colRef); 
        } else {
            console.log("🔄 [Brands] Verificando cambios en la nube...");
            q = query(colRef, where("updatedAt", ">", new Date(lastSyncTime)));
        }

        const snapshot = await getDocs(q);

        // Actualizamos timestamp SIEMPRE para reiniciar el contador de 10 minutos
        localStorage.setItem(SYNC_KEY, Date.now().toString());

        if (snapshot.empty) {
            console.log("✅ [Brands] Todo al día.");
            return;
        }

        console.log(`🔥 [Brands] Procesando ${snapshot.size} actualizaciones.`);

        // 3. FUSIÓN
        snapshot.forEach(doc => {
            const newData = { id: doc.id, ...doc.data() };
            const index = brandsData.findIndex(b => b.id === newData.id);

            if (index > -1) {
                brandsData[index] = newData;
            } else {
                brandsData.push(newData);
            }
        });

        // 4. LIMPIEZA FINAL (Anti-Duplicados)
        const uniqueMap = new Map();
        brandsData.forEach(item => {
            if(item.id) uniqueMap.set(item.id, item);
        });
        brandsData = Array.from(uniqueMap.values());

        // 5. ORDENAR Y GUARDAR
        brandsData.sort((a, b) => a.name.localeCompare(b.name));

        localStorage.setItem(STORAGE_KEY, JSON.stringify(brandsData));
        
        renderGrid();

    } catch (error) {
        console.error("Error en Sync Brands:", error);
    }
}

// ==========================================================================
// RENDERIZADO (UI)
// ==========================================================================
function renderGrid() {
    grid.innerHTML = ""; 

    if (brandsData.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-center text-gray-400 font-bold uppercase py-10">No hay marcas registradas.</p>`;
        return;
    }

    brandsData.forEach((brand) => {
        const imageSrc = brand.image || 'https://placehold.co/400x300?text=' + brand.name;
        
        const card = document.createElement('a');
        card.href = `/shop/search.html?subcategory=${encodeURIComponent(brand.name)}`;
        
        card.className = "group relative bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl hover:border-brand-cyan/30 transition-all duration-300 hover:-translate-y-2 cursor-pointer h-56 flex flex-col";

        // AQUÍ ESTÁ EL CAMBIO EN LA ETIQUETA <img>
        card.innerHTML = `
            <div class="absolute inset-0 bg-gray-50 flex items-center justify-center p-8 group-hover:bg-white transition duration-500">
                <img src="${imageSrc}" alt="${brand.name}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-500">
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
}

document.addEventListener('DOMContentLoaded', loadBrands);