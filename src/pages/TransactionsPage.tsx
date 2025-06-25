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
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { DataGrid, GridColDef, GridToolbar, GridPaginationModel } from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../ThemeContext';

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
  tax: number;
  remainder: number;
  operationType: OperationType;
  note?: string;
}

interface ResponsibleUser {
  id: number;
  login: string;
  nickname: string;
}

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

type TransactionsPageProps = {
  showError: (msg: string) => void;
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Генерируем случайный цвет. Можно улучшить генератор по вкусу */
function getRandomColor(): string {
  // Например, формат "#RRGGBB"
  const random = Math.floor(Math.random() * 16777215); // 0xFFFFFF
  const hex = random.toString(16).padStart(6, '0');
  return `#${hex}`;
}

/** applySort: вручную сортируем массив rows */
function applySort(rows: Transaction[], sortField: string, direction: 'asc' | 'desc'): Transaction[] {
  if (!sortField) return rows;
  return [...rows].sort((a, b) => {
    let aVal = (a as any)[sortField];
    let bVal = (b as any)[sortField];

    // сортируем даты
    if (sortField === 'date') {
      const parseTime = (val: string) => {
        if (!val) return Number.MIN_SAFE_INTEGER; // или MAX_SAFE_INTEGER
        const t = new Date(val).getTime();
        return Number.isNaN(t) ? Number.MIN_SAFE_INTEGER : t;
      };
      const aTime = parseTime(aVal);
      const bTime = parseTime(bVal);
      return direction === 'asc' ? aTime - bTime : bTime - aTime;
    }
    

    // сортируем числа
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return direction === 'asc' ? aVal - bVal : bVal - aVal;
    }

    // строки
    aVal = String(aVal ?? '');
    bVal = String(bVal ?? '');
    return direction === 'asc'
      ? aVal.localeCompare(bVal)
      : bVal.localeCompare(aVal);
  });
}

/** Компонент-заголовок колонки с нашей кастомной стрелкой */
function MySortableHeader(props: {
  label: string;
  field: string;
  sortField: string;
  direction: 'asc' | 'desc';
  onToggleSort: (field: string) => void;
}) {
  const { label, field, sortField, direction, onToggleSort } = props;
  const isActive = (sortField === field);

  return (
    <Box
      onClick={() => onToggleSort(field)}
      sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
    >
      <Typography variant="body2">{label}</Typography>
      {isActive && (
        direction === 'asc'
          ? <ArrowUpwardIcon sx={{ ml: 0.5, fontSize: 'inherit' }} />
          : <ArrowDownwardIcon sx={{ ml: 0.5, fontSize: 'inherit' }} />
      )}
    </Box>
  );
}

const TransactionsPage: React.FC<TransactionsPageProps> = ({ showError }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { bgImage, themeMode } = React.useContext(ThemeContext);
  const isDark = themeMode === 'dark';

  // Пагинация
  const [paginationModel, setPaginationModel] = React.useState<GridPaginationModel>({
    pageSize: 25,
    page: 0,
  });

  // Состояние сортировки
  const [sortField, setSortField] = React.useState<string>('date');
  const [direction, setDirection] = React.useState<'asc' | 'desc'>('desc');

  // карта: project -> color
  const projectColorMap = React.useRef<Record<string, string>>({});

  // переключаем сортировку
  const handleToggleSort = (field: string) => {
    if (sortField === field) {
      setDirection(direction === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setDirection('asc');
    }
  };

  // для редактирования
  const [editRow, setEditRow] = React.useState<Transaction | null>(null);
  // для добавления
  const [openDrawer, setOpenDrawer] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);

  const [responsibleUsers, setResponsibleUsers] = React.useState<ResponsibleUser[]>([]);

  React.useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/login');
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
      } catch (err) {
        if (err instanceof Error) {
          showError(err.message);
        }
      }
    };
    fetchResponsibleUsers();
  }, [navigate, showError]);

  // Запрос транзакций
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

  React.useEffect(() => {
    if (isError && error instanceof Error) {
      showError(error.message);
    }
  }, [isError, error, showError]);

  // Мутации создания / обновления
  const createMutation = useMutation({
    mutationFn: async (data: Omit<Transaction, 'id'>) => {
      const res = await fetch(`${API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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

  // Открыть/закрыть Drawer
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
      [name]:
        name === 'total' || name === 'advance' || name === 'tax'
          ? +value
          : value,
    }));
  };
  const handleAdd = () => {
    createMutation.mutate({
      ...form,
      remainder: form.total - form.advance,
    });
  };

  // Редактирование
  const handleEdit = (row: Transaction) => {
    setEditRow(row);
  };
  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!editRow) return;
    const { name, value } = e.target;
    setEditRow((prev) =>
      prev
        ? {
            ...prev,
            [name]: name === 'total' || name === 'advance' || name === 'tax'
              ? +value
              : value,
          }
        : null
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

  // Колонки: отключаем встроенную сортировку (sortable: false),
  // рисуем заголовки через MySortableHeader + цвет для "project"
  const columns: GridColDef<Transaction>[] = [
    {
      field: 'date',
      headerName: 'Дата',
      width: 140,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Дата"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
      renderCell: (params) => params.value ?? '',
    },
    {
      field: 'contractor',
      headerName: 'Контрагент',
      width: 160,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Контрагент"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
    },
    {
      field: 'project',
      headerName: 'Проект',
      width: 180,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Проект"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
      renderCell: (params) => {
        const projectName = params.value as string;
        if (!projectName) return '';
        // ищем или создаём цвет:
        if (!projectColorMap.current[projectName]) {
          projectColorMap.current[projectName] = getRandomColor();
        }
        const bg = projectColorMap.current[projectName];
        return (
          <Chip
            label={projectName}
            sx={{
              backgroundColor: bg,
              color: '#fff',
            }}
          />
        );
      },
    },
    {
      field: 'section',
      headerName: 'Раздел',
      width: 140,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Раздел"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
    },
    {
      field: 'responsible',
      headerName: 'Ответственный',
      width: 140,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Ответственный"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
      renderCell: (params) => {
        // params.value — это login
        const login = params.value as string;
        const user = responsibleUsers.find((u) => u.login === login);
        // Если user найден, покажем nickname, иначе fallback = login
        return user ? user.nickname : login;
      },
    },
    
    {
      field: 'operationType',
      headerName: 'Тип',
      width: 100,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Тип"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
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
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Сумма"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
      renderCell: (params) =>
        params.value != null
          ? params.value.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })
          : '',
    },
    {
      field: 'advance',
      headerName: 'Аванс',
      width: 120,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Аванс"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
      renderCell: (params) =>
        params.value != null
          ? params.value.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })
          : '',
    },
    {
      field: 'tax',
      headerName: 'Налог',
      width: 120,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Налог"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
      renderCell: (params) =>
        params.value != null
          ? params.value.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })
          : '',
    },
    {
      field: 'remainder',
      headerName: 'Остаток',
      width: 120,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Остаток"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
      renderCell: (params) =>
        params.value != null
          ? params.value.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })
          : '',
    },
    {
      field: 'note',
      headerName: 'Примечание',
      width: 200,
      sortable: false,
      renderHeader: (params) => (
        <MySortableHeader
          label="Примечание"
          field={params.colDef.field}
          sortField={sortField}
          direction={direction}
          onToggleSort={handleToggleSort}
        />
      ),
    },
    {
      field: 'actions',
      headerName: 'Действия',
      width: 100,
      sortable: false,
      filterable: false,
      renderHeader: () => <Typography variant="body2">Действия</Typography>,
      renderCell: (params) => (
        <IconButton onClick={() => handleEdit(params.row)}>
          <EditIcon />
        </IconButton>
      ),
    },
  ];

  // Сортируем rows перед отдачей DataGrid
  const displayedRows = applySort(rows, sortField, direction);

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
        border: isDark ? '0px solid #444' : '0px solid #ddd',
      }}
    >
      <Box
        sx={{
          backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(4px)',
          borderRadius: 2,
          p: 2,
          border: isDark ? '0px solid #444' : '0px solid #ddd',
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
            rows={displayedRows}
            columns={columns}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[100, 250, 500]}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
            loading={isLoading}
            // Указываем sortingMode="server", чтобы DataGrid не пытался сам сортировать
            sortingMode="server"
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
              },
              '& .MuiDataGrid-container--top[role="row"], & .MuiDataGrid-container--bottom[role="row"]': {
                background: 'var(--DataGrid-containerBackground) !important',
              },
                  // И добиваемся, чтобы row действительно взял этот фон
              '& .MuiDataGrid-container--top[role="presentation"] [role="row"]': {
                backgroundColor: isDark
                  ? 'rgba(30,30,30,0.9) !important'
                  : 'rgba(255,255,255,0.8) !important',
              },
              '& .MuiTablePagination-toolbar': {
        color: '#fff !important',
      },
      // Если нужно поправить цвет и для select / label
      '& .MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': {
        color: '#fff !important',
      },
      // А если надо и сам select "Rows per page"
      '& .MuiTablePagination-select': {
        color: '#fff !important',
      },
              

              // ... прочие стили ...
            }}
          />
        </Box>

        {/* Drawer для создания */}
        <Drawer anchor="right" open={openDrawer} onClose={handleCloseDrawer}>
          <Box sx={{ width: isMobile ? '100%' : 400, p: 2, pt: 10 }}>
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

        {/* Диалог редактирования */}
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
