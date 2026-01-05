import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  LogOut, 
  Save, 
  User as UserIcon, 
  AlertCircle, 
  CheckCircle2 
} from 'lucide-react';
import { api, me } from '../lib/api';

type Role = 'admin' | 'user';

// Типы API
type ApiMeUser = { id: number; login: string; role: Role; nickname?: string | null };
type MeResponse = { user: ApiMeUser | null };

const MyProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ---- Загрузка данных ----
  const { data: meData, isFetching: meFetching } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const user = meData?.user ?? null;
  const role: Role = user?.role ?? 'user';

  // ---- Локальное состояние ----
  const [login, setLogin] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setLogin(user.login || '');
      setNickname(user.nickname || '');
    }
  }, [user]);

  // ---- Сохранение ----
  const updateMe = useMutation({
    mutationFn: async (payload: { id: number; login: string; nickname: string }) => {
      // Сохраняем логику: роль отправляем ту же, что и была
      const body = { id: payload.id, login: payload.login, type: role, nickname: payload.nickname };
      return api(`/api/users/${payload.id}`, { method: 'PUT', body: JSON.stringify(body) });
    },
    onSuccess: async () => {
      setOkMsg('Профиль сохранён');
      setErrorMsg(null);
      await qc.invalidateQueries({ queryKey: ['me'] });
      // Скрываем успех через 3 сек
      setTimeout(() => setOkMsg(null), 3000);
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
  });

  // ---- Выход ----
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

  const avatarLetter = (nickname || login || '?').slice(0, 1).toUpperCase();

  return (
    <div className="page-container">
      {/* Шапка */}
      <div className="header">
        <h2 className="text-xl font-bold m-0">Профиль</h2>
        
        <div className="actions-block">
          <button
            className="btn"
            disabled={meFetching || updateMe.isPending || !login.trim()}
            onClick={handleSave}
          >
            <Save size={18} />
            <div className="unset">{updateMe.isPending ? 'Сохранение...' : 'Сохранить'}</div>
            
          </button>
          
          <button
            className="btn danger"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut size={18} />
            <div className="unset">Выйти</div>
            
          </button>
        </div>
      </div>

      {/* Контент */}
      <div className="content profile-content">
        
        {/* Аватар (Слева) */}
        <div className="profile-sidebar">
          <div className="avatar-xl">
            {avatarLetter}
          </div>
          <div className="text-center mt-2">
            <div className="font-bold text-xl">{login}</div>
            <div className="text-soft text-sm">{role}</div>
          </div>
        </div>

        {/* Форма (Справа) */}
        <div className="profile-form">
          {/* Сообщения об ошибках/успехе */}
          {errorMsg && (
            <div className="alert alert-error mb-4">
              <AlertCircle size={20} />
              <span>{errorMsg}</span>
            </div>
          )}
          
          {okMsg && (
            <div className="alert alert-success mb-4">
              <CheckCircle2 size={20} />
              <span>{okMsg}</span>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Логин</label>
            <input 
              className="input" 
              value={login} 
              onChange={(e) => setLogin(e.target.value)} 
              placeholder="Логин"
            />
          </div>

          <div className="input-group">
            <label className="input-label">Никнейм (отображаемое имя)</label>
            <input 
              className="input" 
              value={nickname} 
              onChange={(e) => setNickname(e.target.value)} 
              placeholder="Иван Иванов"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyProfilePage;