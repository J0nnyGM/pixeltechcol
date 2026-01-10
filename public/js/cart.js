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
    updateCartCount(); // Actualizar el numerito rojo
}

// --- 3. AGREGAR ITEM ---
export function addToCart(product) {
    const cart = getCart();
    
    // Identificador único (si usas variantes color/capacidad, úsalos aquí)
    // Por ahora usaremos el ID del producto
    const existingItem = cart.find(item => item.id === product.id);

    if (existingItem) {
        existingItem.quantity += (product.quantity || 1);
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.mainImage || product.image || 'https://placehold.co/100',
            color: product.color || null,       // Opcional
            capacity: product.capacity || null, // Opcional
            quantity: product.quantity || 1
        });
    }

    saveCart(cart);
    return cart.length;
}

// --- 4. ACTUALIZAR CANTIDAD ---
export function updateQuantity(productId, newQty) {
    let cart = getCart();
    const item = cart.find(i => i.id === productId);

    if (item) {
        item.quantity = parseInt(newQty);
        if (item.quantity <= 0) {
            // Si es 0 o menos, eliminar
            cart = cart.filter(i => i.id !== productId);
        }
        saveCart(cart);
    }
}

// --- 5. ELIMINAR ITEM ---
export function removeFromCart(productId) {
    let cart = getCart();
    cart = cart.filter(item => item.id !== productId);
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

// NUEVA FUNCIÓN: Obtener cantidad de un producto específico en el carrito
export function getProductQtyInCart(productId) {
    const cart = getCart();
    // Sumamos todas las variantes del mismo ID de producto
    return cart
        .filter(item => item.id === productId)
        .reduce((sum, item) => sum + (item.quantity || 0), 0);
}

export function removeOneUnit(productId) {
    let cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
    // Buscamos el índice del último item que coincida con ese ID
    const index = cart.findLastIndex(item => item.id === productId);
    
    if (index !== -1) {
        if (cart[index].quantity > 1) {
            cart[index].quantity -= 1;
        } else {
            cart.splice(index, 1); // Si es 1, lo elimina del array
        }
    }
    localStorage.setItem('pixeltech_cart', JSON.stringify(cart));
}