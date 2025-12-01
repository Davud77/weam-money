/* eslint-disable no-console */
'use strict';

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const { CONFIG } = require('./config');
const { registerRoutes } = require('./routes');
const { getDb, dbAsync, hasTxRemainder } = require('./db');
const utils = require('./utils');
const auth = require('./middleware/auth');

function createApp() {
  const app = express();

  // доверяем только один прокси (или отключаем, если нужно)
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ----- Security headers / CSP -----
  const cspDirectives = {
    "default-src": ["'self'"],
    "script-src":  ["'self'"],
    "style-src":   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src":    ["'self'", "data:", "https://fonts.gstatic.com"],
    "img-src":     ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://*.unsplash.com"],
    "connect-src": ["'self'", ...CONFIG.CLIENT_ORIGINS],
    "object-src":  ["'none'"],
    "base-uri":    ["'none'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "media-src": ["'self'", "blob:"],
    "form-action": ["'self'"]
  };
  if (CONFIG.CSP_UPGRADE_INSECURE) cspDirectives['upgrade-insecure-requests'] = [];

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: CONFIG.ENABLE_HSTS ? undefined : false,
    contentSecurityPolicy: { useDefaults: true, directives: cspDirectives },
    referrerPolicy: { policy: 'no-referrer' },
  }));

  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
    next();
  });

  // ----- Body / misc -----
  app.use(cookieParser());
  app.use(express.json({ limit: CONFIG.BODY_LIMIT }));
  app.use(hpp());
  app.use(compression());
  app.use(morgan(CONFIG.isProd ? 'combined' : 'dev'));

  // ----- CORS (cookie-based auth требует credentials: true) -----
  const corsOptions = {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (CONFIG.CLIENT_ORIGINS.includes(origin)) return cb(null, true);
      const err = new Error('CORS_ORIGIN_NOT_ALLOWED'); err.statusCode = 403; return cb(err);
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 86400,
  };
  app.use((req, res, next) => { res.setHeader('Vary', 'Origin, Cookie'); next(); });
  app.use(cors(corsOptions));
  app.use((req, res, next) => { if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });

  // ----- Rate limits -----
  const apiLimiter = rateLimit({
    windowMs: CONFIG.LIMIT_API_WINDOW_MS,
    limit: CONFIG.LIMIT_API_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const loginLimiter = rateLimit({
    windowMs: CONFIG.LIMIT_API_WINDOW_MS,
    limit: CONFIG.LIMIT_LOGIN_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, try later.' },
  });

  // no-store для API и лимитер
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, apiLimiter);

  // ===== API =====
  registerRoutes(app, {
    db: getDb(),
    dbAsync,
    utils,
    auth,
    config: CONFIG,
    limiters: { loginLimiter },
    flags: { hasTxRemainder: hasTxRemainder() },
  });

  // ===== SPA static (CRA/Vite build в корне репозитория => ../build) =====
  const spaDir = path.join(__dirname, '..', 'build');
  app.use(express.static(spaDir, { maxAge: CONFIG.STATIC_MAX_AGE, etag: true, immutable: CONFIG.isProd }));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  // Fallback: всё, что не /api/* — index.html из сборки
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(spaDir, 'index.html'), (err) => {
      if (err) {
        console.error('Unhandled error:', err);
        res.status(500).json({ error: 'SPA bundle not found (build). Did you run the frontend build?' });
      }
    });
  });

  // ----- Error handler -----
  app.use((err, _req, res, _next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    if (err && err.message === 'CORS_ORIGIN_NOT_ALLOWED') return res.status(err.statusCode || 403).json({ error: 'CORS not allowed for this Origin' });
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };
