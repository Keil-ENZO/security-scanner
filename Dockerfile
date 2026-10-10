# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim
ARG NUCLEI_VERSION=3.11.1
ARG TRIVY_VERSION=0.75.0
ARG SEMGREP_VERSION=1.180.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git unzip \
 && rm -rf /var/lib/apt/lists/*

# Binaires officiels, checksums vérifiés
WORKDIR /tmp/tools
RUN set -eux; \
    base=https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}; \
    curl -fsSLO "$base/nuclei_${NUCLEI_VERSION}_linux_amd64.zip"; \
    curl -fsSLO "$base/nuclei_${NUCLEI_VERSION}_checksums.txt"; \
    sha256sum --ignore-missing -c "nuclei_${NUCLEI_VERSION}_checksums.txt"; \
    unzip -q "nuclei_${NUCLEI_VERSION}_linux_amd64.zip" nuclei -d /usr/local/bin; \
    base=https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}; \
    curl -fsSLO "$base/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"; \
    curl -fsSLO "$base/trivy_${TRIVY_VERSION}_checksums.txt"; \
    sha256sum --ignore-missing -c "trivy_${TRIVY_VERSION}_checksums.txt"; \
    tar xzf "trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" -C /usr/local/bin trivy; \
    rm -rf /tmp/tools

COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv
ENV UV_TOOL_DIR=/opt/uv/tools UV_TOOL_BIN_DIR=/usr/local/bin UV_PYTHON_INSTALL_DIR=/opt/uv/python
RUN uv tool install "semgrep==${SEMGREP_VERSION}" && semgrep --version

WORKDIR /app
COPY --from=build /app/.output ./.output

# Base, caches et templates Nuclei dans le volume /data
ENV NODE_ENV=production NUXT_DATA_DIR=/data HOME=/data/home NITRO_HOST=127.0.0.1 NITRO_PORT=3003
USER node
CMD ["sh", "-c", "mkdir -p \"$HOME\" && exec node .output/server/index.mjs"]
