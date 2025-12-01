// src/components/AppSidebar.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, Typography, Tooltip } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import DashboardIcon from '@mui/icons-material/Dashboard';
import TableChartIcon from '@mui/icons-material/TableChart';
import FolderIcon from '@mui/icons-material/Folder';
import PeopleIcon from '@mui/icons-material/People';
import TimelineIcon from '@mui/icons-material/Timeline';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import AccountCircle from '@mui/icons-material/AccountCircle';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { me } from '../lib/api';

type SidebarProps = {
  variant?: 'sidebar' | string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

type NavItem = {
  label: string;
  to: string;
  icon: React.ReactNode;
  isActive: (path: string) => boolean;
  onlyAdmin?: boolean;
};

const PRESS_HOLD_MS = 1000;

const AppSidebar: React.FC<SidebarProps> = ({ collapsed, onToggleCollapsed }) => {
  const location = useLocation();
  const navigate = useNavigate();

  // Роль пользователя для UX (доступ проверяет сервер на эндпоинтах)
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const isAdmin = meData?.user?.role === 'admin';

  const baseItems: NavItem[] = useMemo(
    () => [
      { label: 'Дашборд',     to: '/dashboard',  icon: <DashboardIcon />,   isActive: (p) => p === '/dashboard' },
      { label: 'Таблица',     to: '/table',      icon: <TableChartIcon />,  isActive: (p) => p === '/table' || p === '/transactions' },
      { label: 'Проекты',     to: '/projects',   icon: <FolderIcon />,      isActive: (p) => p.startsWith('/projects') },
      { label: 'План-график', to: '/gant',       icon: <TimelineIcon />,    isActive: (p) => p.startsWith('/gant') },
      { label: 'Доска',       to: '/board',      icon: <ViewKanbanIcon />,  isActive: (p) => p.startsWith('/board') },
      { label: 'Пользователи',to: '/users',      icon: <PeopleIcon />,      isActive: (p) => p.startsWith('/users'), onlyAdmin: true },
    ],
    []
  );

  const items = useMemo(
    () => baseItems.filter((it) => !it.onlyAdmin || isAdmin),
    [baseItems, isAdmin]
  );

  const go = (to: string) => () => navigate(to);

  // Press/hold эффект (визуал)
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (pressTimer.current) {
        window.clearTimeout(pressTimer.current);
        pressTimer.current = null;
      }
    };
  }, []);
  const handlePress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    setPressed(true);
    pressTimer.current = window.setTimeout(() => {
      setPressed(false);
      pressTimer.current = null;
    }, PRESS_HOLD_MS);
  };

  // Подсветка активного пункта (динамическое позиционирование)
  const rootRef = useRef<HTMLDivElement | null>(null);
  const navContainerRef = useRef<HTMLDivElement | null>(null);
  const [backdropTop, setBackdropTop] = useState<number | null>(null);
  const activeIndex = items.findIndex((it) => it.isActive(location.pathname));

  useEffect(() => {
    if (!rootRef.current || !navContainerRef.current || activeIndex < 0) {
      setBackdropTop(null);
      return;
    }
    const container = navContainerRef.current;
    const el = container.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    if (!el || !rootRef.current) {
      setBackdropTop(null);
      return;
    }
    const elRect = el.getBoundingClientRect();
    const rootRect = rootRef.current.getBoundingClientRect();
    const centerY = elRect.top - rootRect.top + elRect.height / 2;
    setBackdropTop(centerY);
  }, [activeIndex, collapsed, location.pathname]);

  return (
    <Box ref={rootRef} component="nav" className={`weam-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      {/* Glow backdrop — цвет/прозрачность через CSS-переменные */}
      {backdropTop !== null && (
        <Box
          className={`sidebar__glow ${pressed ? 'is-pressed' : 'is-base'}`}
          style={{ top: `calc(${backdropTop}px - 40px)` }} // только позиция динамически
        />
      )}

      {/* Brand */}
      <Box className="sidebar__brand" onClick={() => navigate('/dashboard')} title="На дашборд">
        <Typography variant="h6" className="sidebar__title">
          {collapsed ? 'WM' : 'WEAM'}
        </Typography>
      </Box>

      {/* Навигация */}
      <Box ref={navContainerRef} className="sidebar__nav">
        {items.map((it, idx) => {
          const active = idx === activeIndex;

          if (collapsed) {
            return (
              <Box key={it.to} data-idx={idx} sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                <Tooltip title={it.label} placement="right">
                  <IconButton
                    onClick={go(it.to)}
                    onMouseDown={handlePress}
                    data-idx={idx}
                    color="inherit"
                    className={`iconbtn--nav ${active ? 'is-active' : ''}`}
                    aria-label={it.label}
                  >
                    {it.icon}
                  </IconButton>
                </Tooltip>
              </Box>
            );
          }

          return (
            <Box key={it.to} data-idx={idx} sx={{ width: '100%' }}>
              <Button
                onClick={go(it.to)}
                onMouseDown={handlePress}
                startIcon={it.icon}
                data-idx={idx}
                className={`btn--nav ${active ? 'is-active' : ''}`}
              >
                {it.label}
              </Button>
            </Box>
          );
        })}
      </Box>

      {/* Нижняя секция */}
      <Box className="sidebar__section">
        {!collapsed ? (
          <>
            <Button onClick={() => navigate('/profile')} startIcon={<AccountCircle />} className="btn--ghost">
              Профиль
            </Button>
            <Button onClick={onToggleCollapsed} startIcon={<ChevronLeftIcon />} className="btn--ghost">
              Свернуть
            </Button>
          </>
        ) : (
          <Box className="section__compact">
            <Tooltip title="Профиль" placement="right">
              <IconButton
                onClick={() => navigate('/profile')}
                onMouseDown={handlePress}
                color="inherit"
                className="iconbtn--nav"
                aria-label="Профиль"
              >
                <AccountCircle />
              </IconButton>
            </Tooltip>
            <Tooltip title="Развернуть" placement="right">
              <IconButton
                onClick={onToggleCollapsed}
                onMouseDown={handlePress}
                color="inherit"
                className="iconbtn--nav"
                aria-label="Развернуть"
              >
                <ChevronRightIcon />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default AppSidebar;
