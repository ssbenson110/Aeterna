# AETERNA. One process, no dependencies, no build step.
# Persistent state (SQLite database, uploads, email outbox) lives in /data,
# so mount a volume there.
FROM node:22-alpine

WORKDIR /app
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY README.md DEPLOYMENT.md ./

ENV NODE_ENV=production \
    PORT=8080 \
    AETERNA_DATA_DIR=/data

RUN addgroup -S aeterna && adduser -S aeterna -G aeterna \
    && mkdir -p /data && chown -R aeterna:aeterna /data /app

USER aeterna
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
