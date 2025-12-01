/* eslint-disable no-console */
'use strict';

require('dotenv').config();

const http = require('http');
const path = require('path');
const { CONFIG, validateConfig } = require('./config');
const { getDb, closeDb, ensureSchema } = require('./db');
const { createApp } = require('./app');

async function bootstrap() {
  // 1) Конфиг + БД
  validateConfig();

  // Схема БД гарантируется на старте (безопасно, если миграции идемпотентны)
  const db = getDb();
  await ensureSchema(db);

  // 2) Приложение (API + SPA)
  // Ожидаем, что createApp вернёт express-приложение со смонтированным /api
  // и, при желании, раздачей статики фронта (например, из /dist).
  const app = createApp({
    // Путь к прод-сборке фронта можно пробросить в app,
    // если он это поддерживает; иначе игнорируется.
    publicDir:
      process.env.PUBLIC_DIR ||
      path.join(__dirname, '..', 'client', 'dist'),
  });

  const server = http.createServer(app);

  // 3) Таймауты (keep-alive важен для браузеров и прокси)
  server.keepAliveTimeout = 70_000; // 70s
  server.headersTimeout = 75_000;   // 75s

  // 4) Грейсфул-шатдаун с закрытием открытых соединений
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  function shutdown(reason) {
    const tag = `[shutdown:${reason}]`;
    console.log(`\n${tag} Получен сигнал, закрываем HTTP-сервер...`);
    // Перестаём принимать новые соединения
    server.close(() => {
      console.log(`${tag} HTTP server closed.`);
      // Рубим оставшиеся keep-alive спустя grace-период
      setTimeout(() => {
        sockets.forEach((s) => s.destroy());
      }, 2_000);
      // Закрываем БД
      closeDb((err) => {
        if (err) {
          console.error(`${tag} Ошибка при закрытии SQLite:`, err);
        } else {
          console.log(`${tag} SQLite connection closed.`);
        }
        process.exit(0);
      });
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    console.error('[unhandledRejection]', err);
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    shutdown('uncaughtException');
  });

  // 5) Старт
  const port = Number(CONFIG.PORT) || 3000;
  const host = CONFIG.HOST || '0.0.0.0';

  server.listen(port, host, () => {
    const mode = CONFIG.isProd ? 'prod' : 'dev';
    console.log(`WEAM API + SPA listening on http://${host}:${port} (${mode})`);
  });

  // На всякий случай — дружелюбная ошибка занятости порта
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Порт :${port} уже используется. Измени PORT или освободи его.`);
    } else {
      console.error('HTTP server error:', err);
    }
    process.exit(1);
  });
}

bootstrap();
