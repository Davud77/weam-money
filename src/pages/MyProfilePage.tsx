// src/pages/MyProfilePage.tsx
import React from 'react';
import { Box, Typography, Button, Stack, TextField, Avatar, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, me } from '../lib/api';

type Role = 'admin' | 'user';

// что реально возвращает API (/api/me)
type ApiMeUser = { id: number; login: string; role: Role; nickname?: string | null };
type MeResponse = { user: ApiMeUser | null };

const MyProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ---- кто я (только для UX)
  const { data: meData, isFetching: meFetching } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => me(), // важно: сигнатура -> Promise<MeResponse>
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const user = meData?.user ?? null;
  const role: Role = user?.role ?? 'user';

  // ---- локальное состояние формы
  const [login, setLogin] = React.useState<string>('');
  const [nickname, setNickname] = React.useState<string>('');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user) {
      setLogin(user.login || '');
      setNickname(user.nickname || '');
    }
  }, [user]);

  // ---- сохранить профиль
  const updateMe = useMutation({
    mutationFn: async (payload: { id: number; login: string; nickname: string }) => {
      // Решение о правах на бэке (RBAC). Передаём роль как есть.
      const body = { id: payload.id, login: payload.login, type: role, nickname: payload.nickname };
      return api(`/api/users/${payload.id}`, { method: 'PUT', body: JSON.stringify(body) });
    },
    onSuccess: async () => {
      setOkMsg('Профиль сохранён');
      setErrorMsg(null);
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: unknown) => {
      const msg = (e as Error)?.message || '';
      if (/405/.test(msg) || /read[-\s]?only/i.test(msg)) {
        setErrorMsg('Сохранение профиля недоступно: сервер в режиме read-only.');
      } else if (/403/.test(msg) || /forbidden/i.test(msg)) {
        setErrorMsg('Нет прав для изменения профиля.');
      } else {
        setErrorMsg(msg || 'Не удалось сохранить профиль');
      }
      setOkMsg(null);
    },
    retry: 0,
  });

  // ---- выход
  const logout = useMutation({
    mutationFn: () => api('/api/logout', { method: 'POST' }),
    onSettled: () => navigate('/login', { replace: true }),
  });

  const handleSave = async () => {
    if (!user?.id) return;
    setErrorMsg(null);
    setOkMsg(null);
    await updateMe.mutateAsync({ id: user.id, login: login.trim(), nickname: nickname.trim() });
  };

  /* --------------------------------- UI ---------------------------------- */
  return (
    <Box className="profile-page">
      <Box className="header">
        <Typography variant="h6" className="title">Мой профиль</Typography>
        <Stack direction="row" spacing={1} className="header-actions">
          <Button
            variant="contained"
            size="small"
            className="bluebutton tiny-btn"
            disabled={meFetching || updateMe.isPending || !login.trim()}
            onClick={handleSave}
          >
            {updateMe.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="error"
            className="btn-text-no-transform"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Выйти
          </Button>
        </Stack>
      </Box>

      <Box className="content">
        <Box className="content-card profile-card">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start" className="profile-stack">
            <Box className="profile-avatar">
              <Avatar className="avatar avatar--xl" src={undefined} alt={nickname || login || 'avatar'}>
                {(nickname || login || '?').slice(0, 1).toUpperCase()}
              </Avatar>
            </Box>

            <Box className="profile-form">
              <Stack spacing={2}>
                {errorMsg && <Alert severity="error" onClose={() => setErrorMsg(null)}>{errorMsg}</Alert>}
                {okMsg && <Alert severity="success" onClose={() => setOkMsg(null)}>{okMsg}</Alert>}

                <TextField label="Логин" value={login} onChange={(e) => setLogin(e.target.value)} fullWidth className="dark-input" />
                <TextField label="Никнейм" value={nickname} onChange={(e) => setNickname(e.target.value)} fullWidth className="dark-input" />
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};

export default MyProfilePage;
