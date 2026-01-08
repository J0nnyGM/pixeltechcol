import { db, collection, addDoc } from "./firebase-init.js";

const products = [
    {
        name: "Set de Artes Digital",
        price: 180000,
        originalPrice: 250000, // Precio anterior para tachar
        category: "Creatividad",
        image: "https://placehold.co/300x300/E63946/FFF?text=Art+Set",
        description: "Tablet gráfica con stylus de alta precisión.",
        stock: 10
    },
    {
        name: "AirPods Pro 2",
        price: 950000,
        originalPrice: 1200000,
        category: "Audio",
        image: "https://placehold.co/300x300/1A1A1A/FFF?text=AirPods",
        description: "Cancelación de ruido activa y audio espacial.",
        stock: 25
    },
    {
        name: "Smartwatch Ultra",
        price: 350000,
        originalPrice: 500000,
        category: "Smartwatch",
        image: "https://placehold.co/300x300/00AEC7/FFF?text=Watch+Ultra",
        description: "Monitor de salud y batería de 3 días.",
        stock: 15
    },
    {
        name: "Laptop Gamer X",
        price: 4500000,
        originalPrice: 5200000,
        category: "Computación",
        image: "https://placehold.co/300x300/333/FFF?text=Laptop+Gamer",
        description: "RTX 4060, 16GB RAM, 1TB SSD.",
        stock: 5
    }
];

export async function uploadProducts() {
    if(!confirm("¿Actualizar catálogo de PixelTech?")) return;
    
    console.log("⏳ Subiendo productos...");
    const productsRef = collection(db, "products");

    for (const product of products) {
        await addDoc(productsRef, product);
    }
    alert("¡Catálogo actualizado con ofertas!");
    location.reload();
}