# ==========================================
# Stage 1: Build client (needs devDeps)
# ==========================================
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY tsconfig.json bunfig.toml ./
COPY apps/ apps/
COPY packages/ packages/
RUN bun install --frozen-lockfile
RUN bun run build:client

# ==========================================
# Stage 2: Production dependencies only (no source code)
# ==========================================
FROM oven/bun:1.3 AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY tsconfig.json bunfig.toml ./
# Copy package.json for EACH workspace preserving directory structure.
# 不能写 COPY apps/*/package.json apps/ —— Docker 会把通配符匹配的文件
# 平铺到目标目录（apps/server/package.json → apps/package.json），
# 导致 bun 找不到 workspace 子包（@excuse/shared 等）的 package.json。
COPY apps apps/
COPY packages packages/
RUN bun install --frozen-lockfile && rm -rf node_modules && rm bun.lock && bun install --production

# ==========================================
# Stage 3: Server runtime
# ==========================================
FROM runtime-deps AS server
WORKDIR /app
ENV NODE_ENV=production
COPY apps/server/src/ apps/server/src/
COPY packages/ packages/
EXPOSE 5007
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "await fetch('http://127.0.0.1:5007/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "apps/server/src/index.ts"]

# ==========================================
# Stage 4: Worker runtime (needs ffmpeg)
# ==========================================
FROM runtime-deps AS worker-runtime
WORKDIR /app
# ffmpeg is required by subtitle/audio/video processing in the worker.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

FROM worker-runtime AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY apps/worker/src/ apps/worker/src/
COPY packages/ packages/
EXPOSE 5100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "await fetch('http://127.0.0.1:5100/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "apps/worker/src/index.ts"]

# ==========================================
# Stage 5: Client (Nginx static)
# ==========================================
FROM nginx:1.27-alpine AS client
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
EXPOSE 80
