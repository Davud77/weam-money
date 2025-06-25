import React, { useState, useMemo, useContext } from 'react';
import {
  Box,
  Typography,
  Stack,
  TextField,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Checkbox,
  FormControlLabel,
  FormControl,
  InputLabel,
  Select,
  SelectChangeEvent,
  Button,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../ThemeContext';

// Тип одной транзакции
export type Transaction = {
  id: number;
  contractor: string;    // Контрагент
  project: string;       // Проект
  section: string;
  responsible: string;   // Ответственный
  date: string;          // пустая строка = план
  total: number;
  advance: number;
  remainder: number;
  operationType: 'Расход' | 'Доход';
  note?: string;

  // Если для налог нужна реальное поле:
  tax?: number;
};

// Пропсы
type DashboardPageProps = {
  showError: (msg: string) => void;
};

const API_URL = '/api';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getLastDayOfCurrentMonth(): string {
  const now = new Date();
  const lastDayDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const yyyy = lastDayDate.getFullYear();
  const mm = String(lastDayDate.getMonth() + 1).padStart(2, '0');
  const dd = String(lastDayDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Для «динамики по датам»
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
};

type NumericDayEntryKeys =
  | 'incomePlan'
  | 'expensePlan'
  | 'profitPlan'
  | 'incomeFact'
  | 'expenseFact'
  | 'profitFact'
  | 'incomeTotal'
  | 'expenseTotal'
  | 'profitTotal';

const linesConfig = [
  {
    key: 'incomePlan',
    color: '#5d9cec',
    label: 'Доход (план)',
    strokeWidth: 2,
  },
  {
    key: 'expensePlan',
    color: '#ff6161',
    label: 'Расход (план)',
    strokeWidth: 2,
  },
  {
    key: 'profitPlan',
    color: '#74bb8d',
    label: 'Прибыль (план)',
    strokeWidth: 2,
  },

  {
    key: 'incomeFact',
    color: '#0000ff',
    label: 'Доход (факт)',
    strokeWidth: 2,
  },
  {
    key: 'expenseFact',
    color: '#ff0000',
    label: 'Расход (факт)',
    strokeWidth: 2,
  },
  {
    key: 'profitFact',
    color: '#00b300',
    label: 'Прибыль (факт)',
    strokeWidth: 2,
  },

  {
    key: 'incomeTotal',
    color: '#00009a',
    label: 'Доход (итог)',
    strokeWidth: 4,
  },
  {
    key: 'expenseTotal',
    color: '#8b0000',
    label: 'Расход (итог)',
    strokeWidth: 4,
  },
  {
    key: 'profitTotal',
    color: '#006400',
    label: 'Прибыль (итог)',
    strokeWidth: 4,
  },
] as const;

const DashboardPage: React.FC<DashboardPageProps> = ({ showError }) => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { bgImage, themeMode } = useContext(ThemeContext);
  const isDark = themeMode === 'dark';

  // Цвета для таблицы (План/Факт)
  const incomeColor = '#0000ff';
  const expenseColor = '#ff0000';
  const profitColor = '#008000';

  const containerSx = {
    backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
    backdropFilter: 'blur(4px)',
    borderRadius: 2,
    p: 2,
    border: isDark ? '1px solid #444' : '1px solid #ddd',
    maxWidth: '1920px',
    mx: 'auto',
    color: isDark ? '#fff' : '#000',
  };

  // Фильтры
  const [selectedContractor, setSelectedContractor] = useState<string>('Все');
  const [selectedProject, setSelectedProject] = useState<string>('Все');

  // Проверяем наличие токена
  React.useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/login');
    }
  }, [navigate]);

  // Загружаем транзакции
  const { data: transactions = [], isError, error } = useQuery<Transaction[]>({
    queryKey: ['transactions-dashboard'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/transactions`, {
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      if (res.status === 401 || res.status === 403) {
        navigate('/login');
        throw new Error('Не авторизован или нет доступа');
      }
      if (!res.ok) {
        throw new Error('Ошибка загрузки транзакций');
      }
      return await res.json();
    },
  });

  // Если ошибка
  React.useEffect(() => {
    if (isError && error instanceof Error) {
      showError(error.message);
    }
  }, [isError, error, showError]);

  // Фильтрация
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const contractorMatch =
        selectedContractor === 'Все' || t.contractor === selectedContractor;
      const projectMatch =
        selectedProject === 'Все' || t.project === selectedProject;
      return contractorMatch && projectMatch;
    });
  }, [transactions, selectedContractor, selectedProject]);

  // Подсчёт доход/расход
  const totalIncome = useMemo(() => {
    return filteredTransactions
      .filter((t) => t.operationType === 'Доход')
      .reduce((acc, cur) => acc + cur.total, 0);
  }, [filteredTransactions]);

  const totalExpense = useMemo(() => {
    return filteredTransactions
      .filter((t) => t.operationType === 'Расход')
      .reduce((acc, cur) => acc + cur.total, 0);
  }, [filteredTransactions]);

  const totalProfit = totalIncome - totalExpense;

  // Разделяем на план/факт
  const lastDayOfMonth = getLastDayOfCurrentMonth();
  const planTransactions = useMemo(
    () => filteredTransactions.filter((t) => !t.date),
    [filteredTransactions]
  );
  const factTransactions = useMemo(
    () => filteredTransactions.filter((t) => !!t.date),
    [filteredTransactions]
  );

  // Подсчёт доход/расход/прибыль (план/факт/итог)
  function calcGroup(txs: Transaction[]) {
    const income = txs
      .filter((t) => t.operationType === 'Доход')
      .reduce((acc, t) => acc + t.total, 0);
    const expense = txs
      .filter((t) => t.operationType === 'Расход')
      .reduce((acc, t) => acc + t.total, 0);
    const profit = income - expense;
    const profitability = income > 0 ? (profit / income) * 100 : 0;
    return { income, expense, profit, profitability };
  }
  const plan = calcGroup(planTransactions);
  const fact = calcGroup(factTransactions);
  const total = {
    income: plan.income + fact.income,
    expense: plan.expense + fact.expense,
    profit: (plan.income + fact.income) - (plan.expense + fact.expense),
  };
  const totalProfitability = total.income > 0 ? (total.profit / total.income) * 100 : 0;

  // Круговые диаграммы
  const pieDataPlan = [
    { name: 'Расход', value: plan.expense },
    { name: 'Прибыль', value: plan.profit },
  ];
  const pieDataFact = [
    { name: 'Расход', value: fact.expense },
    { name: 'Прибыль', value: fact.profit },
  ];
  const pieDataTotal = [
    { name: 'Расход', value: total.expense },
    { name: 'Прибыль', value: total.profit },
  ];

  // ====== Кнопки для BarChart ======
  type BarGroupMode = 'contractor' | 'project' | 'responsible' | 'tax';
  type BarPlanOrFact = 'plan' | 'fact';

  const [barGroup, setBarGroup] = useState<BarGroupMode>('contractor');
  const [barPlanOrFact, setBarPlanOrFact] = useState<BarPlanOrFact>('plan');

  // Вычисляем barData
  const barData = useMemo(() => {
    const txs = filteredTransactions.filter((tx) =>
      barPlanOrFact === 'plan' ? !tx.date : !!tx.date
    );

    const map: Record<string, number> = {};

    txs.forEach((tx) => {
      let key: string;
      switch (barGroup) {
        case 'contractor':
          key = tx.contractor || 'Не указан';
          break;
        case 'project':
          key = tx.project || 'Не указан';
          break;
        case 'responsible':
          key = tx.responsible || 'Не указан';
          break;
        case 'tax':
          // Суммируем поле tax (если нет, 0)
          key = 'Налог';
          break;
        default:
          key = '???';
      }
      if (!map[key]) {
        map[key] = 0;
      }
      if (barGroup === 'tax') {
        map[key] += tx.tax ?? 0;
      } else {
        map[key] += tx.total;
      }
    });

    return Object.entries(map).map(([groupKey, total]) => ({
      groupKey,
      total,
    }));
  }, [filteredTransactions, barPlanOrFact, barGroup]);

  // ===== ДИНАМИКА ПО ДАТАМ =====
  type DayMap = Record<string, DayEntry>;
  const dayMap: DayMap = {};

  function addToDayEntry(dateKey: string, field: NumericDayEntryKeys, amount: number) {
    if (!dayMap[dateKey]) {
      dayMap[dateKey] = {
        date: dateKey,
        incomePlan: 0,
        expensePlan: 0,
        profitPlan: 0,
        incomeFact: 0,
        expenseFact: 0,
        profitFact: 0,
        incomeTotal: 0,
        expenseTotal: 0,
        profitTotal: 0,
      };
    }
    dayMap[dateKey][field] += amount;
  }

  filteredTransactions.forEach((tx) => {
    const realDate = tx.date || lastDayOfMonth;
    if (!tx.date) {
      if (tx.operationType === 'Доход') addToDayEntry(realDate, 'incomePlan', tx.total);
      else addToDayEntry(realDate, 'expensePlan', tx.total);
    } else {
      if (tx.operationType === 'Доход') addToDayEntry(realDate, 'incomeFact', tx.total);
      else addToDayEntry(realDate, 'expenseFact', tx.total);
    }
  });

  Object.keys(dayMap).forEach((dateKey) => {
    const e = dayMap[dateKey];
    e.profitPlan = e.incomePlan - e.expensePlan;
    e.profitFact = e.incomeFact - e.expenseFact;
    e.incomeTotal = e.incomePlan + e.incomeFact;
    e.expenseTotal = e.expensePlan + e.expenseFact;
    e.profitTotal = e.profitPlan + e.profitFact;
  });

  const rawData = Object.values(dayMap).sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  // Режим графика: daily / cumulative
  const [mode, setMode] = useState<'daily' | 'cumulative'>('cumulative');
  const handleModeChange = (event: SelectChangeEvent<string>) => {
    setMode(event.target.value as 'daily' | 'cumulative');
  };

  const lineData = useMemo(() => {
    if (mode === 'daily') return rawData;

    // Накопительный
    const cumulative = rawData.map((obj) => ({ ...obj }));
    let accPlanIncome = 0,
      accPlanExpense = 0,
      accPlanProfit = 0;
    let accFactIncome = 0,
      accFactExpense = 0,
      accFactProfit = 0;
    let accTotalIncome = 0,
      accTotalExpense = 0,
      accTotalProfit = 0;

    for (const day of cumulative) {
      accPlanIncome += day.incomePlan;
      accPlanExpense += day.expensePlan;
      accPlanProfit += day.profitPlan;

      accFactIncome += day.incomeFact;
      accFactExpense += day.expenseFact;
      accFactProfit += day.profitFact;

      accTotalIncome += day.incomeTotal;
      accTotalExpense += day.expenseTotal;
      accTotalProfit += day.profitTotal;

      day.incomePlan = accPlanIncome;
      day.expensePlan = accPlanExpense;
      day.profitPlan = accPlanProfit;

      day.incomeFact = accFactIncome;
      day.expenseFact = accFactExpense;
      day.profitFact = accFactProfit;

      day.incomeTotal = accTotalIncome;
      day.expenseTotal = accTotalExpense;
      day.profitTotal = accTotalProfit;
    }
    return cumulative;
  }, [mode, rawData]);

  // Линии: по умолчанию "факт" включён, остальное нет
  const [linesVisibility, setLinesVisibility] = useState<Record<string, boolean>>(() => {
    const obj: Record<string, boolean> = {};
    for (const ln of linesConfig) {
      if (ln.key.includes('Fact')) {
        obj[ln.key] = true;
      } else {
        obj[ln.key] = false;
      }
    }
    return obj;
  });
  const toggleLine = (key: string) => {
    setLinesVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Стили для кнопок с hover
  // Делаем цвет текста контрастным при наведении
  const buttonHoverSx = {
    textTransform: 'none',
    ':hover': {
      color: isDark ? '#000' : '#fff',   // при темной теме текст станет темным, а фон ...?
      backgroundColor: isDark ? '#fff' : '#000',
    },
  };

  return (
    <Box
      sx={{
        backgroundImage: `url("${bgImage}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
        minHeight: '100vh',
        p: 2,
        pt: 12,
        border: isDark ? '1px solid #444' : '1px solid #ddd',
      }}
    >
      {/* ФИЛЬТРЫ */}
      <Box sx={{ ...containerSx, mb: 4 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <Typography variant="h6" sx={{ color: isDark ? '#fff' : '#000' }}>
            Фильтры
          </Typography>
          <TextField
            select
            label="Контрагент"
            value={selectedContractor}
            onChange={(e) => setSelectedContractor(e.target.value)}
            size="small"
            sx={{
              minWidth: 200,
              '& .MuiInputLabel-root': { color: isDark ? '#fff' : undefined },
              '& .MuiOutlinedInput-root': {
                color: isDark ? '#fff' : undefined,
                '& fieldset': { borderColor: isDark ? '#fff' : undefined },
                '&:hover fieldset': { borderColor: isDark ? '#fff' : undefined },
                '&.Mui-focused fieldset': { borderColor: isDark ? '#fff' : undefined },
              },
            }}
          >
            <MenuItem value="Все">Все</MenuItem>
            {Array.from(
              new Set(transactions.map((t) => t.contractor).filter(Boolean))
            ).map((c, i) => (
              <MenuItem key={i} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Проект"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            size="small"
            sx={{
              minWidth: 200,
              '& .MuiInputLabel-root': { color: isDark ? '#fff' : undefined },
              '& .MuiOutlinedInput-root': {
                color: isDark ? '#fff' : undefined,
                '& fieldset': { borderColor: isDark ? '#fff' : undefined },
                '&:hover fieldset': { borderColor: isDark ? '#fff' : undefined },
                '&.Mui-focused fieldset': { borderColor: isDark ? '#fff' : undefined },
              },
            }}
          >
            <MenuItem value="Все">Все</MenuItem>
            {Array.from(
              new Set(transactions.map((t) => t.project).filter(Boolean))
            ).map((p, i) => (
              <MenuItem key={i} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Box>

      {/* Здесь идут блоки с круговыми диаграммами (План, Факт, Итого) + Таблица (Дашборд)... */}
      {/* ------------------------------------------------------------------------------- */}
      {/* ... Пропущено для краткости, так как логика не меняется ... */}
      {/* ------------------------------------------------------------------------------- */}
      {/* ТРИ КРУГОВЫЕ ДИАГРАММЫ (План, Факт, Итого) + ТАБЛИЦА */}
      <Box sx={{ ...containerSx, mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Дашборд
        </Typography>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={4}
          justifyContent="center"
          alignItems="center"
        >
          {/* Круговая диаграмма — ПЛАН */}
          <Box sx={{ width: isMobile ? '100%' : '30%' }}>
            <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>
              План
            </Typography>
            <Box sx={{ width: '100%', height: isMobile ? 200 : 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieDataPlan}
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name}: ${(percent * 100).toFixed(0)}%`
                    }
                    dataKey="value"
                    outerRadius="80%"
                  >
                    <Cell key="expense" fill={expenseColor} />
                    <Cell key="profit" fill={profitColor} />
                  </Pie>
                  <RechartsTooltip />
                  <RechartsLegend />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </Box>

          {/* Круговая диаграмма — ФАКТ */}
          <Box sx={{ width: isMobile ? '100%' : '30%' }}>
            <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>
              Факт
            </Typography>
            <Box sx={{ width: '100%', height: isMobile ? 200 : 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieDataFact}
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name}: ${(percent * 100).toFixed(0)}%`
                    }
                    dataKey="value"
                    outerRadius="80%"
                  >
                    <Cell key="expense" fill={expenseColor} />
                    <Cell key="profit" fill={profitColor} />
                  </Pie>
                  <RechartsTooltip />
                  <RechartsLegend />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </Box>

          {/* Круговая диаграмма — ИТОГО */}
          <Box sx={{ width: isMobile ? '100%' : '30%' }}>
            <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>
              Итого
            </Typography>
            <Box sx={{ width: '100%', height: isMobile ? 200 : 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieDataTotal}
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name}: ${(percent * 100).toFixed(0)}%`
                    }
                    dataKey="value"
                    outerRadius="80%"
                  >
                    <Cell key="expense" fill={expenseColor} />
                    <Cell key="profit" fill={profitColor} />
                  </Pie>
                  <RechartsTooltip />
                  <RechartsLegend />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        </Stack>

        {/* ТАБЛИЦА (План, Факт, Итого) */}
        <Box sx={{ mt: 4 }}>
          <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>
            Итоговые значения (План и Факт)
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell align="center">Приход</TableCell>
                  <TableCell align="center">Расход</TableCell>
                  <TableCell align="center">Прибыль</TableCell>
                  <TableCell align="center">Рентабельность</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {/* ПЛАН */}
                <TableRow>
                  <TableCell>План</TableCell>
                  <TableCell align="center" sx={{ color: incomeColor }}>
                    {plan.income > 0 ? '+' : ''}
                    {plan.income.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ color: expenseColor }}>
                    {plan.expense > 0 ? '-' : ''}
                    {plan.expense.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ color: profitColor }}>
                    {plan.profit >= 0 ? '+' : ''}
                    {plan.profit.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    {plan.profitability.toFixed(2)}%
                  </TableCell>
                </TableRow>

                {/* ФАКТ */}
                <TableRow>
                  <TableCell>Факт</TableCell>
                  <TableCell align="center" sx={{ color: incomeColor }}>
                    {fact.income > 0 ? '+' : ''}
                    {fact.income.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ color: expenseColor }}>
                    {fact.expense > 0 ? '-' : ''}
                    {fact.expense.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ color: profitColor }}>
                    {fact.profit >= 0 ? '+' : ''}
                    {fact.profit.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    {fact.profitability.toFixed(2)}%
                  </TableCell>
                </TableRow>

                {/* ИТОГО */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Итого</TableCell>
                  <TableCell align="center" sx={{ color: incomeColor, fontWeight: 600 }}>
                    {total.income > 0 ? '+' : ''}
                    {total.income.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ color: expenseColor, fontWeight: 600 }}>
                    {total.expense > 0 ? '-' : ''}
                    {total.expense.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ color: profitColor, fontWeight: 600 }}>
                    {total.profit >= 0 ? '+' : ''}
                    {total.profit.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    {totalProfitability.toFixed(2)}%
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Box>

      {/* BAR CHART */}
      <Box sx={{ ...containerSx, mb: 4, overflowX: 'auto' }}>
        <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>
          Суммарный оборот
        </Typography>
        <Stack direction="row" spacing={2} justifyContent="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
          <Button
            variant={barGroup === 'contractor' ? 'contained' : 'outlined'}
            onClick={() => setBarGroup('contractor')}
            sx={buttonHoverSx}
          >
            По контрагентам
          </Button>
          <Button
            variant={barGroup === 'project' ? 'contained' : 'outlined'}
            onClick={() => setBarGroup('project')}
            sx={buttonHoverSx}
          >
            По проектам
          </Button>
          <Button
            variant={barGroup === 'responsible' ? 'contained' : 'outlined'}
            onClick={() => setBarGroup('responsible')}
            sx={buttonHoverSx}
          >
            По ответственным
          </Button>
          <Button
            variant={barGroup === 'tax' ? 'contained' : 'outlined'}
            onClick={() => setBarGroup('tax')}
            sx={buttonHoverSx}
          >
            Налог
          </Button>

          {/* Кнопка План + Факт (разные цвета) */}
          <Button
            variant={barPlanOrFact === 'plan' ? 'contained' : 'outlined'}
            color="success"  // «План» будет зелёной
            onClick={() => setBarPlanOrFact('plan')}
            sx={buttonHoverSx}
          >
            План
          </Button>
          <Button
            variant={barPlanOrFact === 'fact' ? 'contained' : 'outlined'}
            color="error"   // «Факт» будет красной
            onClick={() => setBarPlanOrFact('fact')}
            sx={buttonHoverSx}
          >
            Факт
          </Button>
        </Stack>

        <Box sx={{ width: isMobile ? '100%' : '90%', height: isMobile ? 300 : 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="groupKey"
                label={
                  !isMobile
                    ? {
                        value:
                          barGroup === 'contractor'
                            ? 'Контрагент'
                            : barGroup === 'project'
                            ? 'Проект'
                            : barGroup === 'responsible'
                            ? 'Ответственный'
                            : 'Налог',
                        position: 'insideBottom',
                        offset: -5,
                      }
                    : undefined
                }
              />
              <YAxis />
              <RechartsTooltip />
              <RechartsLegend />
              <Bar dataKey="total" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Box>

      {/* ЛИНЕЙНЫЙ ГРАФИК (динамика по датам) со Селектором «Обычный/Накопительный», чекбоксы и т.д. */}
      {/* ------------------------------------------------------------------------------- */}
      {/* ... Ваш существующий код (mode = daily/cumulative, linesVisibility, etc.) ... */}
      {/* ------------------------------------------------------------------------------- */}
      



      {/* Ниже - блок с Линейным графиком и селектором/чекбоксами */}

      <Box sx={{ ...containerSx, overflowX: 'auto', mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Динамика по датам
        </Typography>

        {/* Селектор: Обычный / Накопительный */}
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="body1" sx={{ color: isDark ? '#fff' : undefined }}>
            Режим графика:
          </Typography>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel
              id="mode-label"
              sx={{
                color: isDark ? '#fff' : undefined,
              }}
            >
              Режим
            </InputLabel>
            <Select
              labelId="mode-label"
              value={mode}
              label="Режим"
              onChange={handleModeChange}
              sx={{
                color: isDark ? '#fff' : undefined,
                '.MuiOutlinedInput-notchedOutline': {
                  borderColor: isDark ? '#fff' : undefined,
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: isDark ? '#fff' : undefined,
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: isDark ? '#fff' : undefined,
                },
              }}
            >
              <MenuItem value="daily">Обычный (по дням)</MenuItem>
              <MenuItem value="cumulative">Накопительный</MenuItem>
            </Select>
          </FormControl>
        </Stack>

        {/* Группировка чекбоксов (Доход, Расход, Прибыль) */}
        <Stack direction="row" spacing={4} justifyContent="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
          {/* Группа "Доход" */}
          <Box>
            <Typography variant="subtitle2" align="center" sx={{ mb: 1 }}>
              Доход
            </Typography>
            <Stack spacing={1}>
              {linesConfig
                .filter((ln) => ln.key.includes('income'))
                .map((ln) => (
                  <FormControlLabel
                    key={ln.key}
                    control={
                      <Checkbox
                        checked={linesVisibility[ln.key]}
                        onChange={() => toggleLine(ln.key)}
                        sx={{
                          color: ln.color,
                          '&.Mui-checked': {
                            color: ln.color,
                          },
                        }}
                      />
                    }
                    label={ln.label}
                  />
                ))}
            </Stack>
          </Box>

          {/* Группа "Расход" */}
          <Box>
            <Typography variant="subtitle2" align="center" sx={{ mb: 1 }}>
              Расход
            </Typography>
            <Stack spacing={1}>
              {linesConfig
                .filter((ln) => ln.key.includes('expense'))
                .map((ln) => (
                  <FormControlLabel
                    key={ln.key}
                    control={
                      <Checkbox
                        checked={linesVisibility[ln.key]}
                        onChange={() => toggleLine(ln.key)}
                        sx={{
                          color: ln.color,
                          '&.Mui-checked': {
                            color: ln.color,
                          },
                        }}
                      />
                    }
                    label={ln.label}
                  />
                ))}
            </Stack>
          </Box>

          {/* Группа "Прибыль" */}
          <Box>
            <Typography variant="subtitle2" align="center" sx={{ mb: 1 }}>
              Прибыль
            </Typography>
            <Stack spacing={1}>
              {linesConfig
                .filter((ln) => ln.key.includes('profit'))
                .map((ln) => (
                  <FormControlLabel
                    key={ln.key}
                    control={
                      <Checkbox
                        checked={linesVisibility[ln.key]}
                        onChange={() => toggleLine(ln.key)}
                        sx={{
                          color: ln.color,
                          '&.Mui-checked': {
                            color: ln.color,
                          },
                        }}
                      />
                    }
                    label={ln.label}
                  />
                ))}
            </Stack>
          </Box>
        </Stack>

        {/* Сам график */}
        <Box sx={{ width: isMobile ? '100%' : '95%', height: isMobile ? 300 : 450 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <RechartsTooltip />
              <RechartsLegend />
              {linesConfig.map((ln) =>
                linesVisibility[ln.key] ? (
                  <Line
                    key={ln.key}
                    type="monotone"
                    dataKey={ln.key}
                    stroke={ln.color}
                    strokeWidth={ln.strokeWidth}
                    dot={false}
                    name={ln.label}
                  />
                ) : null
              )}
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Box>
    </Box>

  );
};

export default DashboardPage;
