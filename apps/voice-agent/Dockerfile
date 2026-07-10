FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @agentcaller/voice-agent build
FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@agentcaller/voice-agent", "start"]
