/* eslint-disable no-console */
'use strict';

const jwt = require('jsonwebtoken');
const { CONFIG } = require('../config');
const { respondError } = require('../utils');

/* ------------------------------ Cookie utils ------------------------------ */
function parseCookies(headerValue) {
  const out = {};
  if (!headerValue) return out;
  // Разбираем "a=1; b=2; c=hello%20world"
  String(headerValue)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((p) => {
      const i = p.indexOf('=');
      if (i > -1) {
        const k = p.slice(0, i).trim();
        const v = p.slice(i + 1).trim();
        try {
          out[k] = decodeURIComponent(v);
        } catch {
          out[k] = v;
        }
      }
    });
  return out;
}

function getTokenFromReq(req) {
  // 1) Authorization: Bearer xxx (CLI/скрипты)
  const hdr = String(req.headers?.authorization || '');
  if (hdr.startsWith('Bearer ')) return hdr.slice(7).trim();

  // 2) HttpOnly cookie с access-токеном
  const cookies = req.cookies || parseCookies(req.headers?.cookie || '');
  const name = CONFIG.ACCESS_COOKIE_NAME || 'access_token';
  const access = cookies[name];
  if (typeof access === 'string' && access.trim()) return access.trim();

  return null;
}

/* ------------------------------ JWT helpers ------------------------------- */
const ACCESS_TTL_SEC  = Number(CONFIG.ACCESS_TTL_SEC  || 15 * 60);            // 15 мин по умолчанию
const REFRESH_TTL_SEC = Number(CONFIG.REFRESH_TTL_SEC || 7 * 24 * 60 * 60);   // 7 дней по умолчанию

function signAccessToken(payload) {
  // Жёстко помечаем тип токена
  return jwt.sign({ ...payload, sub: 'access' }, CONFIG.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SEC,
  });
}

function signRefreshToken(payload) {
  // Можно (и рекомендуется) задавать отдельный REFRESH_SECRET
  const secret = CONFIG.REFRESH_SECRET || CONFIG.JWT_SECRET;
  return jwt.sign({ ...payload, sub: 'refresh' }, secret, {
    algorithm: 'HS256',
    expiresIn: REFRESH_TTL_SEC,
  });
}

function verifyAccess(token) {
  const decoded = jwt.verify(token, CONFIG.JWT_SECRET, { algorithms: ['HS256'] });
  if (decoded?.sub !== 'access') throw new Error('invalid sub');
  return decoded;
}

function verifyRefresh(token) {
  const secret = CONFIG.REFRESH_SECRET || CONFIG.JWT_SECRET;
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (decoded?.sub !== 'refresh') throw new Error('invalid sub');
  return decoded;
}

/* ------------------------------ Cookies I/O ------------------------------- */
function cookieCommonOpts() {
  // В dev SameSite=Lax + secure=false; в prod — secure=true по умолчанию
  const sameSite = (CONFIG.COOKIE_SAMESITE || 'Lax');
  const secure = CONFIG.COOKIE_SECURE != null ? !!CONFIG.COOKIE_SECURE : CONFIG.isProd;
  const domain = CONFIG.COOKIE_DOMAIN || undefined;

  return { httpOnly: true, sameSite, secure, domain, path: '/' };
}

function setAuthCookies(res, { access, refresh }) {
  const accessName = CONFIG.ACCESS_COOKIE_NAME || 'access_token';
  const refreshName = CONFIG.REFRESH_COOKIE_NAME || 'refresh_token';
  const base = cookieCommonOpts();

  // Access — короткий TTL
  res.cookie(accessName, access, { ...base, maxAge: ACCESS_TTL_SEC * 1000 });

  // Refresh — длинный TTL
  res.cookie(refreshName, refresh, { ...base, maxAge: REFRESH_TTL_SEC * 1000 });
}

function clearAuthCookies(res) {
  const accessName = CONFIG.ACCESS_COOKIE_NAME || 'access_token';
  const refreshName = CONFIG.REFRESH_COOKIE_NAME || 'refresh_token';
  const base = cookieCommonOpts();

  res.clearCookie(accessName, { ...base, maxAge: 0 });
  res.clearCookie(refreshName, { ...base, maxAge: 0 });
}

/* --------------------------------- Middleware ----------------------------- */
function auth(required = true) {
  return (req, res, next) => {
    const token = getTokenFromReq(req);

    if (!token) {
      if (required) return respondError(res, 401, 'Unauthorized');
      req.user = null;
      return next();
    }

    if (CONFIG.MAX_TOKEN_LENGTH && token.length > CONFIG.MAX_TOKEN_LENGTH) {
      return respondError(res, 401, 'Invalid or expired token');
    }

    try {
      // ожидаемый payload: { userId, role, login, nickname? }
      const decoded = verifyAccess(token);
      req.user = decoded;
      res.locals.user = decoded;
      return next();
    } catch (_e) {
      return respondError(res, 401, 'Invalid or expired token');
    }
  };
}

// тот же, но "мягкий" — не требует авторизации
const optionalAuth = () => auth(false);

const adminOnly = (req, res, next) =>
  (!req.user || req.user.role !== 'admin') ? respondError(res, 403, 'Forbidden') : next();

/**
 * whereByRole — помогает ограничить SELECT для роли 'user'
 *  - admin видит всё (where: '')
 *  - user видит только свои записи:
 *      • для транзакций по полю t.responsible (login)
 *      • для проектов по полю p.user_id (numeric id)
 */
function whereByRole(req, fieldExpr, params) {
  if (req.user?.role === 'admin') return { where: '', params };

  // Транзакции: поле логина
  if (fieldExpr === 't.responsible') {
    return { where: ' AND t.responsible = ? ', params: [...params, req.user.login] };
  }

  // Проекты/разделы: поле id пользователя (ответственного)
  if (fieldExpr === 'p.user_id' || fieldExpr === 'projects.user_id') {
    return { where: ' AND p.user_id = ? ', params: [...params, req.user.userId] };
  }

  // запасной вариант — ничего не добавляем
  return { where: '', params };
}

module.exports = {
  // middleware
  auth,
  optionalAuth,
  adminOnly,

  // SQL helper
  whereByRole,

  // tokens/cookies
  signAccessToken,
  signRefreshToken,
  verifyRefresh,
  setAuthCookies,
  clearAuthCookies,

  // internals (может пригодиться в тестах/маршрутах)
  getTokenFromReq,
  parseCookies,
};
