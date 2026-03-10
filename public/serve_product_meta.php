<?php
// Le decimos al navegador/bot que esto es HTML válido
header('Content-Type: text/html; charset=utf-8');

// 1. Obtener el ID del producto
$product_id = isset($_GET['id']) ? trim($_GET['id']) : '';

// 2. Ruta física a tu archivo HTML real
$real_html_path = __DIR__ . '/shop/product.html'; 

if (empty($product_id) || !file_exists($real_html_path)) {
    http_response_code(404);
    echo "Página de producto no encontrada.";
    exit;
}

// 3. Leemos el HTML original
$html = file_get_contents($real_html_path);

// 4. API REST de Firebase + Tu API Key
$api_key = "AIzaSyALwLCRjRaWUE5yy5-TBjjxKehguNhb0GU"; // Tu API Key extraída de firebase-init.js
$api_url = "https://firestore.googleapis.com/v1/projects/pixeltechcol/databases/(default)/documents/products/" . urlencode($product_id) . "?key=" . $api_key;

// 5. Usamos cURL en lugar de file_get_contents para saltar bloqueos de cPanel
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_TIMEOUT, 2); // 2 segundos máximo
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// 6. Si Firebase respondió correctamente, procesamos los datos
if ($http_code == 200 && $response) {
    $data = json_decode($response, true);
    
    if (isset($data['fields'])) {
        $fields = $data['fields'];
        
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

        // Reemplazamos cualquier etiqueta <title> existente en tu HTML por nuestros Metas usando RegEx
        $html = preg_replace('/<title>.*?<\/title>/is', $meta_tags, $html);
        
        // Inyectamos datos para acelerar la carga visual del cliente
        $preloadedData = json_encode([
            'id' => $product_id,
            'name' => $name,
            'price' => $price,
            'mainImage' => $image
        ]);
        $html = str_replace('</head>', "\n<script>window.__PRELOADED_PRODUCT__ = $preloadedData;</script>\n</head>", $html);
    }
}

// 7. Entregamos la página final
echo $html;
?>