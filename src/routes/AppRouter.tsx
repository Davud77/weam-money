import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Header from '../components/Header';

// Ваши страницы
const HomePage = React.lazy(() => import('../pages/HomePage'));
const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
const TransactionsPage = React.lazy(() => import('../pages/TransactionsPage'));
const UsersPage = React.lazy(() => import('../pages/UsersPage'));
const ProjectsPage = React.lazy(() => import('../pages/ProjectsPage'));
const LoginPage = React.lazy(() => import('../pages/LoginPage'));

// Новая страница
const MyProfilePage = React.lazy(() => import('../pages/MyProfilePage'));

type AppRouterProps = {
  showError: (msg: string) => void;
};

const AppRouter: React.FC<AppRouterProps> = ({ showError }) => {
  return (
    <>
      <Header />
      <Suspense fallback={<div style={{ minHeight: '100vh' }}>Загрузка...</div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<DashboardPage showError={showError} />} />
          <Route path="/table" element={<TransactionsPage showError={showError} />} />
          <Route path="/users" element={<UsersPage showError={showError} />} />
          <Route path="/projects" element={<ProjectsPage showError={showError} />} />

          {/* Наш новый маршрут */}
          <Route path="/profile" element={<MyProfilePage  />} />

          <Route path="*" element={<div>Страница не найдена</div>} />
        </Routes>
      </Suspense>
    </>
  );
};

export default AppRouter;
