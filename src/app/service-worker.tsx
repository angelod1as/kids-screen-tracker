"use client";

import { useEffect } from "react";

/** Chrome on Android offers installation only to a page a service worker controls (D46). */
export function ServiceWorker() {
  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js");
  }, []);

  return null;
}
