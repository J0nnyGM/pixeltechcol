import { db, doc, getDoc, auth } from './firebase-init.js';
import { addToCart } from './cart.js'; 

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
    breadCat: document.getElementById('breadcrumb-cat'),
    breadName: document.getElementById('breadcrumb-name'),
    optionsContainer: document.getElementById('p-options'),
    btnAdd: document.getElementById('btn-add-main'),
    whatsappBtn: document.getElementById('whatsapp-buy'),
    discountTag: document.getElementById('p-discount-tag'),
    addiContainer: document.getElementById('addi-widget-container'),
    warrantyText: document.getElementById('p-warranty-text'),
    stockText: document.getElementById('p-stock-text'),
    // NUEVO
    shippingText: document.getElementById('p-shipping-text')
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
        state.currentStock = p.stock || 0;
        state.currentImage = p.mainImage || p.image || 'https://placehold.co/500';

        saveToHistory(p);

        // 1. Datos Básicos
        document.title = `${p.name} | PixelTech`;
        els.name.textContent = p.name;
        els.breadName.textContent = p.name;
        els.breadCat.textContent = p.category || 'Tienda';
        els.desc.innerHTML = p.description || '';

        // 2. Garantía
        if (p.warranty && els.warrantyText) {
            const units = { months: 'Meses', days: 'Días', years: 'Años' };
            const unitText = units[p.warranty.unit] || p.warranty.unit || 'Meses';
            els.warrantyText.textContent = `Garantía directa de ${p.warranty.time} ${unitText} por defectos de fábrica.`;
        }

        // 3. Inicializar Selección
        initializeSelection(p);

        // 4. Renderizar UI
        renderOptions(p);
        updatePriceDisplay();
        updateGallery();
        els.mainImg.src = state.currentImage;

        // 5. Lógica de Envío (Hora de Corte)
        await updateShippingText();

        els.whatsappBtn.href = `https://wa.me/573159834171?text=Hola, me interesa: ${p.name}`;
        els.loader.classList.add('hidden');
        els.content.classList.remove('hidden');
        els.btnAdd.onclick = handleAddToCart;

    } catch (e) { console.error(e); }
}

function saveToHistory(product) { /* ... */ }

// --- LÓGICA DE HORA DE CORTE (TEXTOS MÁS CLAROS) ---
async function updateShippingText() {
    if (!els.shippingText) return;
    
    try {
        const configSnap = await getDoc(doc(db, "config", "shipping"));
        let cutoffTime = "14:00"; 
        
        if (configSnap.exists()) {
            cutoffTime = configSnap.data().cutoffTime || "14:00";
        }

        const now = new Date();
        const [hours, minutes] = cutoffTime.split(':').map(Number);
        const cutoffDate = new Date();
        cutoffDate.setHours(hours, minutes, 0, 0);

        if (now < cutoffDate) {
            // CASO 1: Aún hay tiempo para enviar hoy
            els.shippingText.innerHTML = `
                <span class="text-green-600 font-black">¡Despacho HOY!</span> 
                <span class="text-brand-black font-bold">si compras antes de las ${cutoffTime}</span>
            `;
        } else {
            // CASO 2: Ya pasó la hora, se envía mañana
            els.shippingText.innerHTML = `
                <span class="text-brand-cyan font-black">Despacho MAÑANA</span> 
                <span class="text-brand-black font-bold">(Compras después de las ${cutoffTime})</span>
            `;
        }

    } catch (e) {
        console.warn("Error leyendo config envío:", e);
        els.shippingText.textContent = "Envío prioritario a nivel nacional.";
    }
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

    let validCombo = null;
    if (p.combinations) {
        validCombo = p.combinations.find(c => c.stock > 0);
    }

    if (validCombo) {
        state.selectedColor = validCombo.color;
        state.selectedCapacity = validCombo.capacity;
        if (state.selectedColor && p.variants) {
            const v = p.variants.find(v => v.color === state.selectedColor);
            if (v && v.images && v.images.length > 0) state.currentImage = v.images[0];
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

    // Resetear cantidad si excede el nuevo stock
    const currentQty = parseInt(els.qty.value) || 1;
    if (currentQty > stock) els.qty.value = Math.max(1, stock);
    if (stock <= 0) els.qty.value = 0;

    // UI Precio
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

    // UI Stock
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
    if (existingWidget) {
        existingWidget.setAttribute('price', price);
    } else {
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
    const imagesToShow = Array.from(uniqueImages);

    imagesToShow.forEach((src) => {
        const img = document.createElement('img');
        img.src = src;
        
        const activateImage = () => {
            if (state.currentImage === src) return; 
            state.currentImage = src;
            els.mainImg.src = src;
            
            Array.from(els.thumbsContainer.children).forEach(child => {
                child.classList.remove('thumb-active');
                child.classList.add('thumb-inactive');
            });
            img.classList.remove('thumb-inactive');
            img.classList.add('thumb-active');
        };

        const isActive = state.currentImage === src;
        img.className = `w-full h-20 object-contain bg-white border rounded-xl cursor-pointer transition-all duration-200 
            ${isActive ? 'thumb-active' : 'thumb-inactive'}`;
        
        img.onmouseenter = activateImage; 
        img.onclick = activateImage;      

        els.thumbsContainer.appendChild(img);
    });
}

function renderOptions(p) {
    els.optionsContainer.innerHTML = "";

    // A. COLORES
    if (p.hasVariants && p.variants && p.variants.length > 0) {
        const colorDiv = document.createElement('div');
        colorDiv.innerHTML = `<label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Color</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3";

        p.variants.forEach((v) => {
            const isSelected = state.selectedColor === v.color;
            let isColorOutOfStock = true;
            if (p.hasCapacities) {
                isColorOutOfStock = !p.combinations.some(c => c.color === v.color && c.stock > 0);
            } else {
                const stock = getStockForVariant(p, v.color, null);
                isColorOutOfStock = stock <= 0;
            }

            const btn = document.createElement('button');
            let classes = "px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 relative ";
            
            if (isColorOutOfStock) {
                classes += "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60 ";
                btn.disabled = true;
            } else if (isSelected) {
                classes += "bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20 ";
            } else {
                classes += "bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black ";
            }

            btn.className = classes;
            btn.innerHTML = v.color;
            
            if(isColorOutOfStock) btn.innerHTML += `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] px-1.5 rounded-full">AGOTADO</span>`;

            if (!isColorOutOfStock) {
                btn.onclick = () => {
                    state.selectedColor = v.color;
                    if (p.hasCapacities) {
                        const currentCapStock = getStockForVariant(p, state.selectedColor, state.selectedCapacity);
                        if (currentCapStock <= 0) {
                            const validCap = p.capacities.find(cap => getStockForVariant(p, state.selectedColor, cap.label) > 0);
                            if (validCap) state.selectedCapacity = validCap.label;
                        }
                    }
                    if (v.images && v.images.length > 0) {
                        state.currentImage = v.images[0];
                        els.mainImg.src = state.currentImage;
                    }
                    updateGallery();
                    updatePriceDisplay();
                    renderOptions(p);
                };
            }
            btnContainer.appendChild(btn);
        });
        colorDiv.appendChild(btnContainer);
        els.optionsContainer.appendChild(colorDiv);
    }

    // B. CAPACIDADES
    if (p.hasCapacities && p.capacities && p.capacities.length > 0) {
        const capDiv = document.createElement('div');
        capDiv.innerHTML = `<label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Capacidad</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3";

        p.capacities.forEach((c) => {
            const isSelected = state.selectedCapacity === c.label;
            const stockForThisCombo = getStockForVariant(p, state.selectedColor, c.label);
            const isCapOutOfStock = stockForThisCombo <= 0;

            const btn = document.createElement('button');
            let classes = `px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 flex flex-col items-center min-w-[100px] relative `;
            
            if (isCapOutOfStock) {
                classes += "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60 ";
                btn.disabled = true;
            } else if (isSelected) {
                classes += "bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20 ";
            } else {
                classes += "bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black ";
            }

            btn.className = classes;
            
            let comboPrice = c.price; 
            if (p.combinations) {
                 const combo = p.combinations.find(comb => 
                    comb.color === state.selectedColor && comb.capacity === c.label
                 );
                 if (combo) comboPrice = combo.price;
            }

            btn.innerHTML = `
                <span>${c.label}</span>
                <span class="text-[9px] font-normal mt-1 ${isSelected ? 'text-brand-black' : 'text-gray-400'}">$${comboPrice.toLocaleString('es-CO')}</span>
                ${isCapOutOfStock ? `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] px-1.5 rounded-full">AGOTADO</span>` : ''}
            `;
            
            if (!isCapOutOfStock) {
                btn.onclick = () => {
                    state.selectedCapacity = c.label;
                    updatePriceDisplay();
                    renderOptions(p);
                };
            }
            btnContainer.appendChild(btn);
        });
        capDiv.appendChild(btnContainer);
        els.optionsContainer.appendChild(capDiv);
    }
}

function handleAddToCart() {
    const qty = parseInt(els.qty.value) || 1;
    const p = state.product;

    if (qty > state.currentStock) return alert(`Solo hay ${state.currentStock} unidades disponibles.`);
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
    if(v > state.currentStock) v = state.currentStock;
    i.value = v;
};