import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { ragPlugin } from "./server/rag";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ragPlugin(process.cwd(), {
      ...loadEnv(mode, process.cwd(), ["DASHSCOPE_", "RAG_"]),
      ...process.env,
    }),
  ],
  base: "./",
  server: {
    port: 5177,
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
}));
