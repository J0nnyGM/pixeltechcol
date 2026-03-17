const CACHE_NAME = 'pixeltech-shell-v8.4'; // 🔥 Subimos la versión

// Archivos vitales para que la app arranque sin internet
const urlsToCache = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/global-components.js',
  '/img/logo.webp',
  '/img/icons/icon-192x192.webp',
  '/offline.html'
];

self.addEventListener('install', (event) => {
  // ❌ AQUÍ ESTABA EL ERROR: Eliminamos self.skipWaiting()
  // Ahora el nuevo Service Worker se instalará, pero se quedará en estado "waiting"
  // hasta que el usuario presione el botón.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Borrando caché antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Toma control de la página inmediatamente (una vez activado)
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Ignorar extensiones de Chrome y protocolos raros
  if (!url.startsWith('http')) {
    return;
  }

  // Lista negra de dominios que el Service Worker DEBE IGNORAR.
  const ignoredDomains = [
    'firebasestorage', 
    'firestore', 
    'api-colombia', 
    'split.io',       
    'addi.com',       
    'amazonaws.com',  
    'google-analytics'
  ];

  if (ignoredDomains.some(domain => url.includes(domain))) {
    return; 
  }

  // 1. ESTRATEGIA: Network First (Red Primero) para Navegación (HTML)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseToCache = networkResponse.clone();
          
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cacheResponse) => {
            return cacheResponse || caches.match('/offline.html');
          });
        })
    );
    return;
  }

  // 2. ESTRATEGIA: Stale-While-Revalidate para Assets (CSS, JS, Imágenes)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Ignoramos errores de red en assets secundarios
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// --- ESCUCHAR LA ORDEN DE ACTUALIZACIÓN MANUAL ---
self.addEventListener('message', (event) => {
  // 🔥 AQUÍ SÍ SE EJECUTA: Solo cuando el admin-ui.js manda el mensaje al hacer clic en el botón
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});