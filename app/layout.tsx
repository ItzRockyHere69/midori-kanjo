import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Midori Kanjo",
  description: "Offline-first wholesale billing, party khata and festival-decor inventory for Burrabazar traders.",
  manifest: "/manifest.webmanifest",
  applicationName: "Midori Kanjo",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Midori Kanjo" },
  icons: { icon: [{ url: "/app-icon.svg", type: "image/svg+xml" }, { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/app-icon-180.png" },
  other: { "codex-preview": "development" }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#014921" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const themeScript = `(() => {
    try {
      const saved = localStorage.getItem("mantu-theme");
      const theme = saved === "dark" || saved === "light"
        ? saved
        : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (_) {}
  })();`;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
