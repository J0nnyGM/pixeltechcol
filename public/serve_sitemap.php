<?php
// Le decimos al navegador/Google que esto es un archivo XML válido
header('Content-Type: text/xml; charset=utf-8');

// 🔴 REEMPLAZA ESTA URL POR LA URL REAL DE TU CLOUD FUNCTION
$function_url = "https://sitemap-muiondpggq-uc.a.run.app";

// Obtenemos el XML de Firebase y lo imprimimos
$xml = file_get_contents($function_url);

if ($xml === FALSE) {
    http_response_code(500);
    echo '<?xml version="1.0" encoding="UTF-8"?><error>Error de conexión con Firebase</error>';
} else {
    echo $xml;
}
?>