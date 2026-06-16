FROM oven/bun:1.3 AS build
WORKDIR /app

# Install all dependencies in the build stage so client build has dev tooling.
COPY package.json bun.lock ./
COPY tsconfig.json bunfig.toml ./
COPY apps/ apps/
COPY packages/ packages/
RUN bun install --frozen-lockfile
RUN bun run build:client

FROM oven/bun:1.3 AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY tsconfig.json bunfig.toml ./
COPY apps/ apps/
COPY packages/ packages/
RUN bun install --frozen-lockfile --production

FROM runtime-deps AS server
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 5007
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "await fetch('http://127.0.0.1:5007/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "--env-file", ".env", "apps/server/src/index.ts"]

FROM runtime-deps AS worker-runtime
WORKDIR /app
# ffmpeg is required by subtitle/audio/video processing in the worker.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

FROM worker-runtime AS worker
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 5100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "await fetch('http://127.0.0.1:5100/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "--env-file", ".env", "apps/worker/src/index.ts"]

FROM nginx:1.27-alpine AS client
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
EXPOSE 80
