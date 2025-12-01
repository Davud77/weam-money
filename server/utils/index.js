'use strict';

const jwt = require('jsonwebtoken');
const { CONFIG } = require('../config');

/* -------------------------------------------------------------------------- */
/*  Общие хелперы                                                             */
/* -------------------------------------------------------------------------- */

const respond = (res, data, status = 200) => res.status(status).json(data);

const respondError = (res, code, message, details = null) =>
  res.status(code).json({ error: message, ...(details ? { details } : {}) });

const isNonEmptyStr = (s) => typeof s === 'string' && s.trim().length > 0;

const clampStr = (s) => String(s ?? '').slice(0, CONFIG.LIMIT_STRLEN);

const toIntOrNull = (v) =>
  v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

/** Разбивает строку на уникальные элементы со срезом по limit */
function parseList(q, limit = CONFIG.LIMIT_USERS_IN) {
  if (!q) return [];
  return String(q)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ''|null|undefined -> '', неверный формат -> null, корректная YYYY-MM-DD -> строка */
const clampDateStr = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (s === '') return '';
  if (!DATE_RE.test(s)) return null;
  return s;
};

/** 0..100, NaN -> 0 */
const clampProgress = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
};

/** '30s'|'15m'|'1h'|'7d' -> ms */
function ttlToMs(ttl) {
  const m = String(ttl || '').match(/^(\d+)\s*([smhd])$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return n * mult;
}

/* -------------------------------------------------------------------------- */
/*  JWT & Cookies                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Подписывает JWT. Параметр expiresIn может быть числом (секунды) или строкой
 * в формате jsonwebtoken ('15m', '7d' и т.п.).
 */
function signToken(payload, expiresIn) {
  return jwt.sign(payload, CONFIG.JWT_SECRET, {
    expiresIn,
    algorithm: 'HS256',
  });
}

// Для совместимости: используем числовые TTL из CONFIG, но строковые тоже поддержаны.
const signAccessToken = (p) =>
  signToken(p, Number.isFinite(CONFIG.ACCESS_TTL_SEC) ? CONFIG.ACCESS_TTL_SEC : CONFIG.ACCESS_TOKEN_TTL);

const signRefreshToken = (p) =>
  signToken({ ...p, sub: 'refresh' }, Number.isFinite(CONFIG.REFRESH_TTL_SEC) ? CONFIG.REFRESH_TTL_SEC : CONFIG.REFRESH_TOKEN_TTL);

/** Базовые опции для HttpOnly куки */
const cookieBaseOpts = Object.freeze({
  httpOnly: true,
  secure: !!CONFIG.COOKIE_SECURE,
  sameSite: CONFIG.COOKIE_SAMESITE || 'Lax',
  domain: CONFIG.COOKIE_DOMAIN || undefined,
  path: '/',
});

/** Установить HttpOnly cookie с maxAge в секундах */
function setCookie(res, name, value, maxAgeSec) {
  const maxAgeMs = Math.max(0, Number(maxAgeSec || 0)) * 1000;
  res.cookie(name, value, { ...cookieBaseOpts, maxAge: maxAgeMs });
}

/** Сбросить cookie (та же «область видимости», что и при установке) */
function clearCookie(res, name) {
  res.clearCookie(name, { ...cookieBaseOpts });
}

/** Установить обе auth-куки согласно конфигу */
function setAuthCookies(res, accessToken, refreshToken) {
  if (accessToken) setCookie(res, CONFIG.ACCESS_COOKIE_NAME, accessToken, CONFIG.ACCESS_TTL_SEC);
  if (refreshToken) setCookie(res, CONFIG.REFRESH_COOKIE_NAME, refreshToken, CONFIG.REFRESH_TTL_SEC);
}

/* -------------------------------------------------------------------------- */

module.exports = {
  // responses
  respond,
  respondError,

  // strings / numbers
  isNonEmptyStr,
  clampStr,
  toIntOrNull,
  parseList,
  clampDateStr,
  clampProgress,
  ttlToMs,

  // jwt / cookies
  signToken,
  signAccessToken,
  signRefreshToken,
  cookieBaseOpts,
  setCookie,
  clearCookie,
  setAuthCookies,
};
