// public/js/cart.js

const CART_KEY = 'pixeltech_cart';

export function getCart() {
    const cart = localStorage.getItem(CART_KEY);
    return cart ? JSON.parse(cart) : [];
}

function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount();
}

// AGREGAR PRODUCTO (Soporta Variantes)
export function addToCart(product) {
    const cart = getCart();
    
    // Crear una llave única para esta combinación de variantes
    const cartItemId = `${product.id}_${product.color || 'default'}_${product.capacity || 'default'}`;

    const existingItem = cart.find(item => item.cartItemId === cartItemId);

    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        // Guardamos el cartItemId para poder identificar esta variante luego
        cart.push({ 
            ...product, 
            cartItemId, 
            quantity: 1 
        });
    }

    saveCart(cart);
    return cart.length;
}

// ELIMINAR PRODUCTO (Usando cartItemId)
export function removeFromCart(cartItemId) {
    let cart = getCart();
    cart = cart.filter(item => item.cartItemId !== cartItemId);
    saveCart(cart);
    return cart;
}

// ACTUALIZAR CANTIDAD (Usando cartItemId)
export function updateQuantity(cartItemId, newQuantity) {
    const cart = getCart();
    const item = cart.find(item => item.cartItemId === cartItemId);
    
    if (item) {
        item.quantity = parseInt(newQuantity);
        if (item.quantity <= 0) {
            return removeFromCart(cartItemId);
        }
        saveCart(cart);
    }
    return cart;
}

export function getCartTotal() {
    const cart = getCart();
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

export function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    const badges = document.querySelectorAll('#cart-count, .cart-badge');
    badges.forEach(badge => {
        badge.textContent = count;
    });
}