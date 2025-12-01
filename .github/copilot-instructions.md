<!-- Copilot instructions for contributors and AI agents working on WEAM Money -->
# WEAM Money — Copilot quick guide

This repo is a Node.js/Express API with a React+TypeScript single-page app (SPA). The backend holds most business logic and the SQLite schema is authoritative. Use this file to guide automated edits.

Key entry points
- Backend: `server/server.js`, `server/app.js`, `server/routes.js`, `server/db.js`, `server/config.js`
- Frontend: `src/index.tsx`, `src/routes/AppRouter.tsx`, `src/lib/api.ts`, `src/pages/*`
- Dev and ops: `Dockerfile`, `docker-compose.yml`, `README.md`

Big-picture notes
- The server implements auth via JWT stored in HttpOnly cookies (`access_token`, `refresh_token`). See `server/middleware/auth.js` and `server/routes.js` for token lifecycles (`/api/login`, `/api/refresh`, `/api/logout`).
- The server validates DB schema on startup (`server/db.js`). Expected tables: `users`, `projects`, `transactions`. Adding/removing required columns must be coordinated with `ensureSchema` and client code that assumes fields like `remainder` may or may not exist.
- SPA talks to the API using `src/lib/api.ts`. It auto-refreshes the access cookie by calling `/api/refresh` and expects cookie-based credentials (fetch uses credentials: 'include').
- Colors and base styles are centralized in `src/index.css`. Avoid hard-coded colors in JSX — prefer CSS variables defined there.

Developer workflows and important commands
- Local dev (frontend): `npm start` runs CRA dev server (see `package.json`).
- Local dev (backend): run Node with environment variables (Node >=18). Prefer Docker Compose:
  - Create `.env` (see `README.md` for example), then: `docker compose up -d --build`
- Build for prod: run frontend build (CRA `npm run build`) then start server which serves `build/` statics. The server expects `build/index.html` to exist.

Patterns & conventions to preserve
- Authentication: do not return raw tokens in responses. Cookies are set in routes (see `routes.js` login flow). When adding endpoints that change auth, mirror existing cookie handling.
- DB defensive checks: the app expects `ensureSchema` to validate required columns. If adding columns, update `ensureSchema` and any places that use `PRAGMA table_info(...)` (e.g. `routes.js` `getTxCols`).
- Role-based access: use `auth.auth(true)` middleware to require auth and `auth.adminOnly` for admin-only routes. Use `auth.whereByRole(req, 'p.user_id', params)` in SQL queries to limit data for non-admins.
- Error responses: use `utils.respond(res, data)` for success and `utils.respondError(res, code, msg)` for errors to keep API shape consistent.

Examples from the codebase
- Refresh pattern: frontend `src/lib/api.ts` calls `/api/refresh` on 401 and retries the original request. Keep this flow when modifying auth TTLs or cookie names.
- Project slug/name: server auto-generates `projects.name` from `contractor`/`project` in `routes.js` when creating/updating projects — keep this logic if changing project creation.
- Transactions: `routes.js` uses a dynamic check for `transactions.remainder` column. If you add `remainder` handling, update `db.js` schema checks and `getTxCols()` usage.

Safe edit checklist for AI changes
1. If you change API shapes, update `README.md` and `src/lib/api.ts` where client expects fields.
2. If you modify DB schema, update `server/db.js` `ensureSchema` and any `PRAGMA table_info` readers (`routes.js` `getTxCols`).
3. Preserve cookie names and SameSite/secure policies; changes to `server/config.js` affect Docker/production behavior.
4. Run the server startup sequence locally (or via Docker Compose) to verify `ensureSchema` and that the SPA build is served.

Files to reference when making changes
- Auth: `server/middleware/auth.js`, `server/routes.js` (login/refresh/logout), `server/utils/index.js` (cookie helpers)
- DB: `server/db.js`, `server/routes.js` (queries), `server/config.js` (DB path)
- Frontend: `src/lib/api.ts`, `src/routes/AppRouter.tsx`, `src/index.css`

If unclear or risky
- Ask for clarification before changing security-related code (JWT secrets, cookie flags, CORS). These are enforced in `server/config.js`.
- For schema changes request a migration plan and update `README.md` migration notes.

Feedback
- If any of these sections are unclear or incomplete, leave a short note in the PR description and ask the repo maintainer which behavior to preserve.
