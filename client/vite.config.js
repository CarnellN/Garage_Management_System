import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api/v1/... is forwarded to the backend, so there are no CORS errors.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } } },
});
