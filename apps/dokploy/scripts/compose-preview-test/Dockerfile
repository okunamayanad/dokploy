FROM docker:28-cli AS docker-cli
FROM node:24.22.1-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git curl openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.22.0
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
WORKDIR /workspace/apps/dokploy
ENV NODE_ENV=development
EXPOSE 3000
