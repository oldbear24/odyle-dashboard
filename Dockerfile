# The static build is the same for every architecture, so it runs natively instead of under emulation.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src
COPY package*.json ./
RUN npm ci
# What's new bundles the changelog (src/main.js imports CHANGELOG.md).
COPY index.html vite.config.js CHANGELOG.md ./
# The privacy notice is a page of the dashboard (src/privacy.js).
COPY docs/privacy.md ./docs/privacy.md
COPY src ./src
COPY public ./public
ARG VITE_POCKETBASE_URL
ENV VITE_POCKETBASE_URL=$VITE_POCKETBASE_URL
RUN npm run build

# The backend cross-compiles natively too: PocketBase's SQLite driver is pure Go.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS server
ARG TARGETOS
ARG TARGETARCH
# The release names the build (the Server status page shows it); a local build reads "dev".
ARG VERSION=""
ARG COMMIT=""
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
# The dashboard is compiled in (backend/web).
COPY --from=web /src/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w -X github.com/oldbear24/odyle-dashboard/backend/odyle.Version=$VERSION -X github.com/oldbear24/odyle-dashboard/backend/odyle.Commit=$COMMIT" -o /out/odyle . \
 && mkdir -p /out/pb/pb_data

# Distroless: the static server, CA certificates and time zones; no shell or package
# manager. It runs as user 10001, the user of the earlier Alpine image, so data volumes
# created by it stay writable; a new volume takes the ownership of /pb/pb_data from here.
FROM gcr.io/distroless/static-debian13
COPY --from=server --chown=10001:10001 /out/pb /pb
COPY --from=server /out/odyle /pb/odyle
USER 10001:10001
WORKDIR /pb
EXPOSE 8090
# Docker and Compose report the container unhealthy when the backend stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["/pb/odyle", "healthcheck"]
ENTRYPOINT ["/pb/odyle", "serve", "--http=0.0.0.0:8090"]
