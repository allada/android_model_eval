FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System dependencies (including adb from android-tools — works on both x86_64 and arm64)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates unzip \
    scrcpy ffmpeg \
    android-tools-adb \
    && rm -rf /var/lib/apt/lists/*

# Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Project dependencies (cached layer)
WORKDIR /app
COPY package.json bun.lock ./
COPY adb-mcp-bridge/package.json adb-mcp-bridge/bun.lock ./adb-mcp-bridge/
RUN bun install && cd adb-mcp-bridge && bun install

# Project source
COPY . .
RUN chmod +x scripts/*.sh

ENV CODEX_BIN=/app/node_modules/.bin/codex
ENV CLAUDE_BIN=/app/node_modules/.bin/claude
ENV PORT=3000
ENV ADMIN_PORT=3001
