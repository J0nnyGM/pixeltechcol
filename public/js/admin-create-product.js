import { db, storage, collection, addDoc, getDocs, ref, uploadBytes, getDownloadURL } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const form = document.getElementById('main-form');
const btnPublish = document.getElementById('btn-publish');
const descriptionEditor = document.getElementById('p-description-editor');

// Estado Global (Mover al inicio para evitar errores de referencia)
let selectedFiles = []; 
let productVariants = [];
let productCapacities = [];

/**
 * --- 1. GESTIÓN DE GALERÍA GLOBAL ---
 */
const pImagesInput = document.getElementById('p-images');
if (pImagesInput) {
    pImagesInput.onchange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            const id = Math.random().toString(36).substr(2, 9);
            selectedFiles.push({ id, file });
        });
        renderGallery();
        e.target.value = "";
    };
}

function renderGallery() {
    const container = document.getElementById('gallery-container');
    if (!container) return;
    container.innerHTML = "";

    selectedFiles.forEach((item, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = "relative aspect-square rounded-2xl overflow-hidden border-2 border-gray-100 bg-white group shadow-sm";
            div.innerHTML = `
                <img src="${e.target.result}" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-brand-black/80 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                    <div class="flex gap-1">
                        <button type="button" onclick="moveImage(${index}, -1)" class="w-8 h-8 rounded-lg bg-white/20 text-white hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-left text-xs"></i></button>
                        <button type="button" onclick="moveImage(${index}, 1)" class="w-8 h-8 rounded-lg bg-white/20 text-white hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-right text-xs"></i></button>
                    </div>
                    <button type="button" onclick="removeImage('${item.id}')" class="text-[8px] font-black uppercase text-red-400 hover:text-red-200 transition mt-2">Eliminar</button>
                </div>
                <div class="absolute top-2 left-2 bg-brand-black/50 backdrop-blur-md text-white text-[7px] px-2 py-1 rounded-md font-bold">
                    ${index === 0 ? 'PORTADA' : 'POSICIÓN ' + (index + 1)}
                </div>
            `;
            container.appendChild(div);
        };
        reader.readAsDataURL(item.file);
    });
}

window.moveImage = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= selectedFiles.length) return;
    const temp = selectedFiles[index];
    selectedFiles[index] = selectedFiles[newIndex];
    selectedFiles[newIndex] = temp;
    renderGallery();
};

window.removeImage = (id) => {
    selectedFiles = selectedFiles.filter(img => img.id !== id);
    renderGallery();
};

/**
 * --- 2. VARIANTES DE COLOR ---
 */
const btnAddVariant = document.getElementById('btn-add-variant');
if (btnAddVariant) {
    btnAddVariant.onclick = () => {
        const variantId = Math.random().toString(36).substr(2, 9);
        productVariants.push({ id: variantId, color: '', files: [] });
        renderVariants();
    };
}

function renderVariants() {
    const container = document.getElementById('variants-container');
    if (!container) return;
    container.innerHTML = productVariants.length === 0 ? 
        `<p class="text-center text-gray-400 text-[10px] font-bold uppercase py-4">No has agregado variantes de color aún.</p>` : "";

    productVariants.forEach((v) => {
        const div = document.createElement('div');
        div.className = "p-6 border-2 border-gray-100 rounded-3xl bg-slate-50 space-y-4 mb-4";
        div.innerHTML = `
            <div class="flex justify-between items-center gap-4">
                <div class="flex-grow">
                    <label class="block text-[9px] font-black text-gray-400 uppercase mb-1">Nombre del Color</label>
                    <input type="text" placeholder="Ej: Azul Medianoche" value="${v.color}" 
                        onchange="updateVariantColor('${v.id}', this.value)"
                        class="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm font-bold outline-none focus:border-brand-cyan">
                </div>
                <button type="button" onclick="removeVariant('${v.id}')" class="mt-5 text-red-400 hover:text-red-600 transition">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
            <div class="grid grid-cols-4 gap-3" id="v-pics-${v.id}"></div>
            <label class="block w-full py-3 bg-white border border-dashed border-gray-300 rounded-xl text-center cursor-pointer hover:border-brand-cyan transition">
                <span class="text-[9px] font-black text-gray-400 uppercase">Subir fotos para este color</span>
                <input type="file" multiple accept="image/*" class="hidden" onchange="addVariantImages('${v.id}', this.files)">
            </label>
        `;
        container.appendChild(div);
        renderVariantImages(v);
    });
}

function renderVariantImages(v) {
    const picContainer = document.getElementById(`v-pics-${v.id}`);
    if (!picContainer) return;
    picContainer.innerHTML = "";

    v.files.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const imgDiv = document.createElement('div');
            imgDiv.className = "relative aspect-square rounded-xl overflow-hidden border bg-white";
            imgDiv.innerHTML = `<img src="${e.target.result}" class="w-full h-full object-cover">`;
            picContainer.appendChild(imgDiv);
        };
        reader.readAsDataURL(file);
    });
}

window.updateVariantColor = (id, val) => {
    const v = productVariants.find(item => item.id === id);
    if (v) v.color = val;
};

window.addVariantImages = (id, files) => {
    const v = productVariants.find(item => item.id === id);
    if (v) {
        Array.from(files).forEach(f => v.files.push(f));
        renderVariants();
    }
};

window.removeVariant = (id) => {
    productVariants = productVariants.filter(v => v.id !== id);
    renderVariants();
};

/**
 * --- 3. VARIANTES DE CAPACIDAD ---
 */
const btnAddCap = document.getElementById('btn-add-capacity');
if (btnAddCap) {
    btnAddCap.onclick = () => {
        const capId = Math.random().toString(36).substr(2, 9);
        productCapacities.push({ id: capId, label: '', price: 0 });
        renderCapacities();
    };
}

function renderCapacities() {
    const container = document.getElementById('capacities-container');
    if (!container) return;
    if (productCapacities.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-400 text-[10px] font-bold uppercase py-4">Este dispositivo no tiene variantes de capacidad.</p>`;
        return;
    }
    
    container.innerHTML = "";
    productCapacities.forEach((c) => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-4 p-4 border-2 border-gray-100 rounded-2xl bg-white mb-2";
        div.innerHTML = `
            <div class="flex-grow grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-[8px] font-black text-gray-400 uppercase mb-1">Capacidad (ej: 256GB)</label>
                    <input type="text" value="${c.label}" onchange="updateCapValue('${c.id}', 'label', this.value)"
                        class="w-full bg-slate-50 border border-gray-200 rounded-lg p-2 text-xs font-bold outline-none focus:border-brand-cyan">
                </div>
                <div>
                    <label class="block text-[8px] font-black text-gray-400 uppercase mb-1">Precio para esta capacidad</label>
                    <input type="number" value="${c.price}" onchange="updateCapValue('${c.id}', 'price', this.value)"
                        class="w-full bg-slate-50 border border-gray-200 rounded-lg p-2 text-xs font-bold text-brand-cyan outline-none focus:border-brand-cyan">
                </div>
            </div>
            <button type="button" onclick="removeCapacity('${c.id}')" class="text-gray-300 hover:text-brand-red transition p-2">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        container.appendChild(div);
    });
}

window.updateCapValue = (id, field, val) => {
    const cap = productCapacities.find(item => item.id === id);
    if(cap) cap[field] = field === 'price' ? Number(val) : val;
};

window.removeCapacity = (id) => {
    productCapacities = productCapacities.filter(c => c.id !== id);
    renderCapacities();
};

/**
 * --- 4. BUSCADOR DE CATEGORÍAS ---
 */
const catSearchInput = document.getElementById('cat-search');
const catResults = document.getElementById('cat-results');
const pCategoryHidden = document.getElementById('p-category');

if (catSearchInput) {
    catSearchInput.oninput = async (e) => {
        const term = e.target.value.toLowerCase();
        if (term.length < 1) { catResults.classList.add('hidden'); return; }

        const snap = await getDocs(collection(db, "categories"));
        catResults.innerHTML = '';
        let found = false;

        snap.forEach(d => {
            const cat = d.data();
            cat.subcategories.forEach(sub => {
                if (sub.toLowerCase().includes(term) || cat.name.toLowerCase().includes(term)) {
                    found = true;
                    const div = document.createElement('div');
                    div.className = "p-4 hover:bg-brand-cyan/10 cursor-pointer text-xs font-bold rounded-xl flex justify-between items-center transition";
                    div.innerHTML = `<span>${sub}</span> <span class="text-[8px] text-gray-400 uppercase bg-gray-50 px-2 py-1 rounded-md">${cat.name}</span>`;
                    div.onclick = () => {
                        catSearchInput.value = sub;
                        pCategoryHidden.value = sub;
                        catResults.classList.add('hidden');
                    };
                    catResults.appendChild(div);
                }
            });
        });
        if (found) catResults.classList.remove('hidden');
        else catResults.classList.add('hidden');
    };
}

/**
 * --- 5. PUBLICACIÓN ---
 */
form.onsubmit = async (e) => {
    e.preventDefault();

    if (selectedFiles.length === 0 && productVariants.length === 0) {
        alert("🚨 Debes subir al menos una imagen global o agregar una variante con fotos.");
        return;
    }

    if (!pCategoryHidden.value) {
        alert("🚨 Selecciona una categoría válida usando el buscador.");
        return;
    }

    btnPublish.disabled = true;
    btnPublish.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> PUBLICANDO...';

    try {
        // 1. Subir Imágenes Globales
        const imageUrls = [];
        for (const item of selectedFiles) {
            const fileName = `products/global/${Date.now()}_${item.file.name.replace(/\s+/g, '_')}`;
            const fileRef = ref(storage, fileName);
            await uploadBytes(fileRef, item.file);
            imageUrls.push(await getDownloadURL(fileRef));
        }

        // 2. Subir Imágenes de Variantes
        const variantsData = [];
        for (const v of productVariants) {
            const vUrls = [];
            for (const file of v.files) {
                const fileRef = ref(storage, `products/variants/${Date.now()}_${v.color.replace(/\s+/g, '_')}_${file.name.replace(/\s+/g, '_')}`);
                await uploadBytes(fileRef, file);
                vUrls.push(await getDownloadURL(fileRef));
            }
            variantsData.push({ color: v.color, images: vUrls });
        }

        const productData = {
            name: document.getElementById('p-name').value,
            sku: document.getElementById('p-sku').value,
            brand: document.getElementById('p-brand').value,
            stock: Number(document.getElementById('p-stock').value),
            category: pCategoryHidden.value,
            description: descriptionEditor.innerHTML,
            images: imageUrls,
            mainImage: imageUrls.length > 0 ? imageUrls[0] : (variantsData[0]?.images[0] || ''),
            status: 'active',
            createdAt: new Date(),
            hasVariants: variantsData.length > 0,
            variants: variantsData,
            hasCapacities: productCapacities.length > 0,
            capacities: productCapacities.map(c => ({ label: c.label, price: c.price })),
            // Precio: Mínimo de capacidades o precio base
            price: productCapacities.length > 0 ? 
                   Math.min(...productCapacities.map(c => c.price)) : 
                   Number(document.getElementById('p-price').value),
        };

        await addDoc(collection(db, "products"), productData);
        alert("✅ Producto publicado exitosamente.");
        window.location.href = "products.html";

    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
        btnPublish.disabled = false;
        btnPublish.innerHTML = "Guardar en Inventario";
    }
};

window.formatDoc = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    descriptionEditor.focus();
};