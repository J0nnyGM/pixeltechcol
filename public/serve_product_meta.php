<?php
// Le decimos al navegador que esto es HTML valido
header('Content-Type: text/html; charset=utf-8');

// 1. Obtener el ID del producto
$product_id = isset($_GET['id']) ? trim($_GET['id']) : '';
$real_html_path = __DIR__ . '/shop/product.html'; 

if (empty($product_id) || !file_exists($real_html_path)) {
    http_response_code(404);
    echo "Pagina de producto no encontrada.";
    exit;
}

// -------------------------------------------------------------------
// SISTEMA DE CACHE DE SERVIDOR V2 (VELOCIDAD EXTREMA Y PRECARGA COMPLETA)
// -------------------------------------------------------------------
$cache_dir = __DIR__ . '/cache';
if (!is_dir($cache_dir)) {
    @mkdir($cache_dir, 0755, true);
}

// Usamos prefijo prod_v2_ para invalidar caches obsoletas con esqueletos pegados
$cache_file = $cache_dir . '/prod_v2_' . md5($product_id) . '.html';
$cache_time = 7200; // 2 horas (7200 segundos)

if (file_exists($cache_file) && (time() - filemtime($cache_file)) < $cache_time) {
    header('X-PixelTech-Cache: HIT');
    echo file_get_contents($cache_file);
    exit;
}
header('X-PixelTech-Cache: MISS');
// -------------------------------------------------------------------

// 2. Leemos el HTML original procesando el codigo PHP interno (Header/Footer)
ob_start();
include $real_html_path;
$html = ob_get_clean();

// 3. API REST directa a Firebase
$api_key = "AIzaSyALwLCRjRaWUE5yy5-TBjjxKehguNhb0GU"; 
$api_url = "https://firestore.googleapis.com/v1/projects/pixeltechcol/databases/(default)/documents/products/" . urlencode($product_id) . "?key=" . $api_key;

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_TIMEOUT, 4); 
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Referer: https://pixeltechcol.com/",
    "Origin: https://pixeltechcol.com"
]);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

function parseFirebasePrice($field) {
    if (!$field) return 0;
    if (isset($field['integerValue'])) return floatval($field['integerValue']);
    if (isset($field['doubleValue'])) return floatval($field['doubleValue']);
    if (isset($field['stringValue'])) return floatval(preg_replace('/[^0-9]/', '', $field['stringValue']));
    return 0;
}

function parseFirestoreValue($val) {
    if (!is_array($val)) return null;
    if (isset($val['stringValue'])) return $val['stringValue'];
    if (isset($val['integerValue'])) return intval($val['integerValue']);
    if (isset($val['doubleValue'])) return floatval($val['doubleValue']);
    if (isset($val['booleanValue'])) return boolval($val['booleanValue']);
    if (isset($val['timestampValue'])) return $val['timestampValue'];
    if (isset($val['nullValue'])) return null;
    if (isset($val['arrayValue'])) {
        $arr = [];
        if (isset($val['arrayValue']['values']) && is_array($val['arrayValue']['values'])) {
            foreach ($val['arrayValue']['values'] as $item) {
                $arr[] = parseFirestoreValue($item);
            }
        }
        return $arr;
    }
    if (isset($val['mapValue'])) {
        $map = [];
        if (isset($val['mapValue']['fields']) && is_array($val['mapValue']['fields'])) {
            foreach ($val['mapValue']['fields'] as $k => $item) {
                $map[$k] = parseFirestoreValue($item);
            }
        }
        return $map;
    }
    return null;
}

// 4. Procesamos la data
if ($http_code == 200 && $response) {
    $data = json_decode($response, true);
    
    if (isset($data['fields'])) {
        $fields = $data['fields'];
        
        $name = isset($fields['name']['stringValue']) ? $fields['name']['stringValue'] : 'Producto';
        $price = parseFirebasePrice($fields['price'] ?? null);
        
        if ($price == 0) {
            $all_prices = [];
            foreach (['combinations', 'capacities', 'variants'] as $arrKey) {
                if (isset($fields[$arrKey]['arrayValue']['values'])) {
                    foreach ($fields[$arrKey]['arrayValue']['values'] as $item) {
                        $p = parseFirebasePrice($item['mapValue']['fields']['price'] ?? null);
                        if ($p > 0) $all_prices[] = $p;
                    }
                }
            }
            if (count($all_prices) > 0) {
                $price = min($all_prices);
            }
        }

        $image = "https://pixeltechcol.com/img/logo.webp";
        if (isset($fields['mainImage']['stringValue'])) {
            $image = $fields['mainImage']['stringValue'];
        } elseif (isset($fields['image']['stringValue'])) {
            $image = $fields['image']['stringValue'];
        } elseif (isset($fields['images']['arrayValue']['values'][0]['stringValue'])) {
            $image = $fields['images']['arrayValue']['values'][0]['stringValue'];
        }
        
        $desc = "Compra $name al mejor precio en PixelTech Colombia. Envios a todo el pais y credito ADDI.";
        if (isset($fields['description']['stringValue'])) {
            $clean_desc = strip_tags($fields['description']['stringValue']); 
            $clean_desc = trim(preg_replace('/\s\s+/', ' ', $clean_desc)); 
            $desc = mb_substr($clean_desc, 0, 150) . "..."; 
        }
        
        $productUrl = "https://pixeltechcol.com/shop/product.html?id=" . urlencode($product_id);
        
        if ($price > 0) {
            $title = "$" . number_format($price, 0, ',', '.') . " - " . $name . " | PixelTech";
        } else {
            $title = $name . " | PixelTech";
        }

        // 5. Construir objeto de producto completo para precarga instantanea
        $fullProduct = ['id' => $product_id];
        foreach ($fields as $key => $val) {
            $fullProduct[$key] = parseFirestoreValue($val);
        }
        $fullProduct['id'] = $product_id;
        $fullProduct['name'] = $name;
        $fullProduct['price'] = $price;
        $fullProduct['mainImage'] = $image;
        if (!isset($fullProduct['images']) || !is_array($fullProduct['images']) || count($fullProduct['images']) === 0) {
            $fullProduct['images'] = [$image];
        }

        $isSimple = !empty($fullProduct['isSimple']) || (empty($fullProduct['hasVariants']) && empty($fullProduct['hasCapacities']));
        $fullProduct['isSimple'] = $isSimple;

        // 6. Schema.org estructurado
        $schemaData = [
            "@context" => "https://schema.org/",
            "@type" => "Product",
            "name" => $name,
            "image" => [$image],
            "description" => $desc,
            "sku" => !empty($fullProduct['sku']) ? $fullProduct['sku'] : $product_id,
            "offers" => [
                "@type" => "Offer",
                "url" => $productUrl,
                "priceCurrency" => "COP",
                "price" => $price,
                "availability" => (!isset($fullProduct['stock']) || $fullProduct['stock'] > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
            ]
        ];
        $json_ld = json_encode($schemaData, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $meta_tags = "
    <link rel=\"preload\" as=\"image\" href=\"$image\" fetchpriority=\"high\">
    <title>$title</title>
    <meta name=\"description\" content=\"$desc\">
    <meta property=\"og:type\" content=\"product\">
    <meta property=\"og:url\" content=\"$productUrl\">
    <meta property=\"og:title\" content=\"$title\">
    <meta property=\"og:description\" content=\"$desc\">
    <meta property=\"og:image\" content=\"$image\">
    <meta property=\"og:site_name\" content=\"PixelTech Col\">
    <meta property=\"product:price:amount\" content=\"$price\">
    <meta property=\"product:price:currency\" content=\"COP\">
    <meta name=\"twitter:card\" content=\"summary_large_image\">
    <meta name=\"twitter:title\" content=\"$title\">
    <meta name=\"twitter:description\" content=\"$desc\">
    <meta name=\"twitter:image\" content=\"$image\">
    <script type=\"application/ld+json\" id=\"json-ld-product\">
    $json_ld
    </script>
        ";

        $safe_meta_tags = str_replace('$', '\\$', $meta_tags);
        $html = preg_replace('/<title>.*?<\/title>/is', $safe_meta_tags, $html);
        
        // Inyeccion directa de foto principal
        $safe_image = str_replace('$', '\\$', $image);
        $html = preg_replace('/(<img[^>]*id="p-main-image"[^>]*src=")([^"]*)("[^>]*>)/is', '${1}' . $safe_image . '$3', $html);
        
        // Inyeccion directa de precio
        $formatted_price = "$" . number_format($price, 0, ',', '.');
        $html = preg_replace('/(<span[^>]*id="p-price"[^>]*>).*?(<\/span>)/is', '${1}' . $formatted_price . '$2', $html);

        // Inyeccion directa de nombre
        $safe_name = str_replace('$', '\\$', $name);
        $html = preg_replace('/(<h1[^>]*id="p-name"[^>]*>)(.*?)(<\/h1>)/is', '${1}' . $safe_name . '${3}', $html);
        
        // Inyeccion directa de descripcion
        if (isset($fields['description']['stringValue'])) {
            $raw_desc = $fields['description']['stringValue'];
            $safe_desc_html = str_replace('$', '\\$', $raw_desc);
            $html = preg_replace('/(<div[^>]*id="p-description"[^>]*>)(.*?)(<\/div>)/is', '${1}' . $safe_desc_html . '${3}', $html);
        }

        // Inyeccion directa de SKU si existe
        if (!empty($fullProduct['sku'])) {
            $safe_sku = htmlspecialchars($fullProduct['sku'], ENT_QUOTES, 'UTF-8');
            $html = preg_replace('/(<p[^>]*id="p-sku-display"[^>]*>).*?(<\/p>)/is', '${1}REF: ' . $safe_sku . '${2}', $html);
        }

        // Inyeccion directa de stock si existe
        if (isset($fullProduct['stock'])) {
            $stk = intval($fullProduct['stock']);
            if ($stk > 0) {
                $stock_html = '<i class="fa-solid fa-circle-check"></i> ' . $stk . ' unidades disponibles';
                $html = preg_replace('/(<p[^>]*id="p-stock-text"[^>]*>).*?(<\/p>)/is', '${1}' . $stock_html . '${2}', $html);
            } else {
                $stock_html = '<i class="fa-solid fa-circle-xmark"></i> Agotado';
                $html = preg_replace('/(<p[^>]*id="p-stock-text"[^>]*>).*?(<\/p>)/is', '${1}' . $stock_html . '${2}', $html);
                $html = preg_replace('/text-green-600/i', 'text-red-500', $html);
            }
        }

        // Si es producto simple, vaciamos y ocultamos el esqueleto de opciones
        if ($isSimple) {
            $html = preg_replace('/(<div[^>]*id="p-options"[^>]*>).*?(<\/div>\s*<div id="purchase-section")/is', '<div id="p-options" class="hidden"></div><div id="purchase-section"', $html);
        }

        // Reemplazamos los esqueletos de miniaturas por la miniatura real para evitar parpadeos
        $safe_thumb_img = htmlspecialchars($image, ENT_QUOTES, 'UTF-8');
        $safe_thumb_alt = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
        $thumb_markup = '<img src="' . $safe_thumb_img . '" class="min-w-[80px] w-20 md:w-full h-20 object-contain bg-white border rounded-xl cursor-pointer transition-all duration-200 shrink-0 snap-center thumb-active" width="80" height="80" alt="' . $safe_thumb_alt . '">';
        $html = preg_replace('/(<div[^>]*id="p-thumbnails"[^>]*>).*?(<\/div>\s*<div[^>]*class="order-1)/is', '${1}' . $thumb_markup . '</div><div class="order-1', $html);
        
        // Inyectamos el producto COMPLETO para hidratacion inmediata en JS sin esperas de red
        $preloadedData = json_encode($fullProduct, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $safe_preloadedData = str_replace('$', '\\$', $preloadedData);
        $html = str_replace('</head>', "\n<script>window.__PRELOADED_PRODUCT__ = $safe_preloadedData;</script>\n</head>", $html);
        
        // Guardamos en cache del servidor para visitas subsecuentes
        @file_put_contents($cache_file, $html);
    }
}

echo $html;
?>