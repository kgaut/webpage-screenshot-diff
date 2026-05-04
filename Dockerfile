FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build:server

# Build the SPA in a separate step so changes to src/ don't invalidate the
# (heavier) web/node_modules layer.
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web ./
RUN npm run build

WORKDIR /app
RUN npm prune --production

FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    HISTORY_SIZE=10
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "dist/server.js"]
