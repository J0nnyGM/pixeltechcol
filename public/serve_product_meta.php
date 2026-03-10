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
$api_key = "AIzaSyALwLCRjRaWUE5yy5-TBjjxKehguNhb0GU"; 
$api_url = "https://firestore.googleapis.com/v1/projects/pixeltechcol/databases/(default)/documents/products/" . urlencode($product_id) . "?key=" . $api_key;

// 5. Petición cURL segura
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_TIMEOUT, 2); 
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// 6. Procesamos los datos si Firebase respondió bien
if ($http_code == 200 && $response) {
    $data = json_decode($response, true);
    
    if (isset($data['fields'])) {
        $fields = $data['fields'];
        
        // --- 1. Extraer Nombre ---
        $name = isset($fields['name']['stringValue']) ? $fields['name']['stringValue'] : 'Producto';
        
        // --- 2. EXTRAER PRECIO (LÓGICA BLINDADA) ---
        $price = 0;
        
        // A. Buscar precio principal
        if (isset($fields['price'])) {
            if (isset($fields['price']['integerValue'])) {
                $price = floatval($fields['price']['integerValue']);
            } elseif (isset($fields['price']['doubleValue'])) {
                $price = floatval($fields['price']['doubleValue']);
            } elseif (isset($fields['price']['stringValue'])) {
                // Si se guardó como texto con puntos, los limpiamos
                $price = floatval(preg_replace('/[^0-9]/', '', $fields['price']['stringValue']));
            }
        }
        
        // B. Si el precio es 0 (Productos variables), buscar en "capacities"
        if ($price == 0 && isset($fields['capacities']['arrayValue']['values'])) {
            $min_price = 0;
            foreach ($fields['capacities']['arrayValue']['values'] as $cap) {
                $p = 0;
                if (isset($cap['mapValue']['fields']['price']['integerValue'])) {
                    $p = floatval($cap['mapValue']['fields']['price']['integerValue']);
                } elseif (isset($cap['mapValue']['fields']['price']['doubleValue'])) {
                    $p = floatval($cap['mapValue']['fields']['price']['doubleValue']);
                }
                
                // Guardamos el precio más barato que encontremos
                if ($min_price == 0 || ($p > 0 && $p < $min_price)) {
                    $min_price = $p;
                }
            }
            if ($min_price > 0) {
                $price = $min_price;
            }
        }

        // Formatear a pesos colombianos (Ej: 1500000 -> 1.500.000)
        $price_formatted = number_format($price, 0, ',', '.');
        
        // --- 3. Extraer Imagen ---
        $image = "https://pixeltechcol.com/img/logo.webp";
        if (isset($fields['mainImage']['stringValue'])) {
            $image = $fields['mainImage']['stringValue'];
        } elseif (isset($fields['image']['stringValue'])) {
            $image = $fields['image']['stringValue'];
        }
        
        // --- 4. Extraer Descripción ---
        $desc = "Compra $name al mejor precio en PixelTech Colombia. Envíos a todo el país y crédito ADDI.";
        if (isset($fields['description']['stringValue'])) {
            $clean_desc = strip_tags($fields['description']['stringValue']); 
            // Limpiamos saltos de línea para SEO
            $clean_desc = trim(preg_replace('/\s\s+/', ' ', $clean_desc)); 
            $desc = mb_substr($clean_desc, 0, 150) . "..."; 
        }
        
        $productUrl = "https://pixeltechcol.com/shop/product.html?id=" . urlencode($product_id);
        $title = "$" . $price_formatted . " - " . $name . " | PixelTech";

        // --- 5. Construir Meta Etiquetas Dinámicas ---
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

        // 6. Inyectar en el HTML
        $html = preg_replace('/<title>.*?<\/title>/is', $meta_tags, $html);
        
        // Opcional: Inyectamos datos JS para que la página sea aún más rápida
        $preloadedData = json_encode([
            'id' => $product_id,
            'name' => $name,
            'price' => $price,
            'mainImage' => $image
        ]);
        $html = str_replace('</head>', "\n<script>window.__PRELOADED_PRODUCT__ = $preloadedData;</script>\n</head>", $html);
    }
}

// 7. Imprimir la página final
echo $html;
?>