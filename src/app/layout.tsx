import type { Metadata, Viewport } from "next";

import { SURFACE_BG_CLASS } from "../ui/style";
import { plexMono, plexSans } from "./fonts";
import "./globals.css";
import { ServiceWorker } from "./service-worker";

// D22: better-sqlite3 is a native module, so the app must run on Node.
// This sets the default runtime that every segment below inherits — pages,
// layouts and route handlers alike. It is a default, not a lock: a child can
// still override it with `export const runtime = "edge"` and the build will
// accept it. The enforceable guard belongs in CI (#4).
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
  // Native controls (password inputs, selects, date pickers, scrollbars,
  // Chrome autofill) follow the OS palette unless told otherwise. The page is
  // black on white, so a dark-mode phone would paint them grey on white.
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
