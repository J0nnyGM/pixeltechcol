import { db, doc, getDoc, auth } from './firebase-init.js';
import { addToCart } from './cart.js'; 

// Estado local
let state = {
    selectedColor: null,
    selectedCapacity: null,
    currentPrice: 0,
    currentImage: '',
    product: null
};

// Elementos DOM
const els = {
    mainImg: document.getElementById('p-main-image'),
    thumbsContainer: document.getElementById('p-thumbnails'),
    name: document.getElementById('p-name'),
    price: document.getElementById('p-price'),
    oldPrice: document.getElementById('p-old-price'),
    qty: document.getElementById('p-qty'),
    loader: document.getElementById('p-loader'),
    content: document.getElementById('p-content'),
    desc: document.getElementById('p-description'),
    breadCat: document.getElementById('breadcrumb-cat'),
    breadName: document.getElementById('breadcrumb-name'),
    optionsContainer: document.getElementById('p-options'),
    btnAdd: document.getElementById('btn-add-main'),
    whatsappBtn: document.getElementById('whatsapp-buy'),
    discountTag: document.getElementById('p-discount-tag')
};

export async function initProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');

    if (!productId) {
        window.location.href = '/index.html';
        return;
    }

    try {
        const docRef = doc(db, "products", productId);
        const snap = await getDoc(docRef);

        if (!snap.exists()) {
            document.body.innerHTML = "<h1 class='text-center mt-20'>Producto no encontrado</h1>";
            return;
        }

        const p = { id: snap.id, ...snap.data() };
        state.product = p;
        state.currentPrice = p.price;
        state.currentImage = p.mainImage || p.image || 'https://placehold.co/500';

        // --- NUEVO: GUARDAR EN HISTORIAL ---
        saveToHistory(p);
        // -----------------------------------

        // 1. Renderizar Datos Básicos
        document.title = `${p.name} | PixelTech`;
        els.name.textContent = p.name;
        els.breadName.textContent = p.name;
        els.breadCat.textContent = p.category || 'Tienda';
        els.desc.innerHTML = p.description || '';

        // 2. Renderizar Opciones (Color/Capacidad) y Auto-Select
        renderOptions(p);

        // 3. Renderizar Precio
        updatePriceDisplay();

        // 4. Renderizar Galería Inicial
        els.mainImg.src = state.currentImage;
        updateGallery();

        // WhatsApp
        els.whatsappBtn.href = `https://wa.me/573159834171?text=Hola, me interesa: ${p.name}`;

        els.loader.classList.add('hidden');
        els.content.classList.remove('hidden');

        els.btnAdd.onclick = handleAddToCart;

    } catch (e) { console.error(e); }
}

// --- NUEVA FUNCIÓN PARA GUARDAR EL HISTORIAL ---
function saveToHistory(product) {
    try {
        const historyKey = 'pixeltech_view_history';
        let history = JSON.parse(localStorage.getItem(historyKey)) || [];

        // 1. Si el producto ya existe, lo quitamos para ponerlo al principio (efecto "reciente")
        history = history.filter(item => item.id !== product.id);

        // 2. Agregamos el producto al inicio del array
        // Guardamos solo lo necesario para no llenar la memoria
        history.unshift({
            id: product.id,
            name: product.name,
            price: product.price,
            mainImage: product.mainImage || product.image, // Aseguramos que guarde alguna imagen
            category: product.category
        });

        // 3. Limitamos a los últimos 10 vistos
        if (history.length > 10) history = history.slice(0, 10);

        // 4. Guardamos
        localStorage.setItem(historyKey, JSON.stringify(history));
    } catch (e) {
        console.error("Error guardando historial:", e);
    }
}

function renderOptions(p) {
    els.optionsContainer.innerHTML = "";

    // --- A. COLORES ---
    if (p.hasVariants && p.variants && p.variants.length > 0) {
        const colorDiv = document.createElement('div');
        colorDiv.innerHTML = `<label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Color</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3";

        p.variants.forEach((v, index) => {
            // Auto-Select 1ro
            if (!state.selectedColor && index === 0) {
                state.selectedColor = v.color;
                if (v.images && v.images.length > 0) state.currentImage = v.images[0];
            }

            const isSelected = state.selectedColor === v.color;
            const btn = document.createElement('button');
            
            btn.className = `px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 
                ${isSelected 
                    ? 'bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20' 
                    : 'bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black'}`;
            
            btn.textContent = v.color;
            
            btn.onclick = () => {
                state.selectedColor = v.color;
                // Actualizar imagen principal a la primera del color
                if (v.images && v.images.length > 0) {
                    state.currentImage = v.images[0];
                    els.mainImg.src = state.currentImage;
                }
                updateGallery(); // Actualiza la lista de fotos (Color + Globales)
                renderOptions(p); // Actualiza botones
            };

            btnContainer.appendChild(btn);
        });
        colorDiv.appendChild(btnContainer);
        els.optionsContainer.appendChild(colorDiv);
    }

    // --- B. CAPACIDADES ---
    if (p.hasCapacities && p.capacities && p.capacities.length > 0) {
        const capDiv = document.createElement('div');
        capDiv.innerHTML = `<label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Capacidad</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3";

        p.capacities.forEach((c, index) => {
            if (!state.selectedCapacity && index === 0) {
                state.selectedCapacity = c.label;
                state.currentPrice = c.price;
            }

            const isSelected = state.selectedCapacity === c.label;
            const btn = document.createElement('button');
            
            btn.className = `px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 flex flex-col items-center min-w-[100px]
                ${isSelected 
                    ? 'bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20' 
                    : 'bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black'}`;
            
            btn.innerHTML = `
                <span>${c.label}</span>
                <span class="text-[9px] font-normal mt-1 ${isSelected ? 'text-brand-black' : 'text-gray-400'}">$${c.price.toLocaleString('es-CO')}</span>
            `;
            
            btn.onclick = () => {
                state.selectedCapacity = c.label;
                state.currentPrice = c.price;
                updatePriceDisplay();
                renderOptions(p);
            };

            btnContainer.appendChild(btn);
        });
        capDiv.appendChild(btnContainer);
        els.optionsContainer.appendChild(capDiv);
    }
}

function updatePriceDisplay() {
    const p = state.product;
    const price = state.currentPrice;

    if (p.originalPrice && p.originalPrice > price) {
        els.price.textContent = `$${price.toLocaleString('es-CO')}`;
        els.price.classList.add('text-brand-red');
        els.oldPrice.textContent = `$${p.originalPrice.toLocaleString('es-CO')}`;
        els.oldPrice.classList.remove('hidden');
        
        const disc = Math.round(((p.originalPrice - price) / p.originalPrice) * 100);
        if(els.discountTag) {
            els.discountTag.textContent = `-${disc}%`;
            els.discountTag.classList.remove('hidden');
        }
    } else {
        els.price.textContent = `$${price.toLocaleString('es-CO')}`;
        els.price.classList.remove('text-brand-red');
        els.oldPrice.classList.add('hidden');
        if(els.discountTag) els.discountTag.classList.add('hidden');
    }
}

// --- FUNCIÓN DE GALERÍA MEJORADA ---
function updateGallery() {
    els.thumbsContainer.innerHTML = "";
    
    // 1. Obtener Imágenes de Variante (Prioridad)
    let variantImages = [];
    if (state.selectedColor && state.product.variants) {
        const v = state.product.variants.find(vari => vari.color === state.selectedColor);
        if (v && v.images) variantImages = v.images;
    }

    // 2. Obtener Imágenes Globales
    const globalImages = state.product.images || [];

    // 3. Combinar: Variante Primero + Globales (Eliminando duplicados)
    // Usamos Set para evitar repetir la misma URL
    const uniqueImages = new Set([...variantImages, ...globalImages]);
    const imagesToShow = Array.from(uniqueImages);

    // 4. Renderizar
    imagesToShow.forEach((src) => {
        const img = document.createElement('img');
        img.src = src;
        
        // Función para activar la imagen (usada en Hover y Click)
        const activateImage = () => {
            if (state.currentImage === src) return; // Evitar parpadeo si ya es la misma

            state.currentImage = src;
            els.mainImg.src = src;
            
            // Actualizar estilos de bordes
            Array.from(els.thumbsContainer.children).forEach(child => {
                child.classList.remove('border-brand-cyan', 'ring-1', 'ring-brand-cyan', 'thumb-active');
                child.classList.add('border-gray-100');
            });
            img.classList.remove('border-gray-100');
            img.classList.add('border-brand-cyan', 'ring-1', 'ring-brand-cyan', 'thumb-active');
        };

        // Estilos iniciales
        const isActive = state.currentImage === src;
        img.className = `w-full h-20 object-contain bg-white border rounded-xl cursor-pointer transition-all duration-200 
            ${isActive ? 'border-brand-cyan ring-1 ring-brand-cyan thumb-active' : 'border-gray-100 hover:border-brand-cyan'}`;
        
        // EVENTOS: Mouse Encima (Hover) y Click
        img.onmouseenter = activateImage; // Cambia al pasar el mouse
        img.onclick = activateImage;      // Soporte móvil

        els.thumbsContainer.appendChild(img);
    });
}

function handleAddToCart() {
    const qty = parseInt(els.qty.value) || 1;
    const p = state.product;

    if (p.hasCapacities && !state.selectedCapacity) return alert("Error: Selecciona una capacidad.");
    if (p.hasVariants && !state.selectedColor) return alert("Error: Selecciona un color.");

    const originalText = els.btnAdd.innerText;
    els.btnAdd.innerText = "¡Agregado!";
    els.btnAdd.classList.add('bg-green-500', 'text-white');
    
    addToCart({ 
        id: p.id, 
        name: p.name, 
        price: state.currentPrice, 
        image: state.currentImage, 
        color: state.selectedColor, 
        capacity: state.selectedCapacity, 
        quantity: qty 
    });
    
    setTimeout(() => {
        els.btnAdd.innerText = originalText;
        els.btnAdd.classList.remove('bg-green-500', 'text-white');
    }, 500);
}

window.changeQty = (d) => {
    const i = document.getElementById('p-qty');
    let v = parseInt(i.value) + d;
    if(v < 1) v = 1;
    i.value = v;
};