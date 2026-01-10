import { auth, db, storage, doc, getDoc, updateDoc, collection, getDocs, addDoc, query, orderBy, limit, ref, uploadBytes, getDownloadURL } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const params = new URLSearchParams(window.location.search);
const productId = params.get('id');
const form = document.getElementById('main-form');
const btnUpdate = document.getElementById('btn-update');
const descriptionEditor = document.getElementById('p-description-editor');
const stockInput = document.getElementById('p-stock');
const priceInput = document.getElementById('p-price');
const stockLabel = document.getElementById('stock-label-type');

// --- ESTADO GLOBAL ---
let globalFiles = []; 
let definedColors = [];
let definedCaps = [];
let colorImagesMap = {};
let matrixData = {};

// --- 1. CARGA INICIAL ---
async function initEdit() {
    if (!productId) { window.location.href = 'products.html'; return; }

    try {
        const docSnap = await getDoc(doc(db, "products", productId));
        if (!docSnap.exists()) { window.location.href = 'products.html'; return; }

        const p = docSnap.data();
        
        document.getElementById('p-name').value = p.name || '';
        document.getElementById('p-sku').value = p.sku || '';
        document.getElementById('p-brand').value = p.brand || '';
        document.getElementById('p-price').value = p.price || 0;
        document.getElementById('p-stock').value = p.stock || 0; // Se muestra pero es readonly
        document.getElementById('p-status').value = p.status || 'active';
        
        // Categoría y Subcategoría
        document.getElementById('p-category').value = p.category || '';
        let subInput = document.getElementById('p-subcategory');
        if(!subInput) {
            subInput = document.createElement('input');
            subInput.type = 'hidden';
            subInput.id = 'p-subcategory';
            document.querySelector('.admin-input-group.relative').appendChild(subInput);
        }
        subInput.value = p.subcategory || '';
        document.getElementById('cat-search').value = p.subcategory ? `${p.subcategory} (${p.category})` : p.category;

        // Garantía
        if(p.warranty) {
            document.getElementById('p-warranty-time').value = p.warranty.time || '';
            document.getElementById('p-warranty-unit').value = p.warranty.unit || 'months';
        }

        document.getElementById('product-id-display').textContent = `ID: ${productId}`;
        descriptionEditor.innerHTML = p.description || '';

        // Imágenes
        if (p.images) {
            globalFiles = p.images.map(url => ({ id: Math.random().toString(36).substr(2,9), type: 'url', content: url }));
        }

        // Matriz
        definedColors = p.definedColors || [];
        definedCaps = p.definedCapacities || [];

        // Imágenes Color
        if(p.colorImages) {
            Object.keys(p.colorImages).forEach(color => {
                colorImagesMap[color] = p.colorImages[color].map(url => ({
                    id: Math.random().toString(36).substr(2,9), type: 'url', content: url
                }));
            });
        }
        definedColors.forEach(c => { if(!colorImagesMap[c]) colorImagesMap[c] = []; });

        // Datos Matriz
        if(p.combinations) {
            p.combinations.forEach(comb => {
                let key = '';
                if(comb.color && comb.capacity) key = `${comb.color}-${comb.capacity}`;
                else if(comb.color) key = comb.color;
                else if(comb.capacity) key = comb.capacity;
                if(key) matrixData[key] = { price: comb.price, stock: comb.stock };
            });
        }

        renderGlobalGallery();
        renderTags();
        renderColorUploaders();
        renderMatrix();
        loadProductHistory();

        document.getElementById('loader-view').classList.add('hidden');
        document.getElementById('edit-view').classList.remove('hidden');

    } catch (e) { console.error("Error cargando producto:", e); }
}

// --- 2. GESTIÓN MULTIMEDIA GLOBAL ---
const pImagesInput = document.getElementById('p-images');
if (pImagesInput) {
    pImagesInput.onchange = (e) => {
        Array.from(e.target.files).forEach(file => {
            globalFiles.push({ id: Math.random().toString(36).substr(2,9), type: 'file', content: file });
        });
        renderGlobalGallery();
        e.target.value = "";
    };
}

function renderGlobalGallery() {
    const container = document.getElementById('gallery-container');
    if(!container) return;
    container.innerHTML = "";
    
    globalFiles.forEach((item, index) => {
        const src = item.type === 'url' ? item.content : URL.createObjectURL(item.content);
        const div = document.createElement('div');
        div.className = "relative aspect-square rounded-2xl overflow-hidden border shadow-sm group bg-white";
        div.innerHTML = `
            <img src="${src}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-brand-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                <div class="flex gap-2">
                    <button type="button" onclick="moveGlobalImage(${index}, -1)" class="w-8 h-8 rounded-lg bg-white text-brand-black hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-left text-xs"></i></button>
                    <button type="button" onclick="moveGlobalImage(${index}, 1)" class="w-8 h-8 rounded-lg bg-white text-brand-black hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-right text-xs"></i></button>
                </div>
                <button type="button" onclick="removeGlobalImage('${item.id}')" class="text-[8px] font-black uppercase text-red-400 hover:text-red-200 transition">Eliminar</button>
            </div>
            <div class="absolute top-2 left-2 bg-brand-black/50 backdrop-blur-md text-white text-[7px] px-2 py-1 rounded-md font-bold uppercase">
                ${index === 0 ? 'Portada' : 'Pos. ' + (index + 1)}
            </div>`;
        container.appendChild(div);
    });
}

window.moveGlobalImage = (index, direction) => {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= globalFiles.length) return;
    const temp = globalFiles[index];
    globalFiles[index] = globalFiles[newIdx];
    globalFiles[newIdx] = temp;
    renderGlobalGallery();
};

window.removeGlobalImage = (id) => { globalFiles = globalFiles.filter(i => i.id !== id); renderGlobalGallery(); };

// --- 3. ATRIBUTOS ---
document.getElementById('btn-add-color').onclick = () => {
    const input = document.getElementById('new-color-input');
    const val = input.value.trim();
    if(val && !definedColors.includes(val)) { definedColors.push(val); colorImagesMap[val] = []; renderTags(); renderColorUploaders(); renderMatrix(); input.value = ""; }
};
document.getElementById('btn-add-cap').onclick = () => {
    const input = document.getElementById('new-cap-input');
    const val = input.value.trim();
    if(val && !definedCaps.includes(val)) { definedCaps.push(val); renderTags(); renderMatrix(); input.value = ""; }
};
function renderTags() {
    document.getElementById('tags-colors').innerHTML = definedColors.map(c => `<span class="bg-brand-black text-white px-3 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-2">${c} <button type="button" onclick="removeAttr('color', '${c}')" class="hover:text-red-400">×</button></span>`).join('');
    document.getElementById('tags-caps').innerHTML = definedCaps.map(c => `<span class="bg-slate-200 text-gray-600 px-3 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-2">${c} <button type="button" onclick="removeAttr('cap', '${c}')" class="hover:text-red-500">×</button></span>`).join('');
}
window.removeAttr = (type, val) => {
    if(type === 'color') { definedColors = definedColors.filter(c => c !== val); delete colorImagesMap[val]; renderColorUploaders(); } else { definedCaps = definedCaps.filter(c => c !== val); }
    renderTags(); renderMatrix(); 
};

// --- 4. SUBIDA POR COLOR ---
function renderColorUploaders() {
    const container = document.getElementById('color-uploaders-container');
    const section = document.getElementById('color-images-section');
    if(definedColors.length === 0) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    container.innerHTML = "";
    definedColors.forEach(color => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-gray-100";
        let imagesHTML = (colorImagesMap[color] || []).map((item) => {
            const src = item.type === 'url' ? item.content : URL.createObjectURL(item.content);
            return `<div class="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 bg-white"><img src="${src}" class="w-full h-full object-cover"></div>`;
        }).join('');
        div.innerHTML = `
            <div class="w-24 shrink-0"><span class="text-xs font-bold text-brand-black">${color}</span></div>
            <div class="flex gap-2 flex-wrap flex-grow">${imagesHTML}</div>
            <label class="cursor-pointer bg-white border border-gray-200 text-brand-black px-3 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-brand-cyan hover:border-brand-cyan transition">
                + Fotos <input type="file" multiple accept="image/*" class="hidden" onchange="addColorImages('${color}', this.files)">
            </label>`;
        container.appendChild(div);
    });
}
window.addColorImages = (color, files) => { 
    if(!colorImagesMap[color]) colorImagesMap[color] = [];
    Array.from(files).forEach(file => {
        colorImagesMap[color].push({ id: Math.random().toString(36).substr(2,9), type: 'file', content: file });
    });
    renderColorUploaders(); 
};

// --- 5. MATRIZ ---
function renderMatrix() {
    const tbody = document.getElementById('matrix-tbody');
    tbody.innerHTML = "";
    if(definedColors.length === 0 && definedCaps.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-gray-300 text-xs">Producto Simple (Sin variantes)</td></tr>`;
        return;
    }

    let rows = [];
    if(definedColors.length > 0 && definedCaps.length > 0) definedColors.forEach(c => definedCaps.forEach(k => rows.push({ key: `${c}-${k}`, label: `${c} + ${k}` })));
    else if(definedColors.length > 0) definedColors.forEach(c => rows.push({ key: c, label: c }));
    else if(definedCaps.length > 0) definedCaps.forEach(k => rows.push({ key: k, label: k }));

    rows.forEach(row => {
        const prev = matrixData[row.key] || { price: Number(priceInput.value) || 0, stock: 0 };
        matrixData[row.key] = prev;
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-50 hover:bg-slate-50 transition";
        tr.innerHTML = `
            <td class="p-4"><span class="font-black text-brand-black text-xs">${row.label}</span></td>
            <td class="p-4"><input type="number" value="${prev.price}" onchange="updateMatrixData('${row.key}', 'price', this.value)" class="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-brand-cyan outline-none focus:border-brand-cyan"></td>
            <td class="p-4"><input type="number" value="${prev.stock}" onchange="updateMatrixData('${row.key}', 'stock', this.value)" class="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-brand-black outline-none focus:border-brand-cyan"></td>`;
        tbody.appendChild(tr);
    });
    recalcTotalStock();
}
window.updateMatrixData = (key, field, val) => { if(!matrixData[key]) matrixData[key]={}; matrixData[key][field] = Number(val); if(field==='stock') recalcTotalStock(); };
function recalcTotalStock() {
    let total = 0;
    const activeKeys = [];
    if(definedColors.length > 0 && definedCaps.length > 0) definedColors.forEach(c => definedCaps.forEach(k => activeKeys.push(`${c}-${k}`)));
    else if(definedColors.length > 0) definedColors.forEach(c => activeKeys.push(c));
    else if(definedCaps.length > 0) definedCaps.forEach(k => activeKeys.push(k));
    activeKeys.forEach(k => total += (matrixData[k]?.stock || 0));
    
    // Solo actualizamos visualmente porque el input es readonly
    stockInput.value = total;
    stockLabel.innerHTML = "Stock Total <span class='text-xs text-brand-cyan'>(Calculado)</span>";
}

// --- 6. BUSCADOR CATEGORÍAS ---
const catSearchInput = document.getElementById('cat-search');
const catResults = document.getElementById('cat-results');
const pCategoryHidden = document.getElementById('p-category');
let pSubCategoryHidden = document.getElementById('p-subcategory');
if(!pSubCategoryHidden) {
    pSubCategoryHidden = document.createElement('input');
    pSubCategoryHidden.type = 'hidden';
    pSubCategoryHidden.id = 'p-subcategory';
    document.querySelector('.admin-input-group.relative').appendChild(pSubCategoryHidden);
}
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
                    div.innerHTML = `<span>${sub}</span> <span class="text-[8px] text-gray-400 uppercase bg-gray-50 px-2 py-1 rounded-md">${cat.name}</span>`;
                    div.onclick = () => { catSearchInput.value = `${sub} (${cat.name})`; pCategoryHidden.value = cat.name; pSubCategoryHidden.value = sub; catResults.classList.add('hidden'); };
                    catResults.appendChild(div);
                }
            });
        });
        if (found) catResults.classList.remove('hidden'); else catResults.classList.add('hidden');
    };
}

// --- 7. GUARDAR ---
form.onsubmit = async (e) => {
    e.preventDefault();
    btnUpdate.disabled = true;
    btnUpdate.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> ACTUALIZANDO...';

    try {
        const imageUrls = [];
        for (const item of globalFiles) {
            if (item.type === 'url') imageUrls.push(item.content);
            else {
                const sRef = ref(storage, `products/global/${Date.now()}_${item.content.name}`);
                await uploadBytes(sRef, item.content);
                imageUrls.push(await getDownloadURL(sRef));
            }
        }

        const colorUrlsMap = {};
        for (const color of definedColors) {
            colorUrlsMap[color] = [];
            const files = colorImagesMap[color] || [];
            for (const item of files) {
                if (item.type === 'url') colorUrlsMap[color].push(item.content);
                else {
                    const sRef = ref(storage, `products/variants/${Date.now()}_${color}_${item.content.name}`);
                    await uploadBytes(sRef, item.content);
                    colorUrlsMap[color].push(await getDownloadURL(sRef));
                }
            }
        }

        const combinations = [];
        let minPrice = Infinity;
        const activeKeys = [];
        if(definedColors.length > 0 && definedCaps.length > 0) definedColors.forEach(c => definedCaps.forEach(k => activeKeys.push(`${c}-${k}`)));
        else if(definedColors.length > 0) definedColors.forEach(c => activeKeys.push(c));
        else if(definedCaps.length > 0) definedCaps.forEach(k => activeKeys.push(k));

        activeKeys.forEach(key => {
            const data = matrixData[key];
            const parts = key.split('-');
            const color = definedColors.length > 0 ? (parts.length > 1 ? parts[0] : (definedColors.includes(key) ? key : null)) : null;
            const cap = definedCaps.length > 0 ? (parts.length > 1 ? parts[1] : (definedCaps.includes(key) ? key : null)) : null;
            combinations.push({
                color: color, capacity: cap, price: data?.price || 0, stock: data?.stock || 0,
                sku: `${document.getElementById('p-sku').value}-${color?color.substring(0,3):''}-${cap?cap:''}`.toUpperCase()
            });
            if((data?.price || 0) < minPrice) minPrice = data?.price;
        });

        const isSimple = combinations.length === 0;
        const finalPrice = isSimple ? Number(priceInput.value) : minPrice;
        // Si es simple, usamos el stock que ya estaba (no se edita). Si es matriz, sumamos la tabla.
        const finalStock = isSimple ? Number(stockInput.value) : combinations.reduce((a, b) => a + b.stock, 0);
        const subInput = document.getElementById('p-subcategory');

        const updateData = {
            name: document.getElementById('p-name').value,
            sku: document.getElementById('p-sku').value,
            brand: document.getElementById('p-brand').value,
            category: pCategoryHidden.value || document.getElementById('p-category').value,
            subcategory: subInput ? subInput.value : '',
            status: document.getElementById('p-status').value,
            description: descriptionEditor.innerHTML,
            updatedAt: new Date(),
            price: finalPrice,
            stock: finalStock,
            
            warranty: {
                time: Number(document.getElementById('p-warranty-time').value) || 0,
                unit: document.getElementById('p-warranty-unit').value
            },

            isSimple: isSimple,
            combinations: combinations,
            definedColors: definedColors,
            definedCapacities: definedCaps,
            images: imageUrls,
            colorImages: colorUrlsMap,
            mainImage: imageUrls[0] || Object.values(colorUrlsMap)[0]?.[0] || ''
        };

        await updateDoc(doc(db, "products", productId), updateData);
        await addDoc(collection(db, "products", productId, "history"), {
            adminEmail: auth.currentUser.email,
            action: `Edición Matriz (Stock: ${updateData.stock})`,
            timestamp: new Date()
        });

        alert("✅ Producto actualizado correctamente.");
        window.location.href = "products.html";

    } catch (err) { alert(err.message); btnUpdate.disabled = false; }
};

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

window.formatDoc = (cmd, value = null) => { document.execCommand(cmd, false, value); descriptionEditor.focus(); };

initEdit();