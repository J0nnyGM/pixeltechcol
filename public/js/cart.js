// Clave para guardar en el navegador
const CART_KEY = 'pixeltech_cart';

// --- 1. OBTENER CARRITO ---
export function getCart() {
    const cart = localStorage.getItem(CART_KEY);
    return cart ? JSON.parse(cart) : [];
}

// --- 2. GUARDAR CARRITO ---
function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount();
}

// --- 3. AGREGAR ITEM (Soporte Real de Variantes) ---
export function addToCart(product) {
    const cart = getCart();
    
    // Normalizamos valores para evitar errores (null si no existen)
    const pColor = product.color || null;
    const pCapacity = product.capacity || null;

    // Generamos un ID único para ESTA línea del carrito
    // Ejemplo: "prod123-Negro-128GB" vs "prod123-Blanco-128GB"
    const uniqueCartId = `${product.id}-${pColor || 'def'}-${pCapacity || 'def'}`;

    // Buscamos por este ID único
    const existingItem = cart.find(item => item.cartId === uniqueCartId);

    if (existingItem) {
        existingItem.quantity += (product.quantity || 1);
    } else {
        cart.push({
            cartId: uniqueCartId, // IMPORTANTE: Usaremos esto para borrar/editar
            id: product.id,       // ID real del producto (para base de datos)
            name: product.name,
            price: product.price,
            originalPrice: product.originalPrice || 0,
            image: product.mainImage || product.image || 'https://placehold.co/100',
            color: pColor,       
            capacity: pCapacity, 
            quantity: product.quantity || 1
        });
    }

    saveCart(cart);
    return cart.length;
}

// --- 4. ACTUALIZAR CANTIDAD ---
export function updateQuantity(cartId, newQty) {
    let cart = getCart();
    // Buscamos por cartId (único por variante)
    const item = cart.find(i => i.cartId === cartId);

    if (item) {
        item.quantity = parseInt(newQty);
        if (item.quantity <= 0) {
            cart = cart.filter(i => i.cartId !== cartId);
        }
        saveCart(cart);
    }
}

// --- 5. ELIMINAR ITEM ---
export function removeFromCart(cartId) {
    let cart = getCart();
    // Eliminamos solo la variante específica
    cart = cart.filter(item => item.cartId !== cartId);
    saveCart(cart);
}

// --- 6. CALCULAR TOTAL ---
export function getCartTotal() {
    const cart = getCart();
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

// --- 7. ACTUALIZAR BADGES (UI) ---
export function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    const badges = document.querySelectorAll('#cart-count, .cart-badge');
    badges.forEach(badge => {
        badge.textContent = count;
        if(count > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    });
}

// Obtener cantidad total de un producto (sumando variantes)
export function getProductQtyInCart(productId) {
    const cart = getCart();
    return cart
        .filter(item => item.id === productId)
        .reduce((sum, item) => sum + (item.quantity || 0), 0);
}

// Eliminar una unidad (usado en botones inteligentes de la tienda)
export function removeOneUnit(productId) {
    let cart = getCart();
    // Nota: Esto es complejo con variantes. Por defecto quitamos del último agregado de ese ID
    const index = cart.findLastIndex(item => item.id === productId);
    
    if (index !== -1) {
        if (cart[index].quantity > 1) {
            cart[index].quantity -= 1;
        } else {
            cart.splice(index, 1);
        }
        saveCart(cart);
    }
}