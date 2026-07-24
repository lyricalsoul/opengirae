
FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY packages/database/package.json packages/database/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/tests/package.json packages/tests/package.json
COPY packages/answerer/package.json packages/answerer/package.json
COPY packages/commandeer/package.json packages/commandeer/package.json
COPY website/package.json website/package.json

RUN bun install

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "website/build/index.js"]
