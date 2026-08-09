import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mantu.billing",
  appName: "Midori Kanjo",
  webDir: "mobile-dist",
  backgroundColor: "#f9f9f9",
  android: {
    allowMixedContent: false,
    backgroundColor: "#f9f9f9",
    captureInput: true,
    // Core billing and dialog code uses browser APIs introduced through
    // Chromium 92. Capacitor shows its supported-WebView error instead of
    // starting a partially broken counter on an older system WebView.
    minWebViewVersion: 92,
  },
};

export default config;
