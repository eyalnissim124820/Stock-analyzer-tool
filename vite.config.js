import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local dev, proxy /api to `vercel dev` (port 3000) so the
// serverless function runs the same way it will in production.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
