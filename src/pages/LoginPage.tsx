import React, { useEffect, useState, useMemo } from 'react';
import { useLocation, useNavigate, Location } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, LogIn } from 'lucide-react';
import { api, me } from '../lib/api';

type LocationState = { from?: Location } | null;

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState) || null;

  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Куда вернуться после логина
  const backTo = useMemo(() => state?.from?.pathname || '/dashboard', [state]);

  // Проверка авторизации при загрузке
  useEffect(() => {
    let cancelled = false;
    me({ noAuthRetry: true, suppressRedirectOn401: true })
      .then((r) => {
        if (!cancelled && r?.user) {
          navigate('/dashboard', { replace: true });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);

    if (!login.trim() || !password.trim()) {
      setErrMsg('Введите логин и пароль');
      return;
    }

    try {
      setSubmitting(true);
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ login, password }),
        noAuthRetry: true,
        suppressRedirectOn401: true,
      });
      navigate(backTo, { replace: true });
    } catch (err: any) {
      const msg = (err && typeof err.message === 'string' && err.message.trim()) || 'Не удалось авторизоваться';
      setErrMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <div className="card login-card">
        {/* Заголовок */}
        <div className="text-center mb-6">
          <div className="login-logo">
            <LogIn size={32} />
          </div>
          <h2 className="text-xl font-bold mt-4">Вход в систему</h2>
          <div className="text-soft text-sm mt-1">Введите свои учетные данные</div>
        </div>

        {/* Ошибка */}
        {errMsg && (
          <div className="alert alert-error mb-4">
            <AlertCircle size={20} />
            <span>{errMsg}</span>
          </div>
        )}

        {/* Форма */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label className="input-label">Логин</label>
            <input
              className="input"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="username"
              required
              autoFocus
              disabled={submitting}
              autoComplete="username"
            />
          </div>

          <div className="input-group">
            <label className="input-label">Пароль</label>
            <div className="relative">
              <input
                className="input pr-10" // pr-10 чтобы текст не заезжал под иконку
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={submitting}
                autoComplete="current-password"
                style={{ paddingRight: '40px' }}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPass(!showPass)}
                tabIndex={-1}
                title={showPass ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn w-full justify-center mt-2"
            disabled={submitting}
            style={{ height: '44px', fontSize: '1rem' }}
          >
            {submitting ? 'Входим...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;