<?php
// Le decimos al bot que esto es HTML válido
header('Content-Type: text/html; charset=utf-8');

// 1. Obtener el ID del producto que el bot está intentando leer
$product_id = isset($_GET['id']) ? $_GET['id'] : '';

if (empty($product_id)) {
    http_response_code(400);
    echo '<!DOCTYPE html><html><head><title>Producto no encontrado | PixelTech</title></head><body></body></html>';
    exit;
}

// 2. 🟢 URL ACTUALIZADA DE TU CLOUD FUNCTION 
$function_url = "https://renderproductmeta-muiondpggq-uc.a.run.app?id=" . urlencode($product_id);

// 3. Obtenemos el HTML renderizado desde Firebase
$html = @file_get_contents($function_url);

if ($html === FALSE) {
    // Si Firebase falla o tarda, le damos un salvavidas al bot para que no salga error
    http_response_code(500);
    echo '<!DOCTYPE html><html><head><title>PixelTech Colombia</title><meta name="description" content="Innovación al alcance de tu mano."></head><body>Redirigiendo...</body></html>';
} else {
    // 4. Imprimimos las etiquetas meta para WhatsApp/Facebook
    echo $html;
}
?>