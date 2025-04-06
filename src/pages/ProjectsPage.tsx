import React, { useContext } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Stack,
  useTheme,
  useMediaQuery,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
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

export type ProjectData = {
  title: string; // contractor / project
  sections: Transaction[];
};

type ProjectsPageProps = {
  showError: (msg: string) => void;
};

const API_URL = '/api';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

function getTotal(rows: Transaction[], field: 'total' | 'advance' | 'remainder'): number {
  return rows.reduce((acc, row) => acc + (typeof row[field] === 'number' ? row[field] : 0), 0);
}

const ProjectsPage: React.FC<ProjectsPageProps> = ({ showError }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Получаем фон и тему из глобального контекста
  const { bgImage, themeMode } = useContext(ThemeContext);
  const isDark = themeMode === 'dark';

  // Проверка токена
  React.useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
    }
  }, [navigate]);

  // Запрос транзакций
  const { data: transactions = [], isError, error, isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
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

  // Группировка транзакций по contractor / project
  const projects = React.useMemo<ProjectData[]>(() => {
    const groups: Record<string, Transaction[]> = {};
    transactions.forEach((tx) => {
      const key = `${tx.contractor} / ${tx.project}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    });
    return Object.entries(groups).map(([title, sections]) => ({ title, sections }));
  }, [transactions]);

  // Редактируемая строка
  const [editRow, setEditRow] = React.useState<Transaction | null>(null);

  const updateMutation = useMutation({
    mutationFn: async (data: Transaction) => {
      const res = await fetch(`${API_URL}/transactions/${data.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(data),
      });
      if (res.status === 401 || res.status === 403) {
        navigate('/login');
        throw new Error('Не авторизован или нет доступа');
      }
      if (!res.ok) throw new Error('Ошибка обновления транзакции');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setEditRow(null);
    },
    onError: (err: unknown) => {
      if (err instanceof Error) showError(err.message);
    },
  });

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!editRow) return;
    const { name, value } = e.target;
    const newValue = name === 'total' || name === 'advance' ? Number(value) : value;
    setEditRow((prev) => (prev ? { ...prev, [name]: newValue } : null));
  };

  const handleSaveEdit = () => {
    if (editRow) {
      const updated = { ...editRow, remainder: editRow.total - editRow.advance };
      updateMutation.mutate(updated);
    }
  };

  // Фильтруем только расходы
  const getExpenseRows = (rows: Transaction[]) =>
    rows.filter((tx) => tx.operationType === 'Расход');

  return (
    <Box
      sx={{
        backgroundImage: `url("${bgImage}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed', // фон не скроллится
        minHeight: '100vh',
        p: 2,
        pt: 12,
        
      }}
    >
      <Box
        sx={{
          backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(4px)',
          borderRadius: 2,
          p: 2,
          border: isDark ? '1px solid #444' : '1px solid #ddd',
          color: isDark ? '#fff' : '#000',
          maxWidth: '1920px', // максимальная ширина 1920px
            mx: 'auto', // центрирование
          // Переопределяем стили для шапки таблицы и ячеек
          '& .MuiTypography-root.MuiTypography-subtitle2': {
            color: isDark ? '#fff !important' : '#000 !important',
          },
          '& .MuiTableCell-root.MuiTableCell-head.MuiTableCell-sizeSmall': {
            color: isDark ? '#fff !important' : '#000 !important',
            borderColor: isDark ? '#444 !important' : '#ddd !important',
          },
          '& .MuiTableCell-root.MuiTableCell-body.MuiTableCell-sizeSmall': {
            color: isDark ? 'gray !important' : '#000 !important',
            borderColor: isDark ? '#444 !important' : '#ddd !important',
          },
        }}
      >
        <Typography variant="h5" sx={{ mb: 3 }}>
          Проекты
        </Typography>
        {isLoading ? (
          <Typography>Загрузка проектов...</Typography>
        ) : (
          <Stack direction="column" gap={4}>
            {projects.map((project, index) => {
              const totalIncome = project.sections
                .filter((tx) => tx.operationType === 'Доход')
                .reduce((acc, tx) => acc + tx.total, 0);
              const totalExpense = project.sections
                .filter((tx) => tx.operationType === 'Расход')
                .reduce((acc, tx) => acc + tx.total, 0);
              const profit = totalIncome - totalExpense;
              const expenseRows = getExpenseRows(project.sections);

              return (
                <Card
                  key={index}
                  sx={{
                    border: isDark ? '1px solid #444' : '1px solid #ddd',
                    boxShadow: 3,
                    backgroundColor: isDark ? 'rgba(0,0,0,0.9)' : 'background.paper',
                    color: isDark ? '#fff' : 'inherit',
                  }}
                >
                  <CardHeader
                    title={project.title}
                    subheader={
                      <>
                        <Typography variant="subtitle2">
                          Доходы:{' '}
                          {totalIncome.toLocaleString('ru-RU', {
                            style: 'currency',
                            currency: 'RUB',
                          })}
                        </Typography>
                        <Typography variant="subtitle2">
                          Прибыль:{' '}
                          {profit.toLocaleString('ru-RU', {
                            style: 'currency',
                            currency: 'RUB',
                          })}
                        </Typography>
                      </>
                    }
                    titleTypographyProps={{ variant: 'h6' }}
                    sx={{
                      backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'grey.200',
                      color: isDark ? '#fff' : '#000',
                      borderBottom: isDark ? '1px solid #444' : '1px solid #ddd',
                    }}
                  />
                  <CardContent>
                    {/* Оборачиваем таблицу в Box для горизонтальной прокрутки */}
                    <Box sx={{ overflowX: 'auto' }}>
                      <Paper
                        variant="outlined"
                        sx={{
                          borderColor: isDark ? '#444' : '#ddd',
                          backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'inherit',
                          color: isDark ? '#fff' : 'inherit',
                          minWidth: '700px',
                        }}
                      >
                        <Table size="small">
                          <TableHead
                            sx={{
                              backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'grey.300',
                              color: isDark ? '#fff' : '#000',
                              borderBottom: isDark ? '1px solid #444' : '1px solid #ddd',
                            }}
                          >
                            <TableRow>
                              <TableCell>Раздел</TableCell>
                              <TableCell>Ответственный</TableCell>
                              <TableCell>Дата</TableCell>
                              <TableCell>Сумма</TableCell>
                              <TableCell>Аванс</TableCell>
                              <TableCell>Остаток</TableCell>
                              <TableCell>Примечание</TableCell>
                              <TableCell>Действия</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {expenseRows.map((tx, i) => (
                              <TableRow
                                key={i}
                                sx={{
                                  borderBottom: isDark ? '1px solid #444' : '1px solid #ddd',
                                }}
                              >
                                <TableCell>{tx.section}</TableCell>
                                <TableCell>{tx.responsible}</TableCell>
                                <TableCell>{tx.date}</TableCell>
                                <TableCell>{tx.total}</TableCell>
                                <TableCell>{tx.advance}</TableCell>
                                <TableCell>{tx.remainder}</TableCell>
                                <TableCell>{tx.note}</TableCell>
                                <TableCell>
                                  <IconButton onClick={() => setEditRow(tx)}>
                                    <EditIcon sx={{ color: isDark ? '#fff' : 'inherit' }} />
                                  </IconButton>
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow
                              sx={{
                                backgroundColor: isDark ? 'rgba(0,0,0,0.9)' : 'grey.400',
                              }}
                            >
                              <TableCell colSpan={3} align="right" sx={{ fontWeight: 600 }}>
                                Итого:
                              </TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>
                                {expenseRows.reduce((acc, tx) => acc + tx.total, 0)}
                              </TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>
                                {expenseRows.reduce((acc, tx) => acc + tx.advance, 0)}
                              </TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>
                                {expenseRows.reduce((acc, tx) => acc + tx.remainder, 0)}
                              </TableCell>
                              <TableCell colSpan={2} />
                            </TableRow>
                          </TableBody>
                        </Table>
                      </Paper>
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
      </Box>

      {editRow && (
        <Dialog open={Boolean(editRow)} onClose={() => setEditRow(null)}>
          <DialogTitle>Редактировать строку</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Раздел"
                name="section"
                value={editRow.section}
                onChange={handleEditChange}
              />
              <TextField
                label="Ответственный"
                name="responsible"
                value={editRow.responsible}
                onChange={handleEditChange}
              />
              <TextField
                label="Дата"
                name="date"
                type="date"
                value={editRow.date}
                onChange={handleEditChange}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Сумма"
                name="total"
                type="number"
                value={editRow.total}
                onChange={handleEditChange}
              />
              <TextField
                label="Аванс"
                name="advance"
                type="number"
                value={editRow.advance}
                onChange={handleEditChange}
              />
              <TextField
                label="Примечание"
                name="note"
                value={editRow.note}
                onChange={handleEditChange}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditRow(null)}>Отмена</Button>
            <Button onClick={handleSaveEdit} variant="contained">
              Сохранить
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};

export default ProjectsPage;
