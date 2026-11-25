FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# ca-certificates нужен для OAuth GigaChat: проверку TLS не отключаем.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Только production-зависимости и только то, что нужно во время работы.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

# data/ и certs/ монтируются с хоста: см. docker-compose.yml.
RUN mkdir -p /app/data /app/certs \
 && useradd --uid 10001 --create-home --shell /usr/sbin/nologin chelotext \
 && chown -R chelotext:chelotext /app/data /app/certs

USER chelotext

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server/index.js"]
