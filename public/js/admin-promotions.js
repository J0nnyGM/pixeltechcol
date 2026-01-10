import { db, storage, collection, getDocs, updateDoc, doc, query, orderBy, ref, uploadBytes, getDownloadURL } from "./firebase-init.js";

const tableBody = document.getElementById('admin-products-list');
const searchInput = document.getElementById('promo-search');
const modal = document.getElementById('promo-config-modal');
const form = document.getElementById('promo-form');
const fileContainer = document.getElementById('custom-file-container');
const radioButtons = document.getElementsByName('bannerType');

// Variables locales
let allProducts = [];
let currentConfig = { id: null, field: null };

// --- 1. CARGA DE DATOS ---
async function loadProductsAdmin() {
    tableBody.innerHTML = `<tr><td colspan="3" class="p-20 text-center"><i class="fa-solid fa-spinner fa-spin text-2xl text-brand-cyan"></i></td></tr>`;
    
    try {
        const snap = await getDocs(query(collection(db, "products"), orderBy("name", "asc")));
        allProducts = []; 
        
        snap.forEach(docSnap => {
            allProducts.push({ id: docSnap.id, ...docSnap.data() });
        });

        renderProducts(allProducts);

    } catch (e) { console.error(e); }
}

// --- 2. RENDERIZADO (Con corrección de Imágenes) ---
function renderProducts(products) {
    tableBody.innerHTML = "";

    if (products.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" class="p-10 text-center text-gray-400 text-xs font-bold uppercase">No hay productos.</td></tr>`;
        return;
    }

    products.forEach(p => {
        // --- CORRECCIÓN DE IMAGEN ---
        // Buscamos en este orden: mainImage -> image -> primera imagen del array images -> placeholder
        let imageSrc = 'https://placehold.co/50';

        if (p.mainImage) {
            imageSrc = p.mainImage;
        } else if (p.image) {
            imageSrc = p.image;
        } else if (p.images && Array.isArray(p.images) && p.images.length > 0) {
            imageSrc = p.images[0];
        }
        // ---------------------------
        
        const isHeroPromo = p.isHeroPromo || false;
        const isNewLaunch = p.isNewLaunch || false;

        // Iconos si tiene banner personalizado
        const customIconHero = p.promoBannerUrl ? `<i class="fa-solid fa-image text-[8px] ml-1" title="Banner Custom"></i>` : '';
        const customIconLaunch = p.launchBannerUrl ? `<i class="fa-solid fa-image text-[8px] ml-1" title="Banner Custom"></i>` : '';

        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-50 hover:bg-gray-50/50 transition";
        tr.innerHTML = `
            <td class="p-6">
                <div class="flex items-center gap-4">
                    <img src="${imageSrc}" class="w-12 h-12 rounded-xl object-contain bg-gray-100 p-1 border border-gray-200">
                    <div>
                        <p class="font-bold text-sm text-brand-black uppercase tracking-tighter">${p.name}</p>
                        <p class="text-[9px] font-black text-brand-cyan uppercase">${p.category || 'Sin Categoría'}</p>
                    </div>
                </div>
            </td>
            <td class="p-6 text-center">
                <button onclick="updateFlag('${p.id}', 'isHeroPromo', ${!isHeroPromo})" 
                        class="w-10 h-10 rounded-full transition flex items-center justify-center mx-auto ${isHeroPromo ? 'bg-brand-red text-white shadow-lg shadow-red-500/30' : 'bg-gray-100 text-gray-300 hover:text-gray-500'}">
                    <i class="fa-solid fa-fire text-sm"></i> ${customIconHero}
                </button>
            </td>
            <td class="p-6 text-center">
                <button onclick="updateFlag('${p.id}', 'isNewLaunch', ${!isNewLaunch})" 
                        class="w-10 h-10 rounded-full transition flex items-center justify-center mx-auto ${isNewLaunch ? 'bg-brand-cyan text-brand-black shadow-lg shadow-cyan-500/30' : 'bg-gray-100 text-gray-300 hover:text-gray-500'}">
                    <i class="fa-solid fa-star text-sm"></i> ${customIconLaunch}
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

// --- 3. BUSCADOR INTELIGENTE ---
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allProducts.filter(p => 
        p.name.toLowerCase().includes(term) || 
        (p.category && p.category.toLowerCase().includes(term))
    );
    renderProducts(filtered);
});

// --- 4. LÓGICA DE ACTUALIZACIÓN ---
window.updateFlag = async (id, field, value) => {
    // Si vamos a ACTIVAR (true), preguntamos configuración
    if (value === true) {
        openConfigModal(id, field);
    } else {
        // DESACTIVAR DIRECTO
        try {
            const productRef = doc(db, "products", id);
            
            // Campo de URL a limpiar
            const urlField = field === 'isHeroPromo' ? 'promoBannerUrl' : 'launchBannerUrl';
            
            await updateDoc(productRef, { 
                [field]: false,
                [urlField]: null 
            });
            
            loadProductsAdmin();
        } catch (e) {
            alert("Error al actualizar: " + e.message);
        }
    }
};

// --- 5. MODAL CONFIGURACIÓN ---
function openConfigModal(id, field) {
    currentConfig = { id, field };
    form.reset();
    fileContainer.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

window.closeConfigModal = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    currentConfig = { id: null, field: null };
};

// Toggle input file
radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
            fileContainer.classList.remove('hidden');
        } else {
            fileContainer.classList.add('hidden');
        }
    });
});

// Submit del Modal (Guardar)
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const originalText = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    try {
        const bannerType = document.querySelector('input[name="bannerType"]:checked').value;
        let bannerUrl = null;

        // Subir imagen personalizada si aplica
        if (bannerType === 'custom') {
            const fileInput = document.getElementById('banner-file');
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const storageRef = ref(storage, `banners/${currentConfig.field}/${currentConfig.id}_${Date.now()}`);
                await uploadBytes(storageRef, file);
                bannerUrl = await getDownloadURL(storageRef);
            } else {
                alert("⚠️ Selecciona una imagen para el banner personalizado.");
                btn.disabled = false; btn.textContent = originalText;
                return;
            }
        }

        const urlField = currentConfig.field === 'isHeroPromo' ? 'promoBannerUrl' : 'launchBannerUrl';

        const productRef = doc(db, "products", currentConfig.id);
        await updateDoc(productRef, {
            [currentConfig.field]: true, // Activar flag
            [urlField]: bannerUrl || null // Guardar URL o null (automático)
        });

        closeConfigModal();
        loadProductsAdmin();

    } catch (e) {
        console.error(e);
        alert("Error al guardar: " + e.message);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
});

loadProductsAdmin();