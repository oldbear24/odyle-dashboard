# The static build is the same for every architecture, so it runs natively instead of under emulation.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
ARG VITE_POCKETBASE_URL
ENV VITE_POCKETBASE_URL=$VITE_POCKETBASE_URL
RUN npm run build

# The backend cross-compiles natively too: PocketBase's SQLite driver is pure Go.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS server
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/odyle .

FROM alpine:3.24
RUN apk add --no-cache ca-certificates \
 && addgroup -g 10001 odyle && adduser -D -u 10001 -G odyle odyle \
 && mkdir -p /pb/pb_data && chown -R odyle:odyle /pb
WORKDIR /pb
COPY --from=server /out/odyle /pb/odyle
COPY --from=web --chown=odyle:odyle /src/dist ./pb_public
USER odyle
EXPOSE 8090
# Docker and Compose report the container unhealthy when the backend stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:8090/api/health || exit 1
ENTRYPOINT ["/pb/odyle", "serve", "--http=0.0.0.0:8090"]
