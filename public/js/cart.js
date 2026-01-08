// public/js/cart.js

// Clave para guardar en el navegador
const CART_KEY = 'pixeltech_cart';

// Obtener carrito actual
export function getCart() {
    const cart = localStorage.getItem(CART_KEY);
    return cart ? JSON.parse(cart) : [];
}

// Guardar carrito
function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount(); // Actualizar el numerito rojo del navbar
}

// Agregar producto
export function addToCart(product) {
    const cart = getCart();
    // Verificar si ya existe para sumar cantidad
    const existingItem = cart.find(item => item.id === product.id);

    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ ...product, quantity: 1 });
    }

    saveCart(cart);
    
    // Feedback visual (SweetAlert o nativo)
    // Por ahora usaremos un console log y efecto visual en el botón
    console.log("Producto agregado:", product.name);
    return cart.length;
}

// Eliminar producto
export function removeFromCart(productId) {
    let cart = getCart();
    cart = cart.filter(item => item.id !== productId);
    saveCart(cart);
    return cart;
}

// Actualizar cantidad (Subir/Bajar)
export function updateQuantity(productId, newQuantity) {
    const cart = getCart();
    const item = cart.find(item => item.id === productId);
    
    if (item) {
        item.quantity = parseInt(newQuantity);
        if (item.quantity <= 0) {
            return removeFromCart(productId);
        }
        saveCart(cart);
    }
    return cart;
}

// Calcular Total
export function getCartTotal() {
    const cart = getCart();
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

// Actualizar el contador del Navbar (El círculo rojo)
export function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    // Buscar todos los contadores en la página (Móvil y Desktop)
    const badges = document.querySelectorAll('#cart-count, .cart-badge');
    badges.forEach(badge => {
        badge.textContent = count;
        // Animación pequeña si cambió
        badge.classList.add('scale-125');
        setTimeout(() => badge.classList.remove('scale-125'), 200);
    });
}