import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Agent worktrees under .claude/ hold whole copies of the project; their tests are not ours to run.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // A full run at one worker per core exhausts memory on 8 GB machines.
    maxWorkers: 2,
    minWorkers: 1
  },
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
