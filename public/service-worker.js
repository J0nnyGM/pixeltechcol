// 🔥 IMPORTANTE: Sube este número cada vez que hagas un cambio grande en tu código (ej: v7.5)
const CACHE_NAME = 'pixeltech-shell-v7.5';

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
  self.skipWaiting(); // Fuerza al SW a activarse de inmediato
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
  self.clients.claim(); // Toma control de la página inmediatamente
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

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
  // Siempre busca la página más reciente. Si no hay internet, usa el caché o offline.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Si hay internet, guardamos la página más nueva en el caché silenciosamente
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          // Si no hay internet (falla el fetch), buscamos en el caché
          return caches.match(event.request).then((cacheResponse) => {
            return cacheResponse || caches.match('/offline.html');
          });
        })
    );
    return; // Detenemos aquí para que no siga con el código de abajo
  }

  // 2. ESTRATEGIA: Stale-While-Revalidate para Assets (CSS, JS, Imágenes)
  // Devuelve el caché rápido, pero actualiza en segundo plano.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Solo guardamos en caché respuestas válidas
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => {
        // Ignoramos errores de red en assets secundarios
      });

      // Retorna el caché inmediatamente si existe. Mientras tanto, fetchPromise se ejecuta atrás.
      // Si no existe en caché, espera a fetchPromise.
      return cachedResponse || fetchPromise;
    })
  );
});