<?php
header('Content-Type: text/html; charset=utf-8');

// 1. Obtener el ID del producto
$product_id = isset($_GET['id']) ? $_GET['id'] : '';

// 2. Lista de User-Agents que consideramos Bots (Redes Sociales + Buscadores)
$user_agent = strtolower($_SERVER['HTTP_USER_AGENT']);
$is_bot = preg_match('/(whatsapp|facebookexternalhit|twitterbot|pinterest|linkedinbot|telegrambot|viber|skypeuri|slackbot|googlebot|bingbot|yandexbot|duckduckbot|slurp|baiduspider|ia_archiver)/i', $user_agent);

if ($is_bot && !empty($product_id)) {
    // 🔴 SI ES UN BOT (O GOOGLE): Le mostramos la versión pre-renderizada de Firebase
    $function_url = "https://renderproductmeta-muiondpggq-uc.a.run.app?id=" . urlencode($product_id);
    $html = @file_get_contents($function_url);

    if ($html !== FALSE) {
        echo $html;
        exit;
    }
}

// 🟢 SI ES UN HUMANO (O si falló Firebase): Le servimos tu HTML estático normal
// Buscamos el archivo product.html físico en tu servidor
$real_html_path = __DIR__ . '/shop/product.html'; 

if (file_exists($real_html_path)) {
    echo file_get_contents($real_html_path);
} else {
    http_response_code(404);
    echo "Página de producto no encontrada.";
}
exit;
?>