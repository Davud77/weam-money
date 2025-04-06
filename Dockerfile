# =========================
# 1) Билдим React (фронтенд)
# =========================
FROM node:latest AS build-frontend
WORKDIR /app

# Копируем package.json, package-lock.json
COPY package*.json ./

# Ставим зависимости для фронтенда и бэкенда (если нужно)
# Но обычно фронтенд/бэкенд в одном package.json, тогда:
RUN npm install

# Копируем все исходники (React, etc.)
COPY . .

# Запускаем сборку React
RUN npm run build

# =========================
# 2) Финальный образ (бэкенд + build)
# =========================
FROM node:latest

# Создадим рабочую директорию
WORKDIR /app

# Скопируем package.json, package-lock.json (для установки prod-зависимостей)
COPY package*.json ./

# Устанавливаем только production-зависимости (если у вас всё там)
RUN npm install --only=production

# Копируем server.js (и, если нужно, другие файлы сервера)
COPY server.js ./
COPY database.sqlite ./

# Копируем собранный build из предыдущего stage
COPY --from=build-frontend /app/build ./build

# (Опционально) если нужны какие-то другие файлы, копируем их

EXPOSE 4000

# Запускаем Node-сервер
CMD ["node", "server.js"]
