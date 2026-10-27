# syntax=docker/dockerfile:1
# Base images pinned by digest, updated by Dependabot
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git unzip \
 && rm -rf /var/lib/apt/lists/*

# Official binaries: checksums verified, and signatures checked by cosign when published.
# Versions live in scripts/tools.env
COPY scripts/tools.env scripts/install-tool.sh /tmp/tools/
RUN /tmp/tools/install-tool.sh /usr/local/bin nuclei trivy syft grype

COPY --from=ghcr.io/astral-sh/uv:0.13.0@sha256:cdc6093146eb3ff6a40107b38f008b789e050e77ad87865e381d9917da55a168 /uv /usr/local/bin/uv
ENV UV_TOOL_DIR=/opt/uv/tools UV_TOOL_BIN_DIR=/usr/local/bin UV_PYTHON_INSTALL_DIR=/opt/uv/python
# Python 3.12: ruamel-yaml-clib ships a wheel there, no compiler needed
RUN . /tmp/tools/tools.env \
 && uv tool install --python 3.12 "semgrep==${SEMGREP_VERSION}" && semgrep --version \
 && rm -rf /tmp/tools

WORKDIR /app
COPY --from=build /app/.output ./.output

LABEL org.opencontainers.image.title="security-scanner" \
      org.opencontainers.image.description="Self-hosted security audits: Trivy, Grype, Syft, Semgrep, Nuclei, local LLM report" \
      org.opencontainers.image.source="https://github.com/Keil-ENZO/security-scanner"

# Database, caches and Nuclei templates live in the /data volume.
# Listens on 127.0.0.1 by default: set NITRO_HOST=0.0.0.0 behind a port mapping
ENV NODE_ENV=production NUXT_DATA_DIR=/data HOME=/data/home NITRO_HOST=127.0.0.1 NITRO_PORT=3003
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.NITRO_PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["sh", "-c", "mkdir -p \"$HOME\" && exec node .output/server/index.mjs"]
