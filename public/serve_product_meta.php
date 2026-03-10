<?php
// Le decimos al navegador/bot que esto es HTML válido
header('Content-Type: text/html; charset=utf-8');

// 1. Obtener el ID del producto
$product_id = isset($_GET['id']) ? trim($_GET['id']) : '';
$real_html_path = __DIR__ . '/shop/product.html'; 

if (empty($product_id) || !file_exists($real_html_path)) {
    http_response_code(404);
    echo "Página de producto no encontrada.";
    exit;
}

// 2. Leemos el HTML original
$html = file_get_contents($real_html_path);

// 3. API REST directa a Firebase (Cero Cold Starts, respuesta en milisegundos)
$api_key = "AIzaSyALwLCRjRaWUE5yy5-TBjjxKehguNhb0GU"; 
$api_url = "https://firestore.googleapis.com/v1/projects/pixeltechcol/databases/(default)/documents/products/" . urlencode($product_id) . "?key=" . $api_key;

// 4. Ejecutamos cURL con 5 segundos de paciencia (Por si la red general está lenta)
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_TIMEOUT, 5); 
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// --- FUNCIÓN AUXILIAR PARA LIMPIAR PRECIOS DE FIREBASE ---
function parseFirebasePrice($field) {
    if (!$field) return 0;
    if (isset($field['integerValue'])) return floatval($field['integerValue']);
    if (isset($field['doubleValue'])) return floatval($field['doubleValue']);
    if (isset($field['stringValue'])) return floatval(preg_replace('/[^0-9]/', '', $field['stringValue']));
    return 0;
}

// 5. Procesamos la data
if ($http_code == 200 && $response) {
    $data = json_decode($response, true);
    
    if (isset($data['fields'])) {
        $fields = $data['fields'];
        
        // A. Extraer Nombre
        $name = isset($fields['name']['stringValue']) ? $fields['name']['stringValue'] : 'Producto';
        
        // B. Extraer Precio (Lógica Inteligente)
        $price = parseFirebasePrice($fields['price'] ?? null);
        
        if ($price == 0) {
            $all_prices = [];
            
            // Buscar en Combinaciones
            if (isset($fields['combinations']['arrayValue']['values'])) {
                foreach ($fields['combinations']['arrayValue']['values'] as $item) {
                    $p = parseFirebasePrice($item['mapValue']['fields']['price'] ?? null);
                    if ($p > 0) $all_prices[] = $p;
                }
            }
            // Buscar en Capacidades
            if (isset($fields['capacities']['arrayValue']['values'])) {
                foreach ($fields['capacities']['arrayValue']['values'] as $item) {
                    $p = parseFirebasePrice($item['mapValue']['fields']['price'] ?? null);
                    if ($p > 0) $all_prices[] = $p;
                }
            }
            // Buscar en Variantes (Colores)
            if (isset($fields['variants']['arrayValue']['values'])) {
                foreach ($fields['variants']['arrayValue']['values'] as $item) {
                    $p = parseFirebasePrice($item['mapValue']['fields']['price'] ?? null);
                    if ($p > 0) $all_prices[] = $p;
                }
            }
            
            if (count($all_prices) > 0) {
                $price = min($all_prices); // Tomamos el precio más barato
            }
        }

        $price_formatted = number_format($price, 0, ',', '.');
        
        // C. Extraer Imagen
        $image = "https://pixeltechcol.com/img/logo.webp";
        if (isset($fields['mainImage']['stringValue'])) {
            $image = $fields['mainImage']['stringValue'];
        } elseif (isset($fields['image']['stringValue'])) {
            $image = $fields['image']['stringValue'];
        } elseif (isset($fields['images']['arrayValue']['values'][0]['stringValue'])) {
            $image = $fields['images']['arrayValue']['values'][0]['stringValue'];
        }
        
        // D. Extraer Descripción
        $desc = "Compra $name al mejor precio en PixelTech Colombia. Envíos a todo el país y crédito ADDI.";
        if (isset($fields['description']['stringValue'])) {
            $clean_desc = strip_tags($fields['description']['stringValue']); 
            $clean_desc = trim(preg_replace('/\s\s+/', ' ', $clean_desc)); 
            $desc = mb_substr($clean_desc, 0, 150) . "..."; 
        }
        
        $productUrl = "https://pixeltechcol.com/shop/product.html?id=" . urlencode($product_id);
        $title = "$" . $price_formatted . " - " . $name . " | PixelTech";

        // 6. Construir Meta Etiquetas Dinámicas
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

        // 7. Inyectar en el HTML
        $html = preg_replace('/<title>.*?<\/title>/is', $meta_tags, $html);
        
        // Inyectamos JSON para acelerar tu JS
        $preloadedData = json_encode([
            'id' => $product_id,
            'name' => $name,
            'price' => $price,
            'mainImage' => $image
        ]);
        $html = str_replace('</head>', "\n<script>window.__PRELOADED_PRODUCT__ = $preloadedData;</script>\n</head>", $html);
    }
}

// 8. Imprimir la página final
echo $html;
?>