import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 9245,
    strictPort: true,
  },
});
