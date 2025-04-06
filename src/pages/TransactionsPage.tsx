import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Button,
  Stack,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  useTheme,
  useMediaQuery,
  MenuItem,
  IconButton,
} from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridToolbar,
  GridPaginationModel,
  GridSortModel,
} from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../ThemeContext';

// ---------- Типы -------------
type OperationType = 'Расход' | 'Доход';

export interface Transaction {
  id: number;
  contractor: string;
  project: string;
  section: string;
  responsible: string;
  date: string;
  total: number;
  advance: number;
  tax: number;  // дополнительное поле
  remainder: number;
  operationType: OperationType;
  note?: string;
}

interface ResponsibleUser {
  id: number;
  login: string;
  nickname: string;
}

// ---------- Начальное состояние формы -------------
const emptyForm: Omit<Transaction, 'id' | 'remainder'> = {
  contractor: '',
  project: '',
  section: '',
  responsible: '',
  date: '',
  total: 0,
  advance: 0,
  tax: 0,
  operationType: 'Расход',
  note: '',
};

const API_URL = '/api';

// ---------- Функция заголовков аутентификации -------------
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------- Пропсы страницы -------------
type TransactionsPageProps = {
  showError: (msg: string) => void;
};

const TransactionsPage: React.FC<TransactionsPageProps> = ({ showError }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { bgImage, themeMode } = React.useContext(ThemeContext);
  const isDark = themeMode === 'dark';

  // ---------- Состояния компонента -------------
  const [paginationModel, setPaginationModel] = React.useState<GridPaginationModel>({
    pageSize: 25,
    page: 0,
  });
  const [editRow, setEditRow] = React.useState<Transaction | null>(null);
  const [openDrawer, setOpenDrawer] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);
  const [responsibleUsers, setResponsibleUsers] = React.useState<ResponsibleUser[]>([]);

  // ---------- Проверка токена и загрузка списка "ответственных" -------------
  React.useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/login');
      return;
    }
    const fetchResponsibleUsers = async () => {
      try {
        const res = await fetch(`${API_URL}/responsible`, {
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
        });
        if (res.status === 401 || res.status === 403) {
          navigate('/login');
          return;
        }
        if (!res.ok) {
          throw new Error('Ошибка при загрузке списка ответственных');
        }
        const data = await res.json();
        setResponsibleUsers(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          showError(err.message);
        }
      }
    };
    fetchResponsibleUsers();
  }, [navigate, showError]);

  // ---------- Запрашиваем транзакции из API -------------
  const {
    data: rows = [],
    isLoading,
    isError,
    error,
  } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
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
      if (!res.ok) throw new Error('Ошибка загрузки транзакций');
      return await res.json();
    },
  });

  // ---------- Если ошибка в запросе, показать уведомление -------------
  React.useEffect(() => {
    if (isError && error instanceof Error) {
      showError(error.message);
    }
  }, [isError, error, showError]);

  // ---------- Мутации (create + update) -------------
  const createMutation = useMutation({
    mutationFn: async (data: Omit<Transaction, 'id'>) => {
      const res = await fetch(`${API_URL}/transactions`, {
        method: 'POST',
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
      if (!res.ok) throw new Error('Ошибка создания транзакции');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setOpenDrawer(false);
      setForm(emptyForm);
    },
    onError: (err: unknown) => {
      if (err instanceof Error) showError(err.message);
    },
  });

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

  // ---------- Обработчики для создания -------------
  const handleOpenDrawer = (type: OperationType) => {
    setForm({ ...emptyForm, operationType: type });
    setOpenDrawer(true);
  };
  const handleCloseDrawer = () => {
    setOpenDrawer(false);
  };
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: (name === 'total' || name === 'advance' || name === 'tax') ? +value : value,
    }));
  };
  const handleAdd = () => {
    createMutation.mutate({
      ...form,
      remainder: form.total - form.advance, // remainder
    });
  };

  // ---------- Обработчики для редактирования -------------
  const handleEdit = (row: Transaction) => {
    setEditRow(row);
  };
  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!editRow) return;
    const { name, value } = e.target;
    setEditRow((prev) =>
      prev ? {
        ...prev,
        [name]: (name === 'total' || name === 'advance' || name === 'tax')
          ? +value
          : value,
      } : null
    );
  };
  const handleSaveEdit = () => {
    if (editRow) {
      updateMutation.mutate({
        ...editRow,
        remainder: editRow.total - editRow.advance,
      });
    }
  };

  // ---------- Столбцы DataGrid со встроенной сортировкой «из коробки» -------------
  const columns: GridColDef<Transaction>[] = [
    {
      field: 'date',
      headerName: 'Дата',
      width: 140,
      sortable: true,
    },
    {
      field: 'contractor',
      headerName: 'Контрагент',
      width: 160,
      sortable: true,
    },
    {
      field: 'project',
      headerName: 'Проект',
      width: 140,
      sortable: true,
    },
    {
      field: 'section',
      headerName: 'Задача/раздел',
      width: 140,
      sortable: true,
    },
    {
      field: 'responsible',
      headerName: 'Ответственный',
      width: 140,
      sortable: true,
    },
    {
      field: 'operationType',
      headerName: 'Тип',
      width: 100,
      sortable: true,
      renderCell: (params) => (
        <Chip
          label={params.value}
          color={params.value === 'Расход' ? 'error' : 'success'}
          size="small"
        />
      ),
    },
    {
      field: 'total',
      headerName: 'Сумма',
      width: 120,
      sortable: true,
      renderCell: (params) =>
        params.value != null
          ? params.value.toLocaleString('ru-RU', {
              style: 'currency',
              currency: 'RUB',
            })
          : '',
    },
    {
      field: 'advance',
      headerName: 'Аванс',
      width: 120,
      sortable: true,
      renderCell: (params) =>
        params.value != null
          ? params.value.toLocaleString('ru-RU', {
              style: 'currency',
              currency: 'RUB',
            })
          : '',
    },
    {
      field: 'tax',
      headerName: 'Налог',
      width: 120,
      sortable: true,
      renderCell: (params) =>
        params.value != null
          ? params.value.toLocaleString('ru-RU', {
              style: 'currency',
              currency: 'RUB',
            })
          : '',
    },
    {
      field: 'remainder',
      headerName: 'Остаток',
      width: 120,
      sortable: true,
      renderCell: (params) =>
        params.value != null
          ? params.value.toLocaleString('ru-RU', {
              style: 'currency',
              currency: 'RUB',
            })
          : '',
    },
    {
      field: 'note',
      headerName: 'Примечание',
      width: 200,
      sortable: true,
    },
    {
      field: 'actions',
      headerName: 'Действия',
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <IconButton onClick={() => handleEdit(params.row)}>
          <EditIcon />
        </IconButton>
      ),
    },
  ];

  // ---------- Начальная сортировка (date: desc) -------------
  const initialState = {
    sorting: {
      sortModel: [{ field: 'date', sort: 'desc' }] as GridSortModel,
    },
  };

  // ---------- JSX -------------
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
        border: isDark ? '1px solid #444' : '1px solid #ddd',
      }}
    >
      <Box
        sx={{
          backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(4px)',
          borderRadius: 2,
          p: 2,
          border: isDark ? '1px solid #444' : '1px solid #ddd',
          maxWidth: '1920px',
          mx: 'auto',
          color: isDark ? '#fff' : '#000',
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <Button variant="contained" color="success" onClick={() => handleOpenDrawer('Доход')}>
            Приход
          </Button>
          <Button variant="contained" color="error" onClick={() => handleOpenDrawer('Расход')}>
            Расход
          </Button>
        </Stack>

        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <DataGrid<Transaction>
            rows={rows}                     // Подаём массив напрямую, без ручной сортировки
            columns={columns}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[25, 50, 100]}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }} // Показываем тулбар
            loading={isLoading}
            initialState={initialState}      // Дата desc
            // ВАЖНО: не указываем sortingMode="server", onSortModelChange и т.п.
            sx={{
              '--DataGrid-rowBorderColor': isDark ? '#444' : '#ddd',
              borderColor: isDark ? '#444' : '#ddd',
              '& .MuiDataGrid-virtualScrollerContent': {
                backgroundColor: '#ffffff99',
              },
              '& .MuiDataGrid-columnHeaders': {
                backgroundColor: isDark
                  ? 'rgba(0,0,0,0.8) !important'
                  : 'rgba(255,255,255,0.8) !important',
                color: isDark ? '#fff !important' : '#000 !important',
                boxShadow: isDark
                  ? `0px 1px 0px 0px var(--DataGrid-rowBorderColor) !important`
                  : undefined,
              },
              '& .MuiDataGrid-toolbarContainer': {
                backgroundColor: isDark
                  ? 'rgba(0,0,0,0.8) !important'
                  : 'rgba(255,255,255,0.8) !important',
                color: isDark ? '#fff !important' : '#000 !important',
              },
              '& .MuiDataGrid-cell': {
                color: isDark ? '#fff !important' : '#000 !important',
              },
              '& .MuiDataGrid-row--borderBottom': {
                backgroundColor: isDark
                  ? 'rgba(0,0,0,0.8) !important'
                  : 'rgba(255,255,255,0.8) !important',
                color: isDark ? '#fff !important' : '#000 !important',
                boxShadow: isDark
                  ? `0px 1px 0px 0px var(--DataGrid-rowBorderColor) !important`
                  : undefined,
                pointerEvents: 'none',
              },
              '& .MuiTablePagination-toolbar': {
                backgroundColor: isDark
                  ? 'rgba(0,0,0,0.8) !important'
                  : 'rgba(255,255,255,0.8) !important',
                color: isDark ? '#fff !important' : '#000 !important',
              },
              '& .MuiBox-root.css-1fupizq': {
                backgroundColor: isDark ? 'rgba(0,0,0,0.8) !important' : undefined,
                color: isDark ? '#fff !important' : undefined,
              },
              '& .MuiDataGrid-virtualScrollerRenderZone.css-1vouojk': {
                backgroundColor: isDark ? 'rgba(0,0,0,0.8) !important' : undefined,
                color: isDark ? '#fff !important' : undefined,
                boxShadow: isDark
                  ? `0px 1px 0px 0px var(--DataGrid-rowBorderColor) !important`
                  : undefined,
              },
              '& .MuiDataGrid-virtualScroller': {
                '&::-webkit-scrollbar': { width: '8px', height: '8px' },
                '&::-webkit-scrollbar-track': {
                  background: isDark ? '#333' : '#f1f1f1',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: isDark ? '#555' : '#aaa',
                  borderRadius: '4px',
                },
                '&::-webkit-scrollbar-thumb:hover': {
                  background: isDark ? '#777' : '#888',
                },
              },
            }}
          />
        </Box>

        {/* Drawer для добавления новой транзакции */}
        <Drawer anchor="right" open={openDrawer} onClose={handleCloseDrawer}>
          <Box sx={{ width: isMobile ? '100%' : 400, p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Добавить {form.operationType === 'Доход' ? 'приход' : 'расход'}
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Контрагент"
                name="contractor"
                value={form.contractor}
                onChange={handleChange}
              />
              <TextField
                label="Проект"
                name="project"
                value={form.project}
                onChange={handleChange}
              />
              <TextField
                label="Раздел"
                name="section"
                value={form.section}
                onChange={handleChange}
              />
              <TextField
                select
                label="Ответственный"
                name="responsible"
                value={form.responsible}
                onChange={handleChange}
              >
                {responsibleUsers.map((u) => (
                  <MenuItem key={u.id} value={u.login}>
                    {u.nickname ? `${u.login} (${u.nickname})` : u.login}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Дата"
                name="date"
                type="date"
                value={form.date}
                onChange={handleChange}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Сумма"
                name="total"
                type="number"
                value={form.total}
                onChange={handleChange}
              />
              <TextField
                label="Аванс"
                name="advance"
                type="number"
                value={form.advance}
                onChange={handleChange}
              />
              <TextField
                label="Налог"
                name="tax"
                type="number"
                value={form.tax}
                onChange={handleChange}
              />
              <TextField
                label="Примечание"
                name="note"
                value={form.note}
                onChange={handleChange}
                multiline
                rows={2}
              />
              <Stack direction="row" spacing={2}>
                <Button variant="outlined" onClick={handleCloseDrawer}>
                  Отмена
                </Button>
                <Button variant="contained" onClick={handleAdd}>
                  Добавить
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Drawer>

        {/* Диалог для редактирования существующей строки */}
        {editRow && (
          <Dialog open={Boolean(editRow)} onClose={() => setEditRow(null)}>
            <DialogTitle>Редактировать транзакцию</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Контрагент"
                  name="contractor"
                  value={editRow.contractor}
                  onChange={handleEditChange}
                />
                <TextField
                  label="Проект"
                  name="project"
                  value={editRow.project}
                  onChange={handleEditChange}
                />
                <TextField
                  label="Раздел"
                  name="section"
                  value={editRow.section}
                  onChange={handleEditChange}
                />
                <TextField
                  select
                  label="Ответственный"
                  name="responsible"
                  value={editRow.responsible}
                  onChange={handleEditChange}
                >
                  {responsibleUsers.map((u) => (
                    <MenuItem key={u.id} value={u.login}>
                      {u.nickname ? `${u.login} (${u.nickname})` : u.login}
                    </MenuItem>
                  ))}
                </TextField>
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
                  label="Налог"
                  name="tax"
                  type="number"
                  value={editRow.tax}
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
    </Box>
  );
};

export default TransactionsPage;
