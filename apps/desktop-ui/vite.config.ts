import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.endsWith("/catalog/providers.json")) return "providers";
          if (id.includes("/catalog/")) return "extensions";
        },
      },
    },
  },
  server: { host: "0.0.0.0", allowedHosts: [".e2b.app"] },
});
