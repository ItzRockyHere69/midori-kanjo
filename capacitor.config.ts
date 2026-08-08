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
  },
};

export default config;
