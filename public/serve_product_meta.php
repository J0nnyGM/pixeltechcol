<?php
// Le decimos al navegador/bot que esto es HTML válido
header('Content-Type: text/html; charset=utf-8');

// 1. Obtener el ID del producto de la URL
$product_id = isset($_GET['id']) ? trim($_GET['id']) : '';

// 2. Ruta física a tu archivo HTML real
$real_html_path = __DIR__ . '/shop/product.html'; 

// Si no hay ID o no existe el archivo, mostramos error
if (empty($product_id) || !file_exists($real_html_path)) {
    http_response_code(404);
    echo "Página de producto no encontrada.";
    exit;
}

// 3. Leemos el HTML original (que dice <title>Cargando Producto...</title>)
$html = file_get_contents($real_html_path);

// 4. Consultamos Firebase usando su API REST (Súper rápida, ~100ms)
$api_url = "https://firestore.googleapis.com/v1/projects/pixeltechcol/databases/(default)/documents/products/" . urlencode($product_id);

// Timeout de seguridad: Si Firebase tarda más de 2 segundos, no bloqueamos la web
$ctx = stream_context_create(array('http' => array('timeout' => 2.0)));
$response = @file_get_contents($api_url, false, $ctx);

if ($response) {
    $data = json_decode($response, true);
    
    if (isset($data['fields'])) {
        $fields = $data['fields'];
        
        // --- Extraer Datos ---
        $name = isset($fields['name']['stringValue']) ? $fields['name']['stringValue'] : 'Producto';
        
        $price = 0;
        if (isset($fields['price']['integerValue'])) {
            $price = $fields['price']['integerValue'];
        } elseif (isset($fields['price']['doubleValue'])) {
            $price = $fields['price']['doubleValue'];
        }
        $price_formatted = number_format($price, 0, ',', '.');
        
        $image = "https://pixeltechcol.com/img/logo.webp";
        if (isset($fields['mainImage']['stringValue'])) {
            $image = $fields['mainImage']['stringValue'];
        } elseif (isset($fields['image']['stringValue'])) {
            $image = $fields['image']['stringValue'];
        }
        
        $desc = "Compra $name al mejor precio en PixelTech Colombia. Envíos a todo el país y crédito ADDI.";
        if (isset($fields['description']['stringValue'])) {
            $clean_desc = strip_tags($fields['description']['stringValue']); 
            $desc = mb_substr($clean_desc, 0, 150) . "..."; 
        }
        
        $productUrl = "https://pixeltechcol.com/shop/product.html?id=" . urlencode($product_id);
        $title = "$" . $price_formatted . " - " . $name . " | PixelTech";

        // --- Construir Meta Etiquetas Dinámicas ---
        $meta_tags = "
    <title>$title</title>
    <meta name=\"description\" content=\"$desc\">
    
    <meta property=\"og:type\" content=\"product\">
    <meta property=\"og:url\" content=\"$productUrl\">
    <meta property=\"og:title\" content=\"$title\">
    <meta property=\"og:description\" content=\"$desc\">
    <meta property=\"og:image\" content=\"$image\">
    <meta property=\"og:site_name\" content=\"PixelTech Col\">
    
    <meta name=\"twitter:card\" content=\"summary_large_image\">
    <meta name=\"twitter:title\" content=\"$title\">
    <meta name=\"twitter:description\" content=\"$desc\">
    <meta name=\"twitter:image\" content=\"$image\">
        ";

        // 5. Inyectar en el HTML reemplazando la etiqueta de carga
        $html = str_replace('<title>Cargando Producto... | PixelTech</title>', $meta_tags, $html);
        
        // También podemos inyectar un pequeño script para ayudar a tu JS local (Opcional pero recomendado para evitar parpadeos)
        $preloadedData = json_encode([
            'id' => $product_id,
            'name' => $name,
            'price' => $price,
            'mainImage' => $image
        ]);
        $html = str_replace('</head>', "<script>window.__PRELOADED_PRODUCT__ = $preloadedData;</script></head>", $html);
    }
}

// 6. Entregamos la página lista a TODO el mundo
echo $html;
?>