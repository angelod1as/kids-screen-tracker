import type { MetadataRoute } from "next";

import { ACCENT_HEX, SURFACE_HEX } from "../ui/style";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quanto Tempo Vale?",
    short_name: "Quanto Tempo Vale?",
    lang: "pt-BR",
    start_url: "/",
    display: "standalone",
    theme_color: ACCENT_HEX,
    background_color: SURFACE_HEX,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
