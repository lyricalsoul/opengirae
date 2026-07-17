
FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY packages/database/package.json packages/database/package.json
COPY packages/common/package.json packages/common/package.json
COPY website/package.json website/package.json

# TODO: this needs to go once i find out why a random dep is failing
RUN bun install || bun install

FROM deps AS build
COPY packages/database packages/database
COPY packages/common packages/common
COPY website website
RUN bun run --cwd website build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules

COPY --from=build /app/website/node_modules website/node_modules
COPY --from=build /app/packages/database packages/database
COPY --from=build /app/packages/common packages/common
COPY --from=build /app/website/build website/build
COPY website/package.json website/package.json

EXPOSE 3000
CMD ["bun", "website/build/index.js"]
