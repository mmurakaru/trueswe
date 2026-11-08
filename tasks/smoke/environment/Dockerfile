FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY add.mjs AGENTS.md /app/
