/* eslint-disable no-console */
'use strict';

const sqlite3 = require('sqlite3').verbose();
const { CONFIG } = require('./config');

let dbInstance = null;
let FLAGS = { hasTxRemainder: false };

/** Единственный экземпляр соединения с SQLite + базовые PRAGMA */
function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = new sqlite3.Database(CONFIG.DB_FILE, (err) => {
    if (err) {
      console.error('FATAL: Ошибка открытия SQLite:', err.message);
      process.exit(1);
    }
    console.log('SQLite connected:', CONFIG.DB_FILE);
  });

  // Консервативные настройки под веб-сервис
  dbInstance.serialize(() => {
    dbInstance.run(`PRAGMA foreign_keys = ON;`);
    dbInstance.run(`PRAGMA busy_timeout = 5000;`);
    dbInstance.run(`PRAGMA journal_mode = WAL;`);
    dbInstance.run(`PRAGMA synchronous = NORMAL;`);
    dbInstance.run(`PRAGMA cache_size = -16000;`);
  });

  return dbInstance;
}

function closeDb(cb) {
  if (!dbInstance) return cb?.();
  dbInstance.close(cb);
}

/** Обёртка для красивого лога по типичным ошибкам SQLite */
function logIfReadonly(e, op) {
  if (!e) return;
  if (String(e.message || '').includes('SQLITE_READONLY')) {
    console.error(`SQL error (${op}): SQLITE_READONLY — база недоступна на запись.`);
    console.error('Подсказка: проверь права на ./data и владельца (uid=1000). Пример:');
    console.error('  sudo chown -R 1000:1000 ./data && sudo chmod -R u+rwX,g+rwX ./data');
  }
}

/** Промис-обёртки над sqlite3 API */
const dbAsync = {
  all(sql, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) =>
      db.all(sql, params, (e, rows) => {
        logIfReadonly(e, 'all');
        return e ? reject(e) : resolve(rows);
      }),
    );
  },
  get(sql, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) =>
      db.get(sql, params, (e, row) => {
        logIfReadonly(e, 'get');
        return e ? reject(e) : resolve(row);
      }),
    );
  },
  run(sql, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) =>
      db.run(sql, params, function (e) {
        logIfReadonly(e, 'run');
        if (e) return reject(e);
        resolve({ lastID: this.lastID, changes: this.changes });
      }),
    );
  },
};

async function hasColumn(table, column) {
  const cols = await dbAsync.all(`PRAGMA table_info(${table})`);
  return cols.some((c) => String(c.name) === String(column));
}

/**
 * Проверяет, что схема БД соответствует ожиданиям фронта:
 *  - таблицы: users, projects, transactions
 *  - users:     id, login, password_hash, role, nickname
 *  - projects:  id, contractor, project, section, direction, amount, note, start, end, status, progress, user_id, name, grouping
 *  - transactions: id, responsible, date, total, operationType, note, project_id
 *    (поле remainder может присутствовать — флагируем, но не требуем)
 */
async function ensureSchema() {
  try {
    const tables = await dbAsync.all(`SELECT name FROM sqlite_master WHERE type='table'`);
    const names = new Set((tables || []).map((t) => t.name));

    for (const n of ['users', 'projects', 'transactions']) {
      if (!names.has(n)) {
        console.error(`FATAL: Таблица "${n}" отсутствует.`);
        process.exit(1);
      }
    }

    const getCols = async (t) => (await dbAsync.all(`PRAGMA table_info(${t})`)).map((c) => c.name);

    // users
    {
      const must = ['id', 'login', 'password_hash', 'role', 'nickname'];
      const cols = new Set(await getCols('users'));
      for (const c of must) {
        if (!cols.has(c)) {
          console.error(`FATAL: В "users" нет колонки "${c}".`);
          process.exit(1);
        }
      }
    }

    // projects
    {
      const must = [
        'id',
        'contractor',
        'project',
        'section',
        'direction',
        'grouping', // <-- ДОБАВЛЕНО
        'amount',
        'note',
        'end',
        'status',
        'progress',
        'start',
        'user_id',
        'name',
      ];
      const cols = new Set(await getCols('projects'));
      for (const c of must) {
        if (!cols.has(c)) {
          console.error(`FATAL: В "projects" нет колонки "${c}".`);
          process.exit(1);
        }
      }
    }

    // transactions
    {
      const must = ['id', 'responsible', 'date', 'total', 'operationType', 'note', 'project_id'];
      const cols = new Set(await getCols('transactions'));
      for (const c of must) {
        if (!cols.has(c)) {
          console.error(`FATAL: В "transactions" нет колонки "${c}".`);
          process.exit(1);
        }
      }
      FLAGS.hasTxRemainder = cols.has('remainder');
    }

    console.log(
      `Schema OK. transactions.remainder: ${FLAGS.hasTxRemainder ? 'present' : 'absent'}`,
    );
  } catch (e) {
    console.error('FATAL: Ошибка проверки схемы БД:', e.message);
    process.exit(1);
  }
}

function hasTxRemainder() {
  return !!FLAGS.hasTxRemainder;
}

module.exports = { getDb, closeDb, dbAsync, ensureSchema, hasColumn, hasTxRemainder };