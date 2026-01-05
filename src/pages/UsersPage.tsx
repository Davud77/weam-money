import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Pencil, 
  Trash2, 
  Search, 
  Plus, 
  X, 
  ShieldAlert, 
  User as UserIcon 
} from 'lucide-react';
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

  /* Кто я — запрос к API */
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

  /* Загрузка пользователей */
  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users', isAdmin ? 'all' : 'self'],
    enabled: !!meData,
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
      // Если не админ — показываем только себя
      const u = meData?.user;
      if (!u) return [];
      return [{ id: u.id, login: u.login, type: (u.role as any) || 'user', nickname: (u as any).nickname || '' }];
    },
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  /* ---------------------------- Mutations ------------------------- */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  const create = useMutation({
    mutationFn: (u: UserForm) =>
      api(`${API_URL}/users`, { method: 'POST', body: JSON.stringify(u) }),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => showError(e.message || 'Ошибка создания'),
  });

  const update = useMutation({
    mutationFn: (u: User) =>
      api(`${API_URL}/users/${u.id}`, { method: 'PUT', body: JSON.stringify(u) }),
    onSuccess: (_, usr) => {
      if (!newPassword) {
        setEditUser(null);
        invalidate();
      } else {
        changePass.mutate({ id: (usr as any).id, pwd: newPassword });
      }
    },
    onError: (e: any) => showError(e.message || 'Ошибка обновления'),
  });

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
    onError: (e: any) => showError(e.message || 'Ошибка смены пароля'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`${API_URL}/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
    onError: (e: any) => showError(e.message || 'Ошибка удаления'),
  });

  /* ------------------------------- Handlers ------------------------------- */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };
  
  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!editUser) return;
    const { name, value } = e.target;
    setEditUser({ ...editUser, [name]: value } as User);
  };

  /* ------------------------------ Rows Filter ---------------------------- */
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
    return isAdmin ? filtered : filtered.filter((u) => u.login === myLogin);
  }, [users, search, isAdmin, myLogin]);

  /* --------------------------------- Render -------------------------------- */
  return (
    <div className="page-container">
      {/* Шапка */}
      <div className="header">
        <h2 className="text-xl font-bold m-0">Пользователи</h2>
        
        <div className="actions-block">
          
          
          {isAdmin && (
            <button className="btn" onClick={() => setCreateOpen(true)}>
              <Plus size={18} /> 
              <div className="unset">Добавить</div>
            </button>
          )}


          <div className="relative">
            <input 
              className="input" 
              placeholder="Поиск..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Таблица */}
      <div className="content">
        <div style={{ overflowX: 'auto' }}>
          <table className="table w-full block">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th style={{ textAlign: 'left' }}>Логин</th>
                <th style={{ textAlign: 'center', width: 100 }}>Роль</th>
                <th style={{ textAlign: 'left' }}>Никнейм</th>
                {isAdmin && <th style={{ width: 100, textAlign: 'center' }}>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading || meFetching ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="p-4 text-center text-soft">
                    Загрузка...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="p-4 text-center text-soft">
                    Нет пользователей
                  </td>
                </tr>
              ) : (
                rows.map((user) => (
                  <tr key={user.id} className="hover:bg-sidebar">
                    <td style={{ textAlign: 'center' }} className="text-soft">{user.id}</td>
                    <td className="font-medium">{user.login}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${user.type === 'admin' ? 'badge-danger' : 'badge-primary'}`}>
                        {user.type === 'admin' ? <ShieldAlert size={12} className="mr-1" /> : <UserIcon size={12} className="mr-1" />}
                        {user.type}
                      </span>
                    </td>
                    <td className="text-soft">{user.nickname || '—'}</td>
                    {isAdmin && (
                      <td style={{ textAlign: 'center' }}>
                        <div className="flex justify-center gap-1">
                          <button 
                            className="icon-btn" 
                            onClick={() => setEditUser(user)}
                            title="Редактировать"
                          >
                            <Pencil size={16} />
                          </button>
                          
                          {user.login !== myLogin && (
                            <button 
                              className="icon-btn danger"
                              onClick={() => {
                                if (window.confirm(`Удалить пользователя "${user.login}"?`)) {
                                  remove.mutate(user.id);
                                }
                              }}
                              title="Удалить"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Модалка создания */}
      {createOpen && (
        <div className="modal-overlay" onClick={() => setCreateOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Добавить пользователя</h3>
              <button className="icon-btn" onClick={() => setCreateOpen(false)}><X size={20}/></button>
            </div>
            
            <div className="modal-body flex-col">
              <div className="input-group">
                <label className="input-label">Логин</label>
                <input className="input" name="login" value={form.login} onChange={handleChange} />
              </div>
              <div className="input-group">
                <label className="input-label">Пароль</label>
                <input className="input" type="password" name="password" value={form.password} onChange={handleChange} />
              </div>
              <div className="input-group">
                <label className="input-label">Тип</label>
                <select className="input" name="type" value={form.type} onChange={handleChange}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Никнейм</label>
                <input className="input" name="nickname" value={form.nickname} onChange={handleChange} />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setCreateOpen(false)}>Отмена</button>
              <button className="btn" onClick={() => create.mutate(form)}>Создать</button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка редактирования */}
      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Редактировать {editUser.login}</h3>
              <button className="icon-btn" onClick={() => setEditUser(null)}><X size={20}/></button>
            </div>
            
            <div className="modal-body flex-col">
              <div className="input-group">
                <label className="input-label">Логин</label>
                <input className="input" name="login" value={editUser.login} onChange={handleEditChange} />
              </div>
              <div className="input-group">
                <label className="input-label">Тип</label>
                <select className="input" name="type" value={editUser.type} onChange={handleEditChange as any}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Никнейм</label>
                <input className="input" name="nickname" value={editUser.nickname} onChange={handleEditChange} />
              </div>
              
              <hr style={{ borderColor: 'var(--border)', margin: '10px 0' }} />
              
              <div className="input-group">
                <label className="input-label">Новый пароль (если нужно сменить)</label>
                <input 
                  className="input" 
                  type="password" 
                  placeholder="Оставьте пустым, чтобы не менять"
                  value={newPassword} 
                  onChange={(e) => setNewPassword(e.target.value)} 
                />
              </div>
            </div>

            <div className="modal-footer justify-between">
              {editUser.login !== myLogin ? (
                <button 
                  className="btn danger" 
                  onClick={() => {
                    if (window.confirm(`Удалить "${editUser.login}"?`)) {
                      remove.mutate(editUser.id);
                      setEditUser(null);
                    }
                  }}
                >
                  Удалить
                </button>
              ) : <div />}
              
              <div className="flex">
                <button className="btn secondary mr-2" onClick={() => setEditUser(null)}>Отмена</button>
                <button className="btn" onClick={() => update.mutate(editUser)}>Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersPage;