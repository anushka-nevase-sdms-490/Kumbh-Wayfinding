import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browsers hand motion sensors and the camera only to a secure context, so a
// phone on http://<lan-ip>:5173 gets neither. start.sh drops a self-signed
// cert here; when it exists we serve https and those APIs come alive.
const keyPath = fileURLToPath(new URL('./.certs/dev-key.pem', import.meta.url))
const certPath = fileURLToPath(new URL('./.certs/dev-cert.pem', import.meta.url))
const hasCert = fs.existsSync(keyPath) && fs.existsSync(certPath)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: hasCert
    ? { https: { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } }
    : {},
})
