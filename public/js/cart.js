// Clave para guardar en el navegador
const CART_KEY = 'pixeltech_cart';

// --- 1. OBTENER CARRITO ---
export function getCart() {
    const cart = localStorage.getItem(CART_KEY);
    return cart ? JSON.parse(cart) : [];
}

// --- 2. GUARDAR CARRITO (Interna) ---
function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    // Disparar eventos para actualizar UI global
    window.dispatchEvent(new Event('cartUpdated')); 
    updateCartCount();
}

// --- 3. AGREGAR ITEM (VALIDANDO STOCK) ---
export function addToCart(product) {
    const cart = getCart();
    
    // Normalizamos valores
    const pColor = product.color || null;
    const pCapacity = product.capacity || null;
    const maxStock = product.maxStock || 999; 

    const uniqueCartId = `${product.id}-${pColor || 'def'}-${pCapacity || 'def'}`;
    const existingItem = cart.find(item => item.cartId === uniqueCartId);

    let newQty = product.quantity || 1;

    if (existingItem) {
        newQty += existingItem.quantity;
        // VALIDACIÓN DE STOCK
        if (newQty > maxStock) {
            return { success: false, message: `Solo hay ${maxStock} unidades disponibles.` };
        }
        existingItem.quantity = newQty;
    } else {
        // VALIDACIÓN DE STOCK
        if (newQty > maxStock) {
            return { success: false, message: `Solo hay ${maxStock} unidades disponibles.` };
        }
        cart.push({
            cartId: uniqueCartId,
            id: product.id,
            name: product.name,
            price: product.price,
            originalPrice: product.originalPrice || 0,
            image: product.mainImage || product.image || 'https://placehold.co/100',
            color: pColor,       
            capacity: pCapacity, 
            quantity: newQty,
            maxStock: maxStock
        });
    }

    saveCart(cart);
    window.dispatchEvent(new Event('cartItemAdded'));
    
    return { success: true };
}

// --- 4. ACTUALIZAR CANTIDAD (VALIDANDO STOCK) ---
export function updateQuantity(cartId, newQty) {
    let cart = getCart();
    const item = cart.find(i => i.cartId === cartId);

    if (item) {
        const qty = parseInt(newQty);
        const max = item.maxStock || 999; 
        
        if (qty > max) {
            return { success: false, message: `Máximo ${max} unidades.` };
        }

        if (qty <= 0) {
            cart = cart.filter(i => i.cartId !== cartId);
        } else {
            item.quantity = qty;
        }
        saveCart(cart);
        return { success: true };
    }
    return { success: false, message: "Producto no encontrado" };
}

// --- 5. ELIMINAR ITEM (Por ID de carrito - Variante específica) ---
export function removeFromCart(cartId) {
    let cart = getCart();
    cart = cart.filter(item => item.cartId !== cartId);
    saveCart(cart);
}

// --- 6. ELIMINAR UNA UNIDAD (Por ID de Producto - Genérico) ---
// Esta es la función que faltaba y causaba el error en app.js
export function removeOneUnit(productId) {
    let cart = getCart();
    
    // Buscamos el índice del producto. 
    // Nota: Si hay variantes, esto eliminará una unidad de la primera variante que encuentre.
    // Es el comportamiento estándar para botones genéricos en tarjetas de grid.
    const index = cart.findIndex(item => item.id === productId);
    
    if (index !== -1) {
        if (cart[index].quantity > 1) {
            cart[index].quantity -= 1;
        } else {
            cart.splice(index, 1);
        }
        saveCart(cart);
    }
}

// --- 7. CALCULAR TOTAL ---
export function getCartTotal() {
    const cart = getCart();
    return cart.reduce((total, item) => {
        // Si maxStock está definido y es 0, es un producto agotado: No sumar
        if (item.maxStock !== undefined && item.maxStock <= 0) {
            return total;
        }
        return total + (item.price * item.quantity);
    }, 0);
}

// --- 8. ACTUALIZAR BADGES (UI) ---
export function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    const badges = document.querySelectorAll('#cart-count-desktop, #cart-count-mobile');
    badges.forEach(badge => {
        badge.textContent = count;
        if(count > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    });
}

// --- 9. OBTENER CANTIDAD TOTAL DE UN PRODUCTO ---
export function getProductQtyInCart(productId) {
    const cart = getCart();
    return cart
        .filter(item => item.id === productId)
        .reduce((sum, item) => sum + (item.quantity || 0), 0);
}