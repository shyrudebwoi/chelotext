FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# ca-certificates нужен для OAuth GigaChat (проверка TLS не отключается).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Данные и сертификат монтируются с хоста: см. docker-compose.yml.
RUN mkdir -p /app/data /app/certs \
 && useradd --uid 10001 --create-home --shell /usr/sbin/nologin chelotext \
 && chown -R chelotext:chelotext /app/data /app/certs

USER chelotext

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server/index.js"]
