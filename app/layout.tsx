import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_CACHE } from "../lib/theme";

export const metadata: Metadata = {
  title: "Midori Kanjo",
  description: "Offline-first wholesale billing, party khata and festival-decor inventory for Burrabazar traders.",
  manifest: "/manifest.webmanifest",
  applicationName: "Midori Kanjo",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Midori Kanjo" },
  icons: { icon: [{ url: "/app-icon.svg", type: "image/svg+xml" }, { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/app-icon-180.png" },
  other: { "codex-preview": "development" }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#014921" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const appearanceScript = `(() => {
    try {
      const saved = localStorage.getItem(${JSON.stringify(THEME_CACHE)});
      const theme = saved === "dark" || saved === "light"
        ? saved
        : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (_) {}
    try {
      const scale = localStorage.getItem("midori-interface-scale-v1");
      document.documentElement.dataset.interfaceScale =
        scale === "110" || scale === "120" || scale === "130" ? scale : "100";
    } catch (_) {
      document.documentElement.dataset.interfaceScale = "100";
    }
  })();`;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
