// Service Worker — Pradomotica
// Gestiona las notificaciones push entrantes y los clics sobre ellas.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Pradomotica', body: event.data.text() };
  }

  const title = payload.title ?? 'Pradomotica';
  const options = {
    body: payload.body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url ?? '/dashboard' },
    vibrate: [200, 100, 200],
    // Los avisos del mismo aparato se reemplazan en lugar de apilarse, pero
    // siguen sonando: de ahí renotify junto con tag.
    tag: payload.tag,
    renotify: !!payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/dashboard';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Si ya hay una pestaña abierta, enfocarla y navegar.
        for (const client of windowClients) {
          if ('focus' in client) {
            client.focus();
            client.navigate(url);
            return;
          }
        }
        // Si no, abrir nueva pestaña.
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      }),
  );
});
