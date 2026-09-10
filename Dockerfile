# Imagem única do dashboard (Next.js 15, App Router).
#
# Diferente do integradoras-dashboard, aqui NÃO existem duas aplicações (Express
# + bundle Vite): o Next serve as páginas e as rotas de API no mesmo processo e
# na mesma porta. Por isso não há estágio separado para o front.
#
# A saída é `output: 'standalone'` (ver next.config.ts): o Next resolve a árvore
# de dependências e emite só o que o código realmente alcança. Medido em
# 10/09/2026: node_modules completo 463 MB → standalone 64 MB.

# ---------- 1) dependências ----------
FROM node:20-alpine AS deps
WORKDIR /app

# `npm ci` exige o lockfile e instala exatamente o que está nele.
# Aqui vão TODAS as dependências, inclusive as de desenvolvimento: o `next
# build` precisa do TypeScript e do Tailwind, que são devDependencies.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 2) build ----------
FROM node:20-alpine AS build
WORKDIR /app

# TZ TAMBÉM NO BUILD: o Next pré-renderiza páginas nesta etapa, e qualquer data
# calculada durante a pré-renderização congela no fuso do build. Sem isto, uma
# imagem construída em UTC nasce com datas 3 h deslocadas nas partes estáticas.
ENV TZ=America/Sao_Paulo
RUN apk add --no-cache tzdata

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# O build não acessa banco nenhum: todas as rotas de dados são
# `dynamic = 'force-dynamic'`, então nada é consultado em tempo de build.
# Por isso a imagem se constrói sem VPN e sem credencial de banco.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- 3) imagem final ----------
FROM node:20-alpine

# TZ importa para o dado, não para o log. Este projeto já devolve as datas do
# Postgres como STRING crua para não sofrer conversão de fuso (ver
# src/server/db/tipos.ts), mas os PRESETS de período ("Hoje", "Mês corrente")
# são calculados em JavaScript a partir do relógio do processo. Rodando em UTC,
# entre 21h e meia-noite o "Hoje" do dashboard viraria o dia seguinte.
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PORT=8092 \
    NEXT_TELEMETRY_DISABLED=1

# O server standalone do Next escuta em localhost por padrão. Dentro de um
# container isso o torna inalcançável de fora — inclusive pelo próprio
# healthcheck, que bate em 127.0.0.1 mas depende do processo estar servindo.
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache tzdata wget && \
    addgroup -S app && adduser -S app -G app

WORKDIR /app

# O standalone já traz o node_modules podado E o server.js. `static` e `public`
# ficam de fora do standalone por decisão do Next e precisam ser copiados à mão.
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

# ⚠️ BLINDAGEM DE SEGREDO, NÃO LIMPEZA.
# O Next COPIA o `.env` do projeto para dentro de `.next/standalone` durante o
# build (verificado em 10/09/2026). Hoje o `.dockerignore` impede o `.env` de
# entrar no build context, então ele não chega aqui — mas se alguém tirar essa
# linha do `.dockerignore`, as credenciais de produção passariam a ser assadas
# DENTRO da imagem, em silêncio, e qualquer um com acesso ao registry as leria.
# Esta linha garante que isso não aconteça mesmo nesse caso.
RUN rm -f /app/.env /app/.env.*

# Sem volume de estado: diferente do integradoras-dashboard, este app não grava
# nada em disco. Papéis/permissões não existem aqui (a barreira é Basic auth por
# variável de ambiente) e o cache é memória + Redis. Container descartável.
USER app
EXPOSE 8092

# /api/health não passa pela autenticação de propósito — o wget não manda
# credencial. Ver a nota no matcher de src/middleware.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["node", "server.js"]
