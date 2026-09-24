import type { Metadata, Viewport } from "next";

import { SURFACE_BG_CLASS } from "../ui/style";
import { plexMono, plexSans } from "./fonts";
import "./globals.css";
import { ServiceWorker } from "./service-worker";

// D22: better-sqlite3 is native. A default, not a lock: a segment can still
// export `runtime = "edge"` and the build accepts it.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Quanto Tempo Vale?",
  description: "Saldo de tempo de tela ganho com atividades fora da tela.",
  icons: {
    icon: { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Quanto Tempo Vale?" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Or a dark-mode phone paints native controls grey on this white page.
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${plexSans.variable} ${plexMono.variable}`} lang="pt-BR">
      <body className={`${SURFACE_BG_CLASS} min-h-dvh text-black antialiased`}>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
