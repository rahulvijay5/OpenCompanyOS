FROM node:22-bookworm-slim AS app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY litellm.config.yaml ./litellm.config.yaml

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @opencompanyos/config build \
  && pnpm --filter @opencompanyos/db build \
  && pnpm --filter @opencompanyos/github build \
  && pnpm --filter @opencompanyos/retrieval build \
  && pnpm --filter @opencompanyos/sync build \
  && pnpm --filter @opencompanyos/context build \
  && pnpm --filter @opencompanyos/api build \
  && pnpm --filter @opencompanyos/worker build

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @opencompanyos/web build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/api/dist/index.js"]
