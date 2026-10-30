# Build the PWA (needs public/map from `npm run map:fetch` in the build context).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve it with Caddy (HTTPS, headers: deploy/Caddyfile is mounted at run time).
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
