import { db, doc, getDoc, setDoc, collection, query, getDocs, updateDoc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// ESTADO GLOBAL
let shippingGroups = []; 
let activeGroupId = null;
let excludedProducts = [];
let allProductsCache = null;

// ELEMENTOS DOM
const groupsContainer = document.getElementById('groups-container');
const cityModal = document.getElementById('city-modal');
const deptSelect = document.getElementById('modal-dept-select');
const citySelect = document.getElementById('modal-city-select');

const searchExcludedInput = document.getElementById('search-excluded-input');
const searchExcludedResults = document.getElementById('search-excluded-results');
const excludedProductsContainer = document.getElementById('excluded-products-container');

// --- UTILIDADES MONEDA ---
const formatCurrency = (value) => {
    if (value === "" || value === null || value === undefined) return "";
    return "$ " + Number(value).toLocaleString("es-CO");
};

const parseCurrency = (value) => {
    return Number(value.replace(/[^0-9]/g, '')) || 0;
};

// Aplicar listeners a inputs estáticos
document.querySelectorAll('.currency-input').forEach(input => {
    input.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = formatCurrency(val);
    });
    input.addEventListener('focus', (e) => e.target.select());
});


/**
 * --- 1. CARGA INICIAL ---
 */
async function init() {
    try {
        const configSnap = await getDoc(doc(db, "config", "shipping"));
        if (configSnap.exists()) {
            const data = configSnap.data();
            
            // Cargar valores y formatear
            document.getElementById('free-threshold').value = formatCurrency(data.freeThreshold || 0);
            document.getElementById('default-price').value = formatCurrency(data.defaultPrice || 0);
            document.getElementById('cutoff-time').value = data.cutoffTime || "14:00"; 
            
            shippingGroups = data.groups || [];
            excludedProducts = data.excludedProducts || [];
        }
        renderGroups();
        renderExcludedProducts();
        loadDepartments();
        preloadProductsCache();
    } catch (e) { console.error("Error inicializando:", e); }
}

/**
 * Pre-cargar productos para búsqueda ultra rápida
 */
async function preloadProductsCache() {
    try {
        const snap = await getDocs(collection(db, "products"));
        allProductsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.warn("No se pudo pre-cargar caché de productos:", e);
    }
}

/**
 * --- 2. GESTIÓN DE PRODUCTOS EXCLUIDOS ---
 */
function renderExcludedProducts() {
    if (!excludedProductsContainer) return;

    if (excludedProducts.length === 0) {
        excludedProductsContainer.innerHTML = `
            <div class="col-span-full p-8 text-center border-2 border-dashed border-gray-100 rounded-[2rem]">
                <i class="fa-solid fa-box-open text-3xl text-gray-200 mb-3"></i>
                <p class="text-gray-400 font-bold uppercase text-[10px] tracking-widest">No hay productos excluidos configurados</p>
            </div>`;
        return;
    }

    excludedProductsContainer.innerHTML = excludedProducts.map(p => `
        <div class="p-5 border-2 border-gray-100 rounded-[2rem] bg-slate-50 flex items-center justify-between gap-4 group">
            <div class="flex items-center gap-4 min-w-0">
                <img src="${p.image || '/img/placeholder.webp'}" alt="${p.name}" class="w-14 h-14 object-cover rounded-xl border border-gray-200 flex-shrink-0 bg-white">
                <div class="min-w-0">
                    <p class="font-black text-xs text-brand-black truncate" title="${p.name}">${p.name}</p>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="text-[9px] font-bold text-gray-400 uppercase">${p.sku ? 'SKU: ' + p.sku : 'Ref: ' + (p.id ? p.id.slice(0, 8) : '')}</span>
                        <span class="bg-red-100 text-red-700 text-[8px] font-black px-2 py-0.5 rounded-md uppercase">Excluido</span>
                    </div>
                </div>
            </div>
            <button onclick="window.removeExcludedProduct('${p.id}')" class="p-3 text-gray-300 hover:text-red-500 transition rounded-xl hover:bg-white flex-shrink-0">
                <i class="fa-solid fa-trash-can text-sm"></i>
            </button>
        </div>
    `).join('');
}

window.removeExcludedProduct = (productId) => {
    excludedProducts = excludedProducts.filter(p => p.id !== productId);
    renderExcludedProducts();
};

window.addExcludedProduct = (product) => {
    if (!excludedProducts.some(p => p.id === product.id)) {
        excludedProducts.push({
            id: product.id,
            name: product.name || 'Producto sin nombre',
            image: product.image || (Array.isArray(product.images) && product.images[0]) || '/img/placeholder.webp',
            price: Number(product.price) || 0,
            sku: product.sku || product.ref || ''
        });
        renderExcludedProducts();
    }
    if (searchExcludedResults) searchExcludedResults.classList.add('hidden');
    if (searchExcludedInput) searchExcludedInput.value = '';
};

// Buscador en vivo de productos
if (searchExcludedInput) {
    searchExcludedInput.addEventListener('input', async (e) => {
        const queryStr = e.target.value.trim().toLowerCase();
        if (queryStr.length < 2) {
            searchExcludedResults.classList.add('hidden');
            return;
        }

        let matches = [];
        if (allProductsCache) {
            matches = allProductsCache.filter(p => 
                (p.name && p.name.toLowerCase().includes(queryStr)) ||
                (p.sku && p.sku.toLowerCase().includes(queryStr)) ||
                (p.ref && p.ref.toLowerCase().includes(queryStr))
            );
        } else {
            try {
                const snap = await getDocs(collection(db, "products"));
                matches = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => 
                    (p.name && p.name.toLowerCase().includes(queryStr)) ||
                    (p.sku && p.sku.toLowerCase().includes(queryStr))
                );
            } catch (err) {
                console.error("Error buscando productos:", err);
            }
        }

        if (matches.length === 0) {
            searchExcludedResults.innerHTML = `
                <div class="p-4 text-center text-xs text-gray-400 font-bold uppercase">No se encontraron productos</div>`;
        } else {
            searchExcludedResults.innerHTML = matches.slice(0, 10).map(p => {
                const img = p.image || (Array.isArray(p.images) && p.images[0]) || '/img/placeholder.webp';
                const isAlreadyExcluded = excludedProducts.some(ep => ep.id === p.id);
                return `
                    <div class="p-4 hover:bg-slate-50 flex items-center justify-between cursor-pointer transition" 
                         onclick='window.addExcludedProduct(${JSON.stringify({ id: p.id, name: p.name, image: img, price: p.price, sku: p.sku || '' }).replace(/'/g, "&#39;")})'>
                        <div class="flex items-center gap-3 min-w-0">
                            <img src="${img}" class="w-10 h-10 object-cover rounded-lg border border-gray-200 bg-white">
                            <div class="min-w-0">
                                <p class="font-bold text-xs text-brand-black truncate">${p.name}</p>
                                <p class="text-[9px] font-bold text-brand-cyan">${formatCurrency(p.price)}</p>
                            </div>
                        </div>
                        ${isAlreadyExcluded ? 
                            `<span class="text-[9px] font-black text-gray-400 uppercase bg-gray-100 px-3 py-1 rounded-lg">Ya Excluido</span>` : 
                            `<button class="bg-brand-cyan text-brand-black text-[9px] font-black uppercase px-3 py-1.5 rounded-lg hover:bg-brand-black hover:text-white transition">+ Excluir</button>`
                        }
                    </div>`;
            }).join('');
        }
        searchExcludedResults.classList.remove('hidden');
    });

    // Cerrar menú de resultados al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (!searchExcludedInput.contains(e.target) && !searchExcludedResults.contains(e.target)) {
            searchExcludedResults.classList.add('hidden');
        }
    });
}

/**
 * --- 3. GESTIÓN DE GRUPOS ---
 */
document.getElementById('btn-add-group').onclick = () => {
    shippingGroups.push({ id: Date.now().toString(), price: 0, cities: [] });
    renderGroups();
};

function renderGroups() {
    groupsContainer.innerHTML = shippingGroups.length === 0 ? 
        `<p class="text-center text-gray-300 py-10 uppercase text-[10px] font-black">No hay grupos de tarifa especial.</p>` : "";

    shippingGroups.forEach((group) => {
        const div = document.createElement('div');
        div.className = "p-8 border-2 border-gray-100 rounded-[2rem] bg-slate-50 space-y-6 relative group";
        
        const priceInputHtml = `
            <div class="admin-input-group">
                <label>Precio del Envío (COP)</label>
                <input type="text" 
                       class="currency-input-group" 
                       value="${formatCurrency(group.price)}" 
                       data-id="${group.id}" 
                       placeholder="$ 0">
            </div>`;

        div.innerHTML = `
            <button onclick="window.removeGroup('${group.id}')" class="absolute top-6 right-6 text-gray-300 hover:text-red-500 transition">
                <i class="fa-solid fa-trash-can"></i>
            </button>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                ${priceInputHtml}
                <div class="md:col-span-2">
                    <label class="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3">Ciudades vinculadas a esta tarifa</label>
                    <div class="flex flex-wrap gap-2">
                        ${group.cities.map(city => `
                            <span class="city-badge bg-white border border-gray-200">
                                ${city}
                                <i class="fa-solid fa-xmark cursor-pointer hover:text-red-500" onclick="window.removeCityFromGroup('${group.id}', '${city}')"></i>
                            </span>
                        `).join('')}
                        <button onclick="window.openAddCity('${group.id}')" class="h-8 px-4 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-[9px] font-black hover:border-brand-cyan hover:text-brand-cyan transition">
                            + AÑADIR CIUDAD
                        </button>
                    </div>
                </div>
            </div>
        `;
        groupsContainer.appendChild(div);

        const input = div.querySelector('.currency-input-group');
        input.addEventListener('input', (e) => {
            const val = parseCurrency(e.target.value);
            e.target.value = formatCurrency(val);
            window.updateGroupPrice(group.id, val);
        });
        input.addEventListener('focus', (e) => e.target.select());
    });
}

window.updateGroupPrice = (id, priceRaw) => {
    const group = shippingGroups.find(g => g.id === id);
    if(group) group.price = Number(priceRaw);
};

window.removeGroup = (id) => {
    if(confirm("¿Eliminar este grupo de tarifas?")) {
        shippingGroups = shippingGroups.filter(g => g.id !== id);
        renderGroups();
    }
};

window.removeCityFromGroup = (groupId, cityName) => {
    const group = shippingGroups.find(g => g.id === groupId);
    if(group) {
        group.cities = group.cities.filter(c => c !== cityName);
        renderGroups();
    }
};

/**
 * --- 4. MODAL Y API COLOMBIA ---
 */
async function loadDepartments() {
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        deptSelect.innerHTML = '<option value="">Seleccione Departamento...</option>';
        depts.forEach(d => {
            deptSelect.innerHTML += `<option value="${d.id}">${d.name}</option>`;
        });
    } catch (e) { console.error("Error API:", e); }
}

deptSelect.onchange = async (e) => {
    if(!e.target.value) return;
    citySelect.disabled = true;
    citySelect.innerHTML = '<option>Cargando ciudades...</option>';
    
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${e.target.value}/cities`);
        const cities = await res.json();
        citySelect.innerHTML = '<option value="">Seleccione Ciudad...</option>';
        cities.forEach(c => {
            citySelect.innerHTML += `<option value="${c.name}">${c.name}</option>`;
        });
        citySelect.disabled = false;
    } catch (e) { console.error(e); }
};

window.openAddCity = (groupId) => {
    activeGroupId = groupId;
    cityModal.classList.remove('hidden');
};

document.getElementById('btn-close-modal').onclick = () => cityModal.classList.add('hidden');

document.getElementById('btn-confirm-city').onclick = () => {
    const cityName = citySelect.value;
    if(!cityName) return;

    const group = shippingGroups.find(g => g.id === activeGroupId);
    if(group && !group.cities.includes(cityName)) {
        group.cities.push(cityName);
        renderGroups();
        cityModal.classList.add('hidden');
        citySelect.value = "";
    } else {
        alert("La ciudad ya está en este grupo o no es válida.");
    }
};

/**
 * --- 5. GUARDAR EN FIRESTORE Y ACTUALIZAR PRODUCTOS ---
 */
document.getElementById('btn-save-config').onclick = async () => {
    const btn = document.getElementById('btn-save-config');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    const freeThresholdRaw = parseCurrency(document.getElementById('free-threshold').value);
    const defaultPriceRaw = parseCurrency(document.getElementById('default-price').value);

    const excludedProductIds = excludedProducts.map(p => p.id);

    const config = {
        freeThreshold: freeThresholdRaw,
        defaultPrice: defaultPriceRaw,
        cutoffTime: document.getElementById('cutoff-time').value, 
        groups: shippingGroups,
        excludedProducts: excludedProducts,
        excludedProductIds: excludedProductIds,
        updatedAt: new Date()
    };

    try {
        await setDoc(doc(db, "config", "shipping"), config);
        
        // Actualizar caché de sesión local para reflejo inmediato en el navegador
        sessionStorage.setItem('pixeltech_shipping_config', JSON.stringify(config));

        // Sincronizar campo excludeFromFreeShipping en los documentos de productos
        if (allProductsCache) {
            for (const p of allProductsCache) {
                const shouldBeExcluded = excludedProductIds.includes(p.id);
                if (p.excludeFromFreeShipping !== shouldBeExcluded) {
                    await updateDoc(doc(db, "products", p.id), { excludeFromFreeShipping: shouldBeExcluded }).catch(() => {});
                }
            }
        }

        alert("✅ Configuración de logística y productos excluidos actualizada.");
        init();
    } catch (e) {
        alert("Error al guardar: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Guardar Cambios';
    }
};

init();