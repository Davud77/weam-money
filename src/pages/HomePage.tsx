// HomePage.tsx
import React, { useContext } from 'react';
import { Box, Typography, Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../ThemeContext';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { bgImage, themeMode } = useContext(ThemeContext);
  const textColor = themeMode === 'dark' ? '#fff' : '#fff';

  return (
    <Box
      sx={{
        backgroundImage: `url("${bgImage}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed', // делает фон неподвижным
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        color: textColor,
        textAlign: 'center',
        p: { xs: 2, sm: 4 },
      }}
    >
      <Typography
        variant="h2"
        sx={{
          mb: 4,
          fontWeight: 700,
          fontSize: { xs: '4rem', sm: '5rem', md: '7rem' },
        }}
      >
        WEAM
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} alignItems="center">
        <Button variant="text" onClick={() => navigate('/dashboard')} sx={{ color: textColor }}>
          Дашборд
        </Button>
        <Button variant="text" onClick={() => navigate('/table')} sx={{ color: textColor }}>
          Таблица
        </Button>
        <Button variant="text" onClick={() => navigate('/projects')} sx={{ color: textColor }}>
          Проекты
        </Button>
        <Button variant="text" onClick={() => navigate('/users')} sx={{ color: textColor }}>
          Пользователи
        </Button>
      </Stack>
    </Box>
  );
};

export default HomePage;
