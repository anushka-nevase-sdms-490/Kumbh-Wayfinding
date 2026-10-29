// vite.config.ts
import fs from "fs";
import path from "path";
import { defineConfig } from "file:///home/stark/Kumbh-Wayfinding/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///home/stark/Kumbh-Wayfinding/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
var useHttp = process.env.SETU_HTTP === "1";
var keyPath = path.resolve(".certs/dev-key.pem");
var certPath = path.resolve(".certs/dev-cert.pem");
var hasCert = !useHttp && fs.existsSync(keyPath) && fs.existsSync(certPath);
var backend = hasCert ? "https://127.0.0.1:8000" : "http://127.0.0.1:8000";
var vite_config_default = defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true,
        secure: false
      },
      "/health": {
        target: backend,
        changeOrigin: true,
        secure: false
      }
    },
    ...hasCert ? {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      }
    } : {}
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9zdGFyay9LdW1iaC1XYXlmaW5kaW5nL2Zyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9zdGFyay9LdW1iaC1XYXlmaW5kaW5nL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3N0YXJrL0t1bWJoLVdheWZpbmRpbmcvZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgZnMgZnJvbSBcImZzXCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcblxuLy8gUGhvbmUgR1BTIG5lZWRzIHRydXN0ZWQgSFRUUFMuIHN0YXJ0LnNoIHNldHMgU0VUVV9IVFRQPTAgd2hlbiB1c2luZyBUTFMuXG5jb25zdCB1c2VIdHRwID0gcHJvY2Vzcy5lbnYuU0VUVV9IVFRQID09PSBcIjFcIjtcbmNvbnN0IGtleVBhdGggPSBwYXRoLnJlc29sdmUoXCIuY2VydHMvZGV2LWtleS5wZW1cIik7XG5jb25zdCBjZXJ0UGF0aCA9IHBhdGgucmVzb2x2ZShcIi5jZXJ0cy9kZXYtY2VydC5wZW1cIik7XG5jb25zdCBoYXNDZXJ0ID0gIXVzZUh0dHAgJiYgZnMuZXhpc3RzU3luYyhrZXlQYXRoKSAmJiBmcy5leGlzdHNTeW5jKGNlcnRQYXRoKTtcblxuLy8gUHJveHkgQVBJIHRocm91Z2ggVml0ZSBzbyBvbmUgcHVibGljIEhUVFBTIFVSTCAobmdyb2spIHJlYWNoZXMgdGhlIGJhY2tlbmQgdG9vLlxuY29uc3QgYmFja2VuZCA9IGhhc0NlcnQgPyBcImh0dHBzOi8vMTI3LjAuMC4xOjgwMDBcIiA6IFwiaHR0cDovLzEyNy4wLjAuMTo4MDAwXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogdHJ1ZSxcbiAgICBwb3J0OiA1MTczLFxuICAgIHN0cmljdFBvcnQ6IHRydWUsXG4gICAgcHJveHk6IHtcbiAgICAgIFwiL2FwaVwiOiB7XG4gICAgICAgIHRhcmdldDogYmFja2VuZCxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICBzZWN1cmU6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIFwiL2hlYWx0aFwiOiB7XG4gICAgICAgIHRhcmdldDogYmFja2VuZCxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICBzZWN1cmU6IGZhbHNlLFxuICAgICAgfSxcbiAgICB9LFxuICAgIC4uLihoYXNDZXJ0XG4gICAgICA/IHtcbiAgICAgICAgICBodHRwczoge1xuICAgICAgICAgICAga2V5OiBmcy5yZWFkRmlsZVN5bmMoa2V5UGF0aCksXG4gICAgICAgICAgICBjZXJ0OiBmcy5yZWFkRmlsZVN5bmMoY2VydFBhdGgpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH1cbiAgICAgIDoge30pLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWlTLE9BQU8sUUFBUTtBQUNoVCxPQUFPLFVBQVU7QUFDakIsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxXQUFXO0FBR2xCLElBQU0sVUFBVSxRQUFRLElBQUksY0FBYztBQUMxQyxJQUFNLFVBQVUsS0FBSyxRQUFRLG9CQUFvQjtBQUNqRCxJQUFNLFdBQVcsS0FBSyxRQUFRLHFCQUFxQjtBQUNuRCxJQUFNLFVBQVUsQ0FBQyxXQUFXLEdBQUcsV0FBVyxPQUFPLEtBQUssR0FBRyxXQUFXLFFBQVE7QUFHNUUsSUFBTSxVQUFVLFVBQVUsMkJBQTJCO0FBRXJELElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsUUFDTixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsUUFDZCxRQUFRO0FBQUEsTUFDVjtBQUFBLE1BQ0EsV0FBVztBQUFBLFFBQ1QsUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLFFBQ2QsUUFBUTtBQUFBLE1BQ1Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxHQUFJLFVBQ0E7QUFBQSxNQUNFLE9BQU87QUFBQSxRQUNMLEtBQUssR0FBRyxhQUFhLE9BQU87QUFBQSxRQUM1QixNQUFNLEdBQUcsYUFBYSxRQUFRO0FBQUEsTUFDaEM7QUFBQSxJQUNGLElBQ0EsQ0FBQztBQUFBLEVBQ1A7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
