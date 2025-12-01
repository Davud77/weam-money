// src/pages/LoginPage.tsx
import React from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useLocation, useNavigate, Location } from 'react-router-dom';
import { api, me } from '../lib/api';

type LocationState = { from?: Location } | null;

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState) || null;

  const [login, setLogin] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPass, setShowPass] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);

  // куда вернуться после логина
  const backTo = React.useMemo(() => state?.from?.pathname || '/dashboard', [state]);

  // Если уже авторизованы — сразу на дашборд (без авто-рефреша и редиректов на этой странице)
  React.useEffect(() => {
    let cancelled = false;
    me({ noAuthRetry: true, suppressRedirectOn401: true })
      .then((r) => {
        if (!cancelled && r?.user) {
          navigate('/dashboard', { replace: true });
        }
      })
      .catch(() => {/* игнорируем 401 на /login */});
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

      // Важно: на логине запрещаем авто-рефреш и любые редиректы из api()
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ login, password }),
        noAuthRetry: true,
        suppressRedirectOn401: true,
      });

      // Сервер выставил HttpOnly-куки — идём на нужную страницу
      navigate(backTo, { replace: true });
    } catch (err: any) {
      const msg =
        (err && typeof err.message === 'string' && err.message.trim()) ||
        'Не удалось авторизоваться';
      setErrMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box className="login-page">
      {/* Header (общий стиль) */}
      <Box className="header">
        <Typography variant="h6" className="title">
          Авторизация
        </Typography>
        <Box className="header-actions" />
      </Box>

      {/* Карточка логина */}
      <Box className="content content-login">
        <Box className="content-card login-card">
          {errMsg && (
            <Alert
              severity="error"
              className="login-alert"
              role="alert"
              aria-live="polite"
              onClose={() => setErrMsg(null)}
            >
              {errMsg}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <Stack spacing={2}>
              <TextField
                className="dark-input"
                label="Логин"
                variant="outlined"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
                fullWidth
                autoComplete="username"
                autoFocus
                disabled={submitting}
              />

              <TextField
                className="dark-input"
                label="Пароль"
                variant="outlined"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
                autoComplete="current-password"
                disabled={submitting}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        className="icon-default"
                        aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'}
                        onClick={() => setShowPass((v) => !v)}
                        edge="end"
                        size="small"
                        tabIndex={-1}
                      >
                        {showPass ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                className="bluebutton"
                variant="contained"
                type="submit"
                disabled={submitting}
                fullWidth
              >
                {submitting ? 'Входим…' : 'Войти'}
              </Button>
            </Stack>
          </form>
        </Box>
      </Box>
    </Box>
  );
};

export default LoginPage;
