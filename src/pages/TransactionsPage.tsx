// src/pages/TransactionsPage.tsx
import React from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Menu, MenuItem, Popover, Stack, TextField, Typography, useMediaQuery, useTheme,
  IconButton
} from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, me } from '../lib/api';
import { fmtMoney } from '../lib/format';

/* ------------------------------- Types ----------------------------------- */
type OperationType = 'Расход' | 'Доход';

export interface Transaction {
  id: number;
  contractor: string;
  project: string;
  section: string;
  responsible: string;
  date: string | ''; // '' — плановая
  total: number;
  remainder: number;
  operationType: OperationType;
  note?: string;
  project_id?: number | null;
}

interface ResponsibleUser {
  id: number;
  login: string;
  nickname: string;
}

interface ProjectRow {
  id: number;
  contractor: string;
  project: string;
  section?: string;
  sections?: string;
}

type SectionOption = {
  key: string;
  projectId: number;
  contractor: string;
  project: string;
  section: string;
};

type QueryResponse = { rows: Transaction[] };

/* ------------------------------ Constants -------------------------------- */
const API = '/api';
const STALE_15M = 15 * 60 * 1000;

const empty: Omit<Transaction, 'id' | 'remainder' | 'contractor' | 'project' | 'section'> = {
  responsible: '', date: '',
  total: 0, operationType: 'Расход', note: '',
  project_id: null,
};

const labels: Record<string, string> = {
  id: 'ID',
  operationType: 'Тип',
  project_key: 'Проект ключ',
  section_key: 'Раздел ключ',
  responsible: 'Счёт',
  date: 'Дата',
  total: 'Сумма',
  remainder: 'Остаток',
  note: 'Примечание',
};

const formatISO = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const getQuarter = (d: Date) => Math.floor(d.getMonth() / 3);

const firstDayOfMonth   = new Date(today.getFullYear(), today.getMonth(), 1);
const lastDayOfMonth    = new Date(today.getFullYear(), today.getMonth() + 1, 0);
const firstDayOfQuarter = new Date(today.getFullYear(), getQuarter(today) * 3, 1);
const lastDayOfQuarter  = new Date(today.getFullYear(), getQuarter(today) * 3 + 3, 0);
const firstDayOfYear    = new Date(today.getFullYear(), 0, 1);
const lastDayOfYear     = new Date(today.getFullYear(), 11, 31);

const prevMonth       = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const prevMonthStart  = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
const prevMonthEnd    = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0);
const prevQuarterDate = new Date(today.getFullYear(), getQuarter(today) * 3 - 3, 1);
const prevQuarterStart= new Date(prevQuarterDate.getFullYear(), prevQuarterDate.getMonth(), 1);
const prevQuarterEnd  = new Date(prevQuarterDate.getFullYear(), prevQuarterDate.getMonth() + 3, 0);
const prevYearStart   = new Date(today.getFullYear() - 1, 0, 1);
const prevYearEnd     = new Date(today.getFullYear() - 1, 11, 31);

/* ------------------------------- Helpers --------------------------------- */
const toIntOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Получить «section» из таблицы проектов по project_id. */
function getProjectSection(projects: ProjectRow[], pid?: number | null): string {
  if (!Number.isFinite(Number(pid))) return '—';
  const pr = projects.find(p => Number(p.id) === Number(pid));
  if (!pr) return '—';
  const raw = (pr.section ?? pr.sections ?? '').toString().trim();
  if (!raw) return '—';
  const parts = raw.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  return (parts[0] || raw) || '—';
}

/* ------------------------------ Form ------------------------------------- */
type FormProps = {
  value: Partial<Transaction>;
  users: ResponsibleUser[];
  onChange: (v: Partial<Transaction>) => void;
  isEdit?: boolean;
  sectionOptions: SectionOption[];
};

const Form: React.FC<FormProps> = ({ value, onChange, users, isEdit, sectionOptions }) => {
  const currentOption: SectionOption | null = React.useMemo(() => {
    const pid = toIntOrNull(value.project_id);
    const s = (value.section ?? '').trim().toLowerCase();
    return sectionOptions.find(o => o.projectId === pid && o.section.trim().toLowerCase() === s) ?? null;
  }, [value.project_id, value.section, sectionOptions]);

  return (
    <Stack spacing={2}>
      {/* Раздел ключ (через выбор секции внутри проекта) */}
      <Autocomplete
        options={sectionOptions}
        value={currentOption}
        onChange={(_, opt) => { if (opt) onChange({ ...value, project_id: opt.projectId, section: opt.section }); }}
        groupBy={(opt) => `${opt.contractor || '—'} • ${opt.project || '—'}`}
        getOptionLabel={(opt) => opt.section || '—'}
        renderInput={(params) => (
          <TextField {...params} label={labels['section_key']} className="dark-input" autoFocus />
        )}
        isOptionEqualToValue={(o, v) => o.key === v.key}
        clearOnEscape
        slotProps={{ paper: { className: 'autocomplete-paper' } }}
        ListboxProps={{ className: 'autocomplete-listbox' }}
      />

      <TextField select fullWidth label={labels['operationType']}
        value={value.operationType ?? 'Расход'}
        onChange={(e) => onChange({ ...value, operationType: e.target.value as OperationType })}
        className="dark-input"
      >
        <MenuItem value="Доход">Доход</MenuItem>
        <MenuItem value="Расход">Расход</MenuItem>
      </TextField>

      <TextField fullWidth label={labels['date']} type="date"
        value={value.date ?? ''} onChange={(e) => onChange({ ...value, date: e.target.value })}
        InputLabelProps={{ shrink: true }} className="dark-input"
      />

      <TextField fullWidth label={labels['total']} type="number"
        value={value.total ?? ''} onChange={(e) => onChange({ ...value, total: +e.target.value })}
        className="dark-input"
      />

      <TextField fullWidth label={labels['note']} value={value.note ?? ''}
        onChange={(e) => onChange({ ...value, note: e.target.value })}
        multiline rows={2} className="dark-input"
      />

      {/* Счёт — отображается и при создании, и при редактировании */}
      <TextField select fullWidth label={labels['responsible']}
        value={value.responsible ?? ''} onChange={(e) => onChange({ ...value, responsible: e.target.value })}
        className="dark-input"
      >
        {users.map((u) => (
          <MenuItem key={u.id} value={u.login}>
            {u.nickname ? `${u.nickname} (${u.login})` : u.login}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
};

/* ------------------------------ Page ------------------------------------- */
const TransactionsPage: React.FC<{ showError: (msg: string) => void }> = ({ showError }) => {
  const qc = useQueryClient();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));

  /* Роль пользователя — только с сервера */
  const { data: meData, isFetching: meFetching } = useQuery({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const isAdmin = meData?.user?.role === 'admin';

  const { data: users = [] } = useQuery<ResponsibleUser[]>({
    queryKey: ['users', 'responsible'],
    queryFn: () => api<ResponsibleUser[]>(`${API}/responsible`),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  const { data: projects = [] } = useQuery<ProjectRow[]>({
    queryKey: ['projects'],
    queryFn: () => api<ProjectRow[]>(`${API}/projects`),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [formState, setFormState] = React.useState<Partial<Transaction>>(empty);
  const isEdit = 'id' in formState;

  const [dateRange, setDateRange] = React.useState<{ from?: string; to?: string }>({});
  const [anchorDate, setAnchorDate] = React.useState<HTMLElement | null>(null);

  const [operationFilter, setOperationFilter] = React.useState<'all' | 'income' | 'expense'>('all');
  const [anchorOp, setAnchorOp] = React.useState<HTMLElement | null>(null);

  const [planFilter, setPlanFilter] = React.useState<'all' | 'planned' | 'actual'>('all');
  const [anchorPlan, setAnchorPlan] = React.useState<HTMLElement | null>(null);

  const [accountFilter, setAccountFilter] = React.useState<string>('all');
  const [anchorAcc, setAnchorAcc] = React.useState<HTMLElement | null>(null);

  const [projectKeyFilter, setProjectKeyFilter] = React.useState<number | 'all'>('all');
  const [anchorProj, setAnchorProj] = React.useState<HTMLElement | null>(null);

  const [amountRange, setAmountRange] = React.useState<{ min?: number; max?: number }>({});
  const [amountDialogOpen, setAmountDialogOpen] = React.useState(false);
  const [amountTemp, setAmountTemp] = React.useState<{ min?: number; max?: number }>({});

  /* Секции проектов для выбора в форме */
  const sectionOptions = React.useMemo<SectionOption[]>(() => {
    const opts: SectionOption[] = [];
    projects.forEach((p) => {
      const pid = Number(p.id);
      const contractor = p.contractor || '—';
      const projName = p.project || '—';
      const raw = (p.sections ?? p.section ?? '').toString();
      const parts = raw ? raw.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean) : [];
      parts.forEach((sec) => opts.push({ key: `${pid}|${sec}`, projectId: pid, contractor, project: projName, section: sec }));
    });
    const coll = new Intl.Collator('ru');
    opts.sort((a, b) => coll.compare(a.contractor, b.contractor) || coll.compare(a.project, b.project) || coll.compare(a.section, b.section));
    return opts;
  }, [projects]);

  /* === ГРУППИРОВКА ПРОЕКТОВ ДЛЯ ФИЛЬТРА (без дублей) ===
     Для каждой пары «Контрагент • Проект» собираем список всех project_id.
     Representative id = минимальный id, чтобы не ломать текущее состояние. */
  const projectKeyOptions = React.useMemo(
    () => {
      const groups = new Map<string, number[]>();
      for (const p of projects) {
        const label = `${p.contractor || '—'} • ${p.project || '—'}`.trim();
        const pid = Number(p.id);
        const arr = groups.get(label) || [];
        arr.push(pid);
        groups.set(label, arr);
      }
      const list = Array.from(groups.entries()).map(([label, ids]) => {
        const uniq = Array.from(new Set(ids)).sort((a, b) => a - b);
        return { id: uniq[0], ids: uniq, label };
      });
      return list.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    },
    [projects]
  );

  /* Текущая выбранная группа (если выбрано не "all") */
  const selectedProjectGroup = React.useMemo(() => {
    if (projectKeyFilter === 'all') return null;
    return projectKeyOptions.find(o => o.id === projectKeyFilter) || null;
  }, [projectKeyFilter, projectKeyOptions]);

  /* Параметры запроса на бэкенд:
     - если выбрана группа из одного id — фильтруем на сервере (project_id)
     - если в группе несколько id — не отправляем project_id и будем фильтровать на клиенте */
  const params = React.useMemo(() => {
    const usp = new URLSearchParams();
    if (dateRange.from) usp.set('start', dateRange.from);
    if (dateRange.to)   usp.set('end',   dateRange.to);
    if (operationFilter !== 'all') usp.set('op', operationFilter);
    if (planFilter !== 'all')      usp.set('plan', planFilter);
    if (accountFilter !== 'all')   usp.set('account', accountFilter);
    const group = selectedProjectGroup;
    if (group && group.ids.length === 1) {
      usp.set('project_id', String(group.ids[0]));
    }
    if (amountRange.min != null)   usp.set('min', String(amountRange.min));
    if (amountRange.max != null)   usp.set('max', String(amountRange.max));
    return usp.toString();
  }, [dateRange, operationFilter, planFilter, accountFilter, selectedProjectGroup, amountRange]);

  const queryUrl = React.useMemo(
    () => `${API}/transactions/query${params ? `?${params}` : ''}`,
    [params]
  );

  const {
    data: queryData,
    isLoading: rowsLoading,
    isError: rowsError,
    error: rowsErrorObj,
  } = useQuery<QueryResponse>({
    queryKey: ['transactions-query', params],
    queryFn: () => api<QueryResponse>(queryUrl),
    refetchOnWindowFocus: false,
    retry: (count, err: any) => (err?.message === 'UNAUTHORIZED' ? false : count < 2),
  });

  React.useEffect(() => {
    if (rowsError && rowsErrorObj instanceof Error && rowsErrorObj.message !== 'UNAUTHORIZED') {
      showError(rowsErrorObj.message);
    }
  }, [rowsError, rowsErrorObj, showError]);

  const rows = queryData?.rows ?? [];

  /* Клиентская фильтрация, если выбрана группа с несколькими project_id */
  const viewRows = React.useMemo(() => {
    const group = selectedProjectGroup;
    if (!group || group.ids.length <= 1) return rows;
    const set = new Set(group.ids.map(Number));
    return rows.filter(r => set.has(Number(r.project_id)));
  }, [rows, selectedProjectGroup]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transactions-query'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
  };

  /* Мутации — решение принимает бэкенд (403/405) */
  const create = useMutation({
    mutationFn: (d: Omit<Transaction, 'id'>) =>
      api(`${API}/transactions`, { method: 'POST', body: JSON.stringify(d) }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) => e instanceof Error && e.message !== 'UNAUTHORIZED' && e.message !== 'Недостаточно прав' && showError(e.message),
    retry: 0,
  });

  const update = useMutation({
    mutationFn: (d: Transaction) =>
      api(`${API}/transactions/${d.id}`, { method: 'PUT', body: JSON.stringify(d) }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) => e instanceof Error && e.message !== 'UNAUTHORIZED' && e.message !== 'Недостаточно прав' && showError(e.message),
    retry: 0,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`${API}/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) => e instanceof Error && e.message !== 'UNAUTHORIZED' && e.message !== 'Недостаточно прав' && showError(e.message),
    retry: 0,
  });

  const baseColumns = React.useMemo<GridColDef[]>(
    () => [
      {
        field: 'date',
        headerName: 'Дата',
        width: 110,
        align: 'center',
        headerAlign: 'center',
        cellClassName: 'date-cell',
        renderCell: (p: any) =>
          p?.value ? (
            <Typography variant="body2" className="t-primary">
              {new Date(p.value).toLocaleDateString('ru-RU')}
            </Typography>
          ) : (
            <Chip label="план" size="small" color="info" />
          ),
      },
      {
        field: 'total',
        headerName: 'Операция',
        flex: 1,
        sortable: false,
        renderCell: (p: any) => {
          const row = p?.row as Transaction | undefined;
          const isExpense = row?.operationType === 'Расход';
          const amount = Math.abs(row?.total ?? 0);
          const formatted = `${isExpense ? '-' : '+'}${fmtMoney(amount)}`;
          const sectionOnly = getProjectSection(projects, row?.project_id);

          return (
            <Stack spacing={0.3} className="minw-0">
              <Typography className={`amount ${isExpense ? 'amount--expense' : 'amount--income'}`}>
                {formatted}
              </Typography>
              <Typography variant="body2" className="t-primary t-strong" title={sectionOnly}>
                {sectionOnly}
              </Typography>
            </Stack>
          );
        },
      },
      {
        field: 'note',
        headerName: 'Статья/описание',
        flex: 2.4,
        sortable: false,
        renderCell: (p: any) => (
          <Typography variant="body2" className="t-secondary wrap">
            {p?.value || '—'}
          </Typography>
        ),
      },
      {
        field: 'project_key',
        headerName: labels['project_key'],
        flex: 1.2,
        valueGetter: (params: any) => {
          const row = params?.row as Transaction | undefined;
          const pr = projects.find((pp) => Number(pp.id) === Number(row?.project_id));
          return pr ? `${pr.contractor || ''} ${pr.project || ''}`.trim() : '';
        },
        renderCell: (p: any) => {
          const row = p?.row as Transaction | undefined;
          const pr = projects.find((pp) => Number(pp.id) === Number(row?.project_id));
          if (!pr) return <Typography variant="body2" className="t-primary">—</Typography>;
          return (
            <Stack spacing={0.2} className="minw-0">
              <Typography variant="body2" className="t-primary t-strong nowrap">{pr.contractor || '—'}</Typography>
              <Typography variant="caption" className="t-secondary nowrap">{pr.project || '—'}</Typography>
            </Stack>
          );
        },
      },
      {
        field: 'responsible',
        headerName: labels['responsible'],
        flex: 1,
        renderCell: (p: any) => {
          const usr = users.find((u) => u.login === p?.value);
          return usr?.nickname ? (
            <Stack spacing={0.2}>
              <Typography variant="body2" className="t-primary t-strong">{usr.nickname}</Typography>
              <Typography variant="caption" className="t-secondary">{p?.value}</Typography>
            </Stack>
          ) : (
            <Typography variant="body2" className="t-primary t-strong">{p?.value}</Typography>
          );
        },
      },
    ],
    [users, projects]
  );

  const actionsCol: GridColDef = React.useMemo(
    () => ({
      field: 'actions',
      headerName: 'Действ.',
      width: 80,
      sortable: false,
      filterable: false,
      disableExport: true,
      cellClassName: 'actions-cell',
      renderCell: (p: any) => (
        <IconButton
          onClick={() => {
            (document.activeElement as HTMLElement | null)?.blur?.();
            if (p?.row) { setFormState(p.row); setDialogOpen(true); }
          }}
          size="small" className="icon-edit" aria-label="Редактировать"
        >
          <EditIcon fontSize="small" />
        </IconButton>
      ),
    }),
    []
  );

  const columns = React.useMemo<GridColDef[]>(
    () => (isAdmin ? [...baseColumns, actionsCol] : baseColumns),
    [isAdmin, baseColumns, actionsCol]
  );

  const isDateActive = Boolean(dateRange.from || dateRange.to);
  const isOpActive   = operationFilter !== 'all';
  const isPlanActive = planFilter !== 'all';
  const isAccActive  = accountFilter !== 'all';
  const isProjActive = projectKeyFilter !== 'all';
  const isAmtActive  = amountRange.min != null || amountRange.max != null;

  return (
    <Box className="root transactions-root transactions-page">
      <Box className="header transactions-header">
        <Typography variant="h6" className="title transactions-title">Транзакции</Typography>
        <Stack direction="row" spacing={1} className="actions header-actions" alignItems="center">
          {isAdmin && (
            <>
              <Button
                variant="contained" size="small"
                onClick={() => {
                  (document.activeElement as HTMLElement | null)?.blur?.();
                  setFormState({ ...empty, operationType: 'Доход' });
                  setDialogOpen(true);
                }}
                className="bluebutton tiny-btn"
              >Приход</Button>
              <Button
                variant="contained" size="small"
                onClick={() => {
                  (document.activeElement as HTMLElement | null)?.blur?.();
                  setFormState({ ...empty, operationType: 'Расход' });
                  setDialogOpen(true);
                }}
                className="bluebutton tiny-btn"
              >Расход</Button>
              <Button variant="contained" size="small"
                onClick={() => {
                  const all = ['id','date','operationType','project_key','section_only','responsible','total','remainder','note'] as const;
                  const header = all.map((f) =>
                    f === 'section_only' ? 'Раздел (из проектов)' : (labels[f] || f)
                  ).join(',');
                  const body = viewRows.map((r) => {
                    const pr = projects.find((pp) => Number(pp.id) === Number(r.project_id));
                    const project_key = pr ? `${pr.contractor || ''} ${pr.project || ''}`.trim() : '';
                    const section_only = getProjectSection(projects, r.project_id);
                    const rec: Record<string, any> = {
                      id: r.id,
                      date: r.date,
                      operationType: r.operationType,
                      project_key,
                      section_only,
                      responsible: r.responsible,
                      total: r.total,
                      remainder: r.remainder,
                      note: r.note ?? '',
                    };
                    return all.map((f) => {
                      const v = rec[f] ?? '';
                      return `"${typeof v === 'string' ? String(v).replace(/"/g, '""') : v}"`;
                    }).join(',');
                  }).join('\n');
                  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
                  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'transactions_filtered_export.csv' });
                  link.click();
                }}
                className="bluebutton tiny-btn"
              >Экспорт</Button>
            </>
          )}
        </Stack>
      </Box>

      <Box className="content transactions-content">
        <Box className="filters-section">
          <Stack direction="row" flexWrap="wrap" gap={1} className="filters-bar">
            {/* Период */}
            <Chip
              label={isDateActive ? `${dateRange.from ?? '...'} – ${dateRange.to ?? '...'}` : 'Дата'}
              clickable onClick={(e) => setAnchorDate(e.currentTarget)}
              className={`chip chip--clickable ${isDateActive ? 'chip--active' : ''}`}
            />
            <Popover
              open={Boolean(anchorDate)} anchorEl={anchorDate} onClose={() => setAnchorDate(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { className: 'popover-paper' } }}
            >
              <Box className="popover-body">
                <Stack spacing={2}>
                  <Stack direction="row" gap={1}>
                    <TextField type="date" label="От" fullWidth value={dateRange.from ?? ''} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value || undefined })} className="dark-input" InputLabelProps={{ shrink: true }} />
                    <TextField type="date" label="До" fullWidth value={dateRange.to ?? ''}   onChange={(e) => setDateRange({ ...dateRange, to: e.target.value || undefined })}   className="dark-input" InputLabelProps={{ shrink: true }} />
                  </Stack>
                  <Box className="presets-box">
                    {[
                      { label: 'Текущий месяц',   range: { from: formatISO(firstDayOfMonth),  to: formatISO(lastDayOfMonth) } },
                      { label: 'Текущий квартал', range: { from: formatISO(firstDayOfQuarter), to: formatISO(lastDayOfQuarter) } },
                      { label: 'Текущий год',     range: { from: formatISO(firstDayOfYear),    to: formatISO(lastDayOfYear) } },
                      { label: 'Прошлый месяц',   range: { from: formatISO(prevMonthStart),    to: formatISO(prevMonthEnd) } },
                      { label: 'Прошлый квартал', range: { from: formatISO(prevQuarterStart),  to: formatISO(prevQuarterEnd) } },
                      { label: 'Прошлый год',     range: { from: formatISO(prevYearStart),     to: formatISO(prevYearEnd) } },
                      { label: 'Все время',       range: {} },
                    ].map((p) => {
                      const active = dateRange.from === p.range.from && dateRange.to === p.range.to;
                      return (
                        <Chip key={p.label} label={p.label} clickable size="small"
                          onClick={() => setDateRange(p.range)}
                          className={`chip chip--small ${active ? 'chip--active' : ''}`}
                        />
                      );
                    })}
                  </Box>
                  <Button variant="contained" onClick={() => setAnchorDate(null)} className="btn-contained apply-btn">Применить</Button>
                </Stack>
              </Box>
            </Popover>

            {/* Тип операции */}
            <Chip
              label={operationFilter === 'all' ? 'Все операции' : operationFilter === 'income' ? 'Только доход' : 'Только расход'}
              clickable onClick={(e) => setAnchorOp(e.currentTarget)}
              className={`chip chip--clickable ${isOpActive ? 'chip--active' : ''}`}
            />
            <Menu anchorEl={anchorOp} open={Boolean(anchorOp)} onClose={() => setAnchorOp(null)} MenuListProps={{ dense: true }} PaperProps={{ className: 'menu-paper' }}>
              {[
                { v: 'all', l: 'Все операции' },
                { v: 'income', l: 'Только доход' },
                { v: 'expense', l: 'Только расход' },
              ].map(o => (
                <MenuItem key={o.v} selected={operationFilter === o.v}
                  onClick={() => { setOperationFilter(o.v as any); setAnchorOp(null); }}
                >{o.l}</MenuItem>
              ))}
            </Menu>

            {/* План/факт */}
            <Chip
              label={planFilter === 'all' ? 'Плановые и фактические' : planFilter === 'planned' ? 'Только плановые' : 'Только фактические'}
              clickable onClick={(e) => setAnchorPlan(e.currentTarget)}
              className={`chip chip--clickable ${isPlanActive ? 'chip--active' : ''}`}
            />
            <Menu anchorEl={anchorPlan} open={Boolean(anchorPlan)} onClose={() => setAnchorPlan(null)} MenuListProps={{ dense: true }} PaperProps={{ className: 'menu-paper' }}>
              {[
                { v: 'all', l: 'Плановые и фактические' },
                { v: 'planned', l: 'Только плановые' },
                { v: 'actual',  l: 'Только фактические' },
              ].map(o => (
                <MenuItem key={o.v} selected={planFilter === o.v}
                  onClick={() => { setPlanFilter(o.v as any); setAnchorPlan(null); }}
                >{o.l}</MenuItem>
              ))}
            </Menu>

            {/* Счёт */}
            <Chip
              label={accountFilter === 'all' ? 'Все счета' : users.find((u) => u.login === accountFilter)?.nickname || accountFilter}
              clickable onClick={(e) => setAnchorAcc(e.currentTarget)}
              className={`chip chip--clickable ${isAccActive ? 'chip--active' : ''}`}
            />
            <Menu anchorEl={anchorAcc} open={Boolean(anchorAcc)} onClose={() => setAnchorAcc(null)} MenuListProps={{ dense: true }} PaperProps={{ className: 'menu-paper' }}>
              <MenuItem selected={accountFilter === 'all'} onClick={() => { setAccountFilter('all'); setAnchorAcc(null); }}>Все счета</MenuItem>
              {users.map((u) => (
                <MenuItem key={u.id} selected={accountFilter === u.login} onClick={() => { setAccountFilter(u.login); setAnchorAcc(null); }}>
                  {u.nickname ? `${u.nickname} (${u.login})` : u.login}
                </MenuItem>
              ))}
            </Menu>

            {/* Проект ключ (по project_id) — список без дублей, объединённые группы */}
            <Chip
              label={
                projectKeyFilter === 'all'
                  ? 'Все проекты'
                  : (projectKeyOptions.find(o => o.id === projectKeyFilter)?.label || 'Проект ключ')
              }
              clickable onClick={(e) => setAnchorProj(e.currentTarget)}
              className={`chip chip--clickable ${isProjActive ? 'chip--active' : ''}`}
            />
            <Menu anchorEl={anchorProj} open={Boolean(anchorProj)} onClose={() => setAnchorProj(null)} MenuListProps={{ dense: true }} PaperProps={{ className: 'menu-paper' }}>
              <MenuItem selected={projectKeyFilter === 'all'} onClick={() => { setProjectKeyFilter('all'); setAnchorProj(null); }}>Все проекты</MenuItem>
              {projectKeyOptions.map((p) => (
                <MenuItem key={p.id} selected={projectKeyFilter === p.id} onClick={() => { setProjectKeyFilter(p.id); setAnchorProj(null); }}>
                  {p.label}
                </MenuItem>
              ))}
            </Menu>

            {/* Сумма */}
            <Chip
              label={isAmtActive ? `Сумма: ${amountRange.min ?? '...'} – ${amountRange.max ?? '...'}` : 'Сумма'}
              clickable onClick={() => { setAmountTemp(amountRange); setAmountDialogOpen(true); }}
              className={`chip chip--clickable ${isAmtActive ? 'chip--active' : ''}`}
            />
          </Stack>
        </Box>

        {/* Таблица */}
        <Box className="grid-wrapper">
          <DataGrid
            rows={viewRows}
            columns={columns}
            getRowId={(r) => r.id}
            getRowHeight={() => 'auto'}
            loading={rowsLoading || meFetching}
            initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
            pageSizeOptions={[100, 250, 500]}
            disableRowSelectionOnClick
            density="compact"
            className="transactions-grid grid--dark-head"
          />
        </Box>
      </Box>

      {/* Диалог фильтра суммы */}
      <Dialog
        open={amountDialogOpen}
        onClose={() => setAmountDialogOpen(false)}
        fullWidth maxWidth="xs"
        PaperProps={{ className: 'dialog-paper' }}
        disableRestoreFocus
        keepMounted
      >
        <DialogTitle className="with-bottom-border">Фильтр по сумме</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField label="Минимум" type="number" fullWidth value={amountTemp.min ?? ''} onChange={(e) => setAmountTemp({ ...amountTemp, min: e.target.value ? +e.target.value : undefined })} className="dark-input" />
            <TextField label="Максимум" type="number" fullWidth value={amountTemp.max ?? ''} onChange={(e) => setAmountTemp({ ...amountTemp, max: e.target.value ? +e.target.value : undefined })} className="dark-input" />
          </Stack>
        </DialogContent>
        <DialogActions className="with-top-border">
          <Button onClick={() => { setAmountRange({}); setAmountDialogOpen(false); }} className="btn-text-no-transform" color="warning">Сбросить</Button>
          <Button onClick={() => setAmountDialogOpen(false)} className="btn-text-no-transform" color="info">Отмена</Button>
          <Button variant="contained" onClick={() => { setAmountRange(amountTemp); setAmountDialogOpen(false); }} className="btn-contained">Применить</Button>
        </DialogActions>
      </Dialog>

      {/* Диалог добавления/редактирования */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth maxWidth={mobile ? 'sm' : 'md'}
        PaperProps={{ className: 'dialog-paper' }}
        disableRestoreFocus
        keepMounted
      >
        <DialogTitle className="with-bottom-border">{isEdit ? 'Редактировать транзакцию' : 'Добавить транзакцию'}</DialogTitle>
        <DialogContent dividers>
          <Form value={formState} onChange={setFormState} users={users} isEdit={isEdit} sectionOptions={sectionOptions} />
        </DialogContent>
        <DialogActions className="with-top-border">
          {isAdmin && isEdit && (
            <Button color="error" startIcon={<DeleteIcon />}
              onClick={() => {
                if (formState.id && window.confirm('Удалить эту транзакцию?')) {
                  remove.mutate(formState.id);
                  setDialogOpen(false);
                  setFormState(empty);
                }
              }}
              className="btn-text-no-transform"
            >Удалить</Button>
          )}
          <Box className="flex-grow" />
          <Button onClick={() => setDialogOpen(false)} className="btn-text-no-transform" color="info">Отмена</Button>
          {isAdmin && (
            <Button variant="contained"
              onClick={() => {
                const dto: Transaction | Omit<Transaction, 'id'> = {
                  ...formState,
                  project_id: toIntOrNull(formState.project_id),
                  remainder: (formState.total ?? 0),
                } as Transaction;
                isEdit ? update.mutate(dto as Transaction) : create.mutate(dto as Omit<Transaction, 'id'>);
                setDialogOpen(false);
                setFormState(empty);
              }}
              className="btn-contained"
            >Сохранить</Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TransactionsPage;
