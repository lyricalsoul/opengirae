FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY packages/answerer/package.json packages/answerer/package.json
COPY packages/commandeer/package.json packages/commandeer/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/discord-inbounder/package.json packages/discord-inbounder/package.json
COPY packages/telegram-inbound/package.json packages/telegram-inbound/package.json
RUN bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

CMD ["bun", "packages/commandeer/index.ts"]
