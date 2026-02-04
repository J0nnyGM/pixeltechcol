import { db, storage, collection, getDocs, updateDoc, doc, query, orderBy, ref, uploadBytes, getDownloadURL, where, limit, startAt, endAt } from "./firebase-init.js";
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// DOM
const tableBody = document.getElementById('admin-products-list');
const searchInput = document.getElementById('promo-search');
const searchSpinner = document.getElementById('search-spinner'); 
const statusBar = document.getElementById('table-status-bar');
const modal = document.getElementById('promo-config-modal');
const form = document.getElementById('promo-form');
const fileContainer = document.getElementById('custom-file-container');
const radioButtons = document.getElementsByName('bannerType');

// Variables locales
let currentConfig = { id: null, field: null };
let activePromosCache = [];

// --- HELPER COMPRESIÓN (Optimizado para Banners Grandes) ---
const compressImage = async (file) => {
    if (!file.type.startsWith('image/')) return file;
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
            img.onload = () => {
                // Configuración Banners (Más grandes que productos)
                const maxWidth = 1920; // Full HD
                const quality = 0.85;
                
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) { reject(new Error('Error compress')); return; }
                    const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
                    resolve(new File([blob], newName, { type: 'image/webp', lastModified: Date.now() }));
                }, 'image/webp', quality);
            };
            img.onerror = (e) => reject(e);
        };
        reader.readAsDataURL(file);
    });
};

// Helper de Texto
function capitalizeFirst(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// --- 1. CARGA INICIAL (Igual) ---
async function loadActivePromotions() {
    tableBody.innerHTML = `<tr><td colspan="3" class="p-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-cyan"></i><p class="text-xs text-gray-400 mt-2 font-bold uppercase">Cargando Vitrina...</p></td></tr>`;
    if(statusBar) statusBar.classList.add('hidden');

    try {
        const q1 = query(collection(db, "products"), where("isHeroPromo", "==", true));
        const q2 = query(collection(db, "products"), where("isNewLaunch", "==", true));

        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);

        const mergedMap = new Map();
        snap1.forEach(doc => mergedMap.set(doc.id, { id: doc.id, ...doc.data() }));
        snap2.forEach(doc => mergedMap.set(doc.id, { id: doc.id, ...doc.data() }));

        activePromosCache = Array.from(mergedMap.values());
        activePromosCache.sort((a, b) => a.name.localeCompare(b.name));

        renderProducts(activePromosCache, "No hay promociones activas.");

    } catch (e) {
        console.error(e);
        tableBody.innerHTML = `<tr><td colspan="3" class="p-10 text-center text-red-400 font-bold">Error cargando promociones</td></tr>`;
    }
}

// --- 2. BUSCADOR (Igual) ---
let searchTimeout = null;
searchInput.addEventListener('input', (e) => {
    const rawTerm = e.target.value.trim();
    clearTimeout(searchTimeout);
    if (rawTerm.length === 0) { window.clearSearch(); return; }
    if(searchSpinner) searchSpinner.classList.remove('hidden');
    
    searchTimeout = setTimeout(async () => {
        try {
            const firstWord = rawTerm.split(' ')[0]; 
            const termCap = capitalizeFirst(firstWord); 
            const coll = collection(db, "products");
            const queries = [
                getDocs(query(coll, orderBy('name'), startAt(termCap), endAt(termCap + '\uf8ff'), limit(20))),
                getDocs(query(coll, orderBy('brand'), startAt(termCap), endAt(termCap + '\uf8ff'), limit(20))),
                getDocs(query(coll, orderBy('category'), startAt(termCap), endAt(termCap + '\uf8ff'), limit(20)))
            ];
            const snapshots = await Promise.all(queries);
            const tempMap = new Map();
            snapshots.forEach(snap => snap.forEach(doc => tempMap.set(doc.id, { id: doc.id, ...doc.data() })));
            
            const searchLower = rawTerm.toLowerCase();
            const finalResults = Array.from(tempMap.values()).filter(p => {
                const text = `${p.name} ${p.brand || ''} ${p.category || ''}`.toLowerCase();
                return text.includes(searchLower);
            });

            if(searchSpinner) searchSpinner.classList.add('hidden');
            if(statusBar) {
                statusBar.classList.remove('hidden');
                document.getElementById('table-status-text').textContent = `Resultados para "${rawTerm}"`;
            }
            renderProducts(finalResults, "No se encontraron productos.");
        } catch (e) {
            console.error(e);
            if(searchSpinner) searchSpinner.classList.add('hidden');
        }
    }, 400); 
});

window.clearSearch = () => {
    searchInput.value = "";
    if(searchSpinner) searchSpinner.classList.add('hidden');
    if(statusBar) statusBar.classList.add('hidden');
    renderProducts(activePromosCache); 
};

// --- 3. RENDERIZADO (Igual con Lazy) ---
function renderProducts(products, emptyMsg = "No hay productos.") {
    tableBody.innerHTML = "";
    if (products.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" class="p-10 text-center text-gray-400 text-xs font-bold uppercase">${emptyMsg}</td></tr>`;
        return;
    }
    products.forEach(p => {
        let imageSrc = p.mainImage || p.image || (p.images && p.images[0]) || 'https://placehold.co/50';
        const isHeroPromo = p.isHeroPromo || false;
        const isNewLaunch = p.isNewLaunch || false;
        const customIconHero = p.promoBannerUrl ? `<i class="fa-solid fa-image text-[8px] ml-1" title="Banner Custom"></i>` : '';
        const customIconLaunch = p.launchBannerUrl ? `<i class="fa-solid fa-image text-[8px] ml-1" title="Banner Custom"></i>` : '';

        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-50 hover:bg-gray-50/50 transition fade-in";
        tr.innerHTML = `
            <td class="p-6">
                <div class="flex items-center gap-4">
                    <img src="${imageSrc}" loading="lazy" class="w-12 h-12 rounded-xl object-contain bg-gray-100 p-1 border border-gray-200">
                    <div>
                        <p class="font-bold text-sm text-brand-black uppercase tracking-tighter">${p.name}</p>
                        <div class="flex gap-2 mt-1">
                            <span class="text-[9px] font-black text-brand-cyan uppercase bg-cyan-50 px-2 py-0.5 rounded">${p.brand || 'Genérico'}</span>
                            <span class="text-[9px] font-bold text-gray-400 uppercase border border-gray-100 px-2 py-0.5 rounded">${p.category || 'Varios'}</span>
                        </div>
                    </div>
                </div>
            </td>
            <td class="p-6 text-center">
                <button onclick="updateFlag('${p.id}', 'isHeroPromo', ${!isHeroPromo})" class="w-10 h-10 rounded-full transition flex items-center justify-center mx-auto ${isHeroPromo ? 'bg-brand-red text-white shadow-lg' : 'bg-gray-100 text-gray-300 hover:text-gray-500'}">
                    <i class="fa-solid fa-fire text-sm"></i> ${customIconHero}
                </button>
            </td>
            <td class="p-6 text-center">
                <button onclick="updateFlag('${p.id}', 'isNewLaunch', ${!isNewLaunch})" class="w-10 h-10 rounded-full transition flex items-center justify-center mx-auto ${isNewLaunch ? 'bg-brand-cyan text-brand-black shadow-lg' : 'bg-gray-100 text-gray-300 hover:text-gray-500'}">
                    <i class="fa-solid fa-star text-sm"></i> ${customIconLaunch}
                </button>
            </td>`;
        tableBody.appendChild(tr);
    });
}

// --- 4. MODAL Y GUARDADO (OPTIMIZADO) ---
window.updateFlag = async (id, field, value) => {
    if (value === true) openConfigModal(id, field);
    else {
        try {
            const productRef = doc(db, "products", id);
            const urlField = field === 'isHeroPromo' ? 'promoBannerUrl' : 'launchBannerUrl';
            await updateDoc(productRef, { [field]: false, [urlField]: null });
            if (searchInput.value.trim() === "") loadActivePromotions();
            else window.clearSearch();
        } catch (e) { alert("Error: " + e.message); }
    }
};

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

radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'custom') fileContainer.classList.remove('hidden');
        else fileContainer.classList.add('hidden');
    });
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const originalText = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    try {
        const bannerType = document.querySelector('input[name="bannerType"]:checked').value;
        let bannerUrl = null;

        if (bannerType === 'custom') {
            const fileInput = document.getElementById('banner-file');
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                
                // 1. COMPRESIÓN DE BANNER
                btn.innerHTML = '<i class="fa-solid fa-compress fa-spin"></i> Optimizando...';
                const compressedFile = await compressImage(file);
                
                // 2. SUBIDA
                btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up fa-spin"></i> Subiendo...';
                const storageRef = ref(storage, `banners/${currentConfig.field}/${currentConfig.id}_${Date.now()}_${compressedFile.name}`);
                await uploadBytes(storageRef, compressedFile);
                bannerUrl = await getDownloadURL(storageRef);
            } else {
                alert("⚠️ Selecciona una imagen.");
                btn.disabled = false; btn.textContent = originalText;
                return;
            }
        }

        const urlField = currentConfig.field === 'isHeroPromo' ? 'promoBannerUrl' : 'launchBannerUrl';
        const productRef = doc(db, "products", currentConfig.id);
        
        await updateDoc(productRef, { [currentConfig.field]: true, [urlField]: bannerUrl || null });

        closeConfigModal();
        if (searchInput.value.trim() === "") loadActivePromotions();
        else window.clearSearch();

    } catch (e) {
        console.error(e);
        alert("Error al guardar: " + e.message);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
});

loadActivePromotions();