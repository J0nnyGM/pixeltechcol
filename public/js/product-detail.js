import { db, doc, collection, query, where, limit, getDocs, getDoc, onSnapshot } from './firebase-init.js';
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
    sku: document.getElementById('p-sku-display'),
    qty: document.getElementById('p-qty'),
    loader: document.getElementById('p-loader'),
    content: document.getElementById('p-content'),
    desc: document.getElementById('p-description'),
    
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

    stickyBar: document.getElementById('sticky-bar'),
    stickyPrice: document.getElementById('sticky-price'),
    stickyDiscountRow: document.getElementById('sticky-discount-row'), 
    stickyOldPrice: document.getElementById('sticky-old-price'),     
    stickyBadge: document.getElementById('sticky-discount-badge'),   
    purchaseSection: document.getElementById('purchase-section'),    
    
    relatedSection: document.getElementById('related-products-section'),
    relatedGrid: document.getElementById('related-grid')
};

// Transforma la URL para pedir la version miniatura
function getResizedImageUrl(url) {
    if (!url || !url.includes('firebasestorage')) return url;
    return url.replace(/(\.jpg|\.jpeg|\.png|\.webp)(\?alt=media)/i, '_200x200$1$2');
}

function getProductFromCache(id) {
    try {
        const cachedRaw = localStorage.getItem('pixeltech_master_catalog');
        if (!cachedRaw) return null;
        const cachedData = JSON.parse(cachedRaw);
        const map = cachedData.map || {};
        if (map[id]) {
            return map[id];
        }
    } catch (e) {}
    return null;
}

// Variable global para guardar la lista de imagenes actual
let currentGalleryImages = [];
// Variable para controlar la suscripcion en tiempo real y evitar duplicados
let unsubscribeProduct = null;

// Lógica de swipe para dispositivos moviles
let swipeInitialized = false;

// Parser para documentos REST de Firestore
function parseFirestoreRestDoc(fields, id) {
    const parseVal = (v) => {
        if (!v || typeof v !== 'object') return null;
        if ('stringValue' in v) return v.stringValue;
        if ('integerValue' in v) return parseInt(v.integerValue, 10);
        if ('doubleValue' in v) return parseFloat(v.doubleValue);
        if ('booleanValue' in v) return !!v.booleanValue;
        if ('nullValue' in v) return null;
        if ('arrayValue' in v) {
            const vals = v.arrayValue.values || [];
            return vals.map(parseVal);
        }
        if ('mapValue' in v) {
            const res = {};
            const subFields = v.mapValue.fields || {};
            for (const k in subFields) {
                res[k] = parseVal(subFields[k]);
            }
            return res;
        }
        return null;
    };

    const docData = { id };
    for (const key in fields) {
        docData[key] = parseVal(fields[key]);
    }
    return docData;
}

// Consulta directa resiliente con timeout y fallback REST
async function fetchProductDirectly(productId) {
    try {
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout Firestore getDoc")), 3500)
        );
        const docPromise = getDoc(doc(db, "products", productId));
        const snap = await Promise.race([docPromise, timeoutPromise]);
        
        if (snap && snap.exists()) {
            return { id: snap.id, ...snap.data() };
        }
    } catch (err) {
        console.warn("[Detalle] getDoc lento o no disponible, usando fallback REST...", err);
    }

    try {
        const apiKey = "AIzaSyALwLCRjRaWUE5yy5-TBjjxKehguNhb0GU";
        const url = `https://firestore.googleapis.com/v1/projects/pixeltechcol/databases/(default)/documents/products/${encodeURIComponent(productId)}?key=${apiKey}`;
        const res = await fetch(url);
        if (res.ok) {
            const json = await res.json();
            if (json && json.fields) {
                return parseFirestoreRestDoc(json.fields, productId);
            }
        }
    } catch (restErr) {
        console.warn("[Detalle] REST fallback error:", restErr);
    }

    return null;
}

export async function initProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');

    if (!productId) { window.location.href = '/index.html'; return; }

    let productData = null;

    // 1. HIDRATACION INMEDIATA: Datos precargados desde servidor (0ms)
    if (window.__PRELOADED_PRODUCT__) {
        productData = window.__PRELOADED_PRODUCT__;
        renderProductData(productData, productId);
    }

    // 2. BUSCAR CACHE LOCAL (SmartCache)
    const cachedProduct = getProductFromCache(productId);
    if (cachedProduct) {
        if (!productData || (cachedProduct.variants && !productData.variants)) {
            productData = cachedProduct;
            renderProductData(productData, productId);
        }
    } 

    // 3. CONSULTA DIRECTA CON TIMEOUT Y FALLBACK REST (Inmediata, sin esperar idle)
    fetchProductDirectly(productId).then(freshData => {
        if (freshData) {
            const isDifferent = !productData || JSON.stringify(productData) !== JSON.stringify(freshData);
            if (isDifferent) {
                productData = freshData;
                renderProductData(productData, productId);
                updateLocalCacheWith(productData);
            }
        }
    }).catch(err => {
        console.warn("[Detalle] Error en sync directo:", err);
    });

    // 4. SINCRONIZACION EN SEGUNDO PLANO
    startRealtimeSync(productId);
}

function startRealtimeSync(productId) {
    if (unsubscribeProduct) unsubscribeProduct();
    try {
        unsubscribeProduct = onSnapshot(doc(db, "products", productId), (snap) => {
            if (!snap.exists()) {
                if (!state.product) {
                    document.body.innerHTML = "<div class='flex flex-col items-center justify-center h-screen'><h1 class='text-2xl font-black mb-4'>Producto no disponible</h1><a href='/' class='bg-brand-cyan px-6 py-3 rounded-xl font-bold'>Volver al Inicio</a></div>";
                }
                return;
            }

            const freshData = { id: snap.id, ...snap.data() };
            const isDifferent = !state.product || JSON.stringify(state.product) !== JSON.stringify(freshData);

            if (isDifferent) {
                state.product = freshData;
                renderProductData(freshData, productId);
                updateLocalCacheWith(freshData);
            }
        }, (error) => {
            console.warn("[Detalle] Listener en tiempo real inactivo:", error);
        });
    } catch (e) {
        console.warn("[Detalle] Error iniciando listener:", e);
    }
}

function updateLocalCacheWith(productData) {
    try {
        const STORAGE_KEY = 'pixeltech_master_catalog';
        const cachedRaw = localStorage.getItem(STORAGE_KEY);
        if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);
            if (parsed.map) {
                parsed.map[productData.id] = productData;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            }
        }
    } catch(e) {}
}

async function renderProductData(p, productId) {
    if (!p) return;
    state.product = p;
    
    // Leer parametros de la URL para autoseleccionar variantes
    const params = new URLSearchParams(window.location.search);
    const urlColor = params.get('color');
    const urlCapacity = params.get('capacity');

    if (urlColor && Array.isArray(p.variants)) {
        const foundColor = p.variants.find(v => v.color && v.color.toLowerCase() === urlColor.toLowerCase());
        if (foundColor) state.selectedColor = foundColor.color;
    }
    if (urlCapacity && Array.isArray(p.capacities)) {
        const foundCap = p.capacities.find(c => c.label && c.label.toLowerCase() === urlCapacity.toLowerCase());
        if (foundCap) state.selectedCapacity = foundCap.label;
    }

    // Autoseleccion de proteccion
    if (p.hasCapacities && !state.selectedCapacity && Array.isArray(p.capacities) && p.capacities.length > 0) {
        const validCap = p.capacities.find(cap => getStockForVariant(p, state.selectedColor, cap.label) > 0) || p.capacities[0];
        if (validCap) state.selectedCapacity = validCap.label;
    }
    
    if (p.hasVariants && !state.selectedColor && Array.isArray(p.variants) && p.variants.length > 0) {
        const validColor = p.variants.find(v => getStockForVariant(p, v.color, state.selectedCapacity) > 0) || p.variants[0];
        if (validColor) state.selectedColor = validColor.color;
    }

    // Inicializar valores base
    state.currentPrice = p.price || 0;
    state.currentStock = typeof p.stock === 'number' ? p.stock : 0;
    
    const rawImages = Array.isArray(p.images) ? p.images : [];
    const allImages = [p.mainImage, ...rawImages].filter(Boolean);
    if (!state.currentImage || !allImages.includes(state.currentImage)) {
        state.currentImage = p.mainImage || (allImages.length > 0 ? allImages[0] : 'https://placehold.co/500');
    }

    document.title = `${p.name} | PixelTech`;
    if (els.name) els.name.textContent = p.name;
    if (els.desc) els.desc.innerHTML = p.description || '';

    if (els.breadName) els.breadName.textContent = p.name;
    if (p.category && els.breadCat) {
        els.breadCat.textContent = p.category;
        if (els.breadCatLink) els.breadCatLink.href = `/shop/search.html?category=${encodeURIComponent(p.category)}`;
    } else if (els.breadCat) {
        els.breadCat.textContent = 'General';
    }
    if (p.subcategory && els.breadSub) {
        els.breadSub.textContent = p.subcategory;
        if (els.breadSubLink) {
            els.breadSubLink.href = `/shop/search.html?category=${encodeURIComponent(p.category || '')}&subcategory=${encodeURIComponent(p.subcategory)}`;
            els.breadSubLink.classList.remove('hidden');
        }
        if (els.breadSubSep) els.breadSubSep.classList.remove('hidden');
    }

    if (p.warranty && els.warrantyText) {
        const units = { months: 'Meses', days: 'Días', years: 'Años' };
        const unitText = units[p.warranty.unit] || p.warranty.unit || 'Meses';
        els.warrantyText.textContent = `Garantía directa de ${p.warranty.time} ${unitText} por defectos de fábrica.`;
    }

    try {
        trackEcommerceEvent('view_item', {
            currency: "COP",
            value: p.price,
            items: [{ item_id: p.id, item_name: p.name, price: p.price, item_category: p.category }]
        });
    } catch(e) {}

    renderOptions(p);
    updatePriceDisplay(); 
    updateGallery();
    
    if (els.mainImg) {
        els.mainImg.src = state.currentImage;
        els.mainImg.alt = `Comprar ${p.name} - ${p.category || ''} en Colombia`;
    }

    // Consulta de envios no bloqueante
    updateShippingText().catch(() => {});

    if (els.whatsappBtn) {
        els.whatsappBtn.href = `https://wa.me/573009046450?text=Hola PixelTech, me interesa este producto: ${encodeURIComponent(p.name)} (Ref: ${productId})`;
    }
    if (els.loader) els.loader.classList.add('hidden');
    if (els.content) els.content.classList.remove('hidden');
    if (els.btnAdd) els.btnAdd.onclick = handleAddToCart;
    
    initStickyBar(); 
    if (p.category) {
        loadRelatedProductsOptimized(p.category, p.id); 
    }
    
    try { injectProductSchema(p); } catch (e) {}
    try { updateMetaTags(p); } catch (e) {}
    try { saveToHistory(p); } catch (e) {}
}

async function loadRelatedProductsOptimized(category, currentId) {
    if (!els.relatedSection) return;
    let related = [];
    
    const cachedRaw = localStorage.getItem('pixeltech_master_catalog');
    if (cachedRaw) {
        try {
            const allProducts = Object.values(JSON.parse(cachedRaw).map || {});
            related = allProducts.filter(p => p.category === category && p.status === 'active' && p.id !== currentId);
            if (related.length < 4) {
                const others = allProducts.filter(p => p.category !== category && p.status === 'active' && p.id !== currentId);
                related = [...related, ...others];
            }
        } catch (e) {}
    }

    if (related.length === 0) {
        try {
            let q = query(collection(db, "products"), where("category", "==", category), where("status", "==", "active"), limit(5));
            let snap = await getDocs(q);
            if (snap.empty) {
                q = query(collection(db, "products"), where("status", "==", "active"), limit(5));
                snap = await getDocs(q);
            }
            snap.forEach(d => { if (d.id !== currentId) related.push({ id: d.id, ...d.data() }); });
        } catch (err) { console.error(err); }
    }

    if (related.length === 0) return;
    related.sort(() => 0.5 - Math.random());
    
    els.relatedSection.classList.remove('hidden');
    els.relatedGrid.innerHTML = related.slice(0, 8).map(p => {
        const price = (p.price || 0).toLocaleString('es-CO');
        const originalImg = p.mainImage || (p.images && p.images.length > 0 ? p.images[0] : 'https://placehold.co/150');
        const miniaturaImg = getResizedImageUrl(originalImg);
        const hasDiscount = p.originalPrice && p.originalPrice > p.price;
        const discountBadge = hasDiscount ? `<span class="absolute top-3 left-3 bg-brand-red text-white text-[8px] font-black px-2 py-1 rounded shadow-sm z-10">OFERTA</span>` : '';

        return `
            <div class="w-[70vw] sm:w-[calc(50%-8px)] lg:w-[calc(25%-12px)] shrink-0 bg-white rounded-[1.5rem] md:rounded-[2rem] p-3 md:p-4 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition-all cursor-pointer group relative snap-start" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                ${discountBadge}
                <div class="h-32 md:h-36 mb-3 md:mb-4 flex items-center justify-center p-3 bg-slate-50 rounded-[1.2rem] md:rounded-[1.5rem] group-hover:bg-cyan-50/30 transition-colors">
                    <img src="${miniaturaImg}" width="224" height="224" onerror="this.onerror=null; this.src='${originalImg}';" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-500 mix-blend-multiply" loading="lazy" alt="${p.name}">
                </div>
                <div class="px-1 md:px-2">
                    <p class="text-[8px] md:text-[9px] font-bold text-gray-400 uppercase tracking-widest truncate mb-1">${p.category || ''}</p>
                    <h4 class="text-[11px] md:text-xs font-black text-brand-black uppercase leading-tight line-clamp-2 h-8 mb-2 group-hover:text-brand-cyan transition">${p.name}</h4>
                    <div class="flex justify-between items-end border-t border-gray-50 pt-2 md:pt-3">
                        <div class="flex flex-col">
                            ${hasDiscount ? `<span class="text-[8px] md:text-[9px] text-gray-300 line-through mb-0.5">$${p.originalPrice.toLocaleString('es-CO')}</span>` : ''}
                            <span class="text-sm md:text-base font-black ${hasDiscount ? 'text-brand-red' : 'text-brand-black'} tracking-tight">$${price}</span>
                        </div>
                        <button class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-brand-black text-white flex items-center justify-center hover:bg-brand-cyan hover:scale-110 transition shadow-lg shadow-black/10"><i class="fa-solid fa-plus text-[10px]"></i></button>
                    </div>
                </div>
            </div>`;
    }).join('');

    const grid = els.relatedGrid;
    let autoScrollInterval;

    const startAutoScroll = () => {
        if (document.hidden) return;
        if (autoScrollInterval) clearInterval(autoScrollInterval);
        autoScrollInterval = setInterval(() => {
            if (document.hidden) {
                stopAutoScroll();
                return;
            }
            if (!grid) return;
            const maxScrollLeft = grid.scrollWidth - grid.clientWidth;
            
            if (grid.scrollLeft >= maxScrollLeft - 10) {
                grid.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                const firstCard = grid.querySelector('div');
                const cardWidth = firstCard ? firstCard.offsetWidth + 16 : 240; 
                grid.scrollBy({ left: cardWidth, behavior: 'smooth' });
            }
        }, 3500); 
    };

    const stopAutoScroll = () => {
        if (autoScrollInterval) {
            clearInterval(autoScrollInterval);
            autoScrollInterval = null;
        }
    };

    startAutoScroll();

    grid.addEventListener('mouseenter', stopAutoScroll);
    grid.addEventListener('mouseleave', () => { if (!document.hidden) startAutoScroll(); });
    grid.addEventListener('touchstart', stopAutoScroll, { passive: true });
    grid.addEventListener('touchend', () => { if (!document.hidden) startAutoScroll(); }, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAutoScroll();
        } else {
            startAutoScroll();
        }
    });
}

function initStickyBar() {
    if (!els.stickyBar || !els.purchaseSection) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting && entry.boundingClientRect.top < 0) els.stickyBar.classList.add('visible');
            else els.stickyBar.classList.remove('visible');
        });
    }, { threshold: 0 });
    observer.observe(els.purchaseSection);
}

function saveToHistory(product) {
    try {
        let history = JSON.parse(localStorage.getItem('pixeltech_view_history')) || [];
        history = history.filter(item => item.id !== product.id);
        history.unshift({ id: product.id, name: product.name, price: product.price, image: product.mainImage || product.image, category: product.category });
        if (history.length > 15) history.pop();
        localStorage.setItem('pixeltech_view_history', JSON.stringify(history));
    } catch (e) {}
}

async function updateShippingText() {
    if (!els.shippingText) return;
    try {
        const configSnap = await getDoc(doc(db, "config", "shipping"));
        let cutoffTime = "14:00"; 
        if (configSnap && configSnap.exists()) cutoffTime = configSnap.data().cutoffTime || "14:00";
        const now = new Date();
        const [hours, minutes] = cutoffTime.split(':').map(Number);
        const cutoffDate = new Date();
        cutoffDate.setHours(hours, minutes, 0, 0);
        if (now < cutoffDate) {
            els.shippingText.innerHTML = `<span class="text-green-600 font-black">¡Despacho HOY!</span> <span class="text-brand-black font-bold">si compras antes de las ${cutoffTime}</span>`;
        } else {
            els.shippingText.innerHTML = `<span class="text-brand-cyan font-black">Despacho MAÑANA</span> <span class="text-brand-black font-bold">(Compras después de las ${cutoffTime})</span>`;
        }
    } catch (e) {
        els.shippingText.textContent = "Envío prioritario a nivel nacional.";
    }
}

function getStockForVariant(product, color, capacity) {
    if (!product) return 0;
    if (product.isSimple) return product.stock || 0;
    if (!Array.isArray(product.combinations)) return 0;
    const variant = product.combinations.find(c => (c.color === color || (!c.color && !color)) && (c.capacity === capacity || (!c.capacity && !capacity)));
    return variant ? (variant.stock || 0) : 0;
}

function updatePriceDisplay() {
    const p = state.product;
    if (!p) return;
    let price = p.price || 0;
    let stock = typeof p.stock === 'number' ? p.stock : 0;
    let activeSku = p.sku || 'N/A'; 

    if (!p.isSimple && Array.isArray(p.combinations)) {
        if (state.selectedColor || state.selectedCapacity) {
            const variant = p.combinations.find(c => 
                (c.color === state.selectedColor || (!c.color && !state.selectedColor)) &&
                (c.capacity === state.selectedCapacity || (!c.capacity && !state.selectedCapacity))
            );
            if (variant) {
                stock = variant.stock || 0;
                price = variant.price || price;
                if(variant.sku) activeSku = variant.sku; 
            } else {
                stock = 0; 
            }
        }
    }

    state.currentPrice = price;
    state.currentStock = stock;

    if (els.qty) {
        const currentQty = parseInt(els.qty.value) || 1;
        if (currentQty > stock) els.qty.value = Math.max(1, stock);
        if (stock <= 0) els.qty.value = 0;
    }

    if (els.price) els.price.textContent = `$${price.toLocaleString('es-CO')}`;
    if (els.stickyPrice) els.stickyPrice.textContent = `$${price.toLocaleString('es-CO')}`;
    
    if (els.sku) {
        if (!activeSku || activeSku === 'N/A' || activeSku === '' || activeSku === '--') {
            els.sku.classList.add('hidden');
        } else {
            els.sku.textContent = `REF: ${activeSku}`;
            els.sku.classList.remove('hidden');
        }
    }

    if (p.originalPrice && p.originalPrice > price) {
        const disc = Math.round(((p.originalPrice - price) / p.originalPrice) * 100);
        const formattedOld = `$${p.originalPrice.toLocaleString('es-CO')}`;
        if (els.price) els.price.classList.add('text-brand-red');
        if (els.oldPrice) {
            els.oldPrice.textContent = formattedOld;
            els.oldPrice.classList.remove('hidden');
        }
        if (els.discountTag) { els.discountTag.textContent = `-${disc}%`; els.discountTag.classList.remove('hidden'); }
        if (els.stickyDiscountRow) {
            els.stickyDiscountRow.classList.remove('hidden');
            if (els.stickyOldPrice) els.stickyOldPrice.textContent = formattedOld;
            if (els.stickyBadge) els.stickyBadge.textContent = `-${disc}%`;
            if (els.stickyPrice) {
                els.stickyPrice.classList.add('text-brand-red');
                els.stickyPrice.classList.remove('text-brand-black');
            }
        }
    } else {
        if (els.price) els.price.classList.remove('text-brand-red');
        if (els.oldPrice) els.oldPrice.classList.add('hidden');
        if (els.discountTag) els.discountTag.classList.add('hidden');
        if (els.stickyDiscountRow) {
            els.stickyDiscountRow.classList.add('hidden');
            if (els.stickyPrice) {
                els.stickyPrice.classList.add('text-brand-black');
                els.stickyPrice.classList.remove('text-brand-red');
            }
        }
    }

    if (els.stockText) {
        if (stock > 0) {
            els.stockText.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${stock} unidades disponibles`;
            els.stockText.className = "text-green-600 text-[10px] font-black uppercase tracking-widest mt-4 flex items-center gap-2";
            if (els.btnAdd) {
                els.btnAdd.disabled = false;
                els.btnAdd.classList.remove('bg-gray-400', 'cursor-not-allowed');
                els.btnAdd.classList.add('bg-brand-cyan');
                els.btnAdd.textContent = "Agregar al carrito";
            }
        } else {
            els.stockText.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Agotado`;
            els.stockText.className = "text-red-500 text-[10px] font-black uppercase tracking-widest mt-4 flex items-center gap-2";
            if (els.btnAdd) {
                els.btnAdd.disabled = true;
                els.btnAdd.classList.add('bg-gray-400', 'cursor-not-allowed');
                els.btnAdd.classList.remove('bg-brand-cyan');
                els.btnAdd.textContent = "Sin Stock";
            }
        }
    }

    renderAddiWidget(price);
    try { injectProductSchema(p); } catch (e) {}
}

function updateGallery() {
    if (!els.thumbsContainer) return;
    els.thumbsContainer.innerHTML = "";
    let displayImages = [];
    
    if (state.selectedColor && Array.isArray(state.product?.variants)) {
        const v = state.product.variants.find(vari => vari.color === state.selectedColor);
        if (v && Array.isArray(v.images)) displayImages = [...v.images];
    }
    const globalImages = Array.isArray(state.product?.images) ? state.product.images : [];
    
    currentGalleryImages = Array.from(new Set([...displayImages, ...globalImages].filter(Boolean)));
    
    if (currentGalleryImages.length === 0) {
        currentGalleryImages = [state.product?.mainImage || 'https://placehold.co/500'];
    }

    currentGalleryImages.forEach((src) => {
        const img = document.createElement('img');
        img.src = getResizedImageUrl(src); 
        img.onerror = function() {
            if (this.src !== src) {
                this.src = src;
            }
        };
        
        const activateImage = () => {
            if (state.currentImage === src) return; 
            state.currentImage = src;
            if (els.mainImg) {
                els.mainImg.src = src; 
                els.mainImg.classList.remove('fade-in');
                void els.mainImg.offsetWidth; 
                els.mainImg.classList.add('fade-in');
            }

            Array.from(els.thumbsContainer.children).forEach(child => { 
                child.classList.remove('thumb-active'); 
                child.classList.add('thumb-inactive'); 
            });
            img.classList.remove('thumb-inactive'); 
            img.classList.add('thumb-active');
            
            img.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        };

        const isActive = state.currentImage === src;
        img.className = `min-w-[80px] w-20 md:w-full h-20 object-contain bg-white border rounded-xl cursor-pointer transition-all duration-200 shrink-0 snap-center ${isActive ? 'thumb-active' : 'thumb-inactive'}`;
        img.width = 80;
        img.height = 80;
        img.onmouseenter = activateImage; 
        img.onclick = activateImage;      
        
        els.thumbsContainer.appendChild(img);
    });
    
    initSwipeGallery();
}

function initSwipeGallery() {
    if (swipeInitialized || currentGalleryImages.length <= 1 || !els.mainImg) return;
    
    const imgContainer = els.mainImg.parentElement; 
    if (!imgContainer) return;
    
    let touchStartX = 0;
    let touchEndX = 0;

    imgContainer.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    imgContainer.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });

    function handleSwipe() {
        const swipeDistance = touchStartX - touchEndX;
        const minSwipeDistance = 40; 
        
        const currentIndex = currentGalleryImages.indexOf(state.currentImage);
        if (currentIndex === -1) return;

        if (swipeDistance > minSwipeDistance) {
            const nextIndex = (currentIndex + 1) % currentGalleryImages.length;
            changeToImageIndex(nextIndex);
        } 
        else if (swipeDistance < -minSwipeDistance) {
            const prevIndex = (currentIndex - 1 + currentGalleryImages.length) % currentGalleryImages.length;
            changeToImageIndex(prevIndex);
        }
    }
    
    swipeInitialized = true;
}

function changeToImageIndex(index) {
    if (!els.thumbsContainer) return;
    const thumbs = els.thumbsContainer.children;
    if (thumbs && thumbs[index]) {
        thumbs[index].click(); 
    }
}

function renderOptions(p) {
    if (!els.optionsContainer) return;
    els.optionsContainer.innerHTML = "";
    
    let hasOptions = false; 

    // Colores
    if (p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0) {
        hasOptions = true; 
        const colorDiv = document.createElement('div');
        colorDiv.innerHTML = `<label class="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 text-center md:text-left">Color</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3 justify-center md:justify-start";
        
        p.variants.forEach((v) => {
            const isSelected = state.selectedColor === v.color;
            let isOut = p.hasCapacities ? (!Array.isArray(p.combinations) || !p.combinations.some(c => c.color === v.color && c.stock > 0)) : getStockForVariant(p, v.color, null) <= 0;
            const btn = document.createElement('button');
            let classes = "px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 relative ";
            if (isOut) { classes += "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60 "; btn.disabled = true; }
            else if (isSelected) classes += "bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20 ";
            else classes += "bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black ";
            btn.className = classes;
            btn.innerHTML = v.color + (isOut ? `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] px-1.5 rounded-full">AGOTADO</span>` : '');
            if (!isOut) btn.onclick = () => {
                state.selectedColor = v.color;
                if (p.hasCapacities && Array.isArray(p.capacities)) {
                    if (getStockForVariant(p, state.selectedColor, state.selectedCapacity) <= 0) {
                        const validCap = p.capacities.find(cap => getStockForVariant(p, state.selectedColor, cap.label) > 0);
                        if (validCap) state.selectedCapacity = validCap.label;
                    }
                }
                if (Array.isArray(v.images) && v.images.length > 0) { 
                    state.currentImage = v.images[0]; 
                    if (els.mainImg) els.mainImg.src = state.currentImage; 
                }
                updateGallery(); 
                updatePriceDisplay(); 
                renderOptions(p);
            };
            btnContainer.appendChild(btn);
        });
        colorDiv.appendChild(btnContainer); 
        els.optionsContainer.appendChild(colorDiv);
    }

    // Capacidades
    if (p.hasCapacities && Array.isArray(p.capacities) && p.capacities.length > 0) {
        hasOptions = true; 
        const capDiv = document.createElement('div');
        capDiv.innerHTML = `<label class="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 text-center md:text-left">Capacidad</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3 justify-center md:justify-start";
        
        p.capacities.forEach((c) => {
            const isSelected = state.selectedCapacity === c.label;
            const isOut = state.selectedColor ? getStockForVariant(p, state.selectedColor, c.label) <= 0 : false; 
            const btn = document.createElement('button');
            let classes = `px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 flex flex-col items-center min-w-[100px] relative `;
            if (isOut) { classes += "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60 "; btn.disabled = true; }
            else if (isSelected) classes += "bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20 ";
            else classes += "bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black ";
            btn.className = classes;
            
            let comboPrice = c.price; 
            if (Array.isArray(p.combinations) && state.selectedColor) {
                 const combo = p.combinations.find(comb => comb.color === state.selectedColor && comb.capacity === c.label);
                 if (combo) comboPrice = combo.price;
            } else if (Array.isArray(p.combinations)) {
                const combos = p.combinations.filter(comb => comb.capacity === c.label);
                if(combos.length > 0) comboPrice = Math.min(...combos.map(x => x.price));
            }

            btn.innerHTML = `<span>${c.label}</span><span class="text-[9px] font-normal mt-1 ${isSelected ? 'text-brand-black' : 'text-gray-400'}">$${(comboPrice || 0).toLocaleString('es-CO')}</span>${isOut ? `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] px-1.5 rounded-full">AGOTADO</span>` : ''}`;
            if (!isOut) btn.onclick = () => { 
                state.selectedCapacity = c.label; 
                updatePriceDisplay(); 
                renderOptions(p); 
            };
            btnContainer.appendChild(btn);
        });
        capDiv.appendChild(btnContainer); 
        els.optionsContainer.appendChild(capDiv);
    }

    if (hasOptions) {
        els.optionsContainer.classList.remove('hidden');
    } else {
        els.optionsContainer.classList.add('hidden');
    }
}

function handleAddToCart() {
    if (!els.qty) return;
    const qty = parseInt(els.qty.value) || 1;
    const p = state.product;
    if (!p) return;
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
    setTimeout(() => { 
        if (els.btnAdd) {
            els.btnAdd.innerText = originalText; 
            els.btnAdd.classList.remove('bg-green-500', 'text-white'); 
        }
    }, 1000);
}

window.changeQty = (d) => {
    const i = document.getElementById('p-qty');
    if (!i) return;
    let v = parseInt(i.value) + d;
    if(v < 1) v = 1;
    if(v > state.currentStock) v = state.currentStock;
    i.value = v;
};

function injectProductSchema(p) {
    const oldSchema = document.getElementById('json-ld-product');
    if (oldSchema) oldSchema.remove();
    
    const currentUrl = window.location.href; 
    
    const exactDisplayedPrice = state.currentPrice || p.price || 0;
    const exactDisplayedStock = typeof state.currentStock === 'number' ? state.currentStock : (p.stock || 0);
    const availability = exactDisplayedStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

    let schemaProductName = p.name;
    let currentVariantId = p.id;
    let currentSku = p.sku || p.id;

    if (state.selectedColor || state.selectedCapacity) {
        schemaProductName = `${p.name} ${state.selectedCapacity || ''} ${state.selectedColor ? '- ' + state.selectedColor : ''}`.trim();
        
        if (Array.isArray(p.combinations)) {
            const combo = p.combinations.find(c => 
                (c.color === state.selectedColor || (!c.color && !state.selectedColor)) &&
                (c.capacity === state.selectedCapacity || (!c.capacity && !state.selectedCapacity))
            );
            if (combo) {
                currentVariantId = combo.sku || `${p.id}_${combo.color || 'x'}_${combo.capacity || 'y'}`.replace(/\s+/g, '');
                currentSku = combo.sku || p.sku || currentVariantId;
            }
        }
    }

    const schemaData = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": schemaProductName,
        "image": [state.currentImage || p.mainImage || p.image].filter(Boolean),
        "description": p.description ? p.description.replace(/<[^>]*>?/gm, '') : `Compra ${p.name} en PixelTech.`,
        "sku": currentSku,
        "productID": currentVariantId,
        "brand": { "@type": "Brand", "name": p.brand || "Genérico" },
        "offers": {
            "@type": "Offer",
            "url": currentUrl,
            "priceCurrency": "COP",
            "price": exactDisplayedPrice,
            "availability": availability,
            "itemCondition": "https://schema.org/NewCondition",
            "inventoryLevel": {
                "@type": "QuantitativeValue",
                "value": exactDisplayedStock
            }
        }
    };

    if (p.originalPrice && p.originalPrice > exactDisplayedPrice) {
         schemaData.offers.priceValidUntil = p.promoEndsAt ? new Date(p.promoEndsAt.seconds * 1000).toISOString() : new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString();
    }

    if (p.sku) {
        const cleanSku = p.sku.replace(/\s|-/g, '');
        if (/^\d{8}$|^\d{12,14}$/.test(cleanSku)) {
            schemaData.gtin = cleanSku; 
        } else {
            schemaData.mpn = p.sku; 
        }
    }

    const script = document.createElement('script');
    script.id = "json-ld-product";
    script.type = "application/ld+json";
    script.text = JSON.stringify(schemaData);
    document.head.appendChild(script);
}

function updateMetaTags(p) {
    document.title = `${p.name} | Compra en PixelTech`;
    const setMeta = (name, content, attribute = 'name') => {
        let element = document.querySelector(`meta[${attribute}="${name}"]`);
        if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, name); document.head.appendChild(element); }
        element.setAttribute('content', content);
    };
    const currentUrl = window.location.href;
    const image = p.mainImage || p.image;
    const description = (p.description || '').replace(/<[^>]*>?/gm, '').substring(0, 150);
    setMeta('og:site_name', 'PixelTech Col', 'property');
    setMeta('description', `Compra ${p.name} al mejor precio. ${description}`);
    setMeta('og:type', 'product', 'property');
    setMeta('og:title', p.name, 'property');
    setMeta('og:description', description, 'property');
    setMeta('og:image', image, 'property');
    setMeta('og:url', currentUrl, 'property');
    setMeta('product:price:amount', p.price, 'property');
    setMeta('product:price:currency', 'COP', 'property');
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', p.name);
    setMeta('twitter:image', image);
    const canonicalLink = document.querySelector("link[rel='canonical']") || document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    canonicalLink.setAttribute("href", `${window.location.origin}/shop/product.html?id=${p.id}`);
    document.head.appendChild(canonicalLink);
}

function renderAddiWidget(price) {
    if (!els.addiContainer || price <= 0) {
        const sk = document.getElementById('addi-skeleton');
        if (sk) sk.remove();
        return;
    }

    // Si ya existe el widget, solo le actualizamos el precio
    let existingWidget = els.addiContainer.querySelector('addi-widget');
    if (existingWidget) {
        existingWidget.setAttribute('price', price);
        const sk = document.getElementById('addi-skeleton');
        if (sk) sk.remove();
        return;
    }

    const initAddi = () => {
        try {
            if (!document.getElementById('addi-script')) {
                const script = document.createElement('script');
                script.id = 'addi-script';
                script.src = "https://s3.amazonaws.com/widgets.addi.com/bundle.min.js";
                script.async = true;
                script.onerror = () => {
                    const sk = document.getElementById('addi-skeleton');
                    if (sk) sk.remove();
                };
                document.body.appendChild(script);
            }

            const widget = document.createElement('addi-widget');
            widget.setAttribute('price', price);
            widget.setAttribute('ally-slug', 'pixeltechcolombia-ecommerce');
            widget.setAttribute('text-color', '#111827');
            widget.setAttribute('logo-color', '#00AEC7');
            
            const skeleton = document.getElementById('addi-skeleton');
            if (skeleton) skeleton.remove();
            
            els.addiContainer.appendChild(widget);
        } catch (e) {
            const skeleton = document.getElementById('addi-skeleton');
            if (skeleton) skeleton.remove();
        }
    };

    // Temporizador de seguridad: nunca dejar esqueleto pegado mas de 1.2 segundos
    setTimeout(() => {
        const sk = document.getElementById('addi-skeleton');
        if (sk) sk.remove();
    }, 1200);

    if ('requestIdleCallback' in window) {
        requestIdleCallback(initAddi, { timeout: 1000 });
    } else {
        setTimeout(initAddi, 150);
    }
}