# Luna's K9 Club: Node container (docs/deployment.md). Build locally with
#   docker build -t lunak9-club .            (runtime image)
#   docker build --target tools -t lunak9-club-tools .   (migrations, owner:create, jobs)
# No secrets are baked in: every setting is read from the environment at run time.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# `next build` prerenders a few pages, which parse the environment. These throwaway values exist only for
# this one command (not saved in the image); real settings are supplied when the container runs.
RUN APP_ENV=test DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-not-a-secret-0123456789 pnpm build

# One-off jobs: `pnpm db:migrate`, `pnpm owner:create`, `pnpm jobs:tick` (needs dev tools such as tsx).
FROM build AS tools
ENV NODE_ENV=production
USER node
CMD ["pnpm", "db:migrate"]

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/src/domain/documents/file-type.ts ./src/domain/documents/file-type.ts
COPY --from=build /app/drizzle ./drizzle
USER node
EXPOSE 3000
# Needs APP_ENV=production and the settings in docs/deployment.md, or it refuses to start.
CMD ["pnpm", "start"]
