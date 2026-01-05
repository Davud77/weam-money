import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  LayoutDashboard, 
  Table2, 
  FolderOpen, 
  GanttChartSquare, 
  KanbanSquare, 
  Users, 
  UserCircle, 
  ChevronLeft, 
  ChevronRight 
} from 'lucide-react';

import { me } from '../lib/api';

type SidebarProps = {
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

  // Получаем роль пользователя
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const isAdmin = meData?.user?.role === 'admin';

  // Конфигурация меню (иконки заменены на Lucide)
  const baseItems: NavItem[] = useMemo(
    () => [
      { label: 'Дашборд',     to: '/dashboard',  icon: <LayoutDashboard size={20} />,   isActive: (p) => p === '/dashboard' },
      { label: 'Таблица',     to: '/table',      icon: <Table2 size={20} />,            isActive: (p) => p === '/table' || p === '/transactions' },
      { label: 'Проекты',     to: '/projects',   icon: <FolderOpen size={20} />,        isActive: (p) => p.startsWith('/projects') },
      { label: 'План-график', to: '/gant',       icon: <GanttChartSquare size={20} />,  isActive: (p) => p.startsWith('/gant') },
      { label: 'Доска',       to: '/board',      icon: <KanbanSquare size={20} />,      isActive: (p) => p.startsWith('/board') },
      { label: 'Пользователи',to: '/users',      icon: <Users size={20} />,             isActive: (p) => p.startsWith('/users'), onlyAdmin: true },
    ],
    []
  );

  const items = useMemo(
    () => baseItems.filter((it) => !it.onlyAdmin || isAdmin),
    [baseItems, isAdmin]
  );

  const go = (to: string) => () => navigate(to);

  // Эффект нажатия (Press/hold)
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pressTimer.current) {
        window.clearTimeout(pressTimer.current);
      }
    };
  }, []);

  const handlePress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    setPressed(true);
    pressTimer.current = window.setTimeout(() => {
      setPressed(false);
      pressTimer.current = null;
    }, PRESS_HOLD_MS);
  };

  // Логика "Светящегося фона" (Glow backdrop)
  const rootRef = useRef<HTMLElement | null>(null);
  const navContainerRef = useRef<HTMLDivElement | null>(null);
  const [backdropTop, setBackdropTop] = useState<number | null>(null);
  const activeIndex = items.findIndex((it) => it.isActive(location.pathname));

  useEffect(() => {
    if (!rootRef.current || !navContainerRef.current || activeIndex < 0) {
      setBackdropTop(null);
      return;
    }
    const container = navContainerRef.current;
    // Ищем кнопку по data-idx
    const el = container.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    
    if (!el) {
      setBackdropTop(null);
      return;
    }
    
    // Вычисляем позицию относительно контейнера навигации
    const elRect = el.getBoundingClientRect();
    const navRect = container.getBoundingClientRect();
    
    // Центр элемента относительно начала nav-блока
    const relativeTop = elRect.top - navRect.top;
    setBackdropTop(relativeTop);
    
  }, [activeIndex, collapsed, location.pathname]);

  return (
    <nav 
      ref={rootRef} 
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
    >
      {/* Brand Header */}
      <div 
        className="sidebar-header" 
        onClick={() => navigate('/dashboard')} 
        title="На главную"
      >
        <div className="sidebar-logo">
          {collapsed ? 'WM' : 'WEAM'}
        </div>
      </div>

      {/* Navigation List */}
      <div className="sidebar-nav" ref={navContainerRef}>
        {/* Glow Element (задний фон активного элемента) */}
        {backdropTop !== null && (
          <div
            className={`sidebar-glow ${pressed ? 'pressed' : ''}`}
            style={{ 
              transform: `translateY(${backdropTop}px)`,
              height: '40px' // Высота кнопки навигации
            }}
          />
        )}

        {items.map((it, idx) => {
          const active = idx === activeIndex;
          return (
            <button
              key={it.to}
              data-idx={idx}
              onClick={go(it.to)}
              onMouseDown={handlePress}
              className={`nav-item ${active ? 'active' : ''}`}
              title={collapsed ? it.label : ''} // Нативный тултип при сворачивании
            >
              <span className="nav-icon">{it.icon}</span>
              {!collapsed && <span className="nav-label">{it.label}</span>}
            </button>
          );
        })}
      </div>

      {/* Footer Section */}
      <div className="sidebar-footer">
        <button 
          className="nav-item secondary"
          onClick={() => navigate('/me')}
          title="Профиль"
        >
          <span className="nav-icon"><UserCircle size={20} /></span>
          {!collapsed && <span className="nav-label">Профиль</span>}
        </button>
        
        <button 
          className="nav-item secondary"
          onClick={onToggleCollapsed}
          title={collapsed ? "Развернуть" : "Свернуть"}
        >
          <span className="nav-icon">
            {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </span>
          {!collapsed && <span className="nav-label">Свернуть</span>}
        </button>
      </div>
    </nav>
  );
};

export default AppSidebar;