FROM node:18-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
RUN pnpm -r run build

FROM node:18-alpine
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY --from=builder /app/ ./
EXPOSE 3001
CMD ["node", "packages/api/dist/index.js"]
