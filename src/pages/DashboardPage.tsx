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
  LineChart,
  Line,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../ThemeContext';

export type Transaction = {
  id: number;
  contractor: string;
  project: string;
  section: string;
  responsible: string;
  date: string;
  total: number;
  advance: number;
  remainder: number;
  operationType: 'Расход' | 'Доход';
  note?: string;
};

type DashboardPageProps = {
  showError: (msg: string) => void;
};

const API_URL = '/api';
const COLORS = ['#0088FE', '#FF8042'];

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const DashboardPage: React.FC<DashboardPageProps> = ({ showError }) => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { bgImage, themeMode } = useContext(ThemeContext);
  const isDark = themeMode === 'dark';

  // Определяем общий стиль для внутренних контейнеров
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

  const [selectedContractor, setSelectedContractor] = useState<string>('Все');
  const [selectedProject, setSelectedProject] = useState<string>('Все');

  // Проверяем токен при монтировании
  React.useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
    }
  }, [navigate]);

  // Запрос транзакций
  const {
    data: transactions = [],
    isError,
    error,
  } = useQuery<Transaction[]>({
    queryKey: ['transactions-dashboard'],
    queryFn: async (): Promise<Transaction[]> => {
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
      if (!res.ok) throw new Error('Ошибка загрузки транзакций');
      return await res.json();
    },
  });

  React.useEffect(() => {
    if (isError && error instanceof Error) {
      showError(error.message);
    }
  }, [isError, error, showError]);

  // Фильтрация транзакций
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t: Transaction) => {
      const contractorMatch =
        selectedContractor === 'Все' || t.contractor === selectedContractor;
      const projectMatch =
        selectedProject === 'Все' || t.project === selectedProject;
      return contractorMatch && projectMatch;
    });
  }, [transactions, selectedContractor, selectedProject]);

  // Подсчет итоговых значений
  const totalIncome = useMemo(() => {
    return filteredTransactions
      .filter((t: Transaction) => t.operationType === 'Доход')
      .reduce((acc: number, cur: Transaction) => acc + cur.total, 0);
  }, [filteredTransactions]);

  const totalExpense = useMemo(() => {
    return filteredTransactions
      .filter((t: Transaction) => t.operationType === 'Расход')
      .reduce((acc: number, cur: Transaction) => acc + cur.total, 0);
  }, [filteredTransactions]);

  const totalProfit = totalIncome - totalExpense;

  // Данные для круговой диаграммы
  const pieData = [
    { name: 'Доход', value: totalIncome },
    { name: 'Расход', value: totalExpense },
  ];

  // Данные для Bar Chart (суммарный оборот по контрагентам)
  const contractorMap: { [key: string]: number } = {};
  filteredTransactions.forEach((t: Transaction) => {
    const key = t.contractor || 'Не указан';
    contractorMap[key] = (contractorMap[key] || 0) + t.total;
  });
  const barData = Object.entries(contractorMap).map(([contractor, total]) => ({
    contractor,
    total,
  }));

  // Данные для Line Chart (динамика по датам)
  const dateMap: { [date: string]: { income: number; expense: number } } = {};
  filteredTransactions.forEach((t: Transaction) => {
    if (!t.date) return;
    if (!dateMap[t.date]) {
      dateMap[t.date] = { income: 0, expense: 0 };
    }
    if (t.operationType === 'Доход') {
      dateMap[t.date].income += t.total;
    } else {
      dateMap[t.date].expense += t.total;
    }
  });
  const sortedDates = Object.entries(dateMap).sort(
    ([a], [b]) => new Date(a).getTime() - new Date(b).getTime()
  );
  let cumulativeIncome = 0;
  let cumulativeExpense = 0;
  const lineData = sortedDates.map(([date, values]) => {
    cumulativeIncome += values.income;
    cumulativeExpense += values.expense;
    return {
      date,
      income: cumulativeIncome,
      expense: cumulativeExpense,
      profit: cumulativeIncome - cumulativeExpense,
    };
  });

  // Уникальные значения для фильтров
  const uniqueContractors = useMemo(() => {
    const setOfContractors = new Set<string>(
      transactions.map((t: Transaction) => t.contractor).filter(Boolean)
    );
    return Array.from(setOfContractors);
  }, [transactions]);

  const uniqueProjects = useMemo(() => {
    const setOfProjects = new Set<string>(
      transactions.map((t: Transaction) => t.project).filter(Boolean)
    );
    return Array.from(setOfProjects);
  }, [transactions]);

  const tableData = [
    { type: 'Доход', value: totalIncome },
    { type: 'Расход', value: totalExpense },
    { type: 'Прибыль', value: totalProfit },
  ];

  // Размеры диаграмм
  const pieChartWidth = isMobile ? 300 : 500;
  const pieChartHeight = isMobile ? 200 : 300;
  const pieOuterRadius = isMobile ? 70 : 100;
  const barChartWidth = isMobile ? 300 : 400;
  const barChartHeight = isMobile ? 200 : 300;
  const lineChartWidth = isMobile ? 600 : 1200;
  const lineChartHeight = isMobile ? 200 : 300;

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
      {/* Фильтры */}
      <Box sx={{ ...containerSx, mb: 4 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <Typography variant="h6">Фильтры</Typography>
          <TextField
            select
            label="Контрагент"
            value={selectedContractor}
            onChange={(e) => setSelectedContractor(e.target.value)}
            size="small"
          >
            <MenuItem value="Все">Все</MenuItem>
            {uniqueContractors.map((c: string, i: number) => (
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
          >
            <MenuItem value="Все">Все</MenuItem>
            {uniqueProjects.map((p: string, i: number) => (
              <MenuItem key={i} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Box>

      {/* Блок с итоговыми значениями и круговой диаграммой */}
      <Box sx={{ ...containerSx, mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Дашборд
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={4}
          justifyContent="space-around"
          alignItems="center"
        >
          {/* Круговая диаграмма */}
          <Box>
            <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>
              Соотношение Доход/Расход
            </Typography>
            <PieChart width={pieChartWidth} height={pieChartHeight}>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) =>
                  `${name}: ${(percent * 100).toFixed(0)}%`
                }
                outerRadius={pieOuterRadius}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip />
              <RechartsLegend />
            </PieChart>
          </Box>
          {/* Таблица итоговых значений */}
          <Box sx={{ width: isMobile ? '100%' : 'auto' }}>
            <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>
              Итоговые значения
            </Typography>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Тип</TableCell>
                    <TableCell align="right">Значение (руб.)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tableData.map((row) => (
                    <TableRow key={row.type}>
                      <TableCell component="th" scope="row">
                        {row.type}
                      </TableCell>
                      <TableCell align="right">
                        {row.value.toLocaleString('ru-RU', {
                          style: 'currency',
                          currency: 'RUB',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Stack>
      </Box>

      {/* Bar Chart */}
      <Box sx={{ ...containerSx, mb: 4, overflowX: 'auto' }}>
        <Typography variant="subtitle1" align="center" sx={{ mb: 1 }}>
          Суммарный оборот по контрагентам
        </Typography>
        <BarChart width={barChartWidth} height={barChartHeight} data={barData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="contractor" />
          <YAxis />
          <RechartsTooltip />
          <RechartsLegend />
          <Bar dataKey="total" fill="#82ca9d" />
        </BarChart>
      </Box>

      {/* Line Chart */}
      <Box sx={{ ...containerSx, overflowX: 'auto' }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Динамика по датам
        </Typography>
        <LineChart width={lineChartWidth} height={lineChartHeight} data={lineData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <RechartsTooltip />
          <RechartsLegend />
          <Line type="monotone" dataKey="expense" stroke="#ff0000" strokeOpacity={0.5} name="Расход" />
          <Line type="monotone" dataKey="income" stroke="#0000ff" name="Доход" />
          <Line type="monotone" dataKey="profit" stroke="#008000" name="Прибыль" />
        </LineChart>
      </Box>
    </Box>
  );
};

export default DashboardPage;
