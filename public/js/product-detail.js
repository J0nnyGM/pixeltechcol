import { db, doc, getDoc } from "./firebase-init.js";
import { addToCart, updateCartCount } from "./cart.js";

/**
 * --- 1. INICIALIZACIÓN ---
 */
export async function initProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');

    if (!productId) { 
        window.location.href = '/'; 
        return; 
    }

    try {
        const docRef = doc(db, "products", productId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const p = docSnap.data();
            renderProduct(productId, p);
            trackProductView(productId, p);
            
            const viewCountEl = document.getElementById('view-count');
            if(viewCountEl) viewCountEl.textContent = Math.floor(Math.random() * (45 - 12) + 12);
        } else {
            window.location.href = '/';
        }
    } catch (e) { 
        console.error("Error al inicializar detalle:", e); 
    }
}

/**
 * --- 2. RENDERIZADO PRINCIPAL ---
 */
function renderProduct(id, p) {
    document.title = `${p.name} | PixelTech Store`;
    
    // Configuración inicial de imágenes
    const mainImg = document.getElementById('p-main-image');
    const allImages = p.images && p.images.length > 0 ? p.images : [p.mainImage || p.image];
    if (mainImg) mainImg.src = allImages[0];
    
    updateGallery(allImages);

    // Precios y Descuentos
    const priceEl = document.getElementById('p-price');
    const oldPriceEl = document.getElementById('p-old-price');
    const discountTag = document.getElementById('p-discount-tag');

    if (priceEl) priceEl.textContent = `$${p.price.toLocaleString('es-CO')}`;
    
    if (p.originalPrice && p.originalPrice > p.price) {
        if (oldPriceEl) {
            oldPriceEl.textContent = `$${p.originalPrice.toLocaleString('es-CO')}`;
            oldPriceEl.classList.remove('hidden');
        }
        if (discountTag) {
            const discount = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
            discountTag.textContent = `-${discount}% OFF`;
            discountTag.classList.remove('hidden');
        }
    }

    // Textos básicos
    if(document.getElementById('p-name')) document.getElementById('p-name').textContent = p.name;
    if(document.getElementById('breadcrumb-name')) document.getElementById('breadcrumb-name').textContent = p.name;
    if(document.getElementById('breadcrumb-cat')) document.getElementById('breadcrumb-cat').textContent = p.category;
    
    const descEl = document.getElementById('p-description');
    if (descEl) descEl.innerHTML = p.description || '<p>Sin especificaciones disponibles.</p>';

    /**
     * --- 3. GESTIÓN DE VARIANTES (CORREGIDO - SIN DUPLICADOS) ---
     */
const pContent = document.getElementById('p-content');
    const purchaseSection = document.getElementById('purchase-section');

    const existingOptions = document.getElementById('dynamic-options-wrapper');
    if (existingOptions) existingOptions.remove();

    if (pContent && purchaseSection && (p.hasVariants || p.hasCapacities)) {
        const optionsWrapper = document.createElement('div');
        optionsWrapper.id = 'dynamic-options-wrapper';
        optionsWrapper.className = "py-6 border-t border-gray-100 space-y-6";

// --- LÓGICA DE COLORES (ACTUALIZADO A NEGRO) ---
        if (p.hasVariants && p.variants && p.variants.length > 0) {
            const colorDiv = document.createElement('div');
            colorDiv.innerHTML = `<label class="text-[10px] font-black uppercase text-gray-400 block mb-3">Color disponible:</label>`;
            const btnGroup = document.createElement('div');
            btnGroup.className = "flex flex-wrap gap-2";

            p.variants.forEach((v, idx) => {
                const btn = document.createElement('button');
                // CAMBIO: Se usa border-brand-black y bg-slate-100 para el estado activo inicial
                btn.className = `color-btn px-5 py-2.5 rounded-xl border-2 text-[10px] font-black uppercase transition-all ${idx === 0 ? 'border-brand-black bg-slate-100' : 'border-gray-100'}`;
                btn.textContent = v.color;
                
                if(idx === 0) p.selectedColor = v.color;

                btn.onclick = () => {
                    updateGallery(v.images);
                    // Actualizar todos los botones de color eliminando el estado negro
                    document.querySelectorAll('.color-btn').forEach(b => {
                        b.classList.remove('border-brand-black', 'bg-slate-100');
                        b.classList.add('border-gray-100'); 
                    });
                    // Activar el seleccionado con color negro
                    btn.classList.remove('border-gray-100');
                    btn.classList.add('border-brand-black', 'bg-slate-100');
                    p.selectedColor = v.color;
                };
                btnGroup.appendChild(btn);
            });
            colorDiv.appendChild(btnGroup);
            optionsWrapper.appendChild(colorDiv);
        }   

        // --- LÓGICA DE CAPACIDADES ---
        if (p.hasCapacities && p.capacities && p.capacities.length > 0) {
            const capDiv = document.createElement('div');
            capDiv.innerHTML = `<label class="text-[10px] font-black uppercase text-gray-400 block mb-3">Almacenamiento:</label>`;
            const btnGroup = document.createElement('div');
            btnGroup.className = "flex flex-wrap gap-2";

            p.capacities.forEach((c, idx) => {
                const btn = document.createElement('button');
                btn.className = `cap-btn px-5 py-2.5 rounded-xl border-2 text-[10px] font-black uppercase transition-all ${idx === 0 ? 'border-brand-black bg-slate-100' : 'border-gray-100'}`;
                btn.textContent = c.label;

                if(idx === 0) {
                    p.selectedCapacity = c.label;
                    p.currentPrice = c.price;
                }

                btn.onclick = () => {
                    if (priceEl) priceEl.textContent = `$${c.price.toLocaleString('es-CO')}`;
                    // Actualizar todos los botones de capacidad
                    document.querySelectorAll('.cap-btn').forEach(b => {
                        b.classList.remove('border-brand-black', 'bg-slate-100');
                        b.classList.add('border-gray-100'); // Restaurar borde inactivo
                    });
                    // Activar el seleccionado
                    btn.classList.remove('border-gray-100');
                    btn.classList.add('border-brand-black', 'bg-slate-100');
                    p.selectedCapacity = c.label;
                    p.currentPrice = c.price;
                };
                btnGroup.appendChild(btn);
            });
            capDiv.appendChild(btnGroup);
            optionsWrapper.appendChild(capDiv);
        }

        pContent.insertBefore(optionsWrapper, purchaseSection);
    }

    // Configuración Botón Carrito
const addBtn = document.getElementById('btn-add-main');
    if (addBtn) {
        addBtn.onclick = () => {
            const qtyInput = document.getElementById('p-qty');
            const qty = qtyInput ? parseInt(qtyInput.value) : 1;
            
            const itemToCart = {
                ...p,
                id: id,
                price: p.currentPrice || p.price,
                color: p.selectedColor || (p.variants ? p.variants[0]?.color : null),
                capacity: p.selectedCapacity || (p.capacities ? p.capacities[0]?.label : null)
            };

            for(let i=0; i < qty; i++) { addToCart(itemToCart); }
            updateCartCount();
            
            // FEEDBACK VISUAL: De Cian a Verde
            addBtn.innerHTML = '¡Añadido! <i class="fa-solid fa-check"></i>';
            addBtn.classList.replace('bg-brand-cyan', 'bg-green-600');
            addBtn.classList.replace('text-brand-black', 'text-white'); // El verde se ve mejor con blanco

            setTimeout(() => {
                addBtn.innerHTML = 'Agregar al carrito';
                addBtn.classList.replace('bg-green-600', 'bg-brand-cyan');
                addBtn.classList.replace('text-white', 'text-brand-black');
            }, 2000);
        };
    }
    
    // Configuración WhatsApp
    const whatsappBtn = document.getElementById('whatsapp-buy');
    if (whatsappBtn) {
        whatsappBtn.href = `https://wa.me/573000000000?text=Interesado en: ${p.name}`;
    }

    // Mostrar contenido final
    document.getElementById('p-loader')?.classList.add('hidden');
    document.getElementById('p-content')?.classList.remove('hidden');
}

/**
 * --- 4. FUNCIONES DE APOYO ---
 */
function updateGallery(images) {
    const mainImg = document.getElementById('p-main-image');
    const thumbContainer = document.getElementById('p-thumbnails');
    if (!mainImg || !images || images.length === 0) return;
    
    mainImg.src = images[0];
    if (thumbContainer) {
        thumbContainer.innerHTML = "";
        images.forEach((url, index) => {
            const img = document.createElement('img');
            img.src = url;
            img.className = `w-full aspect-square object-cover rounded-2xl cursor-pointer border-2 ${index === 0 ? 'thumb-active' : 'border-transparent'}`;
            img.onclick = () => {
                mainImg.src = url;
                document.querySelectorAll('#p-thumbnails img').forEach(t => t.classList.remove('thumb-active'));
                img.classList.add('thumb-active');
            };
            thumbContainer.appendChild(img);
        });
    }
}

window.changeQty = (val) => {
    const input = document.getElementById('p-qty');
    if (!input) return;
    let current = parseInt(input.value);
    if (current + val >= 1) input.value = current + val;
};

function trackProductView(id, p) {
    let history = JSON.parse(localStorage.getItem('pixeltech_view_history')) || [];
    history = history.filter(item => item.id !== id);
    history.unshift({ id, name: p.name, price: p.price, image: p.mainImage || p.image });
    localStorage.setItem('pixeltech_view_history', JSON.stringify(history.slice(0, 10)));
}

initProductDetail();