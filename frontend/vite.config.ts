import fs from "fs";
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phone GPS needs trusted HTTPS. start.sh sets SETU_HTTP=0 when using TLS.
const useHttp = process.env.SETU_HTTP === "1";
const keyPath = path.resolve(".certs/dev-key.pem");
const certPath = path.resolve(".certs/dev-cert.pem");
const hasCert = !useHttp && fs.existsSync(keyPath) && fs.existsSync(certPath);

// Proxy API through Vite so one public HTTPS URL (ngrok) reaches the backend too.
const backend = hasCert ? "https://127.0.0.1:8000" : "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true,
        secure: false,
      },
      "/health": {
        target: backend,
        changeOrigin: true,
        secure: false,
      },
    },
    ...(hasCert
      ? {
          https: {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
          },
        }
      : {}),
  },
});
