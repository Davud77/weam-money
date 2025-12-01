import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Stack,
  Chip,
  Popover,
  Checkbox,
  FormControlLabel,
  CircularProgress,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper,
} from '@mui/material';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import 'dayjs/locale/ru';
import dayjs, { Dayjs } from 'dayjs';
// ИЗМЕНЕНИЕ: Импортируем keepPreviousData
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api, me } from '../lib/api';
import { fmtMoney, fmtPercent } from '../lib/format';

/* ---------- типы ---------- */
type PresetKey =
  | 'currentMonth'
  | 'currentQuarter'
  | 'currentYear'
  | 'prevMonth'
  | 'prevQuarter'
  | 'prevYear'
  | 'allTime'
  | 'custom';

type DayEntry = {
  date: string;
  incomePlan: number;
  expensePlan: number;
  profitPlan: number;
  incomeFact: number;
  expenseFact: number;
  profitFact: number;
  incomeTotal: number;
  expenseTotal: number;
  profitTotal: number;
  project?: string | null;
  section?: string | null;
  note?: string | null;
};

type Kpi = { income: number; expense: number; profit: number; profitability: number };

/** Доп. тип для тултипа расходов (контрагенты) */
type ExpenseContractorDatum = {
  name: string;
  value: number;
  project?: string | null;
  section?: string | null;
  description?: string | null;
};

// НОВЫЙ ТИП: Данные для таблицы пользователей
type UserSummaryData = {
  userId: number;
  income: number;  // Заработок (доход)
  balance: number; // Остаток
};

type DashboardApiResponse = {
  contractorsMap: Record<string, string[]>;
  allUsers: number[]; // user ids
  kpi: { plan: Kpi; fact: Kpi; total: Kpi };
  lineData: DayEntry[];
  topIncomeClients: { name: string; value: number }[];
  topExpenseContractors: ExpenseContractorDatum[];
  profitByProject: { name: string; profit: number }[];
  profitabByProject: { name: string; profitability: number }[];
  userSummary: UserSummaryData[]; // НОВОЕ ПОЛЕ В ОТВЕТЕ API
};

type ResponsibleUser = { id: number; login: string; nickname?: string | null };

/* ---------- константы ---------- */
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
  currentMonth: 'Текущий месяц',
  currentQuarter: 'Текущий квартал',
  currentYear: 'Текущий год',
  prevMonth: 'Прошлый месяц',
  prevQuarter: 'Прошлый квартал',
  prevYear: 'Прошлый год',
  allTime: 'Все время',
  custom: 'Период',
};

/* ---------- tooltip форматтеры для Recharts ---------- */
const tooltipMoneyNoKey = (value: any) => [fmtMoney(Number(value) || 0), ''] as any;
const tooltipPctNoKey = (value: any) => [fmtPercent(Number(value) || 0), ''] as any;

/* ---------- KPI карточка ---------- */
type KpiCardProps = {
  title: string;
  value: number;
  unit?: string;
  data: number[];
  subLines?: string[];
};

const KpiCard: React.FC<KpiCardProps> = ({ title, value, unit = '₽', data, subLines }) => (
  <Box className="kpi-card">
    <Typography variant="subtitle2" className="kpi-title">{title.toUpperCase()}</Typography>
    <Typography variant="h5" className="kpi-value">
      {(Number(value) || 0).toLocaleString('ru-RU')} {unit}
    </Typography>
    {subLines?.map((l) => (
      <Typography key={l} variant="caption" className="kpi-subl">{l}</Typography>
    ))}
    {data.length > 1 && (
      <Box className="spark-container">
        <ResponsiveContainer>
          <AreaChart data={data.map((y, i) => ({ x: i, y }))} className="spark-chart">
            <defs>
              <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
                <stop className="spark-stop-1" offset="5%" stopOpacity={0.5} />
                <stop className="spark-stop-2" offset="95%" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="y"
              className="spark-area"
              strokeWidth={2}
              isAnimationActive={false}
              fill="url(#sparkGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    )}
  </Box>
);

/* ---------- Кастомные тултипы ---------- */
type ReValue = number | string | Array<number | string>;
type ReName = string;
type RTooltipProps = import('recharts').TooltipProps<ReValue, ReName>;

/* Унифицированный простой тултип для bar-чартов */
const SimpleBarTooltip: React.FC<RTooltipProps & { mode: 'money' | 'percent' }> = ({ active, label, payload, mode }) => {
  if (!active || !payload || !payload.length) return null;
  const v = Number(payload[0].value) || 0;
  const text = mode === 'percent' ? fmtPercent(v) : fmtMoney(v);
  return (
    <Box className="tooltip-card tooltip-card--bar">
      <Typography variant="body2" className="tooltip-line">{String(label)}</Typography>
      <Typography variant="body2" className="tooltip-line">{text}</Typography>
    </Box>
  );
};

/* Контрагенты с наибольшими расходами — привели стиль к единому */
const TopExpenseTooltip: React.FC<RTooltipProps> = ({ active, label, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const p = (payload[0].payload || {}) as ExpenseContractorDatum;
  const sum = Number(payload[0].value) || 0;

  return (
    <Box className="tooltip-card tooltip-card--bar">
      <Typography variant="body2" className="tooltip-line">{String(label)}</Typography>
      <Typography variant="body2" className="tooltip-line">{fmtMoney(sum)}</Typography>
      {p.project ? <Typography variant="body2" className="tooltip-line">{p.project}</Typography> : null}
      {p.section ? <Typography variant="body2" className="tooltip-line">{p.section}</Typography> : null}
      {p.description ? <Typography variant="body2" className="tooltip-line">{p.description}</Typography> : null}
    </Box>
  );
};

const FundsTooltip: React.FC<RTooltipProps> = ({ active, label, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const sum = Number(payload[0].value) || 0;
  const p = (payload[0].payload || {}) as DayEntry;
  const proj = (p.project || '').toString().trim();
  const sec  = (p.section || '').toString().trim();
  const note = (p.note || '').toString().trim();

  const projectSection = [proj, sec].filter(Boolean).join(', ');
  const displayNote = note.length > 40 ? `${note.slice(0, 40)}\n${note.slice(40)}` : note;

  return (
    <Box className="tooltip-card tooltip-card--funds">
      <Typography variant="body2" className="tooltip-line">
        Дата: {dayjs(String(label)).format('DD.MM.YYYY')}
      </Typography>
      <Typography variant="body2" className="tooltip-line">{fmtMoney(sum)}</Typography>
      {projectSection ? (
        <Typography variant="body2" className="tooltip-line">{projectSection}</Typography>
      ) : null}
      {displayNote ? (
        <Typography variant="body2" className="tooltip-line">{displayNote}</Typography>
      ) : null}
    </Box>
  );
};

/* ---------- страница ---------- */
const STALE_15M = 15 * 60 * 1000;

const DashboardPage: React.FC<{ showError: (msg: string) => void }> = ({ showError }) => {
  /* фильтры state */
  const [projAnchor, setProjAnchor] = useState<HTMLElement | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());

  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const [preset, setPreset] = useState<PresetKey>('allTime');
  const [dateRange, setDateRange] = useState<{ start: Dayjs | null; end: Dayjs | null }>(
    () => getPresetRange('allTime'),
  );

  const [usersAnchor, setUsersAnchor] = useState<HTMLElement | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  /* параметры запроса для /api/dashboard */
  const params = useMemo(() => {
    const usp = new URLSearchParams();
    if (dateRange.start) usp.set('start', dateRange.start.format('YYYY-MM-DD'));
    if (dateRange.end)   usp.set('end',   dateRange.end.format('YYYY-MM-DD'));
    if (selectedProjects.size) usp.set('projects', Array.from(selectedProjects).join(','));
    if (selectedUsers.size)    usp.set('users', Array.from(selectedUsers).join(','));
    return usp.toString();
  }, [dateRange.start, dateRange.end, selectedProjects, selectedUsers]);

  /* me — только для UX (скрывать кнопки и т.п.). Решение — на бэке */
  useQuery({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  /* загрузка агрегатов */
  const dashboardQuery = useQuery<DashboardApiResponse>({
    queryKey: ['dashboard-summary', params],
    queryFn: () => api(`/api/dashboard?${params}`),
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  /* справочник пользователей (label = nickname | login) */
  const usersQuery = useQuery<ResponsibleUser[]>({
    queryKey: ['responsible-list'],
    queryFn: () => api('/api/responsible'),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  const isFetching = dashboardQuery.isFetching || usersQuery.isFetching;
  const isError = dashboardQuery.isError || usersQuery.isError;
  const error = (dashboardQuery.error as Error) || (usersQuery.error as Error);

  if (isError && error) {
    showError(error.message);
  }

  const data = dashboardQuery.data;
  
  // По умолчанию выбираем всех пользователей и все проекты при первой загрузке
  React.useEffect(() => {
    if (data && isInitialLoad && dashboardQuery.isSuccess) {
      const allUserIds = (data.allUsers || []).filter(Number.isFinite);
      setSelectedUsers(new Set(allUserIds));

      const allProjectNames = Object.values(data.contractorsMap || {}).flat();
      setSelectedProjects(new Set(allProjectNames));

      setIsInitialLoad(false);
    }
  }, [data, isInitialLoad, dashboardQuery.isSuccess]);

  const contractorsMap = data?.contractorsMap || {};

  const allUserIds: number[] = (data?.allUsers || []).filter((x) => Number.isFinite(x));
  const userDirectory = new Map<number, string>(
    (usersQuery.data || []).map((u) => [u.id, (u.nickname && u.nickname.trim()) || u.login || String(u.id)])
  );
  const userOptions: { id: number; label: string }[] = allUserIds.map((id) => ({
    id,
    label: userDirectory.get(id) || String(id),
  }));

  const allProjectNames = useMemo(() => Object.values(contractorsMap).flat(), [contractorsMap]);
  const allProjectsCount = allProjectNames.length;

  const lineData = data?.lineData || [];
  const plan = data?.kpi?.plan || { income: 0, expense: 0, profit: 0, profitability: 0 };
  const fact = data?.kpi?.fact || { income: 0, expense: 0, profit: 0, profitability: 0 };
  const total = data?.kpi?.total || { income: 0, expense: 0, profit: 0, profitability: 0 };

  const last = lineData.length ? lineData[lineData.length - 1] : null;
  const revenue = total.income;
  const expense = total.expense;
  const funds = last ? last.incomeTotal - last.expenseTotal : 0;
  const profitability = total.profitability;

  const spark = (m: keyof DayEntry) => lineData.slice(-20).map((d) => d[m] as number);

  // НОВЫЙ БЛОК: Подготовка данных для таблицы пользователей
  const userSummaryData = useMemo(() => {
    if (!data?.userSummary || !userDirectory.size) {
      return [];
    }
    return data.userSummary.map((summary) => ({
      ...summary,
      name: userDirectory.get(summary.userId) || String(summary.userId),
    }));
  }, [data?.userSummary, userDirectory]);

  /* ---------- UI ---------- */
  return (
    <Box className="root dashboard-page">
      {/* Header */}
      <Box className="header dashboard-header">
        <Typography variant="h6" className="title dashboard-title">Дашборд</Typography>
      </Box>

      {/* Контент */}
      <Box className="content dashboard-content">
        {/* Фильтры */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip
            className="chip chip--clickable"
            label={
              preset === 'custom'
                ? `${dateRange.start ? dateRange.start.format('DD.MM.YYYY') : '...'} — ${dateRange.end ? dateRange.end.format('DD.MM.YYYY') : '...'}`
                : presetLabel[preset]
            }
            onClick={(e) => setDateAnchor(e.currentTarget)}
          />
          <Chip
            className="chip chip--clickable"
            label={
              !data || selectedUsers.size === 0 || selectedUsers.size === allUserIds.length
                ? 'Все пользователи'
                : `Пользователи (${selectedUsers.size})`
            }
            onClick={(e) => setUsersAnchor(e.currentTarget)}
          />
          <Chip
            className="chip chip--clickable"
            label={
              !data || selectedProjects.size === 0 || selectedProjects.size === allProjectsCount
                ? 'Все проекты'
                : `Проекты (${selectedProjects.size})`
            }
            onClick={(e) => setProjAnchor(e.currentTarget)}
          />
        </Stack>

        {/* Popover период */}
        <Popover
          open={Boolean(dateAnchor)}
          anchorEl={dateAnchor}
          onClose={() => setDateAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          className="dashboard-popover"
        >
          <Box className="popover-body popover-body--wide">
            <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ru">
              <Stack direction="row" spacing={2}>
                <DatePicker
                  label="От"
                  value={dateRange.start}
                  onChange={(v) => { setDateRange((r) => ({ ...r, start: v })); setPreset('custom'); }}
                />
                <DatePicker
                  label="До"
                  value={dateRange.end}
                  onChange={(v) => { setDateRange((r) => ({ ...r, end: v })); setPreset('custom'); }}
                />
              </Stack>
            </LocalizationProvider>

            <Stack direction="row" flexWrap="wrap" className="chip-grid mt-1">
              {(['currentMonth','currentQuarter','currentYear','prevMonth','prevQuarter','prevYear','allTime'] as PresetKey[])
                .map((k) => (
                <Chip
                  key={k}
                  label={presetLabel[k]}
                  size="small"
                  onClick={() => { setPreset(k); setDateRange(getPresetRange(k)); }}
                  className={`chip chip--small ${preset === k ? 'chip--active' : ''}`}
                />
              ))}
            </Stack>
          </Box>
        </Popover>

        {/* Popover пользователи */}
        <Popover
          open={Boolean(usersAnchor)}
          anchorEl={usersAnchor}
          onClose={() => setUsersAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box className="popover-body popover-body--scroll max-h-360">
            {(!data || userOptions.length === 0) && (
              <Typography variant="body2" color="text.secondary">Пользователи не найдены.</Typography>
            )}
            <Stack direction="column" spacing={0.5} className="no-margin">
              {userOptions.map(({ id, label }) => (
                <FormControlLabel
                  key={id}
                  control={
                    <Checkbox
                      checked={selectedUsers.has(id)}
                      onChange={(e) =>
                        setSelectedUsers((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(id) : next.delete(id);
                          return next;
                        })
                      }
                    />
                  }
                  label={label}
                  className="form-item--compact"
                />
              ))}
            </Stack>

            {userOptions.length > 0 && (
              <Stack direction="row" spacing={1} className="mt-1">
                <Chip
                  label="Выбрать всех"
                  size="small"
                  onClick={() => setSelectedUsers(new Set(allUserIds))}
                  className="chip chip--small"
                />
                <Chip
                  label="Очистить"
                  size="small"
                  onClick={() => setSelectedUsers(new Set())}
                  className="chip chip--small"
                />
              </Stack>
            )}
          </Box>
        </Popover>

        {/* Popover проекты */}
        <Popover
          open={Boolean(projAnchor)}
          anchorEl={projAnchor}
          onClose={() => setProjAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box className="popover-body popover-body--scroll">
            {Object.entries(contractorsMap).map(([contractor, projects]) => (
              <Box key={contractor} className="contractor-block">
                <Typography variant="subtitle2" className="contractor-title">{contractor}</Typography>
                {projects.map((proj) => (
                  <FormControlLabel
                    key={`${contractor}:${proj}`}
                    control={
                      <Checkbox
                        checked={selectedProjects.has(proj)}
                        onChange={(e) =>
                          setSelectedProjects((prev) => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(proj) : next.delete(proj);
                            return next;
                          })
                        }
                      />
                    }
                    label={proj}
                    className="form-item--compact"
                  />
                ))}
              </Box>
            ))}
             <Stack direction="row" spacing={1} className="mt-1">
                <Chip
                  label="Выбрать все"
                  size="small"
                  onClick={() => setSelectedProjects(new Set(allProjectNames))}
                  className="chip chip--small"
                />
                <Chip
                  label="Очистить"
                  size="small"
                  onClick={() => setSelectedProjects(new Set())}
                  className="chip chip--small"
                />
              </Stack>
          </Box>
        </Popover>

        {isFetching && (
          <Box className="loading-inline">
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Загрузка данных…</Typography>
          </Box>
        )}

        {/* KPI */}
        <Stack direction="row" useFlexGap spacing={2}>
          {[
            ['Выручка', revenue, spark('incomeTotal'), [`План: ${fmtMoney(plan.income)}`, `Факт: ${fmtMoney(fact.income)}`]],
            ['Расходы', expense, spark('expenseTotal'), [`План: ${fmtMoney(plan.expense)}`, `Факт: ${fmtMoney(fact.expense)}`]],
            ['Деньги бизнеса', funds, spark('incomeTotal'), [`План: ${fmtMoney(plan.profit)}`, `Факт: ${fmtMoney(fact.profit)}`]],
            ['Рентабельность', profitability, spark('profitTotal'), [`План: ${fmtPercent(plan.profitability)}`, `Факт: ${fmtPercent(fact.profitability)}`], '%'],
          ].map(([title, val, dataSeries, lines, unit]) => (
            <Box key={title as string} className="kpi-col">
              <KpiCard
                title={title as string}
                value={val as number}
                data={dataSeries as number[]}
                subLines={lines as string[]}
                unit={unit as string | undefined}
              />
            </Box>
          ))}
        </Stack>

        {/* Деньги на счетах */}
        <Box className="chart-card chart-card--lg">
          <Typography variant="subtitle2" className="block-title">ДЕНЬГИ НА СЧЁТАХ</Typography>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={lineData} className="chart chart--line">
              <CartesianGrid vertical={false} className="grid grid--weak" />
              <XAxis
                dataKey="date"
                className="axis axis--soft"
                tickFormatter={(d) => dayjs(d).format('DD.MM')}
              />
              <YAxis className="axis axis--soft" domain={[0, 'auto']} />
              <RechartsTooltip wrapperClassName="recharts-tooltip tooltip-compact tooltip-unified" content={<FundsTooltip />} />
              <Line
                type="monotone"
                dataKey="profitTotal"
                className="chart-line chart-line--primary"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>

        {/* аналитика */}
        <Box className="analytics-grid">
          {/* Доходные клиенты */}
          <Box className="analytics-card">
            <Typography variant="subtitle2" className="block-title">САМЫЕ ДОХОДНЫЕ КЛИЕНТЫ</Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data?.topIncomeClients || []} layout="vertical" barCategoryGap={8} className="chart chart--bar">
                <CartesianGrid horizontal={false} className="grid grid--weak" />
                <XAxis type="number" className="axis axis--soft" tickFormatter={(v) => (v / 1000).toFixed(0) + 'K'} />
                <YAxis dataKey="name" type="category" width={180} className="axis axis--soft" />
                <RechartsTooltip wrapperClassName="recharts-tooltip tooltip-unified" content={<SimpleBarTooltip mode="money" />} />
                <Bar dataKey="value" className="bar bar--primary" />
              </BarChart>
            </ResponsiveContainer>
          </Box>

          {/* Расходные контрагенты — с расширенным тултипом */}
          <Box className="analytics-card">
            <Typography variant="subtitle2" className="block-title">КОНТРАГЕНТЫ С НАИБОЛЬШИМИ РАСХОДАМИ</Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data?.topExpenseContractors || []} layout="vertical" barCategoryGap={8} className="chart chart--bar">
                <CartesianGrid horizontal={false} className="grid grid--weak" />
                <XAxis type="number" className="axis axis--soft" tickFormatter={(v) => (v / 1000).toFixed(0) + 'K'} />
                <YAxis dataKey="name" type="category" width={180} className="axis axis--soft" />
                <RechartsTooltip wrapperClassName="recharts-tooltip tooltip-unified" content={<TopExpenseTooltip />} />
                <Bar dataKey="value" className="bar bar--primary" />
              </BarChart>
            </ResponsiveContainer>
          </Box>

          {/* Самые прибыльные проекты — вертикальные бары */}
          <Box className="analytics-card">
            <Typography variant="subtitle2" className="block-title">САМЫЕ ПРИБЫЛЬНЫЕ ПРОЕКТЫ</Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data?.profitByProject || []} layout="vertical" barCategoryGap={8} className="chart chart--bar">
                <CartesianGrid horizontal={false} className="grid grid--weak" />
                <XAxis type="number" className="axis axis--soft" tickFormatter={(v) => (v / 1000).toFixed(0) + 'K'} />
                <YAxis dataKey="name" type="category" width={180} className="axis axis--soft" />
                <RechartsTooltip wrapperClassName="recharts-tooltip tooltip-unified" content={<SimpleBarTooltip mode="money" />} />
                <Bar dataKey="profit" className="bar bar--primary" />
              </BarChart>
            </ResponsiveContainer>
          </Box>

          {/* Наименьшая рентабельность — вертикальные бары */}
          <Box className="analytics-card">
            <Typography variant="subtitle2" className="block-title">ПРОЕКТЫ С НАИМЕНЬШЕЙ РЕНТАБЕЛЬНОСТЬЮ</Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data?.profitabByProject || []} layout="vertical" barCategoryGap={8} className="chart chart--bar">
                <CartesianGrid horizontal={false} className="grid grid--weak" />
                <XAxis type="number" className="axis axis--soft" tickFormatter={(v) => `${v}%`} />
                <YAxis dataKey="name" type="category" width={180} className="axis axis--soft" />
                <RechartsTooltip wrapperClassName="recharts-tooltip tooltip-unified" content={<SimpleBarTooltip mode="percent" />} />
                <Bar dataKey="profitability" className="bar bar--primary" />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>

        {/* НОВАЯ КАРТОЧКА: Таблица пользователей */}
        {userSummaryData.length > 0 && (
          <Box className="analytics-card" sx={{ mt: 2 }}>
            <Typography variant="subtitle2" className="block-title">ПОЛЬЗОВАТЕЛИ</Typography>
            <TableContainer component={Paper} sx={{ boxShadow: 'none' }}>
              <Table size="small" aria-label="a dense table">
                <TableHead>
                  <TableRow>
                    <TableCell>Никнейм</TableCell>
                    <TableCell align="right">Заработок (доход)</TableCell>
                    <TableCell align="right">Остаток</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {userSummaryData.map((user) => (
                    <TableRow key={user.userId}>
                      <TableCell component="th" scope="row">
                        {user.name}
                      </TableCell>
                      <TableCell align="right">{fmtMoney(user.income)}</TableCell>
                      <TableCell align="right">{fmtMoney(user.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {!isFetching && lineData.length === 0 && (
          <Box className="pad-1">
            <Typography variant="body2" color="text.secondary">Нет данных за выбранный период/проекты.</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default DashboardPage;