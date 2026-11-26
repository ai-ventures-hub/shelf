/**
 * The phone app's service worker, kept as text so the Companion server can
 * serve it at /sw.js (root scope) without a build step or a file read. It
 * does one job: show the alerts Shelf pushes and open the app when one is
 * tapped. It caches nothing; the app always loads from the Mac.
 */
export const COMPANION_SERVICE_WORKER = `// Shelf Companion service worker
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (err) { data = {} }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Shelf'
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    icon: '/apple-touch-icon.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) client.navigate(url).catch(() => {})
        return client.focus()
      }
    }
    return self.clients.openWindow(url)
  }))
})
`
