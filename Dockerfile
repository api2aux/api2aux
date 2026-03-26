FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc* ./
COPY packages/app/package.json packages/app/
COPY packages/mcp-worker/package.json packages/mcp-worker/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/semantic-analysis/package.json packages/semantic-analysis/
COPY packages/tool-definition-builder/package.json packages/tool-definition-builder/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm -r build

# Production image
FROM node:20-slim AS production

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=base /app/packages/mcp-worker/package.json packages/mcp-worker/
COPY --from=base /app/packages/tool-definition-builder/package.json packages/tool-definition-builder/
RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/packages/mcp-worker/dist packages/mcp-worker/dist/
COPY --from=base /app/packages/app/dist packages/app/dist/
COPY --from=base /app/packages/tool-definition-builder/dist packages/tool-definition-builder/dist/

EXPOSE 8787
CMD ["node", "packages/mcp-worker/dist/node.js"]
