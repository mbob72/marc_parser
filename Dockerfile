# Сборка общего MARC-ядра и серверных команд.
# DOC-PREVIEW:/docs/documents-deployment.md#image-build
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
USER root
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ARG VCS_REF=unknown
ARG SOURCE_URL=unknown
ARG RELEASED_AT=unknown
LABEL org.opencontainers.image.revision=$VCS_REF org.opencontainers.image.source=$SOURCE_URL org.opencontainers.image.created=$RELEASED_AT
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
USER node

# Существующий сервис конвертации сохраняет своё назначение в compose.yaml.
FROM runtime AS service
EXPOSE 3000
CMD ["node", "dist/api.js"]

# Серверный образ: команды импорта и worker.
# DOC-PREVIEW:/docs/documents-deployment.md#entrypoint
FROM runtime AS documents
COPY --chmod=755 docker/documents-entrypoint.sh /usr/local/bin/marc-documents
ENTRYPOINT ["/usr/local/bin/marc-documents"]
CMD ["help"]

# Сборка без --target совместима с прежним сервисом API.
FROM service AS default
