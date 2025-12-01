/* eslint-disable no-console */
'use strict';

const path = require('path');
const fs = require('fs');

const isProd = process.env.NODE_ENV === 'production';

/** Парсит "15m", "1h", "7d", "3600", "3600s" → seconds (integer) */
function parseDurationToSeconds(input, fallbackSeconds) {
  if (input == null || input === '') return fallbackSeconds;
  if (typeof input === 'number' && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  const s = String(input).trim().toLowerCase();

  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10));

  const m = s.match(/^(\d+)\s*([smhd])?$/);
  if (!m) return fallbackSeconds;
  const n = parseInt(m[1], 10);
  const unit = m[2] || 's';
  const mul = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return Math.max(0, n * mul);
}

const DEFAULT_ACCESS = '15m';
const DEFAULT_REFRESH = '7d';

const CONFIG = Object.freeze({
  isProd,
  PORT: Number(process.env.PORT) || 4000,

  // --- JWT / Cookies ---
  JWT_SECRET: process.env.JWT_SECRET || process.env.SECRET_KEY || '',
  REFRESH_SECRET: process.env.REFRESH_SECRET || '',

  ACCESS_TOKEN_TTL:  process.env.ACCESS_TOKEN_TTL  || process.env.ACCESS_TTL  || DEFAULT_ACCESS,
  REFRESH_TOKEN_TTL: process.env.REFRESH_TOKEN_TTL || process.env.REFRESH_TTL || DEFAULT_REFRESH,
  ACCESS_TTL_SEC:  parseDurationToSeconds(process.env.ACCESS_TTL  || process.env.ACCESS_TOKEN_TTL  || DEFAULT_ACCESS,  15 * 60),
  REFRESH_TTL_SEC: parseDurationToSeconds(process.env.REFRESH_TTL || process.env.REFRESH_TOKEN_TTL || DEFAULT_REFRESH, 7 * 24 * 60 * 60),

  ACCESS_COOKIE_NAME:  process.env.ACCESS_COOKIE_NAME  || 'access_token',
  REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME || 'refresh_token',
  COOKIE_SECURE:   process.env.COOKIE_SECURE === '1' || isProd,
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || 'Lax',  // Lax|Strict|None
  COOKIE_DOMAIN:   process.env.COOKIE_DOMAIN || '',

  // --- CORS / CSP / HSTS ---
  CLIENT_ORIGINS: (
      process.env.CLIENT_ORIGINS
      || process.env.CLIENT_ORIGIN
      || 'http://localhost:5173,http://localhost:3000,http://localhost:4000'
    )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  ENABLE_HSTS: process.env.ENABLE_HSTS === '1',
  CSP_UPGRADE_INSECURE: process.env.CSP_UPGRADE_INSECURE === '1',

  // --- DB ---
  DB_FILE: process.env.DATABASE_FILE
    ? path.resolve(process.env.DATABASE_FILE)
    : path.join(process.cwd(), 'data', 'database.sqlite'),

  // --- Static ---
  STATIC_MAX_AGE: isProd ? '7d' : 0,

  // --- Limits ---
  LIMIT_API_WINDOW_MS: 10 * 60 * 10000,
  LIMIT_API_MAX: 10000,
  LIMIT_LOGIN_MAX: 20,
  BODY_LIMIT: '1mb',
  LIMIT_PROJECTS_IN: 200,
  LIMIT_USERS_IN: 200,
  LIMIT_STRLEN: 512,
  MAX_TOKEN_LENGTH: 4096,
});

function validateConfig() {
  const validSameSite = ['Lax', 'Strict', 'None'];
  if (!validSameSite.includes(CONFIG.COOKIE_SAMESITE)) {
    console.error(`FATAL: COOKIE_SAMESITE должен быть одним из ${validSameSite.join('|')}, получено: ${CONFIG.COOKIE_SAMESITE}`);
    process.exit(1);
  }

  if (!CONFIG.JWT_SECRET || CONFIG.JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET (или SECRET_KEY) обязателен и должен быть ≥ 32 символов.');
    process.exit(1);
  }
  if (!CONFIG.REFRESH_SECRET || CONFIG.REFRESH_SECRET.length < 32) {
    console.warn('WARN: REFRESH_SECRET не задан или короче 32 символов. Будет использоваться JWT_SECRET. Рекомендуется задать отдельный длинный REFRESH_SECRET.');
  }

  if (CONFIG.isProd) {
    const hasInsecure = CONFIG.CLIENT_ORIGINS.some((o) => o.startsWith('http://'));
    if (hasInsecure) {
      console.warn('WARN: В production желательно использовать только https:// в CLIENT_ORIGINS.');
    }
  }

  // Готовим директорию для БД
  try {
    const dir = path.dirname(CONFIG.DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Проверяем права на запись в каталог
    fs.accessSync(dir, fs.constants.W_OK);

    // touch файла БД (создастся если его нет) + проверка на запись
    const fd = fs.openSync(CONFIG.DB_FILE, 'a'); // откроет на добавление/создаст
    fs.closeSync(fd);

    // Нежёстко выставим права: rw-rw-r--
    try { fs.chmodSync(CONFIG.DB_FILE, 0o664); } catch (_) {}

  } catch (e) {
    console.error('FATAL: БД недоступна для записи.');
    console.error(`  DATABASE_FILE: ${CONFIG.DB_FILE}`);
    console.error(`  Причина: ${e.message}`);
    console.error('  Подсказка: на хосте выполни:');
    console.error('    sudo chown -R 1000:1000 ./data && sudo chmod -R u+rwX,g+rwX ./data');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.DB_FILE)) {
    console.warn(`WARN: Файл БД не найден: ${CONFIG.DB_FILE}. Будет создан автоматически при первом подключении.`);
  }
}

module.exports = { CONFIG, validateConfig };
