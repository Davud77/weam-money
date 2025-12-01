# ------------------------------------------------------------
# Продовый Dockerfile (фикс сборки CRA: отключён CI режим для eslint)
#  1) build-frontend  — собираем React bundle (CRA), CI=false => предупреждения не валят билд
#  2) deps-prod       — production node_modules (вкл. native, напр. sqlite3)
#  3) app             — финальный образ с бэкендом и статикой
# ------------------------------------------------------------

# -------------------------
# 1) FRONTEND BUILD (React + CRA)
# -------------------------
FROM node:20-alpine AS build-frontend
WORKDIR /app

# Для сборки фронта нам нужны dev-зависимости
ENV NODE_ENV=development
ENV NPM_CONFIG_PRODUCTION=false
# отключаем sourcemaps для меньшего размера
ENV GENERATE_SOURCEMAP=false
# ВАЖНО: CRA трактует предупреждения как ошибки, когда CI != "false".
# Явно выключаем CI-режим, чтобы не падать на warning'ах линтера в прод-сборке контейнера.
ENV CI=false

# инструменты для сборки (на случай нативных пакетов)
RUN apk add --no-cache python3 make g++

# Устанавливаем deps
COPY package*.json ./
RUN npm install

# Исходники всего репозитория (фронт расположен вместе с сервером)
COPY . .

# Фикс для CRA5/webpack5/ajv-связки
RUN npm i --no-save \
  react-scripts@5.0.1 \
  ajv@6.12.6 \
  ajv-keywords@3.5.2

# Собираем статику в /app/build
RUN npm run build


# -------------------------
# 2) PROD DEPS (node_modules для бэкенда с native-сборкой)
# -------------------------
FROM node:20-alpine AS deps-prod
WORKDIR /app
ENV NODE_ENV=production

# Инструменты для сборки нативных модулей (sqlite3 и т.п.)
RUN apk add --no-cache python3 make g++

COPY package*.json ./

# Production зависимости (без dev)
RUN npm install --omit=dev \
 && npm cache clean --force

# На случай, если cookie-parser не прописан в package.json
RUN npm i --no-save cookie-parser@^1.4.6 \
 && npm cache clean --force


# -------------------------
# 3) RUNTIME BACKEND (Express + статика)
# -------------------------
FROM node:20-alpine AS app
WORKDIR /app

# Минимальные рантайм-пакеты
RUN apk add --no-cache tini

# Прод-режим для Node/Express
ENV NODE_ENV=production
ENV PORT=4000
# По умолчанию база монтируется томом в /data (см. VOLUME ниже)
ENV DATABASE_FILE=/data/database.sqlite

# Копируем production node_modules из deps-prod (уже собраны с native)
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=deps-prod /app/package*.json ./

# Серверный код и собранный фронт
COPY server ./server
COPY --from=build-frontend /app/build ./build

# Готовим каталог для БД и правим права для пользователя node
RUN mkdir -p /data \
 && chown -R node:node /app /data

# Запускаем от непривилегированного пользователя
USER node

# Экспонируем порт
EXPOSE 4000

# HEALTHCHECK пингует /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1 || exit 1

# Объявляем том для БД (можно монтировать снаружи)
VOLUME ["/data"]

# Корректная обработка сигналов (PID 1) через Tini
ENTRYPOINT ["/sbin/tini", "--"]

# Запускаем сервер
CMD ["node", "server/server.js"]
