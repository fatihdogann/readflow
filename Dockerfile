FROM node:22-bookworm-slim

# better-sqlite3 prebuilt binary bulamazsa derleme için araçlar
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm build

# Kalıcı veri (SQLite + yedekler) için Coolify volume buraya bağlanır
ENV READFLOW_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000

CMD ["pnpm", "start"]
