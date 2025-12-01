/* eslint-disable no-console */
'use strict';

/**
 * routes.js (modular, hardened)
 * ctx = {
 *   db, dbAsync,
 *   utils: { respond, respondError, isNonEmptyStr, clampStr, toIntOrNull, parseList, clampDateStr, clampProgress, ttlToMs },
 *   auth: { auth: authRequired, adminOnly, whereByRole, signAccessToken, signRefreshToken, verifyRefresh },
 *   limiters: { loginLimiter },
 *   config
 * }
 */

function registerRoutes(app, ctx) {
  const { db, dbAsync, utils, auth, limiters, config } = ctx;
  const {
    respond, respondError, isNonEmptyStr, clampStr, toIntOrNull,
    parseList, clampDateStr: _clampDateStr, clampProgress, ttlToMs
  } = utils;
  const {
    auth: authRequired,
    adminOnly,
    whereByRole,
    signAccessToken,
    signRefreshToken,
    verifyRefresh,
  } = auth;

  const ACCESS_COOKIE = config.ACCESS_COOKIE_NAME;
  const REFRESH_COOKIE = config.REFRESH_COOKIE_NAME;

  const baseCookieOpts = {
    httpOnly: true,
    sameSite: config.COOKIE_SAMESITE,
    secure: !!config.COOKIE_SECURE,
    path: '/',
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {})
  };

  /* ------------------------------ helpers --------------------------------- */
  const clampDateStr = (v) => {
    if (typeof _clampDateStr === 'function') return _clampDateStr(v);
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (v === null || v === undefined || v === '') return '';
    const s = String(v).trim();
    if (s === '') return '';
    if (!DATE_RE.test(s)) return null;
    return s;
  };

  // Выражение SQL для расчёта остатка по разделу проекта (alias — алиас таблицы projects)
  const remainderExpr = (alias = 'p') => `(
    COALESCE(${alias}.amount, 0) - COALESCE((
      SELECT SUM(ABS(t.total))
        FROM transactions t
       WHERE t.project_id = ${alias}.id
         AND t.date <> '' -- только фактические
         AND (
           (${alias}.direction = 'нам должны' AND t.operationType = 'Доход') OR
           (${alias}.direction = 'мы должны'  AND t.operationType = 'Расход')
         )
    ), 0)
  )`;

  let txColsCache = null;
  async function getTxCols() {
    if (txColsCache) return txColsCache;
    const cols = await dbAsync.all(`PRAGMA table_info(transactions)`);
    txColsCache = new Set((cols || []).map(c => c.name));
    return txColsCache;
  }

  const methodNotAllowed = (allow = 'GET') => (_req, res) => {
    res.set('Allow', allow);
    respondError(res, 405, 'Method Not Allowed by policy');
  };

  function safeSqlError(res, e, fallback = 'DB error') {
    const msg = String(e && e.message || fallback);
    if (/FOREIGN KEY constraint failed/i.test(msg)) {
      return respondError(res, 400, 'Invalid foreign key (project_id)');
    }
    if (/NOT NULL constraint failed: transactions\./i.test(msg)) {
      const m = msg.match(/transactions\.([a-zA-Z0-9_]+)/);
      return respondError(res, 400, `Field "${m?.[1] || 'unknown'}" is required`);
    }
    if (/no such column/i.test(msg)) {
      console.error('SQL error:', msg);
      return respondError(res, 500, 'Server schema mismatch: no such column');
    }
    if (/datatype mismatch/i.test(msg)) {
      return respondError(res, 400, 'Invalid data type');
    }
    console.error('SQL error:', msg);
    return respondError(res, 500, fallback);
  }

  /* -------------------------------- Health / Me --------------------------- */
  app.get('/api/health', async (_req, res) => {
    try {
      const row = await dbAsync.get('SELECT 1 AS ok');
      respond(res, { status: 'ok', db: row?.ok === 1 ? 'up' : 'unknown', time: new Date().toISOString() });
    } catch {
      respond(res, { status: 'ok', db: 'down', time: new Date().toISOString() });
    }
  });

  // МЯГКИЙ /api/me: не авторизован → 200 { user: null } (чтобы не шуметь 401 на /login)
  app.get('/api/me', authRequired(false), async (req, res) => {
    try {
      if (!req.user) return respond(res, { user: null });
      const row = await dbAsync.get(
        `SELECT id, login, role, nickname FROM users WHERE id = ?`,
        [req.user.userId]
      );
      return respond(res, { user: row || null });
    } catch (e) {
      return respond(res, { user: null });
    }
  });

  /* ---------------------------------- Auth -------------------------------- */

  // LOGIN — ставим только HttpOnly cookies, НЕ возвращаем access-токен в теле
  app.post('/api/login', limiters.loginLimiter, (req, res) => {
    const { login, password } = req.body || {};
    if (!isNonEmptyStr(login) || !isNonEmptyStr(password)) {
      return respondError(res, 400, 'login and password are required');
    }
    db.get(
      `SELECT id, login, password_hash, role, nickname
         FROM users
        WHERE login = ?`,
      [clampStr(login)],
      (err, row) => {
        if (err)   return respondError(res, 500, 'DB error');
        if (!row)  return respondError(res, 401, 'Invalid credentials');

        const bcrypt = require('bcryptjs');
        const ok = row.password_hash && bcrypt.compareSync(password, row.password_hash);
        if (!ok) return respondError(res, 401, 'Invalid credentials');

        const payload = { userId: row.id, role: row.role, login: row.login };
        const accessToken  = signAccessToken(payload);
        const refreshToken = signRefreshToken(payload);

        const accessMs  = ttlToMs(config.ACCESS_TOKEN_TTL);
        const refreshMs = ttlToMs(config.REFRESH_TOKEN_TTL);

        res.cookie(ACCESS_COOKIE,  accessToken,  { ...baseCookieOpts, ...(accessMs  ? { maxAge: accessMs }  : {}) });
        res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookieOpts, ...(refreshMs ? { maxAge: refreshMs } : {}) });

        respond(res, {
          user: { id: row.id, login: row.login, role: row.role, nickname: row.nickname }
        });
      }
    );
  });

  // REFRESH — проверяет refresh cookie и выдаёт новый access (кука), без возврата токена в теле
  app.post('/api/refresh', (req, res) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (!token || String(token).trim() === '') return respondError(res, 401, 'No refresh token');

      // verifyRefresh использует REFRESH_SECRET (fallback на JWT_SECRET) и проверяет sub==="refresh"
      const decoded = verifyRefresh(token);

      const payload = { userId: decoded.userId, role: decoded.role, login: decoded.login };
      const newAccess = signAccessToken(payload);
      const accessMs = ttlToMs(config.ACCESS_TOKEN_TTL);

      res.cookie(ACCESS_COOKIE, newAccess, { ...baseCookieOpts, ...(accessMs ? { maxAge: accessMs } : {}) });
      return respond(res, { ok: true });
    } catch {
      return respondError(res, 401, 'Invalid or expired refresh token');
    }
  });

  // LOGOUT — чистим cookies
  app.post('/api/logout', (_req, res) => {
    res.cookie(ACCESS_COOKIE,  '', { ...baseCookieOpts, maxAge: 0 });
    res.cookie(REFRESH_COOKIE, '', { ...baseCookieOpts, maxAge: 0 });
    respond(res, { ok: true });
  });

  /* ---------------------------------- Users ------------------------------- */
  app.get('/api/users', authRequired(true), adminOnly, (_req, res) => {
    db.all(`SELECT id, login, role, nickname, role AS type FROM users ORDER BY id ASC`,
      (err, rows) => err ? respondError(res, 500, 'DB error') : respond(res, rows || []));
  });

  // Создание/удаление пользователей — закрыто политикой (при необходимости можно включить)
  app.post('/api/users', authRequired(true), adminOnly, methodNotAllowed());
  app.delete('/api/users/:id', authRequired(true), adminOnly, methodNotAllowed());

  // Смена пароля (админ)
  app.put('/api/users/:id/password', authRequired(true), adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const { newPassword } = req.body || {};
    if (!Number.isFinite(id) || !isNonEmptyStr(newPassword)) return respondError(res, 400, 'id and newPassword are required');
    try {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync(String(newPassword), 10);
      const r = await dbAsync.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, id]);
      respond(res, { updated: r.changes > 0 });
    } catch (e) { safeSqlError(res, e); }
  });

  // Обновление собственного профиля (логин/никнейм) — пользователь или админ.
  // Админ может также менять роль (через поле type или role).
  app.put('/api/users/:id', authRequired(true), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return respondError(res, 400, 'Invalid id');

    const isAdmin = req.user.role === 'admin';
    const isSelf  = req.user.userId === id;

    if (!isAdmin && !isSelf) return respondError(res, 403, 'Forbidden');

    const body = req.body || {};
    const patch = {};
    if (body.login !== undefined)    patch.login    = clampStr(body.login);
    if (body.nickname !== undefined) patch.nickname = clampStr(body.nickname);

    // Изменение роли — только админ
    if (isAdmin) {
      const role = clampStr(body.type ?? body.role ?? '');
      if (role === 'admin' || role === 'user') patch.role = role;
    }

    const keys = Object.keys(patch);
    if (!keys.length) return respondError(res, 400, 'No permitted fields');

    try {
      const setParts = keys.map(k => `${k} = ?`);
      const params = keys.map(k => patch[k]);
      const r = await dbAsync.run(`UPDATE users SET ${setParts.join(', ')} WHERE id = ?`, [...params, id]);
      if (!r.changes) return respondError(res, 404, 'User not found or nothing changed');

      const row = await dbAsync.get(`SELECT id, login, role, nickname FROM users WHERE id = ?`, [id]);
      respond(res, { updated: true, user: row });
    } catch (e) { safeSqlError(res, e); }
  });

  /* ------------------------------ Reference lists ------------------------- */
  app.get('/api/responsible', authRequired(true), (req, res) => {
    if (req.user.role === 'admin') {
      db.all(`SELECT id, login, nickname FROM users ORDER BY login`,
        (err, rows) => err ? respondError(res, 500, 'DB error') : respond(res, rows || []));
    } else {
      db.get(`SELECT id, login, nickname FROM users WHERE id = ?`, [req.user.userId],
        (err, row) => err ? respondError(res, 500, 'DB error') : respond(res, row ? [row] : []));
    }
  });

  /* ------------------------------- Organizations -------------------------- */
  app.get('/api/organizations', authRequired(true), async (req, res) => {
    try {
      let sql = `SELECT DISTINCT contractor AS name FROM projects p`;
      const params = [];
      if (req.user.role !== 'admin') { sql += ` WHERE p.user_id = ?`; params.push(req.user.userId); }
      sql += ` ORDER BY name`;
      const rows = await dbAsync.all(sql, params);
      respond(res, rows || []);
    } catch (e) { safeSqlError(res, e); }
  });
  app.post('/api/organizations', authRequired(true), (req, res) => {
    const { name } = req.body || {};
    if (!isNonEmptyStr(name)) return respondError(res, 400, 'name is required');
    respond(res, { name: clampStr(name) });
  });

  /* --------------------------------- Projects ----------------------------- */

  app.get('/api/projects', authRequired(true), async (req, res) => {
    try {
      const baseSql = `
        SELECT
          p.*,
          p.user_id AS responsible,
          u.nickname AS responsible_nickname,
          ${remainderExpr('p')} AS remainder_calc
        FROM projects p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE 1=1
      `;
      const { where, params } = whereByRole(req, 'p.user_id', []);
      const sql = baseSql + where + ` ORDER BY p.contractor, p.project, p.section`;
      const rows = await dbAsync.all(sql, params);
      respond(res, rows || []);
    } catch (e) { safeSqlError(res, e); }
  });

  app.get('/api/projects/by-name/:name', authRequired(true), async (req, res) => {
    try {
      const name = clampStr(req.params.name);
      const { where, params } = whereByRole(req, 'p.user_id', [name]);
      const sql = `
        SELECT
          p.*,
          p.user_id AS responsible,
          u.nickname AS responsible_nickname,
          ${remainderExpr('p')} AS remainder_calc
        FROM projects p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.name = ? ${where}
        ORDER BY p.section
      `;
      const rows = await dbAsync.all(sql, params);
      respond(res, rows || []);
    } catch (e) { safeSqlError(res, e); }
  });

  // Обновление раздела/задачи проекта: админ — любые поля, юзер — dates/status/progress
  app.put('/api/projects/:id', authRequired(true), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return respondError(res, 400, 'Invalid id');
    const isAdmin = req.user.role === 'admin';

    // ИЗМЕНЕНО: добавлено поле 'grouping' в список разрешенных
    const ALLOWED_ADMIN = new Set(['contractor','project','section','direction','amount','note','start','end','status','progress','user_id','responsible','name', 'grouping']);
    const ALLOWED_USER  = new Set(['status','start','end','progress']);
    const body = req.body || {};
    const canUse = (k) => isAdmin ? ALLOWED_ADMIN.has(k) : ALLOWED_USER.has(k);

    const patch = {};
    const push = (k, v) => { patch[k] = v; };

    for (const k of Object.keys(body)) {
      if (!canUse(k)) continue;
      const v = body[k];
      switch (k) {
        // ИЗМЕНЕНО: 'grouping' обрабатывается как обычная строка
        case 'contractor':
        case 'project':
        case 'section':
        case 'direction':
        case 'note':
        case 'name':
        case 'grouping': push(k, clampStr(v)); break;
        case 'amount': push(k, Number(v) || 0); break;
        case 'status': push(k, clampStr(v)); break;
        case 'progress': push(k, clampProgress(v)); break;
        case 'start':
        case 'end': {
          const d = clampDateStr(v);
          if (d === null) return respondError(res, 400, `Invalid date format for "${k}" (YYYY-MM-DD expected)`);
          push(k, d); break;
        }
        case 'user_id':
          if (isAdmin) push('user_id', toIntOrNull(v));
          break;
        case 'responsible':
          if (isAdmin) push('user_id', toIntOrNull(v));
          break;
        default: break;
      }
    }

    if (isAdmin && (patch.contractor !== undefined || patch.project !== undefined)) {
      const current = await dbAsync.get('SELECT contractor, project FROM projects WHERE id = ?', [id]);
      if (current) {
        const newContractor = patch.contractor ?? current.contractor;
        const newProject = patch.project ?? current.project;
        patch.name = `${newContractor} / ${newProject}`;
      }
    }

    const keys = Object.keys(patch);
    if (!keys.length) return respondError(res, 400, 'No permitted fields in patch');

    const setParts = keys.map(k => `${k} = ?`);
    const params = keys.map(k => patch[k]);

    let where = ' WHERE id = ? ';
    const whereParams = [id];
    if (!isAdmin) { where += ' AND user_id = ? '; whereParams.push(req.user.userId); }

    try {
      const r = await dbAsync.run(`UPDATE projects SET ${setParts.join(', ')} ${where}`, [...params, ...whereParams]);
      if (!r.changes) return respondError(res, 404, 'Project not found or not allowed');

      const updated = await dbAsync.get(`
        SELECT
          p.*,
          p.user_id AS responsible,
          u.nickname AS responsible_nickname,
          ${remainderExpr('p')} AS remainder_calc
        FROM projects p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.id = ?`, [id]);
      respond(res, { updated: true, updatedFields: keys, project: updated });
    } catch (e) { safeSqlError(res, e); }
  });

  // Создание раздела (admin)
  app.post('/api/projects', authRequired(true), adminOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const contractor = clampStr(b.contractor);
      const project    = clampStr(b.project);
      const section    = clampStr(b.section);
      const direction  = clampStr(b.direction);
      const grouping   = clampStr(b.grouping); // <-- ДОБАВЛЕНО
      const amount     = Number(b.amount) || 0;
      const note       = b.note != null ? clampStr(b.note) : '';
      const name       = clampStr(b.name || `${contractor} / ${project}`);
      const start      = (() => { const d = clampDateStr(b.start); return d === null ? '' : (d || ''); })();
      const end        = (() => { const d = clampDateStr(b.end);   return d === null ? '' : (d || ''); })();
      const status     = clampStr(b.status || '');
      const progress   = clampProgress(b.progress);
      const user_id    = toIntOrNull(b.responsible ?? b.user_id);

      if (!isNonEmptyStr(contractor) || !isNonEmptyStr(project)) {
        return respondError(res, 400, 'contractor and project are required');
      }

      // ИЗМЕНЕНО: Добавлено поле 'grouping' в INSERT
      const r = await dbAsync.run(
        `INSERT INTO projects (contractor, project, section, direction, amount, note, start, end, status, progress, user_id, name, grouping)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [contractor, project, section, direction, amount, note, start, end, status, progress, user_id, name, grouping]
      );

      const row = await dbAsync.get(`
        SELECT
          p.*,
          p.user_id AS responsible,
          u.nickname AS responsible_nickname,
          ${remainderExpr('p')} AS remainder_calc
        FROM projects p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.id = ?`, [r.lastID]);

      respond(res, row, 201);
    } catch (e) { safeSqlError(res, e); }
  });

  // Удаление раздела (admin)
  app.delete('/api/projects/:id', authRequired(true), adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return respondError(res, 400, 'Invalid id');

      const r = await dbAsync.run(`DELETE FROM projects WHERE id = ?`, [id]);
      respond(res, { deleted: r.changes > 0 });
    } catch (e) { safeSqlError(res, e); }
  });

  /* ------------------------------- Transactions --------------------------- */

  app.get('/api/transactions', authRequired(true), async (req, res) => {
    try {
      const isAdmin = req.user.role === 'admin';
      const params = [];
      let where = '';
      if (!isAdmin) { where = 'WHERE t.responsible = ?'; params.push(req.user.login); }
      const sql = `
        SELECT t.*
          FROM transactions t
          ${where}
         ORDER BY (CASE WHEN t.date='' THEN 0 ELSE 1 END) ASC, t.date DESC, t.id DESC`;
      const rows = await dbAsync.all(sql, params);
      respond(res, rows || []);
    } catch (e) { safeSqlError(res, e); }
  });

  app.get('/api/transactions/query', authRequired(true), async (req, res) => {
    try {
      const isAdmin = req.user.role === 'admin';
      const q = req.query || {};
      const start = q.start ? clampStr(q.start) : null;
      const end   = q.end   ? clampStr(q.end)   : null;

      const params = [];
      let where = ' WHERE 1=1 ';
      if (!isAdmin) { where += ' AND t.responsible = ? '; params.push(req.user.login); }

      if (start) { where += ' AND (t.date <> "" AND t.date >= ?) '; params.push(start); }
      if (end)   { where += ' AND (t.date <> "" AND t.date <= ?) '; params.push(end); }

      if (q.op === 'income')  where += " AND t.operationType = 'Доход' ";
      if (q.op === 'expense') where += " AND t.operationType = 'Расход' ";

      if (q.plan === 'planned') where += " AND t.date = '' ";
      if (q.plan === 'actual')  where += " AND t.date <> '' ";

      if (q.account && isAdmin) { where += ' AND t.responsible = ? '; params.push(clampStr(q.account)); }

      if (q.project_id !== undefined && q.project_id !== null && String(q.project_id).trim() !== '') {
        const pid = Number(q.project_id);
        if (Number.isFinite(pid)) { where += ' AND t.project_id = ? '; params.push(pid); }
      }

      if (q.min != null && q.min !== '') { where += ' AND t.total >= ? '; params.push(Number(q.min) || 0); }
      if (q.max != null && q.max !== '') { where += ' AND t.total <= ? '; params.push(Number(q.max) || 0); }

      const sql = `
        SELECT t.*
          FROM transactions t
          ${where}
         ORDER BY (CASE WHEN t.date='' THEN 0 ELSE 1 END) ASC, t.date DESC, t.id DESC
      `;
      const rows = await dbAsync.all(sql, params);
      respond(res, { rows });
    } catch (e) { safeSqlError(res, e); }
  });

  async function normalizeTxInput(body, { forCreate = false } = {}) {
    const b = body || {};
    const op = b.operationType === 'Доход' ? 'Доход'
             : b.operationType === 'Расход' ? 'Расход' : null;

    const d = clampDateStr(b.date);
    if (d === null) return { error: 'Invalid date format (YYYY-MM-DD or empty)' };
    const date = forCreate ? (d ?? '') : (b.date !== undefined ? (d ?? '') : undefined);

    const total = Number(b.total);
    const note  = b.note != null ? clampStr(b.note) : (forCreate ? '' : undefined);
    const resp  = b.responsible != null ? clampStr(b.responsible) : undefined;

    let pid = toIntOrNull(b.project_id);
    const project_id = forCreate ? pid : (Number.isFinite(pid) ? pid : undefined);

    const patch = {};
    if (op) patch.operationType = op;
    if (date !== undefined) patch.date = date;
    if (Number.isFinite(total)) patch.total = total;
    if (resp !== undefined) patch.responsible = resp;
    if (note !== undefined) patch.note = note;
    if (project_id !== undefined) patch.project_id = project_id;

    const cols = await getTxCols();
    if (cols.has('remainder')) {
      const rv = Number(b.remainder);
      const remainder = Number.isFinite(rv) ? rv : (Number.isFinite(total) ? total : undefined);
      if (forCreate || b.remainder !== undefined || Number.isFinite(total)) patch.remainder = remainder ?? 0;
    }

    if (forCreate) {
      if (!op) return { error: 'operationType must be "Доход" or "Расход"' };
      if (!Number.isFinite(total)) return { error: 'total must be a number' };
      if (!isNonEmptyStr(patch.responsible || '')) return { error: 'responsible is required' };
      if (!Number.isFinite(pid)) return { error: 'project_id is required' };
    }

    return { patch };
  }

  app.post('/api/transactions', authRequired(true), adminOnly, async (req, res) => {
    try {
      const { patch, error } = await normalizeTxInput(req.body, { forCreate: true });
      if (error) return respondError(res, 400, error);

      const cols = await getTxCols();
      const fields = [];
      const values = [];
      const put = (k, v) => { if (cols.has(k)) { fields.push(k); values.push(v); } };

      put('responsible',  patch.responsible ?? '');
      put('date',         patch.date ?? '');
      put('total',        Number(patch.total) || 0);
      put('operationType',patch.operationType);
      if (cols.has('note')) put('note', patch.note ?? '');
      put('project_id',   patch.project_id);
      if (cols.has('remainder')) put('remainder', Number(patch.remainder) || 0);

      if (!fields.length) return respondError(res, 500, 'Server schema mismatch for transactions');

      const placeholders = fields.map(() => '?').join(',');
      const r = await dbAsync.run(`INSERT INTO transactions (${fields.join(',')}) VALUES (${placeholders})`, values);
      const row = await dbAsync.get(`SELECT * FROM transactions WHERE id = ?`, [r.lastID]);
      respond(res, row, 201);
    } catch (e) { safeSqlError(res, e); }
  });

  app.put('/api/transactions/:id', authRequired(true), adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return respondError(res, 400, 'Invalid id');

      const { patch, error } = await normalizeTxInput(req.body, { forCreate: false });
      if (error) return respondError(res, 400, error);

      const cols = await getTxCols();
      const keys = Object.keys(patch).filter(k => cols.has(k));
      if (!keys.length) return respondError(res, 400, 'No fields to update');

      const setParts = keys.map(k => `${k} = ?`);
      const params = keys.map(k => patch[k]);

      const r = await dbAsync.run(`UPDATE transactions SET ${setParts.join(', ')} WHERE id = ?`, [...params, id]);
      if (!r.changes) return respondError(res, 404, 'Nothing updated');

      const row = await dbAsync.get(`SELECT * FROM transactions WHERE id = ?`, [id]);
      respond(res, row);
    } catch (e) { safeSqlError(res, e); }
  });

  app.delete('/api/transactions/:id', authRequired(true), adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return respondError(res, 400, 'Invalid id');
      const r = await dbAsync.run(`DELETE FROM transactions WHERE id = ?`, [id]);
      respond(res, { deleted: r.changes > 0 });
    } catch (e) { safeSqlError(res, e); }
  });

  /* -------------------------------- Dashboard ----------------------------- */
  app.get('/api/dashboard', authRequired(true), async (req, res) => {
    try {
      const isAdmin = req.user.role === 'admin';
      const q = req.query || {};
      const start = q.start ? clampStr(q.start) : null;
      const end   = q.end   ? clampStr(q.end)   : null;

      let userIds = [];
      if (q.users) {
        userIds = String(q.users).split(',').map(s => s.trim()).filter(Boolean)
          .map(Number).filter(n => Number.isFinite(n));
      }

      let allowedLogins = null;
      if (userIds.length) {
        const placeholders = userIds.map(() => '?').join(',');
        const rows = await dbAsync.all(`SELECT id, login FROM users WHERE id IN (${placeholders})`, userIds);
        allowedLogins = rows.map(r => r.login);
      }

      const projectNames = parseList(q.projects, 200);

      let whereFact = ' WHERE t.date <> "" ';
      const paramsFact = [];
      if (!isAdmin) { whereFact += ' AND t.responsible = ? '; paramsFact.push(req.user.login); }
      if (allowedLogins && allowedLogins.length) {
        whereFact += ` AND t.responsible IN (${allowedLogins.map(()=>'?').join(',')}) `;
        paramsFact.push(...allowedLogins);
      }
      if (start) { whereFact += ' AND t.date >= ? '; paramsFact.push(start); }
      if (end)   { whereFact += ' AND t.date <= ? '; paramsFact.push(end); }
      if (projectNames.length) {
        whereFact += ` AND p.project IN (${projectNames.map(()=>'?').join(',')}) `;
        paramsFact.push(...projectNames);
      }
      const factRows = await dbAsync.all(`
        SELECT t.*, p.contractor AS contractor, p.project AS project, p.section AS section
          FROM transactions t
          LEFT JOIN projects p ON p.id = t.project_id
          ${whereFact}
          ORDER BY t.date ASC, t.id ASC
      `, paramsFact);

      let wherePlan = ' WHERE t.date = "" ';
      const paramsPlan = [];
      if (!isAdmin) { wherePlan += ' AND t.responsible = ? '; paramsPlan.push(req.user.login); }
      if (allowedLogins && allowedLogins.length) {
        wherePlan += ` AND t.responsible IN (${allowedLogins.map(()=>'?').join(',')}) `;
        paramsPlan.push(...allowedLogins);
      }
      if (projectNames.length) {
        wherePlan += ` AND p.project IN (${projectNames.map(()=>'?').join(',')}) `;
        paramsPlan.push(...projectNames);
      }
      const planRows = await dbAsync.all(`
        SELECT t.*, p.contractor AS contractor, p.project AS project
          FROM transactions t
          LEFT JOIN projects p ON p.id = t.project_id
          ${wherePlan}
      `, paramsPlan);

      const sumBy = (rows, op) => rows.filter(r => r.operationType === op).reduce((s, r) => s + (Number(r.total)||0), 0);
      const planIncome  = sumBy(planRows, 'Доход');
      const planExpense = sumBy(planRows, 'Расход');
      const factIncome  = sumBy(factRows, 'Доход');
      const factExpense = sumBy(factRows, 'Расход');

      const kpi = {
        plan:  { income: planIncome,  expense: planExpense,  profit: planIncome - planExpense,  profitability: planIncome > 0 ? ((planIncome - planExpense)/planIncome)*100 : 0 },
        fact:  { income: factIncome,  expense: factExpense,  profit: factIncome - factExpense,  profitability: factIncome > 0 ? ((factIncome - factExpense)/factIncome)*100 : 0 },
        total: { income: factIncome,  expense: factExpense,  profit: factIncome - factExpense,  profitability: factIncome > 0 ? ((factIncome - factExpense)/factIncome)*100 : 0 },
      };

      // агрегирование по датам + сохранение последних (ненулевых) project/section/note за день
      const byDate = new Map();
      for (const r of factRows) {
        const d = String(r.date);
        const m = byDate.get(d) || { incomeFact: 0, expenseFact: 0, project: null, section: null, note: null };
        if (r.operationType === 'Доход') m.incomeFact += Number(r.total)||0;
        else m.expenseFact += Number(r.total)||0;

        if (isNonEmptyStr(r.project)) m.project = r.project;
        if (isNonEmptyStr(r.section)) m.section = r.section;
        if (isNonEmptyStr(r.note))    m.note    = r.note;

        byDate.set(d, m);
      }

      const dates = Array.from(byDate.keys()).sort();
      const lineData = [];
      let incCum = 0, expCum = 0;
      for (const d of dates) {
        const m = byDate.get(d);
        incCum += m.incomeFact;
        expCum += m.expenseFact;
        lineData.push({
          date: d,
          incomePlan: 0, expensePlan: 0, profitPlan: 0,
          incomeFact: m.incomeFact, expenseFact: m.expenseFact, profitFact: m.incomeFact - m.expenseFact,
          incomeTotal: incCum, expenseTotal: expCum, profitTotal: incCum - expCum,
          project: m.project, section: m.section, note: m.note
        });
      }

      const projParams = [];
      let projWhere = ' WHERE 1=1 ';
      if (req.user.role !== 'admin') { projWhere += ' AND p.user_id = ? '; projParams.push(req.user.userId); }
      const projRows = await dbAsync.all(
        `SELECT DISTINCT p.contractor, p.project FROM projects p ${projWhere}`, projParams
      );
      const contractorsMap = {};
      for (const r of projRows) {
        if (!contractorsMap[r.contractor]) contractorsMap[r.contractor] = [];
        if (r.project && !contractorsMap[r.contractor].includes(r.project))
          contractorsMap[r.contractor].push(r.project);
      }
      for (const k of Object.keys(contractorsMap)) contractorsMap[k].sort((a,b)=>a.localeCompare(b,'ru'));

      const agg = (rows, key, op) => {
        const map = new Map();
        for (const r of rows) {
          if (r.operationType !== op) continue;
          const name = clampStr(r[key] || '');
          map.set(name, (map.get(name)||0) + (Number(r.total)||0));
        }
        return Array.from(map.entries()).map(([name, value]) => ({ name, value }))
                    .sort((a,b)=>b.value-a.value).slice(0,10);
      };
      const topIncomeClients      = agg(factRows, 'contractor', 'Доход');
      const topExpenseContractors = agg(factRows, 'contractor', 'Расход');

      const byProject = new Map();
      for (const r of factRows) {
        const pName = clampStr(r.project || '');
        const item = byProject.get(pName) || { income: 0, expense: 0 };
        if (r.operationType === 'Доход') item.income += Number(r.total)||0;
        else item.expense += Number(r.total)||0;
        byProject.set(pName, item);
      }
      const profitByProject = Array.from(byProject.entries()).map(([name, v]) => ({
        name, profit: v.income - v.expense
      })).sort((a,b)=>b.profit-a.profit).slice(0,10);
      const profitabByProject = Array.from(byProject.entries()).map(([name, v]) => ({
        name, profitability: v.income > 0 ? Math.round(((v.income - v.expense)/v.income)*10000)/100 : 0
      })).sort((a,b)=>a.profitability-b.profitability).slice(0,10);

      let allUsers = [];
      if (isAdmin) {
        const usr = await dbAsync.all(`SELECT id FROM users ORDER BY id`);
        allUsers = usr.map(u => u.id);
      } else {
        allUsers = [req.user.userId];
      }

      // --- НАЧАЛО ИЗМЕНЕНИЙ ---
      let whereProj = ' WHERE 1=1 ';
      const paramsProj = [];
      if (!isAdmin) {
        whereProj += ' AND p.user_id = ? ';
        paramsProj.push(req.user.userId);
      }
      if (userIds.length > 0) {
        const placeholders = userIds.map(() => '?').join(',');
        whereProj += ` AND p.user_id IN (${placeholders}) `;
        paramsProj.push(...userIds);
      }
      if (projectNames.length > 0) {
        const placeholders = projectNames.map(() => '?').join(',');
        whereProj += ` AND p.project IN (${placeholders}) `;
        paramsProj.push(...projectNames);
      }

      const userSummary = await dbAsync.all(`
        SELECT
          u.id as userId,
          COALESCE(user_expenses.total_expense, 0) as income,
          COALESCE(user_contracts.total_contract_amount, 0) - COALESCE(user_expenses.total_expense, 0) as balance
        FROM users u
        LEFT JOIN (
          SELECT
            u_inner.id AS user_id,
            SUM(t.total) AS total_expense
          FROM transactions t
          JOIN users u_inner ON t.responsible = u_inner.login
          LEFT JOIN projects p ON p.id = t.project_id
          ${whereFact} AND t.operationType = 'Расход'
          GROUP BY u_inner.id
        ) AS user_expenses ON u.id = user_expenses.user_id
        LEFT JOIN (
          SELECT
            p.user_id,
            SUM(p.amount) AS total_contract_amount
          FROM projects p
          ${whereProj}
          GROUP BY p.user_id
        ) AS user_contracts ON u.id = user_contracts.user_id
        -- Фильтруем итоговый список, чтобы показывать только релевантных пользователей
        WHERE user_expenses.user_id IS NOT NULL OR user_contracts.user_id IS NOT NULL
        ORDER BY u.id
      `, [...paramsFact, ...paramsProj]);
      // --- КОНЕЦ ИЗМЕНЕНИЙ ---

      respond(res, {
        contractorsMap,
        allUsers,
        kpi,
        lineData,
        topIncomeClients,
        topExpenseContractors,
        profitByProject,
        profitabByProject,
        userSummary, // ДОБАВЛЕНО В ОТВЕТ
      });
    } catch (e) { safeSqlError(res, e); }
  });
}

module.exports = { registerRoutes };