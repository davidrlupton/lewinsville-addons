ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM node:24-alpine AS build
WORKDIR /src
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache jq
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
COPY run.sh /run.sh
RUN chmod +x /run.sh
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
CMD ["/run.sh"]
