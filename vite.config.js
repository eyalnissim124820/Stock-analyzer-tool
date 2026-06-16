import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// During local dev, proxy /api to `vercel dev` (port 3000) so the
// serverless function runs the same way it will in production.
//
// Multi-page build: the English app (index.html) and the fully separate
// Hebrew app (hebrew.html) are independent entry points that share only the
// /api backend. Each ships its own bundle.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        hebrew: resolve(__dirname, "hebrew.html"),
      },
    },
  },
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
