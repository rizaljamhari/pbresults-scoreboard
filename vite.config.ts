import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.APP_CLIENT_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${Number(process.env.APP_SERVER_PORT ?? 3000)}`,
      "/uploads": `http://localhost:${Number(process.env.APP_SERVER_PORT ?? 3000)}`
    }
  },
  build: {
    outDir: "dist/client"
  }
});
