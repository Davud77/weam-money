import React, { useState, useContext } from 'react';
import { Box, Button, TextField, Typography, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../ThemeContext';

const LoginPage: React.FC = () => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const { bgImage, themeMode } = useContext(ThemeContext);
  const isDark = themeMode === 'dark';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || 'Ошибка авторизации');
        return;
      }
      // Сохраняем токен
      localStorage.setItem('token', data.token);
      // Переходим на дашборд
      navigate('/dashboard');
    } catch (error) {
      console.error('Ошибка при логине:', error);
      alert('Не удалось выполнить вход');
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundImage: `url("${bgImage}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed', // делает фон неподвижным
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        p: 2,
      }}
    >
      <Box
        sx={{
          backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(4px)',
          borderRadius: 2,
          p: 4,
          width: 300,
        }}
      >
        <Typography
          variant="h5"
          sx={{ mb: 2, textAlign: 'center', color: isDark ? '#fff' : '#000' }}
        >
          Авторизация
        </Typography>
        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              label="Логин"
              variant="outlined"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
              InputLabelProps={{ style: { color: isDark ? '#fff' : undefined } }}
              inputProps={{ style: { color: isDark ? '#fff' : undefined } }}
            />
            <TextField
              label="Пароль"
              variant="outlined"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              InputLabelProps={{ style: { color: isDark ? '#fff' : undefined } }}
              inputProps={{ style: { color: isDark ? '#fff' : undefined } }}
            />
            <Button variant="contained" type="submit">
              Войти
            </Button>
          </Stack>
        </form>
      </Box>
    </Box>
  );
};

export default LoginPage;
