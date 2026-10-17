# Imagem da api. A mesma imagem roda a api, o worker de coleta, as migrações e as cópias:
#   api        node src/servidor.ts   (padrão)
#   worker     node src/worker.ts
#   migracoes  /app/db/aplicar.sh
#   copias     /app/infra/copias/agendar.sh
# Construída a partir da raiz do repositório: docker build -f apps/api/Dockerfile .
FROM node:22-alpine
LABEL org.opencontainers.image.source=https://github.com/gilsonalvesgwta/OpcoesFinanceiras
LABEL org.opencontainers.image.description="WTA Options Intelligence: api, coleta, migrações e cópias"
RUN apk add --no-cache bash postgresql17-client tzdata
WORKDIR /app
COPY package.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN npm install --omit=dev -w @wta/api --no-audit --no-fund && npm cache clean --force
COPY packages/domain packages/domain
COPY apps/api apps/api
COPY db db
COPY infra/copias infra/copias
RUN chmod +x db/aplicar.sh infra/copias/*.sh && mkdir -p /copias && chown node:node /copias
ENV NODE_ENV=production TZ=America/Sao_Paulo
USER node
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "src/servidor.ts"]
