import React, { useContext, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  TextField,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  Chip,
  useTheme,
  useMediaQuery,
  MenuItem,
} from '@mui/material';
import { DataGrid, GridColDef, GridToolbar } from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../ThemeContext';

export type User = {
  id: number;
  login: string;
  type: 'admin' | 'user';
  nickname: string;
};

type UserForm = {
  login: string;
  password: string;
  type: 'admin' | 'user';
  nickname: string;
};

type UsersPageProps = {
  showError: (msg: string) => void;
};

const API_URL = '/api';

const emptyForm: UserForm = {
  login: '',
  password: '',
  type: 'user',
  nickname: '',
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const UsersPage: React.FC<UsersPageProps> = ({ showError }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const gridHeight = isMobile ? 400 : 500;

  // Используем глобальный контекст для фона и темы
  const { bgImage, themeMode } = useContext(ThemeContext);
  const isDark = themeMode === 'dark';

  const [isAdmin, setIsAdmin] = useState(false);
  const [openDrawer, setOpenDrawer] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // Проверка токена и извлечение роли
  React.useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    const payloadBase64 = token.split('.')[1];
    if (payloadBase64) {
      try {
        const payload = JSON.parse(atob(payloadBase64));
        setIsAdmin(payload.role === 'admin');
      } catch (err) {
        console.error('Ошибка при разборе токена', err);
      }
    }
  }, [navigate]);

  // Запрос всех пользователей
  const {
    data: users = [],
    isLoading,
    isError,
    error,
  } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async (): Promise<User[]> => {
      const res = await fetch(`${API_URL}/users`, {
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      if (res.status === 401 || res.status === 403) {
        navigate('/login');
        throw new Error('Не авторизован');
      }
      if (!res.ok) throw new Error('Ошибка загрузки пользователей');
      return await res.json();
    },
  });

  React.useEffect(() => {
    if (isError && error instanceof Error) {
      showError(error.message);
    }
  }, [isError, error, showError]);

  // Мутация создания пользователя
  const createUserMutation = useMutation({
    mutationFn: async (newUser: UserForm) => {
      const res = await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(newUser),
      });
      if (res.status === 401 || res.status === 403) {
        navigate('/login');
        throw new Error('Не авторизован или нет доступа');
      }
      if (!res.ok) throw new Error('Ошибка при создании пользователя');
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setOpenDrawer(false);
      setForm(emptyForm);
    },
    onError: (err: unknown) => {
      if (err instanceof Error) showError(err.message);
    },
  });

  // Мутация обновления пользователя (без пароля)
  const updateUserMutation = useMutation({
    mutationFn: async (updated: User) => {
      const res = await fetch(`${API_URL}/users/${updated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(updated),
      });
      if (res.status === 401 || res.status === 403) {
        navigate('/login');
        throw new Error('Не авторизован или нет доступа');
      }
      if (!res.ok) throw new Error('Ошибка при обновлении пользователя');
      return await res.json();
    },
    onSuccess: () => {
      if (!newPassword) {
        setEditUser(null);
        queryClient.invalidateQueries({ queryKey: ['users'] });
      }
    },
    onError: (err: unknown) => {
      if (err instanceof Error) showError(err.message);
    },
  });

  // Мутация обновления пароля
  const updatePasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: number; newPassword: string }) => {
      const res = await fetch(`${API_URL}/users/${userId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ newPassword }),
      });
      if (res.status === 401 || res.status === 403) {
        navigate('/login');
        throw new Error('Не авторизован или нет доступа');
      }
      if (!res.ok) throw new Error('Ошибка при обновлении пароля');
      return await res.json();
    },
    onSuccess: () => {
      setNewPassword('');
      setEditUser(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: unknown) => {
      if (err instanceof Error) showError(err.message);
    },
  });

  const handleOpenDrawer = () => {
    setForm(emptyForm);
    setOpenDrawer(true);
  };

  const handleCloseDrawer = () => {
    setOpenDrawer(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAdd = () => {
    createUserMutation.mutate(form);
  };

  const handleEdit = (user: User) => {
    setEditUser(user);
    setNewPassword('');
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!editUser) return;
    const { name, value } = e.target;
    setEditUser((prev) => (prev ? { ...prev, [name]: value } : null));
  };

  const handleSaveEdit = () => {
    if (editUser) {
      updateUserMutation.mutate(editUser, {
        onSuccess: () => {
          if (newPassword) {
            updatePasswordMutation.mutate({ userId: editUser.id, newPassword });
          } else {
            setEditUser(null);
            queryClient.invalidateQueries({ queryKey: ['users'] });
          }
        },
      });
    }
  };

  const columns: GridColDef<User>[] = [
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'login', headerName: 'Логин', width: 150 },
    {
      field: 'type',
      headerName: 'Тип',
      width: 150,
      renderCell: (params) => (
        <Chip
          label={params.value}
          color={params.value === 'admin' ? 'primary' : 'default'}
          size="small"
        />
      ),
    },
    { field: 'nickname', headerName: 'Никнейм', width: 150 },
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

  // Унифицированный стиль для внутреннего контейнера
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
      <Box sx={containerSx}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <Typography variant="h5">Пользователи</Typography>
          {isAdmin && (
            <Button variant="contained" onClick={handleOpenDrawer}>
              Добавить пользователя
            </Button>
          )}
        </Stack>
        <Box sx={{ height: gridHeight, width: '100%', overflowX: 'auto' }}>
          <DataGrid<User>
            rows={users}
            columns={columns}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
            loading={isLoading}
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
                boxShadow: isDark ? `0px 1px 0px 0px var(--DataGrid-rowBorderColor) !important` : undefined,
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
                boxShadow: isDark ? `0px 1px 0px 0px var(--DataGrid-rowBorderColor) !important` : undefined,
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
                boxShadow: isDark ? `0px 1px 0px 0px var(--DataGrid-rowBorderColor) !important` : undefined,
              },
              '& .MuiDataGrid-virtualScroller': {
                '&::-webkit-scrollbar': {
                  width: '8px',
                  height: '8px',
                },
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
        <Drawer anchor="right" open={openDrawer} onClose={handleCloseDrawer}>
          <Box sx={{ width: { xs: '100%', sm: 400 }, p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Добавить пользователя
            </Typography>
            <Stack spacing={2}>
              <TextField label="Логин" name="login" value={form.login} onChange={handleChange} />
              <TextField
                label="Пароль"
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
              />
              <TextField label="Тип (admin/user)" name="type" value={form.type} onChange={handleChange} />
              <TextField label="Никнейм" name="nickname" value={form.nickname} onChange={handleChange} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
        {editUser && (
          <Dialog open={Boolean(editUser)} onClose={() => setEditUser(null)}>
            <DialogTitle>Редактировать пользователя</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Логин"
                  name="login"
                  value={editUser.login}
                  onChange={handleEditChange}
                />
                <TextField
                  label="Тип (admin/user)"
                  name="type"
                  value={editUser.type}
                  onChange={handleEditChange}
                />
                <TextField
                  label="Никнейм"
                  name="nickname"
                  value={editUser.nickname}
                  onChange={handleEditChange}
                />
                <TextField
                  label="Новый пароль (опционально)"
                  name="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditUser(null)}>Отмена</Button>
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

export default UsersPage;
