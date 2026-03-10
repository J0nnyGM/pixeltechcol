<?php
header('Content-Type: text/html; charset=utf-8');

$product_id = isset($_GET['id']) ? trim($_GET['id']) : '';
$real_html_path = __DIR__ . '/shop/product.html'; 

if (empty($product_id) || !file_exists($real_html_path)) {
    http_response_code(404);
    echo "Página no encontrada.";
    exit;
}

// Consumimos directamente tu Cloud Function que ya tiene toda la lógica perfecta
$function_url = "https://renderproductmeta-muiondpggq-uc.a.run.app?id=" . urlencode($product_id);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $function_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_TIMEOUT, 3); 
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$html_firebase = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// Si Firebase respondió con el HTML y los Metas, lo imprimimos.
if ($http_code == 200 && !empty($html_firebase)) {
    echo $html_firebase;
    exit;
}

// Fallback de emergencia por si Firebase se cae: mostramos el HTML en blanco normal
echo file_get_contents($real_html_path);
?>