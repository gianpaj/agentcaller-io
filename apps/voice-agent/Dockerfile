FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @agentcaller/voice-agent build

FROM node:22-slim
WORKDIR /app
# Copy only what the agent runs. Taking the whole build stage would carry the build context —
# including any local .env and the git history — into a published layer.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/voice-agent/package.json ./apps/voice-agent/package.json
COPY --from=build /app/apps/voice-agent/dist ./apps/voice-agent/dist
COPY --from=build /app/apps/voice-agent/node_modules ./apps/voice-agent/node_modules
USER node
CMD ["node", "apps/voice-agent/dist/main.js", "start"]
