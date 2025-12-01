// src/pages/BoardPage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
  InputAdornment,
  Tooltip,
  Autocomplete,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, me } from '../lib/api';

/* ---------------------------------- Types --------------------------------- */
type ProjectDto = {
  id: number;
  contractor: string;
  project: string;
  section: string;
  direction: string;
  amount: number;
  note?: string | null;
  start?: string | null;
  end?: string | null;
  progress: number;
  status: string;
  responsible: number | null; // (бэкенд: alias p.user_id)
  [k: string]: any;
};

type ResponsibleUser = { id: number; login: string; nickname: string };

type SectionOption = {
  key: string;           // `${contractor}|${project}|${section}`
  contractor: string;
  project: string;
  section: string;
};

/* -------------------------------- Helpers -------------------------------- */
const STATUSES = [
  { key: 'Назначена', label: 'Назначена' },
  { key: 'В работе', label: 'В работе' },
  { key: 'На проверке', label: 'На проверке' },
  { key: 'Пауза', label: 'Пауза' },
  { key: 'Готово', label: 'Готово' },
] as const;

const statusKeyToClass = (k?: string) => {
  switch (k) {
    case 'Назначена': return 'assigned';
    case 'В работе': return 'inprogress';
    case 'На проверке': return 'review';
    case 'Пауза': return 'pause';
    case 'Готово': return 'done';
    default: return 'other';
  }
};

const asDate = (v?: string | Date, fb?: Date) => {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fb ?? new Date();
};
const toISO = (v?: string | Date, fb?: Date) => {
  const d = asDate(v, fb);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const isOverdue = (end?: string | null, progress?: number) =>
  !!end && new Date(end).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0) && (progress ?? 0) < 100;

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const round5 = (n: number) => Math.round(n / 5) * 5;
const asNull = (v: unknown) => (v === '' || v === undefined ? null : (v as any));

/** Чистим патч до корректных типов */
function normalizePatch(patch: Partial<ProjectDto>): Partial<ProjectDto> {
  const out: Partial<ProjectDto> = {};
  if ('status' in patch) out.status = String(patch.status ?? '');
  if ('progress' in patch) out.progress = clamp(round5(Number(patch.progress ?? 0)), 0, 100);
  if ('responsible' in patch) out.responsible = patch.responsible == null ? null : Number(patch.responsible);

  if ('contractor' in patch) out.contractor = String(patch.contractor ?? '').trim();
  if ('project' in patch) out.project = String(patch.project ?? '').trim();
  if ('section' in patch) out.section = String(patch.section ?? '').trim();
  if ('direction' in patch) out.direction = String(patch.direction ?? '').trim();
  if ('amount' in patch) out.amount = Number(patch.amount ?? 0);
  if ('note' in patch) out.note = asNull(patch.note);
  if ('start' in patch) out.start = asNull(patch.start);
  if ('end' in patch) out.end = asNull(patch.end);

  return out;
}

function isMethodNotAllowedMessage(msg?: string) {
  return !!msg && /method not allowed/i.test(msg);
}

/* --------------------------------- Page ---------------------------------- */
const STALE_15M = 15 * 60 * 1000;

const BoardPage: React.FC<{ showError: (m: string) => void }> = ({ showError }) => {
  /* -------- RBAC / режимы редактирования (роль — только с бэка) -------- */
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const isAdmin = meData?.user?.role === 'admin';

  const [apiLocked, setApiLocked] = useState<boolean>(false); // read-only при 405
  const dialogMode: 'none' | 'limited' | 'all' = apiLocked ? 'none' : (isAdmin ? 'all' : 'limited');
  const allowDnD = !apiLocked;      // статус — всем
  const allowProgress = !apiLocked; // прогресс — всем

  /* ------------------------------ Data ----------------------------------- */
  const { data: projects = [], isError, error } = useQuery<ProjectDto[]>({
    queryKey: ['projects'],
    queryFn: () => api<ProjectDto[]>('/api/projects'),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  const { data: users = [] } = useQuery<ResponsibleUser[]>({
    queryKey: ['users', 'responsible'],
    queryFn: () => api<ResponsibleUser[]>('/api/responsible'),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  const qc = useQueryClient();

  // Блокируем дублирующиеся одновременные апдейты одного поля
  const inFlight = useRef<Set<string>>(new Set());
  const keyOf = (id: number, field: string) => `${id}:${field}`;

  const update = useMutation({
    mutationFn: (p: { id: number; patch: Partial<ProjectDto>; fieldKey: string }) =>
      api(`/api/projects/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify(normalizePatch(p.patch)),
      }).finally(() => inFlight.current.delete(p.fieldKey)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
    onError: (e: any) => {
      const msg = e?.message || 'Не удалось сохранить изменения';
      if (isMethodNotAllowedMessage(msg)) {
        setApiLocked(true);
        showError('API для проектов переключилось в режим ТОЛЬКО ЧТЕНИЕ.');
      } else if (msg !== 'UNAUTHORIZED') {
        showError(msg);
      }
    },
    retry: 0,
  });

  useEffect(() => {
    if (isError && error instanceof Error && error.message !== 'UNAUTHORIZED') showError(error.message);
  }, [isError, error, showError]);

  const userById = (id?: number | null) => users.find((u) => u.id === id);

  /* ----------------------------- State ----------------------------------- */
  const [search, setSearch] = useState('');
  const [dlg, setDlg] = useState<ProjectDto | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  /* --------------------------- Filtering --------------------------------- */
  const base = useMemo(() => {
    const list = projects.filter((r) => (r.direction || '').toLowerCase() !== 'нам должны');
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((r) => `${r.section} ${r.project} ${r.contractor}`.toLowerCase().includes(q));
  }, [projects, search]);

  /* ---- Плоский список options для раздела с группировкой по проектам ---- */
  const sectionOptions: SectionOption[] = useMemo(() => {
    const map = new Map<string, SectionOption>(); // key -> option (для уникальности)
    for (const r of projects) {
      const contractor = (r.contractor || '').trim();
      const project = (r.project || '').trim();
      const section = (r.section || '').trim();
      if (!section) continue;
      const key = `${contractor}|${project}|${section}`;
      if (!map.has(key)) map.set(key, { key, contractor, project, section });
    }
    return Array.from(map.values()).sort((a, b) => {
      const gA = `${a.contractor} / ${a.project}`.localeCompare(`${b.contractor} / ${b.project}`, 'ru');
      return gA !== 0 ? gA : a.section.localeCompare(b.section, 'ru');
    });
  }, [projects]);

  /* --------------------------- Board data -------------------------------- */
  type DnDData = { id: number };
  type KanbanCol = { key: string; label: string };
  const KANBAN_COLS: KanbanCol[] = [
    { key: 'Назначена', label: 'Назначена' },
    { key: 'В работе', label: 'В работе' },
    { key: 'На проверке', label: 'На проверке' },
    { key: 'Пауза', label: 'Пауза' },
    { key: 'Готово', label: 'Готово' },
    { key: '__OTHER__', label: 'Прочее' },
  ];
  const KNOWN_KEYS: Set<string> = new Set<string>(['Назначена','В работе','На проверке','Пауза','Готово']);

  const cols = useMemo(() => {
    const map = new Map<string, ProjectDto[]>();
    KANBAN_COLS.forEach((c) => map.set(c.key, []));
    const act = base.filter((r) => Number(r.progress) < 100);
    act.forEach((t) => {
      const k: string = KNOWN_KEYS.has(t.status) ? t.status : '__OTHER__';
      map.get(k)!.push(t);
    });
    return KANBAN_COLS.map((c) => ({ meta: c, items: map.get(c.key)! }));
  }, [base]);

  /* -------------------------------- JSX ---------------------------------- */
  return (
    <Box className="root board-root">
      {/* Header */}
      <Box className="header board-header">
        <Typography variant="h6" className="title board-title">
          Доска
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" className="actions">
          {dialogMode === 'none' && (
            <Chip size="small" label="только чтение" color="default" className="chip chip--small" />
          )}

          <TextField
            size="small"
            placeholder="Поиск…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search board-search"
            InputProps={{
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearch('')} aria-label="Очистить">
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
        </Stack>
      </Box>

      {/* Content */}
      <Box className="content board-content">
        {cols.every((c) => c.items.length === 0) ? (
          <Typography className="board-empty">Нет активных задач.</Typography>
        ) : (
          <Box className="board-scroll">
            <Box className="board-grid">
              {cols.map((col) => (
                <Box
                  key={col.meta.key}
                  className={`kanban-col ${dialogMode === 'none' ? 'kanban-col--readonly' : ''}`}
                  onDragOver={(e) => { if (allowDnD) e.preventDefault(); }}
                  onDrop={(e) => {
                    if (!allowDnD) return;
                    const payload = e.dataTransfer.getData('application/json');
                    try {
                      const { id } = JSON.parse(payload) as DnDData;
                      const task = base.find((x) => x.id === id);
                      if (!task) return;

                      const newKey = col.meta.key === '__OTHER__' ? 'Назначена' : col.meta.key;
                      if (task.status === newKey) return;

                      const fkey = keyOf(task.id, 'status');
                      if (inFlight.current.has(fkey)) return;
                      inFlight.current.add(fkey);

                      update.mutate({ id: task.id, patch: { status: newKey }, fieldKey: fkey });
                    } catch { /* noop */ }
                  }}
                >
                  {/* Column header */}
                  <Stack direction="row" spacing={1} alignItems="center" className="kanban-col__header">
                    <Chip
                      size="small"
                      label={col.meta.label}
                      className={`status-chip status-${statusKeyToClass(col.meta.key)}`}
                    />
                    <Typography variant="caption" className="muted">
                      ({col.items.length})
                    </Typography>
                  </Stack>

                  {/* Cards */}
                  <Stack spacing={1} className="kanban-col__list">
                    {col.items.map((item) => {
                      const u = userById(item.responsible);
                      const overdue = isOverdue(item.end, item.progress);
                      const userLabel = u?.nickname || u?.login || '—';
                      const userInitial = (userLabel || '?').slice(0, 1).toUpperCase();

                      return (
                        <Box
                          key={item.id}
                          draggable={allowDnD}
                          onDragStart={(e) => {
                            if (!allowDnD) return;
                            e.dataTransfer.setData('application/json', JSON.stringify({ id: item.id }));
                          }}
                          className={`board-card ${dialogMode === 'none' ? 'is-readonly' : ''}`}
                        >
                          <Stack spacing={0.75}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Tooltip title={item.section || '(без раздела)'} arrow disableInteractive>
                                <Typography
                                  variant="body2"
                                  noWrap
                                  className="section-title t-strong"
                                >
                                  {item.section || '(без раздела)'}
                                </Typography>
                              </Tooltip>

                              {dialogMode !== 'none' && (
                                <IconButton
                                  size="small"
                                  onClick={() => setDlg(item)}
                                  className="edit-btn"
                                  aria-label="Редактировать"
                                >
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              )}
                            </Stack>

                            <Typography variant="caption" className="muted" noWrap>
                              {item.contractor} / {item.project}
                            </Typography>

                            {/* Ответственный: аватар + имя */}
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Avatar className="avatar-compact" title={userLabel}>
                                {userInitial}
                              </Avatar>
                              <Typography variant="caption" className="muted" noWrap title={userLabel}>
                                {userLabel}
                              </Typography>
                            </Stack>

                            {/* Progress slider */}
                            <Stack spacing={0.25}>
                              <Slider
                                size="small"
                                value={Number(item.progress) || 0}
                                step={5}
                                min={0}
                                max={100}
                                disabled={!allowProgress}
                                onChangeCommitted={(_, v) => {
                                  if (!allowProgress) return;
                                  const val = Array.isArray(v) ? v[0] : (v as number);
                                  const clamped = round5(clamp(Number(val || 0), 0, 100));

                                  const fkey = keyOf(item.id, 'progress');
                                  if (inFlight.current.has(fkey)) return;
                                  inFlight.current.add(fkey);

                                  update.mutate({
                                    id: item.id,
                                    patch: { progress: clamped },
                                    fieldKey: fkey,
                                  });
                                }}
                              />
                              <Stack direction="row" justifyContent="space-between">
                                <Typography variant="caption" className="text-light">
                                  {`${Math.round(Number(item.progress) || 0)}%`}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  className={overdue ? 'date overdue' : 'date muted'}
                                >
                                  {item.end ? new Date(item.end).toLocaleDateString('ru-RU') : '—'}
                                </Typography>
                              </Stack>
                            </Stack>
                          </Stack>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {/* Edit dialog — admin: все поля; user: только статус/даты */}
      {dialogMode !== 'none' && (
        <EditDialog
          mode={dialogMode === 'all' ? 'all' : 'limited'}
          users={users}
          sectionOptions={sectionOptions}
          value={dlg}
          onClose={() => setDlg(null)}
          onSave={(v) => {
            if (!v) return;

            // Собираем патч с учётом ролей:
            const patch = (dialogMode === 'all')
              ? normalizePatch({
                  contractor: v.contractor,
                  project: v.project,
                  section: v.section,
                  direction: v.direction,
                  amount: v.amount,
                  note: v.note,
                  start: v.start,
                  end: v.end,
                  responsible: v.responsible,
                  status: v.status,
                })
              : normalizePatch({
                  start: v.start,
                  end: v.end,
                  status: v.status,
                });

            const fkey = `${v.id}:dialog`;
            if (inFlight.current.has(fkey)) return;
            inFlight.current.add(fkey);

            update.mutate({ id: v.id, patch, fieldKey: fkey });
            setDlg(null);
          }}
        />
      )}
    </Box>
  );
};

/* --------------------------- Dialog – Edit task --------------------------- */
const EditDialog: React.FC<{
  mode: 'all' | 'limited';
  users: ResponsibleUser[];
  sectionOptions: SectionOption[];
  value: ProjectDto | null;
  onClose: () => void;
  onSave: (v: ProjectDto) => void;
}> = ({ mode, users, sectionOptions, value, onClose, onSave }) => {
  const [dlg, setDlg] = useState<ProjectDto | null>(value);
  useEffect(() => setDlg(value), [value]);

  const isAll = mode === 'all';
  const disabledAdminOnly = !isAll;

  // Текущее значение как объект options
  const currentOption = useMemo<SectionOption | null>(() => {
    if (!dlg) return null;
    const c = (dlg.contractor || '').trim();
    const p = (dlg.project || '').trim();
    const s = (dlg.section || '').trim();
    if (!s) return null;
    const key = `${c}|${p}|${s}`;
    return (
      sectionOptions.find(o => o.key === key) ||
      // Если в справочнике нет — добавим временную опцию
      { key, contractor: c, project: p, section: s }
    );
  }, [dlg?.contractor, dlg?.project, dlg?.section, sectionOptions]);

  if (!dlg) {
    return (
      <Dialog open={false} onClose={onClose}>
        <></>
      </Dialog>
    );
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} PaperProps={{ className: 'board-dialog-paper' }}>
      <DialogTitle>Редактирование задачи</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} mt={1}>
          {/* Раздел — только админ; Autocomplete с группировкой по проектам */}
          <Autocomplete<SectionOption, false, false, false>
            disabled={disabledAdminOnly}
            options={sectionOptions}
            value={currentOption}
            onChange={(_, opt) => {
              if (!opt) return;
              setDlg({ ...dlg, contractor: opt.contractor, project: opt.project, section: opt.section });
            }}
            groupBy={(opt) => `${opt.contractor || ''} / ${opt.project || ''}`}
            getOptionLabel={(opt) => opt.section}
            isOptionEqualToValue={(opt, val) => opt.key === val.key}
            renderInput={(params) => (
              <TextField {...params} label="Задача (раздел)" placeholder="Выберите раздел" />
            )}
          />

          {/* Статус — всем */}
          <TextField
            label="Статус"
            select
            value={dlg.status}
            onChange={(e) => setDlg({ ...dlg, status: e.target.value })}
            fullWidth
          >
            {STATUSES.map((s) => (
              <MenuItem key={s.key} value={s.key}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>

          {/* Даты — всем */}
          <Stack direction="row" spacing={1}>
            <TextField
              label="Начало"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={dlg.start ? toISO(dlg.start) : ''}
              onChange={(e) => setDlg({ ...dlg, start: e.target.value })}
              fullWidth
            />
            <TextField
              label="Срок"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={dlg.end ? toISO(dlg.end) : ''}
              onChange={(e) => setDlg({ ...dlg, end: e.target.value })}
              fullWidth
            />
          </Stack>

          {/* Ответственный — только админ */}
          <TextField
            label="Ответственный"
            select
            value={dlg.responsible ?? ''}
            onChange={(e) =>
              setDlg({ ...dlg, responsible: e.target.value === '' ? null : Number(e.target.value) })
            }
            fullWidth
            disabled={disabledAdminOnly}
          >
            {users.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {u.nickname || u.login}
              </MenuItem>
            ))}
          </TextField>

          {/* Сумма — только админ */}
          <TextField
            label="Сумма"
            type="number"
            value={dlg.amount}
            onChange={(e) => setDlg({ ...dlg, amount: +e.target.value })}
            fullWidth
            disabled={disabledAdminOnly}
          />

          {/* Примечание — только админ */}
          <TextField
            label="Примечание"
            value={dlg.note ?? ''}
            onChange={(e) => setDlg({ ...dlg, note: e.target.value })}
            multiline
            rows={2}
            fullWidth
            disabled={disabledAdminOnly}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} className="btn-cancel">
          Отмена
        </Button>
        <Button variant="contained" onClick={() => dlg && onSave(dlg)} className="bluebutton">
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BoardPage;
