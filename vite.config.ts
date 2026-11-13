import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        "**/.cache/**",
        "**/test-results/**",
        "**/reports/**",
        "**/release/**",
      ],
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1800 },
});
