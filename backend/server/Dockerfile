# Garage Management API image. Build from the repository root so the OpenAPI contract and SQL files are included:
#   docker build -f backend/server/Dockerfile -t garage-api .
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8000
WORKDIR /app
COPY docs/openapi.yaml docs/openapi.yaml
COPY backend/database backend/database
COPY backend/server/package.json backend/server/package-lock.json backend/server/
RUN cd backend/server && npm ci --omit=dev && npm cache clean --force
COPY backend/server/src backend/server/src
COPY backend/server/scripts backend/server/scripts
WORKDIR /app/backend/server
USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8000/health/ready || exit 1
# Install/upgrade tables (idempotent), optionally load demo data into an empty database, then serve.
CMD ["sh", "-c", "node scripts/db-init.js $([ \"$SEED_DEMO\" = true ] && echo --seed) && exec node src/server.js"]
