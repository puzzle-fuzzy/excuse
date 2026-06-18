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
# Stage 2: Production dependencies (cache-friendly copy)
# ==========================================
FROM oven/bun:1.3 AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY tsconfig.json bunfig.toml ./

# 只复制 package.json 文件 → 源码不变时命中 Docker layer cache
# 通配符 COPY apps/*/package.json apps/ 在 Docker 中会把匹配的文件
# 平铺到 apps/ 目录下，导致 bun 找不到 workspace 子包目录。
# 此处显式列出所有 workspace 的 package.json。
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/provider/package.json packages/provider/
COPY packages/storage/package.json packages/storage/
COPY packages/ffmpeg/package.json packages/ffmpeg/
COPY packages/billing/package.json packages/billing/
COPY packages/canvas-engine/package.json packages/canvas-engine/
COPY packages/canvas-runtime/package.json packages/canvas-runtime/
COPY packages/prompt-engine/package.json packages/prompt-engine/
COPY packages/task-engine/package.json packages/task-engine/
COPY packages/workflow-engine/package.json packages/workflow-engine/
COPY packages/events/package.json packages/events/
COPY packages/gateway/package.json packages/gateway/
COPY packages/metrics/package.json packages/metrics/
COPY packages/rate-limit/package.json packages/rate-limit/
COPY packages/subtitle-engine/package.json packages/subtitle-engine/
COPY packages/auth/package.json packages/auth/
COPY packages/error-recovery/package.json packages/error-recovery/
COPY packages/provider-health/package.json packages/provider-health/

# 安装生产依赖（只 package.json 变更才重跑这一层）
RUN bun install --frozen-lockfile && rm -rf node_modules && rm bun.lock && bun install --production

# 复制源码（源码变更才会重跑，不会触发 bun install）
COPY apps apps/
COPY packages packages/

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
