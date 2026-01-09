import { auth, db, storage, doc, getDoc, updateDoc, collection, getDocs, addDoc, query, orderBy, limit, ref, uploadBytes, getDownloadURL } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const params = new URLSearchParams(window.location.search);
const productId = params.get('id');
const form = document.getElementById('main-form');
const btnUpdate = document.getElementById('btn-update');
const descriptionEditor = document.getElementById('p-description-editor');

// ESTADO GLOBAL
let galleryItems = []; // { id, type: 'url'|'file', content }
let productVariants = []; // { id, color, images: [{id, type, content}] }
let productCapacities = []; // { id, label, price }

/**
 * --- 1. CARGA INICIAL ---
 */
async function initEdit() {
    if (!productId) { window.location.href = 'products.html'; return; }

    try {
        const docSnap = await getDoc(doc(db, "products", productId));
        if (!docSnap.exists()) { window.location.href = 'products.html'; return; }

        const p = docSnap.data();
        
        // Llenar campos básicos
        document.getElementById('p-name').value = p.name || '';
        document.getElementById('p-sku').value = p.sku || '';
        document.getElementById('p-brand').value = p.brand || '';
        document.getElementById('p-price').value = p.price || 0;
        document.getElementById('p-stock').value = p.stock || 0;
        document.getElementById('p-category').value = p.category || '';
        document.getElementById('cat-search').value = p.category || '';
        document.getElementById('product-id-display').textContent = `ID: ${productId}`;
        descriptionEditor.innerHTML = p.description || '';

        // Cargar Multimedia Global
        if (p.images) {
            galleryItems = p.images.map(url => ({ id: Math.random().toString(36).substr(2,9), type: 'url', content: url }));
        }

        // Cargar Variantes
        if (p.variants) {
            productVariants = p.variants.map(v => ({
                id: Math.random().toString(36).substr(2,9),
                color: v.color,
                images: v.images.map(url => ({ id: Math.random().toString(36).substr(2,9), type: 'url', content: url }))
            }));
        }

        // Cargar Capacidades
        if (p.capacities) {
            productCapacities = p.capacities.map(c => ({
                id: Math.random().toString(36).substr(2,9),
                label: c.label,
                price: c.price
            }));
        }
        
        renderGallery();
        renderVariants();
        renderCapacities();
        loadProductHistory();

        document.getElementById('loader-view').classList.add('hidden');
        document.getElementById('edit-view').classList.remove('hidden');

    } catch (e) { console.error("Error cargando producto:", e); }
}

/**
 * --- 2. GESTIÓN MULTIMEDIA GLOBAL ---
 */
const pImagesInput = document.getElementById('p-images');
if (pImagesInput) {
    pImagesInput.onchange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            galleryItems.push({ id: Math.random().toString(36).substr(2,9), type: 'file', content: file });
        });
        renderGallery();
    };
}

function renderGallery() {
    const container = document.getElementById('gallery-container');
    if(!container) return;
    container.innerHTML = "";
    
    galleryItems.forEach((item, index) => {
        const src = item.type === 'url' ? item.content : URL.createObjectURL(item.content);
        const div = document.createElement('div');
        div.className = "relative aspect-square rounded-2xl overflow-hidden border shadow-sm group bg-white";
        div.innerHTML = `
            <img src="${src}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-brand-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                <div class="flex gap-2">
                    <button type="button" onclick="moveGlobalImg(${index}, -1)" class="w-8 h-8 rounded-lg bg-white text-brand-black hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-left text-xs"></i></button>
                    <button type="button" onclick="moveGlobalImg(${index}, 1)" class="w-8 h-8 rounded-lg bg-white text-brand-black hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-right text-xs"></i></button>
                </div>
                <button type="button" onclick="removeGlobalImg('${item.id}')" class="text-[8px] font-black uppercase text-red-400">Eliminar</button>
            </div>
            <div class="absolute top-2 left-2 bg-brand-black/50 backdrop-blur-md text-white text-[7px] px-2 py-1 rounded-md font-bold uppercase">
                ${index === 0 ? 'Portada' : 'Pos. ' + (index + 1)}
            </div>`;
        container.appendChild(div);
    });
}

// Lógica de movimiento global
window.moveGlobalImg = (index, direction) => {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= galleryItems.length) return;
    const temp = galleryItems[index];
    galleryItems[index] = galleryItems[newIdx];
    galleryItems[newIdx] = temp;
    renderGallery();
};

window.removeGlobalImg = (id) => { galleryItems = galleryItems.filter(i => i.id !== id); renderGallery(); };

/**
 * --- 3. GESTIÓN DE VARIANTES DE COLOR ---
 */
const btnAddVariant = document.getElementById('btn-add-variant');
if(btnAddVariant) {
    btnAddVariant.onclick = () => {
        productVariants.push({ id: Math.random().toString(36).substr(2,9), color: '', images: [] });
        renderVariants();
    };
}

function renderVariants() {
    const container = document.getElementById('variants-container');
    if(!container) return;
    container.innerHTML = productVariants.length === 0 ? `<p class="text-center text-gray-400 text-[10px] font-bold uppercase py-4">Sin variantes de color.</p>` : "";

    productVariants.forEach((v) => {
        const div = document.createElement('div');
        div.className = "p-6 border-2 border-gray-100 rounded-3xl bg-slate-50 space-y-4 mb-4";
        div.innerHTML = `
            <div class="flex justify-between items-center gap-4">
                <div class="flex-grow">
                    <label class="block text-[9px] font-black text-gray-400 uppercase mb-1">Nombre del Color</label>
                    <input type="text" value="${v.color}" onchange="updateVariantColor('${v.id}', this.value)"
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
            </label>`;
        container.appendChild(div);
        renderVariantImages(v);
    });
}

function renderVariantImages(v) {
    const picContainer = document.getElementById(`v-pics-${v.id}`);
    if(!picContainer) return;
    picContainer.innerHTML = "";
    
    v.images.forEach((img, index) => {
        const src = img.type === 'url' ? img.content : URL.createObjectURL(img.content);
        const imgDiv = document.createElement('div');
        imgDiv.className = "relative aspect-square rounded-xl overflow-hidden border bg-white group";
        imgDiv.innerHTML = `
            <img src="${src}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-brand-black/80 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-1">
                <div class="flex gap-1">
                    <button type="button" onclick="moveVariantImg('${v.id}', ${index}, -1)" class="w-6 h-6 rounded bg-white/20 text-white hover:bg-brand-cyan transition"><i class="fa-solid fa-chevron-left text-[10px]"></i></button>
                    <button type="button" onclick="moveVariantImg('${v.id}', ${index}, 1)" class="w-6 h-6 rounded bg-white/20 text-white hover:bg-brand-cyan transition"><i class="fa-solid fa-chevron-right text-[10px]"></i></button>
                </div>
                <button type="button" onclick="removeImgFromVariant('${v.id}', '${img.id}')" class="text-[7px] text-red-300 uppercase font-black">Eliminar</button>
            </div>`;
        picContainer.appendChild(imgDiv);
    });
}

// Lógica de movimiento por variante
window.moveVariantImg = (vId, index, direction) => {
    const v = productVariants.find(item => item.id === vId);
    if (!v) return;
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= v.images.length) return;
    
    const temp = v.images[index];
    v.images[index] = v.images[newIdx];
    v.images[newIdx] = temp;
    renderVariants(); // Renderizamos el contenedor completo para refrescar
};

window.updateVariantColor = (id, val) => { productVariants.find(v => v.id === id).color = val; };
window.removeVariant = (id) => { productVariants = productVariants.filter(v => v.id !== id); renderVariants(); };
window.removeImgFromVariant = (vId, imgId) => {
    const v = productVariants.find(item => item.id === vId);
    v.images = v.images.filter(i => i.id !== imgId);
    renderVariants();
};
window.addVariantImages = (id, files) => {
    const v = productVariants.find(item => item.id === id);
    Array.from(files).forEach(f => v.images.push({ id: Math.random().toString(36).substr(2,9), type: 'file', content: f }));
    renderVariants();
};

/**
 * --- 4. GESTIÓN DE CAPACIDADES ---
 */
const btnAddCap = document.getElementById('btn-add-capacity');
if(btnAddCap) {
    btnAddCap.onclick = () => {
        productCapacities.push({ id: Math.random().toString(36).substr(2,9), label: '', price: 0 });
        renderCapacities();
    };
}

function renderCapacities() {
    const container = document.getElementById('capacities-container');
    if(!container) return;
    container.innerHTML = productCapacities.length === 0 ? `<p class="text-center text-gray-400 text-[10px] font-bold uppercase py-4">Sin variantes de capacidad.</p>` : "";
    productCapacities.forEach((c) => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-4 p-4 border-2 border-gray-100 rounded-2xl bg-white mb-2";
        div.innerHTML = `
            <input type="text" value="${c.label}" onchange="updateCapValue('${c.id}', 'label', this.value)" placeholder="Capacidad (ej: 128GB)" class="flex-grow bg-slate-50 rounded-lg p-2 text-xs font-bold outline-none">
            <input type="number" value="${c.price}" onchange="updateCapValue('${c.id}', 'price', this.value)" placeholder="Precio" class="w-32 bg-slate-50 rounded-lg p-2 text-xs font-bold text-brand-cyan outline-none">
            <button type="button" onclick="removeCapacity('${c.id}')" class="text-gray-300 hover:text-brand-red"><i class="fa-solid fa-xmark"></i></button>`;
        container.appendChild(div);
    });
}
window.updateCapValue = (id, field, val) => { const cap = productCapacities.find(item => item.id === id); cap[field] = field === 'price' ? Number(val) : val; };
window.removeCapacity = (id) => { productCapacities = productCapacities.filter(c => c.id !== id); renderCapacities(); };

/**
 * --- 5. CATEGORÍAS (Buscador Inteligente) ---
 */
const catSearchInput = document.getElementById('cat-search');
const catResults = document.getElementById('cat-results');
const pCategoryHidden = document.getElementById('p-category');

if(catSearchInput) {
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
                    div.innerHTML = `<span>${sub}</span> <span class="text-[8px] text-gray-400 uppercase">${cat.name}</span>`;
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
    };
}

/**
 * --- 6. GUARDADO ---
 */
form.onsubmit = async (e) => {
    e.preventDefault();
    btnUpdate.disabled = true;
    btnUpdate.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> ACTUALIZANDO...';

    try {
        // 1. Procesar Multimedia Global
        const imageUrls = [];
        for (const item of galleryItems) {
            if (item.type === 'url') imageUrls.push(item.content);
            else {
                const sRef = ref(storage, `products/global/${Date.now()}_${item.content.name}`);
                await uploadBytes(sRef, item.content);
                imageUrls.push(await getDownloadURL(sRef));
            }
        }

        // 2. Procesar Variantes
        const finalVariants = [];
        for (const v of productVariants) {
            const vUrls = [];
            for (const img of v.images) {
                if (img.type === 'url') vUrls.push(img.content);
                else {
                    const sRef = ref(storage, `products/variants/${Date.now()}_${img.content.name}`);
                    await uploadBytes(sRef, img.content);
                    vUrls.push(await getDownloadURL(sRef));
                }
            }
            finalVariants.push({ color: v.color, images: vUrls });
        }

        const updateData = {
            name: document.getElementById('p-name').value,
            sku: document.getElementById('p-sku').value,
            brand: document.getElementById('p-brand').value,
            price: Number(document.getElementById('p-price').value),
            stock: Number(document.getElementById('p-stock').value),
            category: pCategoryHidden.value || document.getElementById('p-category').value,
            description: descriptionEditor.innerHTML,
            images: imageUrls,
            hasVariants: finalVariants.length > 0,
            variants: finalVariants,
            hasCapacities: productCapacities.length > 0,
            capacities: productCapacities.map(c => ({ label: c.label, price: c.price })),
            mainImage: finalVariants[0]?.images[0] || imageUrls[0] || '',
            updatedAt: new Date()
        };

        await updateDoc(doc(db, "products", productId), updateData);
        await addDoc(collection(db, "products", productId, "history"), {
            adminEmail: auth.currentUser.email,
            action: "Edición masiva de información y variantes",
            timestamp: new Date()
        });

        alert("✅ Producto actualizado.");
        window.location.href = "products.html";

    } catch (err) { alert(err.message); btnUpdate.disabled = false; }
};

/**
 * --- 7. HISTORIAL ---
 */
async function loadProductHistory() {
    const container = document.getElementById('history-container');
    const q = query(collection(db, "products", productId, "history"), orderBy("timestamp", "desc"), limit(5));
    const snap = await getDocs(q);
    if (!snap.empty) {
        container.innerHTML = "";
        snap.forEach(d => {
            const log = d.data();
            container.innerHTML += `
                <div class="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-gray-50">
                    <div class="flex-grow">
                        <p class="text-[10px] font-black uppercase">${log.adminEmail}</p>
                        <p class="text-[9px] text-gray-400 font-bold">${log.timestamp?.toDate().toLocaleString()} — ${log.action}</p>
                    </div>
                </div>`;
        });
    }
}

initEdit();