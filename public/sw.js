// Installable, not offline (D46). No fetch listener, so every request,
// navigation and server action included, goes to the network untouched.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

// D51. iOS revokes a subscription whose push shows nothing, so every push shows.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {}

  event.waitUntil(
    self.registration.showNotification(message.title || "Quanto Tempo Vale?", {
      body: message.body || "",
      icon: "/icon-192.png",
      data: { url: message.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = new URL(event.notification.data?.url || "/", self.location.origin)
    .href;

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((windows) => {
      const open = windows[0];

      if (open === undefined) {
        return self.clients.openWindow(url);
      }

      return open.focus().then((focused) => focused.navigate(url));
    }),
  );
});
