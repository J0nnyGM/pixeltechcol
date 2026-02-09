import { db, doc, getDoc, collection, query, where, limit, getDocs } from './firebase-init.js';
import { addToCart } from './cart.js'; 
import { trackEcommerceEvent } from './global-components.js';

// Estado local
let state = {
    selectedColor: null,
    selectedCapacity: null,
    currentPrice: 0,
    currentStock: 0,
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
    
    // Breadcrumbs
    breadCat: document.getElementById('breadcrumb-cat'),
    breadCatLink: document.getElementById('breadcrumb-cat-link'),
    breadSub: document.getElementById('breadcrumb-sub'),
    breadSubLink: document.getElementById('breadcrumb-sub-link'),
    breadSubSep: document.getElementById('breadcrumb-sub-sep'),
    breadName: document.getElementById('breadcrumb-name'),

    optionsContainer: document.getElementById('p-options'),
    btnAdd: document.getElementById('btn-add-main'),
    whatsappBtn: document.getElementById('whatsapp-buy'),
    discountTag: document.getElementById('p-discount-tag'),
    addiContainer: document.getElementById('addi-widget-container'),
    warrantyText: document.getElementById('p-warranty-text'),
    stockText: document.getElementById('p-stock-text'),
    shippingText: document.getElementById('p-shipping-text'),

    // --- REFERENCIAS IMPORTANTES PARA STICKY BAR ---
    stickyBar: document.getElementById('sticky-bar'),
    stickyPrice: document.getElementById('sticky-price'),
    stickyDiscountRow: document.getElementById('sticky-discount-row'), // Fila de oferta
    stickyOldPrice: document.getElementById('sticky-old-price'),     // Precio viejo sticky
    stickyBadge: document.getElementById('sticky-discount-badge'),   // Badge sticky
    purchaseSection: document.getElementById('purchase-section'),    // Elemento trigger
    
    // Referencias Relacionados
    relatedSection: document.getElementById('related-products-section'),
    relatedGrid: document.getElementById('related-grid')
};

/* ==========================================================================
   OPTIMIZACIÓN: CARGA DESDE CACHÉ LOCAL (0 LECTURAS)
   ========================================================================== */
function getProductFromCache(id) {
    try {
        const cachedRaw = localStorage.getItem('pixeltech_master_catalog');
        if (!cachedRaw) return null;
        
        const cachedData = JSON.parse(cachedRaw);
        const map = cachedData.map || {};
        
        if (map[id]) {
            console.log("⚡ Producto cargado desde SmartCache (0 lecturas)");
            return map[id];
        }
    } catch (e) {
        console.warn("Error leyendo caché en detalle:", e);
    }
    return null;
}

export async function initProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');

    if (!productId) { window.location.href = '/index.html'; return; }

    try {
        let p = null;

        // 1. INTENTO 1: Buscar en SmartCache (Memoria Local)
        p = getProductFromCache(productId);

        // 2. INTENTO 2: Si no está en caché (ej: link directo), pedir a Firebase
        if (!p) {
            console.log("☁️ Producto no en caché, descargando de Firebase (1 lectura)...");
            const docRef = doc(db, "products", productId);
            const snap = await getDoc(docRef);

            if (!snap.exists()) {
                document.body.innerHTML = "<div class='flex flex-col items-center justify-center h-screen'><h1 class='text-2xl font-black mb-4'>Producto no encontrado 😔</h1><a href='/' class='bg-brand-cyan px-6 py-3 rounded-xl font-bold'>Volver al Inicio</a></div>";
                return;
            }
            p = { id: snap.id, ...snap.data() };
        }

        // --- DE AQUÍ EN ADELANTE ES TU CÓDIGO NORMAL DE RENDERIZADO ---
        state.product = p;

        state.currentPrice = p.price;
        state.currentStock = p.stock || 0;
        state.currentImage = p.mainImage || p.image || 'https://placehold.co/500';

        injectProductSchema(p);
        updateMetaTags(p);
        saveToHistory(p);

        // 1. Datos Básicos
        document.title = `${p.name} | PixelTech`;
        els.name.textContent = p.name;
        els.desc.innerHTML = p.description || '';

        // 2. Breadcrumbs
        els.breadName.textContent = p.name;
        if (p.category) {
            els.breadCat.textContent = p.category;
            els.breadCatLink.href = `/shop/search.html?category=${encodeURIComponent(p.category)}`;
        } else {
            els.breadCat.textContent = 'General';
        }
        if (p.subcategory) {
            els.breadSub.textContent = p.subcategory;
            els.breadSubLink.href = `/shop/search.html?category=${encodeURIComponent(p.category)}&subcategory=${encodeURIComponent(p.subcategory)}`;
            els.breadSubLink.classList.remove('hidden');
            els.breadSubSep.classList.remove('hidden');
        }

        // 3. Garantía
        if (p.warranty && els.warrantyText) {
            const units = { months: 'Meses', days: 'Días', years: 'Años' };
            const unitText = units[p.warranty.unit] || p.warranty.unit || 'Meses';
            els.warrantyText.textContent = `Garantía directa de ${p.warranty.time} ${unitText} por defectos de fábrica.`;
        }

        trackEcommerceEvent('view_item', {
            currency: "COP",
            value: p.price,
            items: [{
                item_id: p.id,
                item_name: p.name,
                price: p.price,
                item_category: p.category
            }]
        });

        // 4. Inicializar & Render
        initializeSelection(p);
        renderOptions(p);
        updatePriceDisplay();
        updateGallery();
        els.mainImg.src = state.currentImage;
        els.mainImg.alt = `Comprar ${p.name} - ${p.category} en Colombia`;
        await updateShippingText();

        els.whatsappBtn.href = `https://wa.me/573159834171?text=Hola PixelTech, me interesa este producto: ${p.name} (Ref: ${productId})`;
        els.loader.classList.add('hidden');
        els.content.classList.remove('hidden');
        els.btnAdd.onclick = handleAddToCart;

        // 5. ACTIVAR STICKY BAR Y RELACIONADOS
        initStickyBar(); 
        
        // OPTIMIZACIÓN EN RELACIONADOS: Usar caché si es posible
        // Si ya tenemos el catálogo completo en localStorage, filtramos ahí en vez de hacer query
        loadRelatedProductsOptimized(p.category, p.id); 

    } catch (e) { console.error(e); }
}

// --- VERSIÓN OPTIMIZADA DE RELACIONADOS ---
async function loadRelatedProductsOptimized(category, currentId) {
    if (!category || !els.relatedSection) return;

    let related = [];

    // 1. Intentar filtrar desde caché local
    const cachedData = localStorage.getItem('pixeltech_master_catalog');
    if (cachedData) {
        try {
            const allProducts = Object.values(JSON.parse(cachedData).map || {});
            related = allProducts.filter(p => p.category === category && p.status === 'active' && p.id !== currentId);
            console.log("⚡ Relacionados cargados desde SmartCache");
        } catch (e) {}
    }

    // 2. Si no hay suficientes en caché, pedimos a Firebase (Fallback)
    if (related.length === 0) {
        console.log("☁️ Descargando relacionados de Firebase...");
        const q = query(
            collection(db, "products"),
            where("category", "==", category),
            where("status", "==", "active"),
            limit(5)
        );
        const snap = await getDocs(q);
        snap.forEach(d => {
            if (d.id !== currentId) related.push({ id: d.id, ...d.data() });
        });
    }

    if (related.length === 0) return;

    // Aleatorizar un poco
    related.sort(() => 0.5 - Math.random());

    els.relatedSection.classList.remove('hidden');
    // ... [RESTO DEL RENDERIZADO IDÉNTICO AL TUYO] ...
    els.relatedGrid.innerHTML = related.slice(0, 4).map(p => {
        const price = p.price.toLocaleString('es-CO');
        const img = p.mainImage || p.image || 'https://placehold.co/150';
        
        const hasDiscount = p.originalPrice && p.originalPrice > p.price;
        const discountBadge = hasDiscount 
            ? `<span class="absolute top-2 left-2 bg-brand-red text-white text-[8px] font-black px-2 py-0.5 rounded shadow-sm">OFERTA</span>` 
            : '';

        return `
            <div class="bg-white rounded-[2rem] p-4 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition cursor-pointer group relative overflow-hidden" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                ${discountBadge}
                <div class="h-32 mb-4 flex items-center justify-center p-2 bg-slate-50 rounded-xl">
                    <img src="${img}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-500 mix-blend-multiply">
                </div>
                <p class="text-[8px] font-bold text-gray-400 uppercase tracking-widest truncate">${p.category}</p>
                <h4 class="text-xs font-black text-brand-black uppercase leading-tight line-clamp-2 h-8 mb-2 group-hover:text-brand-cyan transition">${p.name}</h4>
                <div class="flex justify-between items-center">
                    <div class="flex flex-col">
                        ${hasDiscount ? `<span class="text-[9px] text-gray-300 line-through">$${p.originalPrice.toLocaleString('es-CO')}</span>` : ''}
                        <span class="text-sm font-black ${hasDiscount ? 'text-brand-red' : 'text-brand-black'}">$${price}</span>
                    </div>
                    <button class="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-brand-black hover:text-white transition"><i class="fa-solid fa-arrow-right text-[10px]"></i></button>
                </div>
            </div>
        `;
    }).join('');
}



// --- FUNCIÓN STICKY BAR ---
function initStickyBar() {
    if (!els.stickyBar || !els.purchaseSection) {
        console.warn("Sticky Bar: Elementos no encontrados en el DOM");
        return;
    }

    // Usar IntersectionObserver es más eficiente que el evento scroll
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            // Si la sección de compra sale de la pantalla por ARRIBA, mostramos la barra
            if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
                els.stickyBar.classList.add('visible');
            } else {
                els.stickyBar.classList.remove('visible');
            }
        });
    }, { threshold: 0 });

    observer.observe(els.purchaseSection);
}

// --- FUNCIÓN PRODUCTOS RELACIONADOS ---
async function loadRelatedProducts(category, currentId) {
    if (!category || !els.relatedSection) return;

    try {
        const q = query(
            collection(db, "products"),
            where("category", "==", category),
            where("status", "==", "active"),
            limit(5)
        );
        const snap = await getDocs(q);
        
        let related = [];
        snap.forEach(d => {
            if (d.id !== currentId) related.push({ id: d.id, ...d.data() });
        });

        if (related.length === 0) return;

        els.relatedSection.classList.remove('hidden');
        els.relatedGrid.innerHTML = related.slice(0, 4).map(p => {
            const price = p.price.toLocaleString('es-CO');
            const img = p.mainImage || p.image || 'https://placehold.co/150';
            
            // Check oferta
            const hasDiscount = p.originalPrice && p.originalPrice > p.price;
            const discountBadge = hasDiscount 
                ? `<span class="absolute top-2 left-2 bg-brand-red text-white text-[8px] font-black px-2 py-0.5 rounded shadow-sm">OFERTA</span>` 
                : '';

            return `
                <div class="bg-white rounded-[2rem] p-4 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition cursor-pointer group relative overflow-hidden" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                    ${discountBadge}
                    <div class="h-32 mb-4 flex items-center justify-center p-2 bg-slate-50 rounded-xl">
                        <img src="${img}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-500 mix-blend-multiply">
                    </div>
                    <p class="text-[8px] font-bold text-gray-400 uppercase tracking-widest truncate">${p.category}</p>
                    <h4 class="text-xs font-black text-brand-black uppercase leading-tight line-clamp-2 h-8 mb-2 group-hover:text-brand-cyan transition">${p.name}</h4>
                    <div class="flex justify-between items-center">
                        <div class="flex flex-col">
                            ${hasDiscount ? `<span class="text-[9px] text-gray-300 line-through">$${p.originalPrice.toLocaleString('es-CO')}</span>` : ''}
                            <span class="text-sm font-black ${hasDiscount ? 'text-brand-red' : 'text-brand-black'}">$${price}</span>
                        </div>
                        <button class="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-brand-black hover:text-white transition"><i class="fa-solid fa-arrow-right text-[10px]"></i></button>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) { console.error("Error related:", e); }
}

// ... (Resto de funciones: saveToHistory, updateShippingText, etc. se mantienen igual) ...

function saveToHistory(product) {
    try {
        let history = JSON.parse(localStorage.getItem('pixeltech_view_history')) || [];
        history = history.filter(item => item.id !== product.id);
        history.unshift({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.mainImage || product.image,
            category: product.category
        });
        if (history.length > 15) history.pop();
        localStorage.setItem('pixeltech_view_history', JSON.stringify(history));
    } catch (e) { console.error("Error guardando historial", e); }
}

async function updateShippingText() {
    if (!els.shippingText) return;
    try {
        const configSnap = await getDoc(doc(db, "config", "shipping"));
        let cutoffTime = "14:00"; 
        if (configSnap.exists()) cutoffTime = configSnap.data().cutoffTime || "14:00";

        const now = new Date();
        const [hours, minutes] = cutoffTime.split(':').map(Number);
        const cutoffDate = new Date();
        cutoffDate.setHours(hours, minutes, 0, 0);

        if (now < cutoffDate) {
            els.shippingText.innerHTML = `<span class="text-green-600 font-black">¡Despacho HOY!</span> <span class="text-brand-black font-bold">si compras antes de las ${cutoffTime}</span>`;
        } else {
            els.shippingText.innerHTML = `<span class="text-brand-cyan font-black">Despacho MAÑANA</span> <span class="text-brand-black font-bold">(Compras después de las ${cutoffTime})</span>`;
        }
    } catch (e) { els.shippingText.textContent = "Envío prioritario a nivel nacional."; }
}

function getStockForVariant(product, color, capacity) {
    if (product.isSimple) return product.stock || 0;
    if (!product.combinations) return 0;
    const variant = product.combinations.find(c => 
        (c.color === color || (!c.color && !color)) &&
        (c.capacity === capacity || (!c.capacity && !capacity))
    );
    return variant ? variant.stock : 0;
}

function initializeSelection(p) {
    if (p.isSimple) return;
    let validCombo = p.combinations?.find(c => c.stock > 0);
    if (validCombo) {
        state.selectedColor = validCombo.color;
        state.selectedCapacity = validCombo.capacity;
        if (state.selectedColor && p.variants) {
            const v = p.variants.find(v => v.color === state.selectedColor);
            if (v && v.images?.length > 0) state.currentImage = v.images[0];
        }
    } else {
        if (p.hasVariants && p.variants.length > 0) state.selectedColor = p.variants[0].color;
        if (p.hasCapacities && p.capacities.length > 0) state.selectedCapacity = p.capacities[0].label;
    }
}

function updatePriceDisplay() {
    const p = state.product;
    let price = p.price;
    let stock = p.stock;

    if (!p.isSimple && p.combinations) {
        const stockCombo = getStockForVariant(p, state.selectedColor, state.selectedCapacity);
        stock = stockCombo; 
        const variant = p.combinations.find(c => 
            (c.color === state.selectedColor || (!c.color && !state.selectedColor)) &&
            (c.capacity === state.selectedCapacity || (!c.capacity && !state.selectedCapacity))
        );
        if (variant) price = variant.price;
    }

    state.currentPrice = price;
    state.currentStock = stock;

    // Validación de Cantidad
    const currentQty = parseInt(els.qty.value) || 1;
    if (currentQty > stock) els.qty.value = Math.max(1, stock);
    if (stock <= 0) els.qty.value = 0;

    // --- ACTUALIZACIÓN VISUAL (PRINCIPAL Y STICKY) ---
    
    // Precio Principal
    els.price.textContent = `$${price.toLocaleString('es-CO')}`;
    
    // Precio Sticky (Actualización Dinámica)
    if(els.stickyPrice) els.stickyPrice.textContent = `$${price.toLocaleString('es-CO')}`;

    if (p.originalPrice && p.originalPrice > price) {
        // MODO OFERTA
        const disc = Math.round(((p.originalPrice - price) / p.originalPrice) * 100);
        const formattedOld = `$${p.originalPrice.toLocaleString('es-CO')}`;

        // Principal
        els.price.classList.add('text-brand-red');
        els.oldPrice.textContent = formattedOld;
        els.oldPrice.classList.remove('hidden');
        if(els.discountTag) {
            els.discountTag.textContent = `-${disc}%`;
            els.discountTag.classList.remove('hidden');
        }

        // Sticky Bar
        if(els.stickyDiscountRow) {
            els.stickyDiscountRow.classList.remove('hidden');
            els.stickyOldPrice.textContent = formattedOld;
            els.stickyBadge.textContent = `-${disc}%`;
            els.stickyPrice.classList.add('text-brand-red');
            els.stickyPrice.classList.remove('text-brand-black');
        }

    } else {
        // MODO NORMAL
        els.price.classList.remove('text-brand-red');
        els.oldPrice.classList.add('hidden');
        if(els.discountTag) els.discountTag.classList.add('hidden');

        // Sticky Bar
        if(els.stickyDiscountRow) {
            els.stickyDiscountRow.classList.add('hidden');
            els.stickyPrice.classList.add('text-brand-black');
            els.stickyPrice.classList.remove('text-brand-red');
        }
    }

    // Stock UI
    if (els.stockText) {
        if (stock > 0) {
            els.stockText.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${stock} unidades disponibles`;
            els.stockText.className = "text-green-600 text-[10px] font-black uppercase tracking-widest mt-4 flex items-center gap-2";
            els.btnAdd.disabled = false;
            els.btnAdd.classList.remove('bg-gray-400', 'cursor-not-allowed');
            els.btnAdd.classList.add('bg-brand-cyan');
            els.btnAdd.textContent = "Agregar al carrito";
        } else {
            els.stockText.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Agotado`;
            els.stockText.className = "text-red-500 text-[10px] font-black uppercase tracking-widest mt-4 flex items-center gap-2";
            els.btnAdd.disabled = true;
            els.btnAdd.classList.add('bg-gray-400', 'cursor-not-allowed');
            els.btnAdd.classList.remove('bg-brand-cyan');
            els.btnAdd.textContent = "Sin Stock";
        }
    }

    renderAddiWidget(price);
}

function renderAddiWidget(price) {
    if (!els.addiContainer || price <= 0) return;
    let existingWidget = els.addiContainer.querySelector('addi-widget');
    if (existingWidget) existingWidget.setAttribute('price', price);
    else {
        const widget = document.createElement('addi-widget');
        widget.setAttribute('price', price);
        widget.setAttribute('ally-slug', 'pixeltechcolombia-ecommerce');
        widget.setAttribute('text-color', '#111827');
        widget.setAttribute('logo-color', '#00AEC7');
        els.addiContainer.appendChild(widget);
    }
}

function updateGallery() {
    els.thumbsContainer.innerHTML = "";
    let variantImages = [];
    if (state.selectedColor && state.product.variants) {
        const v = state.product.variants.find(vari => vari.color === state.selectedColor);
        if (v && v.images) variantImages = v.images;
    }
    const globalImages = state.product.images || [];
    const uniqueImages = new Set([...variantImages, ...globalImages]);
    Array.from(uniqueImages).forEach((src) => {
        const img = document.createElement('img');
        img.src = src;
        const activateImage = () => {
            if (state.currentImage === src) return; 
            state.currentImage = src;
            els.mainImg.src = src;
            Array.from(els.thumbsContainer.children).forEach(child => { child.classList.remove('thumb-active'); child.classList.add('thumb-inactive'); });
            img.classList.remove('thumb-inactive'); img.classList.add('thumb-active');
        };
        const isActive = state.currentImage === src;
        img.className = `w-full h-20 object-contain bg-white border rounded-xl cursor-pointer transition-all duration-200 ${isActive ? 'thumb-active' : 'thumb-inactive'}`;
        img.onmouseenter = activateImage; img.onclick = activateImage;      
        els.thumbsContainer.appendChild(img);
    });
}

function renderOptions(p) {
    els.optionsContainer.innerHTML = "";
    // Colores
    if (p.hasVariants && p.variants?.length > 0) {
        const colorDiv = document.createElement('div');
        colorDiv.innerHTML = `<label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Color</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3";
        p.variants.forEach((v) => {
            const isSelected = state.selectedColor === v.color;
            let isOut = p.hasCapacities ? !p.combinations.some(c => c.color === v.color && c.stock > 0) : getStockForVariant(p, v.color, null) <= 0;
            const btn = document.createElement('button');
            let classes = "px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 relative ";
            if (isOut) { classes += "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60 "; btn.disabled = true; }
            else if (isSelected) classes += "bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20 ";
            else classes += "bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black ";
            btn.className = classes;
            btn.innerHTML = v.color + (isOut ? `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] px-1.5 rounded-full">AGOTADO</span>` : '');
            if (!isOut) btn.onclick = () => {
                state.selectedColor = v.color;
                if (p.hasCapacities) {
                    if (getStockForVariant(p, state.selectedColor, state.selectedCapacity) <= 0) {
                        const validCap = p.capacities.find(cap => getStockForVariant(p, state.selectedColor, cap.label) > 0);
                        if (validCap) state.selectedCapacity = validCap.label;
                    }
                }
                if (v.images?.length > 0) { state.currentImage = v.images[0]; els.mainImg.src = state.currentImage; }
                updateGallery(); updatePriceDisplay(); renderOptions(p);
            };
            btnContainer.appendChild(btn);
        });
        colorDiv.appendChild(btnContainer); els.optionsContainer.appendChild(colorDiv);
    }
    // Capacidades
    if (p.hasCapacities && p.capacities?.length > 0) {
        const capDiv = document.createElement('div');
        capDiv.innerHTML = `<label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Capacidad</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3";
        p.capacities.forEach((c) => {
            const isSelected = state.selectedCapacity === c.label;
            const isOut = getStockForVariant(p, state.selectedColor, c.label) <= 0;
            const btn = document.createElement('button');
            let classes = `px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 flex flex-col items-center min-w-[100px] relative `;
            if (isOut) { classes += "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60 "; btn.disabled = true; }
            else if (isSelected) classes += "bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20 ";
            else classes += "bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black ";
            btn.className = classes;
            let comboPrice = c.price; 
            if (p.combinations) {
                 const combo = p.combinations.find(comb => comb.color === state.selectedColor && comb.capacity === c.label);
                 if (combo) comboPrice = combo.price;
            }
            btn.innerHTML = `<span>${c.label}</span><span class="text-[9px] font-normal mt-1 ${isSelected ? 'text-brand-black' : 'text-gray-400'}">$${comboPrice.toLocaleString('es-CO')}</span>${isOut ? `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] px-1.5 rounded-full">AGOTADO</span>` : ''}`;
            if (!isOut) btn.onclick = () => { state.selectedCapacity = c.label; updatePriceDisplay(); renderOptions(p); };
            btnContainer.appendChild(btn);
        });
        capDiv.appendChild(btnContainer); els.optionsContainer.appendChild(capDiv);
    }
}

function handleAddToCart() {
    const qty = parseInt(els.qty.value) || 1;
    const p = state.product;
    if (qty > state.currentStock) { alert(`Solo hay ${state.currentStock} unidades disponibles.`); return; }
    if (p.hasCapacities && !state.selectedCapacity) { alert("Selecciona una capacidad"); return; }
    if (p.hasVariants && !state.selectedColor) { alert("Selecciona un color"); return; }

    const originalText = els.btnAdd.innerText;
    els.btnAdd.innerText = "¡Agregado!";
    els.btnAdd.classList.add('bg-green-500', 'text-white');

    trackEcommerceEvent('add_to_cart', {
        currency: "COP",
        value: state.currentPrice * qty,
        items: [{
            item_id: state.product.id,
            item_name: state.product.name,
            price: state.currentPrice,
            quantity: qty
        }]
    });
    
    addToCart({ id: p.id, name: p.name, price: state.currentPrice, image: state.currentImage, color: state.selectedColor, capacity: state.selectedCapacity, quantity: qty });
    if(window.showToast) window.showToast(`${p.name} agregado al carrito`);
    setTimeout(() => { els.btnAdd.innerText = originalText; els.btnAdd.classList.remove('bg-green-500', 'text-white'); }, 1000);
}

window.changeQty = (d) => {
    const i = document.getElementById('p-qty');
    let v = parseInt(i.value) + d;
    if(v < 1) v = 1;
    if(v > state.currentStock) v = state.currentStock;
    i.value = v;
};

// --- FUNCIÓN: INYECTAR SCHEMA.ORG (SEO) ---
function injectProductSchema(p) {
    // 1. Limpiar schemas anteriores si existen (al navegar entre productos)
    const oldSchema = document.getElementById('json-ld-product');
    if (oldSchema) oldSchema.remove();

    // 2. Determinar disponibilidad
    const availability = (p.stock > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
    
    // 3. Construir el objeto JSON-LD
    const schemaData = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": p.name,
        "image": [
            p.mainImage || p.image,
            ...(p.images || []) // Agrega la galería si existe
        ],
        "description": p.description ? p.description.replace(/<[^>]*>?/gm, '') : `Compra ${p.name} en PixelTech.`, // Limpiar HTML básico
        "sku": p.id,
        "brand": {
            "@type": "Brand",
            "name": p.brand || "Genérico"
        },
        "offers": {
            "@type": "Offer",
            "url": window.location.href,
            "priceCurrency": "COP",
            "price": p.price,
            "availability": availability,
            "itemCondition": "https://schema.org/NewCondition"
        }
    };

    // 4. Crear e inyectar el script
    const script = document.createElement('script');
    script.id = "json-ld-product";
    script.type = "application/ld+json";
    script.text = JSON.stringify(schemaData);
    document.head.appendChild(script);
    
    console.log("🔍 SEO Schema inyectado para:", p.name);
}

function updateMetaTags(p) {
    // Título del Navegador
    document.title = `${p.name} | Compra en PixelTech`;

    // Función auxiliar para actualizar o crear meta tags
    const setMeta = (name, content, attribute = 'name') => {
        let element = document.querySelector(`meta[${attribute}="${name}"]`);
        if (!element) {
            element = document.createElement('meta');
            element.setAttribute(attribute, name);
            document.head.appendChild(element);
        }
        element.setAttribute('content', content);
    };

    const currentUrl = window.location.href;
    const image = p.mainImage || p.image;
    const description = (p.description || '').replace(/<[^>]*>?/gm, '').substring(0, 150);

    // Basic SEO
    setMeta('description', `Compra ${p.name} al mejor precio. ${description}`);

    // Open Graph / Facebook / WhatsApp
    setMeta('og:type', 'product', 'property');
    setMeta('og:title', p.name, 'property');
    setMeta('og:description', description, 'property');
    setMeta('og:image', image, 'property');
    setMeta('og:url', currentUrl, 'property');
    setMeta('og:site_name', 'PixelTech Elite Store', 'property');
    setMeta('product:price:amount', p.price, 'property');
    setMeta('product:price:currency', 'COP', 'property');

    // Twitter Cards
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', p.name);
    setMeta('twitter:description', description);
    setMeta('twitter:image', image);

    // Agrega esta lógica
    const canonicalLink = document.querySelector("link[rel='canonical']") || document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    // Limpiamos la URL de parámetros de rastreo (fbclid, utm_source, etc), dejando solo el ID
    canonicalLink.setAttribute("href", `${window.location.origin}/shop/product.html?id=${p.id}`);
    document.head.appendChild(canonicalLink);
}