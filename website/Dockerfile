
FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY packages/database/package.json packages/database/package.json
COPY website/package.json website/package.json

RUN bun install

FROM deps AS build
COPY packages/database packages/database
COPY website website
RUN bun run --cwd website build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules

COPY --from=build /app/website/node_modules website/node_modules
COPY --from=build /app/packages/database packages/database
COPY --from=build /app/website/build website/build
COPY website/package.json website/package.json

EXPOSE 3000
CMD ["bun", "website/build/index.js"]
