import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom'; // <--- Добавлен импорт
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis,
  Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import dayjs, { Dayjs } from 'dayjs';
import 'dayjs/locale/ru';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronDown, Check, X, Calendar as CalendarIcon, Users, LayoutGrid } from 'lucide-react';

import { api, me } from '../lib/api';
import { fmtMoney, fmtPercent } from '../lib/format';

/* ---------- Типы ---------- */
type PresetKey = 'currentMonth' | 'currentQuarter' | 'currentYear' | 'prevMonth' | 'prevQuarter' | 'prevYear' | 'allTime' | 'custom';

type DayEntry = {
  date: string;
  incomePlan: number; expensePlan: number; profitPlan: number;
  incomeFact: number; expenseFact: number; profitFact: number;
  incomeTotal: number; expenseTotal: number; profitTotal: number;
  project?: string | null; section?: string | null; note?: string | null;
};

type Kpi = { income: number; expense: number; profit: number; profitability: number };

type ExpenseContractorDatum = {
  name: string; value: number;
  project?: string | null; section?: string | null; description?: string | null;
};

type UserSummaryData = { userId: number; income: number; balance: number; name?: string };

type DashboardApiResponse = {
  contractorsMap: Record<string, string[]>;
  allUsers: number[];
  kpi: { plan: Kpi; fact: Kpi; total: Kpi };
  lineData: DayEntry[];
  topIncomeClients: { name: string; value: number }[];
  topExpenseContractors: ExpenseContractorDatum[];
  profitByProject: { name: string; profit: number }[];
  profitabByProject: { name: string; profitability: number }[];
  userSummary: UserSummaryData[];
};

type ResponsibleUser = { id: number; login: string; nickname?: string | null };

/* ---------- Хелперы дат ---------- */
const quarterBounds = (d: Dayjs) => {
  const qStartMonth = d.month() - (d.month() % 3);
  const start = dayjs(d).month(qStartMonth).startOf('month');
  const end = start.add(2, 'month').endOf('month');
  return { start, end };
};

const getPresetRange = (k: PresetKey): { start: Dayjs | null; end: Dayjs | null } => {
  const today = dayjs();
  switch (k) {
    case 'currentMonth':   return { start: today.startOf('month'), end: today.endOf('month') };
    case 'currentQuarter': return quarterBounds(today);
    case 'currentYear':    return { start: today.startOf('year'), end: today.endOf('year') };
    case 'prevMonth': {
      const prev = today.subtract(1, 'month');
      return { start: prev.startOf('month'), end: prev.endOf('month') };
    }
    case 'prevQuarter':    return quarterBounds(today.subtract(3, 'month'));
    case 'prevYear':       return { start: today.subtract(1, 'year').startOf('year'), end: today.subtract(1, 'year').endOf('year') };
    case 'allTime':        return { start: null, end: null };
    default:               return { start: null, end: null };
  }
};

const presetLabel: Record<PresetKey, string> = {
  currentMonth: 'Текущий месяц', currentQuarter: 'Текущий квартал', currentYear: 'Текущий год',
  prevMonth: 'Прошлый месяц', prevQuarter: 'Прошлый квартал', prevYear: 'Прошлый год',
  allTime: 'Все время', custom: 'Период',
};

/* ---------- Компоненты KPI и Тултипов ---------- */

const KpiCard: React.FC<{ title: string; value: number; unit?: string; data: number[]; subLines?: string[] }> = ({ title, value, unit = '₽', data, subLines }) => (
  <div className="card kpi-card block">
    <div className="kpi-header">
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">
        {(Number(value) || 0).toLocaleString('ru-RU')} <span className="text-soft text-sm">{unit}</span>
      </div>
    </div>
    
    <div className="kpi-sublines">
      {subLines?.map((l) => <div key={l} className="kpi-subl">{l}</div>)}
    </div>

    {data.length > 1 && (
      <div className="spark-container">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.map((y, i) => ({ x: i, y }))}>
            <defs>
              <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="y" stroke="var(--primary)" strokeWidth={2} fill="url(#sparkGradient)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}
  </div>
);

const CustomTooltip = ({ active, payload, label, mode = 'money' }: any) => {
  if (!active || !payload || !payload.length) return null;
  const val = Number(payload[0].value) || 0;
  
  // Особая логика для FundsTooltip
  if (payload[0].payload.incomeTotal !== undefined) {
    const p = payload[0].payload as DayEntry;
    return (
      <div className="chart-tooltip">
        <div className="tooltip-date">{dayjs(String(label)).format('DD.MM.YYYY')}</div>
        <div className="tooltip-val">{fmtMoney(val)}</div>
        {p.project && <div className="tooltip-sub">{p.project} {p.section ? `/ ${p.section}` : ''}</div>}
        {p.note && <div className="tooltip-note">{p.note.length > 50 ? p.note.slice(0, 50) + '...' : p.note}</div>}
      </div>
    );
  }

  // Логика для BarChart
  return (
    <div className="chart-tooltip">
      <div className="tooltip-label">{label}</div>
      <div className="tooltip-val">{mode === 'percent' ? fmtPercent(val) : fmtMoney(val)}</div>
    </div>
  );
};

/* ---------- Страница ---------- */
const DashboardPage: React.FC<{ showError: (msg: string) => void }> = ({ showError }) => {
  // --- Состояния фильтров ---
  const [activeDropdown, setActiveDropdown] = useState<'date' | 'users' | 'projects' | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 }); // <--- Координаты для портала
  
  // Date state
  const [preset, setPreset] = useState<PresetKey>('allTime');
  const [dateRange, setDateRange] = useState<{ start: Dayjs | null; end: Dayjs | null }>(() => getPresetRange('allTime'));

  // Filter state
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Логика переключения дропдауна с расчетом координат
  const toggleDropdown = (key: 'date' | 'users' | 'projects', e: React.MouseEvent<HTMLButtonElement>) => {
    if (activeDropdown === key) {
      setActiveDropdown(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8, // Отступ снизу, как было margin-top: 8px
        left: rect.left
      });
      setActiveDropdown(key);
    }
  };

  // Закрытие дропдаунов при клике вне
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      // Проверяем клик: был ли он внутри панели фильтров ИЛИ внутри самого открытого портала
      const clickedInsideFilter = dropdownRef.current && dropdownRef.current.contains(target);
      const clickedInsidePortal = target.closest('.dropdown-portal-root'); // Класс-маркер для портала

      if (!clickedInsideFilter && !clickedInsidePortal) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* --- API Query --- */
  const params = useMemo(() => {
    const usp = new URLSearchParams();
    if (dateRange.start) usp.set('start', dateRange.start.format('YYYY-MM-DD'));
    if (dateRange.end)   usp.set('end',   dateRange.end.format('YYYY-MM-DD'));
    if (selectedProjects.size) usp.set('projects', Array.from(selectedProjects).join(','));
    if (selectedUsers.size)    usp.set('users', Array.from(selectedUsers).join(','));
    return usp.toString();
  }, [dateRange, selectedProjects, selectedUsers]);

  useQuery({ queryKey: ['me'], queryFn: () => me(), staleTime: 300000, refetchOnWindowFocus: false });

  const { data, isFetching, isError, error } = useQuery<DashboardApiResponse>({
    queryKey: ['dashboard-summary', params],
    queryFn: () => api(`/api/dashboard?${params}`),
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  const usersQuery = useQuery<ResponsibleUser[]>({
    queryKey: ['responsible-list'],
    queryFn: () => api('/api/responsible'),
    staleTime: 900000,
    refetchOnWindowFocus: false,
  });

  if (isError && error) showError(error.message);

  // Инициализация фильтров "Выбрать всё"
  useEffect(() => {
    if (data && isInitialLoad) {
      const allUserIds = (data.allUsers || []).filter(Number.isFinite);
      setSelectedUsers(new Set(allUserIds));
      const allProjectNames = Object.values(data.contractorsMap || {}).flat();
      setSelectedProjects(new Set(allProjectNames));
      setIsInitialLoad(false);
    }
  }, [data, isInitialLoad]);

  // Подготовка данных
  const contractorsMap = data?.contractorsMap || {};
  const allUserIds = (data?.allUsers || []).filter(Number.isFinite);
  const userDirectory = new Map((usersQuery.data || []).map(u => [u.id, u.nickname || u.login]));
  const userOptions = allUserIds.map(id => ({ id, label: userDirectory.get(id) || String(id) }));
  const allProjectNames = Object.values(contractorsMap).flat();

  const lineData = data?.lineData || [];
  const plan = data?.kpi?.plan || { income: 0, expense: 0, profit: 0, profitability: 0 };
  const fact = data?.kpi?.fact || { income: 0, expense: 0, profit: 0, profitability: 0 };
  const total = data?.kpi?.total || { income: 0, expense: 0, profit: 0, profitability: 0 };
  const last = lineData.length ? lineData[lineData.length - 1] : null;
  const funds = last ? last.incomeTotal - last.expenseTotal : 0;
  
  const spark = (m: keyof DayEntry) => lineData.slice(-20).map(d => d[m] as number);

  const userSummaryData = useMemo(() => {
    if (!data?.userSummary) return [];
    return data.userSummary.map(s => ({ ...s, name: userDirectory.get(s.userId) || String(s.userId) }));
  }, [data?.userSummary, userDirectory]);

  /* --- Рендер --- */
  return (
    <div className="page-container dashboard-page">
      <div className="header">
        <h2 className="text-xl font-bold m-0">Дашборд</h2>
      </div>

      <div className="content">

      {/* Фильтры */}
        <div className="filtr" ref={dropdownRef}>
          
          {/* Фильтр: Дата */}
          <div className="relative">
            <button 
              className={`chip-btn ${activeDropdown === 'date' ? 'active' : ''}`}
              onClick={(e) => toggleDropdown('date', e)} // <-- Используем toggleDropdown
            >
              <CalendarIcon size={16} />
              {preset === 'custom' 
                ? `${dateRange.start?.format('DD.MM.YY') ?? '...'} — ${dateRange.end?.format('DD.MM.YY') ?? '...'}`
                : presetLabel[preset]
              }
              <ChevronDown size={14} />
            </button>
            
            {activeDropdown === 'date' && createPortal( // <-- Рендерим в портал
              <div 
                className="dropdown-menu p-3 dropdown-portal-root" 
                style={{ 
                  position: 'fixed', 
                  top: dropdownPos.top, 
                  left: dropdownPos.left, 
                  zIndex: 9999,
                  marginTop: 0 // Сброс отступа, так как позиционируем точно
                }}
              >
                <div className="flex gap-2 mb-3">
                  <div className="input-group flex-1 mb-0">
                    <label className="input-label">От</label>
                    <input 
                      type="date" 
                      className="input sm" 
                      value={dateRange.start ? dateRange.start.format('YYYY-MM-DD') : ''}
                      onChange={(e) => {
                        const d = e.target.value ? dayjs(e.target.value) : null;
                        setDateRange(prev => ({ ...prev, start: d }));
                        setPreset('custom');
                      }}
                    />
                  </div>
                  <div className="input-group flex-1 mb-0">
                    <label className="input-label">До</label>
                    <input 
                      type="date" 
                      className="input sm"
                      value={dateRange.end ? dateRange.end.format('YYYY-MM-DD') : ''}
                      onChange={(e) => {
                        const d = e.target.value ? dayjs(e.target.value) : null;
                        setDateRange(prev => ({ ...prev, end: d }));
                        setPreset('custom');
                      }}
                    />
                  </div>
                </div>
                <div className="actions-block actions-block-wrap">
                  {(['currentMonth','currentQuarter','currentYear','prevMonth','prevQuarter','prevYear','allTime'] as PresetKey[]).map(k => (
                    <button 
                      key={k} 
                      className={`btn ${preset === k ? 'active' : ''}`}
                      onClick={() => { setPreset(k); setDateRange(getPresetRange(k)); setActiveDropdown(null); }}
                    >
                      {presetLabel[k]}
                    </button>
                  ))}
                </div>
              </div>,
              document.body // <-- Цель портала
            )}
          </div>

          {/* Фильтр: Пользователи */}
          <div className="relative">
            <button 
              className={`chip-btn ${activeDropdown === 'users' ? 'active' : ''}`}
              onClick={(e) => toggleDropdown('users', e)}
            >
              <Users size={16} />
              {selectedUsers.size === allUserIds.length ? 'Все пользователи' : `Выбрано: ${selectedUsers.size}`}
              <ChevronDown size={14} />
            </button>

            {activeDropdown === 'users' && createPortal(
              <div 
                className="dropdown-menu p-2 dropdown-portal-root" 
                style={{ 
                  position: 'fixed', 
                  top: dropdownPos.top, 
                  left: dropdownPos.left, 
                  zIndex: 9999,
                  width: 250, 
                  maxHeight: 400, 
                  overflowY: 'auto',
                  marginTop: 0
                }}
              >
                <div className="actions-block">
                    <button className="btn" onClick={() => setSelectedUsers(new Set(allUserIds))}>Все</button>
                    <button className="btn" onClick={() => setSelectedUsers(new Set())}>Очистить</button>
                </div>
                {userOptions.length === 0 && <div className="text-sm text-soft p-2">Нет данных</div>}
                {userOptions.map(u => (
                  <label key={u.id} className="dropdown-item checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={selectedUsers.has(u.id)}
                      onChange={(e) => {
                        const next = new Set(selectedUsers);
                        e.target.checked ? next.add(u.id) : next.delete(u.id);
                        setSelectedUsers(next);
                      }}
                    />
                    <span>{u.label}</span>
                  </label>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* Фильтр: Проекты */}
          <div className="relative">
            <button 
              className={`chip-btn ${activeDropdown === 'projects' ? 'active' : ''}`}
              onClick={(e) => toggleDropdown('projects', e)}
            >
              <LayoutGrid size={16} />
              {selectedProjects.size === allProjectNames.length ? 'Все проекты' : `Выбрано: ${selectedProjects.size}`}
              <ChevronDown size={14} />
            </button>

            {activeDropdown === 'projects' && createPortal(
              <div 
                className="dropdown-menu p-2 dropdown-portal-root" 
                style={{ 
                  position: 'fixed', 
                  top: dropdownPos.top, 
                  left: dropdownPos.left, 
                  zIndex: 9999,
                  width: 300, 
                  maxHeight: 400, 
                  overflowY: 'auto',
                  marginTop: 0
                }}
              >
                <div className="actions-block">
                    <button className="btn" onClick={() => setSelectedProjects(new Set(allProjectNames))}>Все</button>
                    <button className="btn" onClick={() => setSelectedProjects(new Set())}>Очистить</button>
                </div>
                {Object.entries(contractorsMap).map(([contr, projs]) => (
                  <div key={contr} className="mb-3">
                    <div className="text-xs font-bold text-soft mb-1 uppercase tracking-wider">{contr}</div>
                    {projs.map(p => (
                        <label key={p} className="dropdown-item checkbox-label">
                          <input 
                            type="checkbox" 
                            checked={selectedProjects.has(p)}
                            onChange={(e) => {
                              const next = new Set(selectedProjects);
                              e.target.checked ? next.add(p) : next.delete(p);
                              setSelectedProjects(next);
                            }}
                          />
                          <span className="truncate">{p}</span>
                        </label>
                    ))}
                  </div>
                ))}
              </div>,
              document.body
            )}
          </div>

          {isFetching && <div className="text-sm text-soft self-center animate-pulse">Обновление...</div>}
        </div>


      

        {/* KPI Cards Grid */}
        <div className="kpi-block">
          <KpiCard title="Выручка" value={total.income} data={spark('incomeTotal')} 
            subLines={[`План: ${fmtMoney(plan.income)}`, `Факт: ${fmtMoney(fact.income)}`]} />
          <KpiCard title="Расходы" value={total.expense} data={spark('expenseTotal')} 
            subLines={[`План: ${fmtMoney(plan.expense)}`, `Факт: ${fmtMoney(fact.expense)}`]} />
          <KpiCard title="Деньги бизнеса" value={funds} data={spark('incomeTotal')} 
            subLines={[`План: ${fmtMoney(plan.profit)}`, `Факт: ${fmtMoney(fact.profit)}`]} />
          <KpiCard title="Рентабельность" value={total.profitability} unit="%" data={spark('profitTotal')} 
            subLines={[`План: ${fmtPercent(plan.profitability)}`, `Факт: ${fmtPercent(fact.profitability)}`]} />
        </div>

        {/* Main Chart */}
        <div className="card block">
          <h3 className="card-title mb-4">Деньги на счетах</h3>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={lineData}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={d => dayjs(d).format('DD.MM')} stroke="var(--text-soft)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-soft)" fontSize={12} tickLine={false} axisLine={false} />
              <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 2 }} />
              <Line type="monotone" dataKey="profitTotal" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4, fill: 'var(--card-bg)', strokeWidth: 2 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Analytics Grid */}
        <div className="dashboard-analytics-grid">
          {[
            { title: 'Самые доходные клиенты', data: data?.topIncomeClients, key: 'value', mode: 'money' },
            { title: 'Контрагенты с расходами', data: data?.topExpenseContractors, key: 'value', mode: 'money' },
            { title: 'Самые прибыльные проекты', data: data?.profitByProject, key: 'profit', mode: 'money' },
            { title: 'Проекты с мин. рентабельностью', data: data?.profitabByProject, key: 'profitability', mode: 'percent' },
          ].map((chart, idx) => (
            <div key={idx} className="card block dashboard-analytics-card">
              <h3 className="card-title mb-4">{chart.title}</h3>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={chart.data || []} layout="vertical" barCategoryGap={10}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={140} stroke="var(--text-soft)" fontSize={11} tickLine={false} axisLine={false} />
                  <RechartsTooltip content={<CustomTooltip mode={chart.mode} />} cursor={{ fill: 'var(--sidebar-bg)' }} />
                  <Bar dataKey={chart.key} fill="var(--primary)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>

        {/* Users Table */}
        {userSummaryData.length > 0 && (
          <div className="card block">
            <div className="p-4 border-b border-white-5 font-bold">Пользователи</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Никнейм</th>
                    <th className="text-right">Заработок</th>
                    <th className="text-right">Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {userSummaryData.map(u => (
                    <tr key={u.userId} className="hover:bg-sidebar">
                      <td className="font-medium">{u.name}</td>
                      <td className="text-right">{fmtMoney(u.income)}</td>
                      <td className={`text-right font-bold ${u.balance >= 0 ? 'text-success' : 'text-danger'}`}>
                        {fmtMoney(u.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {!isFetching && lineData.length === 0 && (
        <div className="text-center text-soft p-10">Нет данных за выбранный период.</div>
      )}
    </div>
  );
};

export default DashboardPage;