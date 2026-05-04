FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --production

FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
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
