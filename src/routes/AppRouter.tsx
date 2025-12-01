import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Header from '../components/AppSidebar';
import { me } from '../lib/api';

// ленивые страницы — лежат в src/pages/
const DashboardPage     = React.lazy(() => import('../pages/DashboardPage'));
const TransactionsPage  = React.lazy(() => import('../pages/TransactionsPage'));
const UsersPage         = React.lazy(() => import('../pages/UsersPage'));
const ProjectsPage      = React.lazy(() => import('../pages/ProjectsPage'));
const ProjectDetailPage = React.lazy(() => import('../pages/ProjectDetailPage'));
const GantPage          = React.lazy(() => import('../pages/GantPage'));
const BoardPage         = React.lazy(() => import('../pages/BoardPage'));
const LoginPage         = React.lazy(() => import('../pages/LoginPage'));
const MyProfilePage     = React.lazy(() => import('../pages/MyProfilePage'));

type Props = {
  /** Опциональный обработчик ошибок верхнего уровня (для Snackbar и т.п.) */
  showError?: (msg: string) => void;
};

/** Требует авторизацию, иначе редирект на /login */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'nope'>('checking');

  useEffect(() => {
    let cancelled = false;
    me().then(
      (r) => !cancelled && setStatus(r?.user ? 'ok' : 'nope'),
      ()   => !cancelled && setStatus('nope'),
    );
    return () => { cancelled = true; };
  }, []);

  if (status === 'checking') return <div style={{ padding: 16 }}>Проверка доступа…</div>;
  if (status === 'nope') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Если уже авторизован — переброс на /dashboard */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'authed' | 'guest'>('checking');

  useEffect(() => {
    let cancelled = false;
    // На странице логина нельзя крутить refresh/redirect при 401
    me({ noAuthRetry: true, suppressRedirectOn401: true }).then(
      (r) => !cancelled && setStatus(r?.user ? 'authed' : 'guest'),
      ()   => !cancelled && setStatus('guest'),
    );
    return () => { cancelled = true; };
  }, []);

  if (status === 'checking') return <div style={{ padding: 16 }}>Загрузка…</div>;
  if (status === 'authed')   return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const noop = () => {};

export default function AppRouter({ showError = noop }: Props) {
  const location = useLocation();

  // В LS храним только состояние сайдбара (это не секреты)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebarCollapsed') === '1'; }
    catch { return false; }
  });
  const sidebarWidth = useMemo(() => (collapsed ? 65 : 225), [collapsed]);

  const handleToggleSidebar = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebarCollapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const showHeader = location.pathname !== '/login';

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {showHeader && (
        <Header variant="sidebar" collapsed={collapsed} onToggleCollapsed={handleToggleSidebar} />
      )}

      <main
        style={{
          flex: 1,
          minWidth: 0,
          marginLeft: showHeader ? sidebarWidth : 0,
          transition: 'margin-left 200ms ease',
        }}
      >
        <Suspense fallback={<div style={{ padding: 16 }}>Загрузка страницы…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route
              path="/login"
              element={
                <RedirectIfAuthed>
                  <LoginPage />
                </RedirectIfAuthed>
              }
            />

            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <DashboardPage showError={showError} />
                </RequireAuth>
              }
            />

            <Route
              path="/table"
              element={
                <RequireAuth>
                  <TransactionsPage showError={showError} />
                </RequireAuth>
              }
            />

            <Route
              path="/transactions"
              element={
                <RequireAuth>
                  <TransactionsPage showError={showError} />
                </RequireAuth>
              }
            />

            <Route
              path="/projects"
              element={
                <RequireAuth>
                  <ProjectsPage showError={showError} />
                </RequireAuth>
              }
            />

            <Route
              path="/projects/:name"
              element={
                <RequireAuth>
                  <ProjectDetailPage showError={showError} />
                </RequireAuth>
              }
            />

            <Route
              path="/users"
              element={
                <RequireAuth>
                  <UsersPage showError={showError} />
                </RequireAuth>
              }
            />

            <Route
              path="/board"
              element={
                <RequireAuth>
                  <BoardPage showError={showError} />
                </RequireAuth>
              }
            />

            {/* Новый канонический путь для план-графика */}
            <Route
              path="/gant"
              element={
                <RequireAuth>
                  <GantPage showError={showError} />
                </RequireAuth>
              }
            />
            {/* Легаси-алиас: /gant → /gant */}
            <Route path="/gant" element={<Navigate to="/gant" replace />} />

            {/* Новый канонический путь профиля */}
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <MyProfilePage />
                </RequireAuth>
              }
            />
            {/* Легаси-алиас: /me → /profile */}
            <Route path="/me" element={<Navigate to="/profile" replace />} />

            {/* 404 */}
            <Route path="*" element={<div style={{ padding: 16 }}>Страница не найдена</div>} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
