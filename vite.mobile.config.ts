import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // Only these two non-secret variables may enter a downloadable client
  // bundle, even if a broader VITE_* environment is present on the builder.
  envPrefix: ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"],
  root: fileURLToPath(new URL("./mobile", import.meta.url)),
  base: "./",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./mobile-dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2017",
    sourcemap: false,
  },
});
