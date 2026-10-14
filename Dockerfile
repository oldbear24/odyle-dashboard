# The static build is the same for every architecture, so it runs natively instead of under emulation.
FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
ARG VITE_POCKETBASE_URL
ENV VITE_POCKETBASE_URL=$VITE_POCKETBASE_URL
RUN npm run build

FROM alpine:3.22
ARG POCKETBASE_VERSION=0.40.5
ARG TARGETARCH
RUN apk add --no-cache ca-certificates unzip wget \
 && mkdir /pb /downloads \
 && cd /downloads \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${TARGETARCH}.zip" \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/checksums.txt" \
 && grep "pocketbase_${POCKETBASE_VERSION}_linux_${TARGETARCH}.zip$" checksums.txt | sha256sum -c - \
 && unzip "pocketbase_${POCKETBASE_VERSION}_linux_${TARGETARCH}.zip" -d /pb \
 && rm -r /downloads \
 && addgroup -g 10001 odyle && adduser -D -u 10001 -G odyle odyle \
 && mkdir /pb/pb_data && chown -R odyle:odyle /pb
WORKDIR /pb
COPY --chown=odyle:odyle backend/pb_hooks ./pb_hooks
COPY --chown=odyle:odyle backend/pb_migrations ./pb_migrations
COPY --from=web --chown=odyle:odyle /src/dist ./pb_public
USER odyle
EXPOSE 8090
# Docker and Compose report the container unhealthy when PocketBase stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:8090/api/health || exit 1
ENTRYPOINT ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--automigrate=false"]
