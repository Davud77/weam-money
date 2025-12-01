// src/pages/UsersPage.tsx
/* -------------------------------------------------------------------------- */
/*  UsersPage — DataGrid в стиле TransactionsPage (унифицированное оформление)*/
/*  Правила доступа (UI):                                                     */
/*    • admin  → видит всех, может создавать/редактировать/удалять           */
/*    • user   → видит только себя, без действий и без диалогов               */
/*  Итоговое решение о правах — на бэкенде (RBAC, 403/405)                    */
/* -------------------------------------------------------------------------- */
import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useTheme,
  useMediaQuery,
  MenuItem,
  Stack,
} from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, me } from '../lib/api';

/* --------------------------------- Types ---------------------------------- */
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

type UsersPageProps = { showError: (msg: string) => void };

/* --------------------------------- Consts --------------------------------- */
const API_URL = '/api';
const STALE_15M = 15 * 60 * 1000;
const emptyForm: UserForm = { login: '', password: '', type: 'user', nickname: '' };

/* --------------------------------- Page ----------------------------------- */
const UsersPage: React.FC<UsersPageProps> = ({ showError }) => {
  const qc = useQueryClient();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));

  /* Кто я — только с сервера */
  const { data: meData, isFetching: meFetching } = useQuery({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const myLogin = meData?.user?.login || '';
  const myRole = (meData?.user?.role as 'admin' | 'user' | undefined) || 'user';
  const isAdmin = myRole === 'admin';

  /* Состояния UI */
  const [createOpen, setCreateOpen]   = useState(false);
  const [form, setForm]               = useState<UserForm>(emptyForm);
  const [editUser, setEditUser]       = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [search, setSearch]           = useState('');

  /* Данные:
     - admin → /api/users (все)
     - user  → только сам (на основе /api/me) */
  const { data: users = [], isLoading, isError, error } = useQuery<User[]>({
    queryKey: ['users', isAdmin ? 'all' : 'self'],
    enabled: !!meData, // ждём /api/me
    queryFn: async () => {
      if (isAdmin) {
        const raw = await api<Array<{ id: number; login: string; role: 'admin' | 'user'; nickname?: string | null }>>(
          `${API_URL}/users`
        );
        return (raw || []).map((u) => ({
          id: u.id,
          login: u.login,
          type: u.role,
          nickname: u.nickname || '',
        }));
      }
      // user → только сам
      const u = meData?.user;
      if (!u) return [];
      return [{ id: u.id, login: u.login, type: (u.role as any) || 'user', nickname: (u as any).nickname || '' }];
    },
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    if (isError && error instanceof Error) showError(error.message);
  }, [isError, error, showError]);

  /* ---------------------------- Mutations (admin) ------------------------- */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  // Создание
  const create = useMutation({
    mutationFn: (u: UserForm) =>
      api(`${API_URL}/users`, {
        method: 'POST',
        body: JSON.stringify(u),
      }),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setForm(emptyForm);
    },
    onError: (e: unknown) =>
      e instanceof Error && e.message !== 'UNAUTHORIZED' && e.message !== 'Недостаточно прав' && showError(e.message),
    retry: 0,
  });

  // Обновление карточки пользователя
  const update = useMutation({
    mutationFn: (u: User) =>
      api(`${API_URL}/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify(u),
      }),
    onSuccess: (_, usr) => {
      if (!newPassword) {
        setEditUser(null);
        invalidate();
      } else {
        changePass.mutate({ id: (usr as any).id, pwd: newPassword });
      }
    },
    onError: (e: unknown) =>
      e instanceof Error && e.message !== 'UNAUTHORIZED' && e.message !== 'Недостаточно прав' && showError(e.message),
    retry: 0,
  });

  // Смена пароля
  const changePass = useMutation({
    mutationFn: ({ id, pwd }: { id: number; pwd: string }) =>
      api(`${API_URL}/users/${id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ newPassword: pwd }),
      }),
    onSuccess: () => {
      setNewPassword('');
      setEditUser(null);
      invalidate();
    },
    onError: (e: unknown) =>
      e instanceof Error && e.message !== 'UNAUTHORIZED' && e.message !== 'Недостаточно прав' && showError(e.message),
    retry: 0,
  });

  // Удаление
  const remove = useMutation({
    mutationFn: (id: number) =>
      api(`${API_URL}/users/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      e instanceof Error && e.message !== 'UNAUTHORIZED' && e.message !== 'Недостаточно прав' && showError(e.message),
    retry: 0,
  });

  /* ------------------------------- Handlers ------------------------------- */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };
  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editUser) return;
    const { name, value } = e.target;
    setEditUser({ ...editUser, [name]: value } as User);
  };

  /* ------------------------------ Rows/Columns ---------------------------- */
  const rows = useMemo(() => {
    const base = users;
    const q = search.trim().toLowerCase();
    const filtered = q
      ? base.filter(
          (u) =>
            String(u.id).includes(q) ||
            u.login.toLowerCase().includes(q) ||
            (u.nickname || '').toLowerCase().includes(q) ||
            u.type.toLowerCase().includes(q),
        )
      : base;
    // Для подстраховки: если не admin — показываем только себя
    return isAdmin ? filtered : filtered.filter((u) => u.login === myLogin);
  }, [users, search, isAdmin, myLogin]);

  const baseColumns: GridColDef<User>[] = [
    { field: 'id', headerName: 'ID', width: 90, align: 'center', headerAlign: 'center' },
    {
      field: 'login',
      headerName: 'Логин',
      flex: 1.2,
      renderCell: (p) => (
        <Typography variant="body2" className="t-primary t-strong">
          {p.value}
        </Typography>
      ),
    },
    {
      field: 'type',
      headerName: 'Тип',
      width: 130,
      align: 'center',
      headerAlign: 'center',
      sortable: true,
      renderCell: (p) => {
        const v = (p.value as User['type']) || 'user';
        return (
          <Typography
            variant="body2"
            className={`users-type ${v === 'admin' ? 'users-type--admin' : 'users-type--user'}`}
          >
            {v}
          </Typography>
        );
      },
    },
    {
      field: 'nickname',
      headerName: 'Никнейм',
      flex: 1,
      renderCell: (p) => <Typography variant="body2" className="t-primary">{p.value || '—'}</Typography>,
    },
  ];

  const actionCol: GridColDef<User> = {
    field: 'actions',
    headerName: 'Действ.',
    width: 100,
    sortable: false,
    filterable: false,
    disableExport: true as any,
    align: 'center',
    headerAlign: 'center',
    renderCell: (p) => {
      const row = p.row as User;
      return (
        <Stack direction="row" spacing={0.5}>
          <IconButton
            size="small"
            onClick={() => setEditUser(row)}
            aria-label="edit"
            className="icon-edit"
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label="delete"
            disabled={row.login === myLogin}
            onClick={() => {
              if (window.confirm(`Удалить пользователя "${row.login}"?`)) {
                remove.mutate(row.id);
              }
            }}
            className="users-delete-btn"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      );
    },
  };

  const columns = useMemo<GridColDef<User>[]>(() => {
    // Для обычного пользователя — без колонки действий
    return isAdmin ? [...baseColumns, actionCol] : baseColumns;
  }, [isAdmin, myLogin, remove]); // deps для корректной перерисовки actionCol

  /* --------------------------------- Render -------------------------------- */
  return (
    <Box className="root users-root users-page transactions-page">
      {/* Шапка — универсальные классы */}
      <Box className="header users-header">
        <Typography variant="h6" className="title users-title">
          Пользователи
        </Typography>

        <Stack direction="row" spacing={1} className="actions header-actions" alignItems="center">
          <TextField
            size="small"
            placeholder="Поиск…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search users-search"
          />
          {isAdmin && (
            <Button
              variant="contained"
              size="small"
              className="bluebutton tiny-btn"
              onClick={() => setCreateOpen(true)}
            >
              Добавить пользователя
            </Button>
          )}
        </Stack>
      </Box>

      {/* Контент */}
      <Box className="content users-content filters-section">
        <Box className="grid-wrapper">
          <DataGrid
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            loading={isLoading || meFetching}
            initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
            pageSizeOptions={[100, 250, 500]}
            disableRowSelectionOnClick
            density="compact"
            className="transactions-grid grid--dark-head"
            getRowHeight={() => 'auto'}
          />
        </Box>
      </Box>

      {/* Диалог — добавление (только admin) */}
      {isAdmin && (
        <Dialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          fullWidth
          maxWidth={mobile ? 'sm' : 'md'}
          PaperProps={{ className: 'dialog-paper' }}
        >
          <DialogTitle className="with-bottom-border">Добавить пользователя</DialogTitle>
          <DialogContent dividers>
            <Box className="chip-grid">
              <TextField label="Логин"    name="login"    value={form.login}    onChange={handleChange} className="users-field" />
              <TextField label="Пароль"   name="password" type="password" value={form.password} onChange={handleChange} className="users-field" />
              <TextField select label="Тип" name="type" value={form.type} onChange={handleChange} className="users-field">
                <MenuItem value="user">user</MenuItem>
                <MenuItem value="admin">admin</MenuItem>
              </TextField>
              <TextField label="Никнейм" name="nickname" value={form.nickname} onChange={handleChange} className="users-field" />
            </Box>
          </DialogContent>
          <DialogActions className="with-top-border">
            <Button onClick={() => setCreateOpen(false)} className="btn-text-no-transform">
              Отмена
            </Button>
            <Button variant="contained" onClick={() => create.mutate(form)} className="bluebutton">
              Добавить
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Диалог — редактирование (только admin) */}
      {isAdmin && editUser && (
        <Dialog
          open
          onClose={() => setEditUser(null)}
          fullWidth
          maxWidth={mobile ? 'sm' : 'md'}
          PaperProps={{ className: 'dialog-paper' }}
        >
          <DialogTitle className="with-bottom-border">Редактировать пользователя</DialogTitle>
          <DialogContent dividers>
            <Box className="chip-grid">
              <TextField label="Логин" name="login" value={editUser.login} onChange={handleEditChange} className="users-field" />
              <TextField select label="Тип" name="type" value={editUser.type} onChange={handleEditChange} className="users-field">
                <MenuItem value="user">user</MenuItem>
                <MenuItem value="admin">admin</MenuItem>
              </TextField>
              <TextField label="Никнейм" name="nickname" value={editUser.nickname} onChange={handleEditChange} className="users-field" />
              <TextField
                label="Новый пароль (опционально)"
                name="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="users-field"
              />
            </Box>
          </DialogContent>
          <DialogActions className="with-top-border users-dialog-actions">
            {editUser.login !== myLogin && (
              <Button
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => {
                  if (window.confirm(`Удалить пользователя "${editUser.login}"?`)) {
                    remove.mutate(editUser.id);
                    setEditUser(null);
                  }
                }}
                className="btn-text-no-transform"
              >
                Удалить
              </Button>
            )}
            <Box className="flex-grow" />
            <Button onClick={() => setEditUser(null)} className="btn-text-no-transform">
              Отмена
            </Button>
            <Button variant="contained" onClick={() => update.mutate(editUser!)} className="bluebutton">
              Сохранить
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};

export default UsersPage;
