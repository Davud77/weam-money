const express = require('express');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // JWT для токенов

const app = express();
const PORT = process.env.PORT || 4000;

// Секретный ключ для JWT (в реальном проекте держите в .env)
const SECRET_KEY = 'SUPER_SECRET_KEY';

// Путь к вашей SQLite базе
const dbPath = path.join(__dirname, 'database.sqlite');

// Подключаем промежуточные модули
app.use(express.json());
app.use(cors());

// Подключаемся к базе данных SQLite
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Ошибка при открытии базы данных:', err.message);
  } else {
    console.log('Подключено к базе данных SQLite.');

    // Создаем таблицы, если их ещё нет:
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contractor TEXT,
        project TEXT,
        section TEXT,
        responsible TEXT,
        date TEXT,
        total INTEGER,
        advance INTEGER,
        remainder INTEGER,
        operationType TEXT,
        note TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT,
        password TEXT,
        type TEXT,
        nickname TEXT
      )
    `);
  }
});

// ----------- Раздаём статические файлы React (папка build) -----------
app.use(express.static(path.join(__dirname, 'build')));

// ----------------------------------------
// Функции защиты
// ----------------------------------------
function authenticateToken(req, res, next) {
  // Проверяем заголовок Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  jwt.verify(token, SECRET_KEY, (err, userData) => {
    if (err) {
      return res.status(403).json({ error: 'Недействительный токен' });
    }
    // Раскладываем данные из токена в req.user
    req.user = userData; // { userId, role, login }
    next();
  });
}

// Проверка, что пользователь — админ
function checkAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ запрещён (нужна роль admin)' });
  }
  next();
}

// ----------------------------------------
// Эндпоинт для Логина
// ----------------------------------------
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  const sql = 'SELECT * FROM users WHERE login = ?';
  db.get(sql, [login], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка при запросе к БД' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    // Генерация JWT-токена (добавляем login)
    const payload = { userId: user.id, role: user.type, login: user.login };
    const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '1h' });

    res.json({ token });
  });
});

// ----------------------------------------
// API для Транзакций (защищенные маршруты)
// ----------------------------------------
app.get('/api/transactions', authenticateToken, (req, res) => {
  // Если админ – возвращаем все, если user – только свои
  if (req.user.role === 'admin') {
    const sql = 'SELECT * FROM transactions';
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    // Обычный пользователь
    const sql = 'SELECT * FROM transactions WHERE responsible = ?';
    db.all(sql, [req.user.login], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

app.post('/api/transactions', authenticateToken, (req, res) => {
  const { contractor, project, section, responsible, date, total, advance, operationType, note } = req.body;
  const remainder = total - advance;

  const sql = `
    INSERT INTO transactions
    (contractor, project, section, responsible, date, total, advance, remainder, operationType, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [contractor, project, section, responsible, date, total, advance, remainder, operationType, note];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put('/api/transactions/:id', authenticateToken, (req, res) => {
  const { contractor, project, section, responsible, date, total, advance, operationType, note } = req.body;
  const remainder = total - advance;

  const sql = `
    UPDATE transactions
    SET contractor = ?, project = ?, section = ?, responsible = ?, date = ?, total = ?, advance = ?, remainder = ?, operationType = ?, note = ?
    WHERE id = ?
  `;
  const params = [contractor, project, section, responsible, date, total, advance, remainder, operationType, note, req.params.id];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updatedID: req.params.id, changes: this.changes });
  });
});

app.delete('/api/transactions/:id', authenticateToken, (req, res) => {
  const sql = 'DELETE FROM transactions WHERE id = ?';
  db.run(sql, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deletedID: req.params.id, changes: this.changes });
  });
});



// ----------------------------------------
// Список пользователей для поля "Ответственный"
app.get('/api/responsible', authenticateToken, (req, res) => {
  if (req.user.role === 'admin') {
    // админ видит всех
    const sql = 'SELECT id, login, nickname FROM users';
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    // обычный пользователь видит только себя
    const sql = 'SELECT id, login, nickname FROM users WHERE login = ?';
    db.get(sql, [req.user.login], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.json([]);
      res.json([row]);
    });
  }
});

// ----------------------------------------
// API для Пользователей (админские)
app.get('/api/users', authenticateToken, checkAdmin, (req, res) => {
  const sql = 'SELECT id, login, type, nickname FROM users';
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/users', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { login, password, type, nickname } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `INSERT INTO users (login, password, type, nickname) VALUES (?, ?, ?, ?)`;
    const params = [login, hashedPassword, type, nickname];

    db.run(sql, params, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:id', authenticateToken, checkAdmin, (req, res) => {
  const { login, type, nickname } = req.body;
  const sql = `UPDATE users SET login = ?, type = ?, nickname = ? WHERE id = ?`;
  const params = [login, type, nickname, req.params.id];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updatedID: req.params.id, changes: this.changes });
  });
});

app.put('/api/users/:id/password', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'Пароль обязателен' });
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const sql = `UPDATE users SET password = ? WHERE id = ?`;
    db.run(sql, [hashedPassword, req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updatedID: req.params.id, changes: this.changes });
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// Fallback: если не найдено в /api/...,
//           отдаём index.html из build (React SPA)
// ----------------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
