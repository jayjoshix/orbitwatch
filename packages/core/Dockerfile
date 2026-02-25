FROM node:18-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/core/ packages/core/
RUN pnpm -r run build

FROM node:18-alpine
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY --from=builder /app/ ./
CMD ["node", "packages/core/dist/index.js"]
