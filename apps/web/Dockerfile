# Imagem da interface (Next.js em modo standalone).
# Construída a partir da raiz do repositório: docker build -f apps/web/Dockerfile .
# O endereço interno da api (API_INTERNA, padrão http://api:3001) entra na hora do build.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY packages/domain packages/domain
COPY apps/web apps/web
COPY ponte-mt5 ponte-mt5
RUN npm install -w @wta/web --include-workspace-root --no-audit --no-fund
ARG API_INTERNA=http://api:3001
ENV API_INTERNA=$API_INTERNA NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @wta/web

FROM node:22-alpine
LABEL org.opencontainers.image.source=https://github.com/gilsonalvesgwta/OpcoesFinanceiras
LABEL org.opencontainers.image.description="WTA Options Intelligence: interface"
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 TZ=America/Sao_Paulo
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
