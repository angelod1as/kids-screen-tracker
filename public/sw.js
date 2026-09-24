// Installable, not offline (D46). No fetch listener, so every request,
// navigation and server action included, goes to the network untouched.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
