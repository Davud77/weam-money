import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Button,
  useMediaQuery,
  useTheme
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TableChartIcon from '@mui/icons-material/TableChart';
import FolderIcon from '@mui/icons-material/Folder';
import PeopleIcon from '@mui/icons-material/People';
import AccountCircle from '@mui/icons-material/AccountCircle';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Скрываем Header на главной странице
  if (location.pathname === '/') {
    return null;
  }

  const navigationItems = [
    { label: 'Дашборд', path: '/dashboard', icon: <DashboardIcon /> },
    { label: 'Таблица', path: '/table', icon: <TableChartIcon /> },
    { label: 'Проекты', path: '/projects', icon: <FolderIcon /> },
    { label: 'Пользователи', path: '/users', icon: <PeopleIcon /> },
  ];

  return (
    <AppBar
      position="fixed"
      sx={{ backgroundColor: '#2c2c2c', boxShadow: 'none', zIndex: 1500 }}
    >
      <Toolbar sx={{ minHeight: '48px' }}>
        <Typography
          variant="h6"
          sx={{ flexGrow: 1, cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          WEAM Деньги
        </Typography>
        {isMobile ? (
          <>
            {navigationItems.map((item) => (
              <IconButton
                key={item.path}
                color="inherit"
                onClick={() => navigate(item.path)}
              >
                {item.icon}
              </IconButton>
            ))}
          </>
        ) : (
          <>
            {navigationItems.map((item) => (
              <Button
                key={item.path}
                variant="text"
                onClick={() => navigate(item.path)}
                sx={{ color: '#fff' }}
              >
                {item.label}
              </Button>
            ))}
          </>
        )}
        {/* При клике на AccountCircle переходим в профиль */}
        <IconButton color="inherit" onClick={() => navigate('/profile')}>
          <AccountCircle />
        </IconButton>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
