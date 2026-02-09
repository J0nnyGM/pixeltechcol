const CACHE_NAME = 'pixeltech-shell-v1';

// Archivos vitales para que la app arranque sin internet
const urlsToCache = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/global-components.js',
  '/img/logo.png',
  '/img/icons/icon-192x192.png',
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

  // --- CORRECCIÓN IMPORTANTE ---
  // Lista negra de dominios que el Service Worker DEBE IGNORAR.
  // Esto arregla el error de CORS con ADDI y Split.io
  const ignoredDomains = [
    'firebasestorage', 
    'firestore', 
    'api-colombia', 
    'split.io',       // <--- Widget de ADDI (Streaming)
    'addi.com',       // <--- Widget de ADDI (Script)
    'amazonaws.com',  // <--- Origen del script de ADDI
    'google-analytics'
  ];

  // Si la URL contiene alguno de estos dominios, no hacemos nada (Red directa)
  if (ignoredDomains.some(domain => url.includes(domain))) {
    return; 
  }

  // Para todo lo demás (archivos locales), usamos estrategia Cache First con Network Fallback
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response; // Si está en caché, úsalo
      }
      
      // Si no, búscalo en la red
      return fetch(event.request).catch(() => {
        // Si falla la red y es una navegación (HTML), muestra offline
        if (event.request.mode === 'navigate') {
          return caches.match('/offline.html');
        }
      });
    })
  );
});