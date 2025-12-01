# WEAM Money — Projects & Finance Dashboard (API + SPA)

Полноценное приложение для учёта проектов и финансов **WEAM**: сервер на **Node.js/Express + SQLite** и SPA на **React + TypeScript**. Авторизация через **JWT в HttpOnly‑cookie**, CORS по allow‑list, безопасность через Helmet (CSP/HSTS), HPP, rate‑limit и `Cache-Control: no-store` для API. Репозиторий ориентирован на промышленную эксплуатацию (Docker, healthcheck, graceful shutdown).

> Вся прикладная логика вынесена на сервер. Все цвета и базовые стили вынесены в `src/index.css` и используются **только** через CSS‑переменные из разрешённой палитры.

---

## Содержание

- [Архитектура и стек](#архитектура-и-стек)
- [Структура проекта](#структура-проекта)
- [Дизайн-система (index.css)](#дизайн-система-indexcss)
- [База данных (схема)](#база-данных-схема)
- [Конфигурация (ENV)](#конфигурация-env)
- [API — краткий обзор](#api--краткий-обзор)
- [Фронтенд — маршруты](#фронтенд--маршруты)
- [Требования](#требования)
- [Быстрый старт](#быстрый-старт)
  - [Docker Compose](#docker-compose)
  - [Synology DSM](#synology-dsm)
- [Операции с БД: резервные копии и восстановление](#операции-с-бд-резервные-копии-и-восстановление)
- [Безопасность: чек‑лист](#безопасность-чеклист)
- [Отладка и частые вопросы](#отладка-и-частые-вопросы)

---

## Архитектура и стек

**Backend**
- Node.js + Express.
- SQLite (файл в каталоге `./data`).
- Аутентификация: JWT в HttpOnly‑cookie (`access` / `refresh`).
- Защита: Helmet (CSP/HSTS), CORS (allow‑list + `credentials`), HPP, compression, morgan, rate‑limit, `Cache-Control: no-store`.
- Раздача SPA статики из `public`/`build` + fallback на `index.html`.
- Health endpoint `/api/health` для Docker и мониторинга.

**Frontend**
- React + TypeScript.
- React Router (маршрутизация).
- Вся тема/цвета — **только из `src/index.css`** через CSS‑переменные.

**Сборка/доставка**
- `Dockerfile` + `docker-compose.yml` (непривилегированный пользователь, отдельный том `./data` для БД, healthcheck).

---

## Структура проекта

```
.
├─ data/                          # Файлы SQLite (WAL/SHM появятся при включённом WAL)
│  ├─ database.sqlite
│  ├─ database.sqlite-wal
│  └─ database.sqlite-shm
├─ public/                        # Публичные статические файлы SPA
│  ├─ index.html
│  ├─ favicon.ico, logo*.png, manifest.json, robots.txt, back.jpg
├─ server/
│  ├─ middleware/auth.js          # Подпись/проверка JWT, установка/сброс cookie
│  ├─ utils/index.js              # Утилиты (cookie/JWT, ответы, парсеры)
│  ├─ app.js                      # Конвейер Express: helmet, cors, hpp, limits, статика
│  ├─ config.js                   # Чтение/валидация ENV, лимиты, cookie-политики
│  ├─ db.js                       # Инициализация SQLite, ensure-schema, хелперы
│  ├─ routes.js                   # Все REST-эндпоинты
│  └─ server.js                   # Bootstrap, health, graceful shutdown
├─ src/                           # Клиент (SPA)
│  ├─ components/AppSidebar.tsx
│  ├─ lib/api.ts                  # Клиент для обращения к серверу
│  ├─ lib/format.ts               # Форматирование чисел/дат
│  ├─ pages/                      # Страницы
│  │  ├─ BoardPage.tsx
│  │  ├─ DashboardPage.tsx
│  │  ├─ GantPage.tsx
│  │  ├─ LoginPage.tsx
│  │  ├─ MyProfilePage.tsx
│  │  ├─ ProjectDetailPage.tsx
│  │  ├─ ProjectsPage.tsx
│  │  ├─ TransactionsPage.tsx
│  │  └─ UsersPage.tsx
│  ├─ routes/AppRouter.tsx        # Маршрутизация SPA
│  ├─ index.css                   # Дизайн‑система (палитра и базовые стили)
│  └─ index.tsx                   # Точка входа SPA
├─ docker-compose.yml
├─ Dockerfile
├─ package.json
└─ README.md
```

---

## Дизайн-система (`index.css`)

Единая палитра и базовые стили объявлены в `:root` и используются **только** через переменные:

```css
:root {
  /* backgrounds */
  --page-bg:    #0b0f12;
  --sidebar-bg: #0f151a;
  --card-bg:    #121a21;

  /* text */
  --text:       #e6edf3;
  --text-soft:  #9fb0bf;

  /* brand / states */
  --primary:    #20a0ff;
  --success:    #29c17e;
  --warning:    #f0b429;
  --danger:     #ef5350;
}

body { background: var(--page-bg); color: var(--text); }
a { color: var(--primary); }
```

> **Правило:** никаких «жёстко» прописанных цветов в JSX/TSX — только переменные.

---

## База данных (схема)

Приложение **валидирует наличие таблиц и колонок на старте**. База состоит из **трёх таблиц**: `users`, `projects`, `transactions`.

### Таблица `users`

| поле            | тип     | примечание                  |
|-----------------|---------|-----------------------------|
| `id`            | INTEGER | PK, автоинкремент           |
| `login`         | TEXT    | уникальный логин            |
| `password_hash` | TEXT    | bcrypt‑хэш                  |
| `role`          | TEXT    | `admin` \\| `user`          |
| `nickname`      | TEXT    | отображаемое имя            |

**Индексы/ограничения**
- `UNIQUE(login)`

### Таблица `projects`

| поле         | тип     | примечание                                         |
|--------------|---------|----------------------------------------------------|
| `id`         | INTEGER | PK                                                 |
| `contractor` | TEXT    | организация (контрагент)                           |
| `project`    | TEXT    | название проекта                                   |
| `section`    | TEXT    | раздел (строка; формирует задачи/группы)          |
| `direction`  | TEXT    | произвольный признак (напр. направление работ)     |
| `amount`     | REAL    | сумма по разделу                                   |
| `note`       | TEXT    | заметки                                            |
| `start`      | TEXT    | дата начала `YYYY-MM-DD`                           |
| `end`        | TEXT    | дата завершения `YYYY-MM-DD`                       |
| `status`     | TEXT    | статус                                             |
| `progress`   | INTEGER | 0…100                                              |
| `user_id`    | INTEGER | ответственный (FK на `users.id`)                   |

**Рекомендованные индексы**
- `INDEX projects_project` (`project`)
- `INDEX projects_user_id` (`user_id`)

### Таблица `transactions`

| поле            | тип     | примечание                                                                 |
|-----------------|---------|----------------------------------------------------------------------------|
| `id`            | INTEGER | PK                                                                         |
| `contractor`    | TEXT    | денормализация из проекта (автозаполняется по `project_id`)                |
| `project`       | TEXT    | денормализация из проекта                                                  |
| `section`       | TEXT    | секция/раздел                                                              |
| `responsible`   | TEXT    | аккаунт/логин ответственного                                               |
| `date`          | TEXT    | `''` — **план**, непустая дата — **факт**                                  |
| `total`         | REAL    | сумма                                                                      |
| `operationType` | TEXT    | `Доход` \\| `Расход`                                                        |
| `note`          | TEXT    | комментарий                                                                |
| `project_id`    | INTEGER | FK на `projects.id`                                                        |
| `remainder`¹    | REAL    | (опционально) остаток — поле используется, если колонка существует в БД    |

¹ Наличие `remainder` определяется динамически при старте (если нет — приложение работает без него).

**Рекомендованные индексы**
- `INDEX transactions_project_id` (`project_id`)
- `INDEX transactions_date` (`date`)
- `INDEX transactions_operationType` (`operationType`)

#### DDL (пример для чистой БД)

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  nickname TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor TEXT,
  project TEXT,
  section TEXT,
  direction TEXT,
  amount REAL,
  note TEXT,
  start TEXT,
  end TEXT,
  status TEXT,
  progress INTEGER DEFAULT 0,
  user_id INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor TEXT,
  project TEXT,
  section TEXT,
  responsible TEXT,
  date TEXT,
  total REAL,
  operationType TEXT,
  note TEXT,
  project_id INTEGER,
  remainder REAL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

> **WAL‑режим:** при включенном Write‑Ahead Logging рядом с `database.sqlite` появляются файлы `*.sqlite-wal` и `*.sqlite-shm` — это нормально и повышает надёжность/скорость записи.

---

## Конфигурация (ENV)

| Переменная | Назначение |
|---|---|
| `PORT` | Порт HTTP (по умолчанию `4000`) |
| `JWT_SECRET` | Секрет подписи JWT (минимум 32 символа) |
| `ACCESS_TOKEN_TTL` | TTL access‑токена (например, `15m`) |
| `REFRESH_TOKEN_TTL` | TTL refresh‑токена (например, `7d`) |
| `ACCESS_COOKIE_NAME` | Имя cookie для access‑токена (`access_token`) |
| `REFRESH_COOKIE_NAME` | Имя cookie для refresh‑токена (`refresh_token`) |
| `COOKIE_SECURE` | `1` — ставить `Secure` на cookie (в проде включайте) |
| `COOKIE_SAMESITE` | `Lax`/`None`/`Strict` (по умолчанию `Lax`) |
| `COOKIE_DOMAIN` | Домен cookie (опционально) |
| `CLIENT_ORIGINS` | Разрешённые CORS‑origin'ы через запятую |
| `ENABLE_HSTS` | `1` — включить HSTS (если приложение за HTTPS‑прокси) |
| `CSP_UPGRADE_INSECURE` | `1` — включить `upgrade-insecure-requests` |
| `DATABASE_FILE` | Путь к SQLite (`./data/database.sqlite`) |
| `BODY_LIMIT` | Лимит тела запроса (`1mb` по умолчанию) |
| `LIMIT_API_WINDOW_MS` / `LIMIT_API_MAX` | Окно/лимит rate‑limit для API |
| `LIMIT_LOGIN_MAX` | Отдельный limit для `/api/login` |

**.env.example**

```env
NODE_ENV=development
PORT=4000
JWT_SECRET=put_a_long_random_secret_here_at_least_32_chars
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
ACCESS_COOKIE_NAME=access_token
REFRESH_COOKIE_NAME=refresh_token
COOKIE_SECURE=0
COOKIE_SAMESITE=Lax
CLIENT_ORIGINS=http://localhost:5173,http://localhost:3000
ENABLE_HSTS=0
CSP_UPGRADE_INSECURE=0
DATABASE_FILE=./data/database.sqlite
```

---

## API — краткий обзор

Базовый префикс: `/api/*`

**Auth/Service**
- `POST /api/login` — вход, на успех выставляет HttpOnly‑cookie.
- `POST /api/refresh` — обновление токенов.
- `POST /api/logout` — сброс cookie.
- `GET  /api/me` — профиль текущего пользователя.
- `GET  /api/health` — health‑probe.

**Users** (только `admin`)
- `GET    /api/users`
- `POST   /api/users` (`login`, `password`, `role`, `nickname`)
- `PUT    /api/users/:id`
- `PUT    /api/users/:id/password`

**Projects**
- `GET    /api/projects` — фильтры: `q`, `responsible`, `status`, пагинация `limit/offset`, `sort`.
- `GET    /api/projects/:name` — карточка проекта.

**Transactions**
- `GET    /api/transactions` — фильтры: `q`, `project`, `responsible`, `from`, `to`, `type`, пагинация/сортировка.

Все ответы API имеют `Cache-Control: no-store` и защищены CORS (allow‑list + `credentials`).

---

## Фронтенд — маршруты

- `/login` — вход
- `/dashboard` — дашборд
- `/transactions` — транзакции
- `/projects` — проекты
- `/projects/:name` — карточка проекта
- `/gant` — диаграмма Гантта
- `/board` — канбан‑доска
- `/users` — пользователи (админ)
- `/me` — мой профиль

Боковая навигация (`AppSidebar`) подхватывает `GET /api/me` для состояния UI.

---

## Требования

- Node.js **>= 18** (локальная разработка без Docker).
- Docker **>= 24** и docker‑compose.
- Современный браузер (ES2017+).

---

## Быстрый старт

### Docker Compose

1) Создайте `.env` рядом с `docker-compose.yml` (можно взять из примера выше).  
2) Запустите:

```bash
docker compose up -d --build
```

Откройте: `http://localhost:4000/`  
База создастся автоматически в `./data/database.sqlite` (том или папка).

### Synology DSM

- Создайте общую папку (например, `docker/weam-money/data`) и смонтируйте её в контейнер как `./data`.
- Через **Container Manager** импортируйте `docker-compose.yml` и `.env` (либо Portainer/CLI).
- Для внешнего домена используйте **Reverse Proxy** DSM и TLS‑сертификат. В `.env` установите:
  - `COOKIE_SECURE=1`, `ENABLE_HSTS=1`
  - добавьте домен в `CLIENT_ORIGINS`
- В локальной сети без публичного TLS оставьте `NODE_ENV=development`, `COOKIE_SECURE=0`.

---

Краткий итог в виде таблицы
Элемент / Действие	Правильное название
Весь компонент	Диаграмма Ганта (Gantt Chart)
Левая таблица	Сетка / Таблица задач (Grid)
Правая диаграмма	Временная шкала (Timeline)
Родительская строка	Суммарная задача (Summary Task)
Дочерняя строка	Задача (Task)
Горизонтальная полоса на диаграмме	Планка задачи (Task Bar)
Фон с датами	Шкала времени (Timescale)
Перемещение планки	Перетаскивание / Перепланирование (Dragging/Rescheduling)
Растягивание планки	Изменение размера / Длительности (Resizing)
Номер в иерархии (1, 1.1)	WBS (Work Breakdown Structure)