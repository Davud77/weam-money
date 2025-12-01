// src/pages/ProjectDetailPage.tsx
import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Stack, Paper, Button, TextField, IconButton,
  MenuItem, Autocomplete, List, ListItemButton, ListItemText, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import MenuIcon from '@mui/icons-material/Menu';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip as ChartTooltip
} from 'recharts';
import dayjs from 'dayjs';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, me } from '../lib/api';
import { fmtMoney, fmtPercent } from '../lib/format';

/* ------------------------------- Types ----------------------------------- */
type OperationType = 'Расход' | 'Доход';

export interface Transaction {
  id: number;
  contractor: string;
  project: string;
  section: string;
  responsible: string;
  date: string;              // пусто = план
  total: number;             // может быть со знаком
  advance: number;
  remainder: number;
  operationType: OperationType | string;
  note?: string;
  project_id?: number | null; // ID строки раздела в /projects
}

interface ProjectRow {
  id: number;
  contractor: string;
  project: string;
  section: string;
  direction: 'нам должны' | 'мы должны';
  grouping?: string | null;
  amount: number;
  progress: number;
  responsible: number | null;
  responsible_nickname?: string;
  end?: string | null;
  name?: string; // slug проекта
  remainder_calc?: number;   // серверное вычисляемое поле
}

interface User {
  id: number;
  login: string;
  nickname: string;
}

/* ------------------------------ Utils ------------------------------------ */
const API = '/api';
const STALE_15M = 15 * 60 * 1000;

const dirRank = (d: ProjectRow['direction']) => (d === 'нам должны' ? 0 : 1);

// DTO для СОЗДАНИЯ. Для обновления используется кастомный объект в мутации.
const toProjectDTO = (p: ProjectRow) => ({
  id: p.id,
  contractor: String(p.contractor || ''),
  project: String(p.project || ''),
  section: String(p.section || ''),
  direction: p.direction,
  grouping: p.grouping || null,
  amount: Number(p.amount) || 0,
  progress: Number(p.progress) || 0,
  responsible: p.responsible ?? null,
  end: p.end ? dayjs(p.end).format('YYYY-MM-DD') : null,
});

const toIntOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Нормализация типа операции — всё, что НЕ «Расход», считаем «Доход». */
const normalizeOp = (v: unknown): OperationType => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'расход' ? 'Расход' : 'Доход';
};

/* -------------------------------- Page ----------------------------------- */
type Props = { showError: (msg: string) => void };

const ProjectDetailPage: React.FC<Props> = ({ showError }) => {
  const { name = '' } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [showList, setShowList] = useState(true);

  /* -------- Кто я -------- */
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const isAdmin = meData?.user?.role === 'admin';

  /* -------- Транзакции -------- */
  const { data: allTx = [], isError: txErr, error: txError, isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: () => api<Transaction[]>(`${API}/transactions`),
    refetchOnWindowFocus: false,
  });
  React.useEffect(() => {
    if (txErr && txError instanceof Error && txError.message !== 'UNAUTHORIZED') showError(txError.message);
  }, [txErr, txError, showError]);

  /* -------- Проекты/разделы -------- */
  const { data: allProjects = [], isLoading: allPrjLoading } = useQuery<ProjectRow[]>({
    queryKey: ['projects'],
    queryFn: () => api<ProjectRow[]>(`${API}/projects`),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  const projectsFlat = useMemo(() => {
    const set = new Set<string>();
    const list: { name: string; project: string; contractor: string; grouping: string | null }[] = [];
    for (const r of allProjects) {
      if (!r.name || set.has(r.name)) continue;
      set.add(r.name);
      list.push({
        name: r.name,
        project: r.project || 'Без проекта',
        contractor: r.contractor,
        grouping: r.grouping || null,
      });
    }
    return list.sort((a, b) => {
      const groupA = a.grouping || '';
      const groupB = b.grouping || '';
      const groupCompare = groupA.localeCompare(groupB, 'ru', { sensitivity: 'base' });
      if (groupCompare !== 0) return groupCompare;

      const contractorCompare = a.contractor.localeCompare(b.contractor, 'ru', { sensitivity: 'base' });
      if (contractorCompare !== 0) return contractorCompare;

      return a.project.localeCompare(b.project, 'ru', { sensitivity: 'base' });
    });
  }, [allProjects]);

  // Опции для выпадающего списка группировок
  const groupingOptions = useMemo(() => {
    if (!allProjects) return [];
    const uniqueGroupings = new Set<string>();
    for (const project of allProjects) {
      if (project.grouping) {
        uniqueGroupings.add(project.grouping);
      }
    }
    return Array.from(uniqueGroupings).sort();
  }, [allProjects]);


  const {
    data: sectionRowsRaw = [],
    isLoading: secLoading,
    isError: secErr,
    error: secError,
  } = useQuery<ProjectRow[]>({
    queryKey: ['projects-by-name', name],
    enabled: !!name,
    queryFn: () => api<ProjectRow[]>(`${API}/projects/by-name/${encodeURIComponent(name)}`),
    retry: (failureCount, error: any) => {
      if (String(error?.message || '').toLowerCase().includes('нет доступа')) return false;
      return failureCount < 2;
    },
    refetchOnWindowFocus: false,
  });
  React.useEffect(() => {
    if (secErr && secError instanceof Error && secError.message !== 'UNAUTHORIZED') showError(secError.message);
  }, [secErr, secError, showError]);

  const sectionRows = useMemo(
    () =>
      sectionRowsRaw
        .slice()
        .sort((a, b) => {
          const byDir = dirRank(a.direction) - dirRank(b.direction);
          return byDir !== 0 ? byDir : a.section.localeCompare(b.section, 'ru', { sensitivity: 'base' });
        }),
    [sectionRowsRaw],
  );

  const titleProject = sectionRows[0]?.project || 'Без проекта';
  const titleContractor = sectionRows[0]?.contractor || '';

  /* -------- KPI/график -------- */
  const sectionIdSet = useMemo(() => new Set(sectionRows.map(s => Number(s.id))), [sectionRows]);

  const txRows = useMemo(
    () => allTx.filter((t) => t.project_id != null && sectionIdSet.has(Number(t.project_id))),
    [allTx, sectionIdSet],
  );

  const income = txRows.filter((r) => normalizeOp(r.operationType) === 'Доход').reduce((s, r) => s + r.total, 0);
  const expense = txRows.filter((r) => normalizeOp(r.operationType) === 'Расход').reduce((s, r) => s + r.total, 0);
  const profit = income - expense;
  const margin = income ? (profit / income) * 100 : 0;

  const chartData = useMemo(() => {
    const m = new Map<string, number>();
    txRows
      .filter((r) => r.date)
      .forEach((r) => {
        const delta = normalizeOp(r.operationType) === 'Доход' ? r.total : -r.total;
        m.set(r.date, (m.get(r.date) ?? 0) + delta);
      });
    const dates = Array.from(m.keys()).sort();
    let acc = 0;
    return dates.map((d) => ({
      date: dayjs(d).format('DD.MM.YYYY'),
      profit: (acc += m.get(d)!),
    }));
  }, [txRows]);

  /* -------- Mutations: sections -------- */
  const invalidateList = () => {
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['projects-by-name', name] });
  };

  const updateSection = useMutation({
    mutationFn: async (p: ProjectRow) => {
      // ИСПРАВЛЕНО: Отправляем только поля, относящиеся к разделу, а не к проекту.
      const dto = {
        id: p.id,
        section: String(p.section || ''),
        direction: p.direction,
        grouping: p.grouping || null,
        amount: Number(p.amount) || 0,
        progress: Number(p.progress) || 0,
        responsible: p.responsible ?? null,
        end: p.end ? dayjs(p.end).format('YYYY-MM-DD') : null,
      };
      return api(`${API}/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(dto) });
    },
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ['projects-by-name', name] });
      const prev = qc.getQueryData<ProjectRow[]>(['projects-by-name', name]);
      if (prev) {
        qc.setQueryData<ProjectRow[]>(
          ['projects-by-name', name],
          prev.map((r) => (r.id === p.id ? { ...r, ...p } : r)),
        );
      }
      return { prev };
    },
    onError: (e: any, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['projects-by-name', name], ctx.prev);
      if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
        showError(e?.message || 'Ошибка сохранения раздела');
      }
    },
    onSettled: invalidateList,
    retry: 0,
  });

  const createSection = useMutation({
    mutationFn: async (p: Omit<ProjectRow, 'id'>) => {
      const dto = { ...toProjectDTO({ ...(p as any), id: 0 } as ProjectRow), name };
      return api(`${API}/projects`, { method: 'POST', body: JSON.stringify(dto) });
    },
    onSuccess: invalidateList,
    onError: (e: any) => {
      if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
        showError(e?.message || 'Ошибка создания раздела');
      }
    },
    retry: 0,
  });

  const deleteSection = useMutation({
    mutationFn: async (id: number) => api(`${API}/projects/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['projects-by-name', name] });
      const prev = qc.getQueryData<ProjectRow[]>(['projects-by-name', name]);
      if (prev) qc.setQueryData<ProjectRow[]>(['projects-by-name', name], prev.filter((r) => r.id !== id));
      return { prev };
    },
    onError: (e: any, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['projects-by-name', name], ctx.prev);
      if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
        showError(e?.message || 'Ошибка удаления раздела');
      }
    },
    onSettled: invalidateList,
    retry: 0,
  });

  /* -------- Mutations: transactions -------- */
  const invalidateTx = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
  };

  const createTx = useMutation({
    mutationFn: (d: Omit<Transaction, 'id'>) =>
      api(`${API}/transactions`, { method: 'POST', body: JSON.stringify(d) }),
    onSuccess: () => invalidateTx(),
    onError: (e: any) => {
      if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
        showError(e?.message || 'Ошибка создания транзакции');
      }
    },
    retry: 0,
  });

  const updateTx = useMutation({
    mutationFn: (d: Transaction) =>
      api(`${API}/transactions/${d.id}`, { method: 'PUT', body: JSON.stringify(d) }),
    onSuccess: () => invalidateTx(),
    onError: (e: any) => {
      if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
        showError(e?.message || 'Ошибка сохранения транзакции');
      }
    },
    retry: 0,
  });

  const removeTx = useMutation({
    mutationFn: (id: number) => api(`${API}/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTx(),
    onError: (e: any) => {
      if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
        showError(e?.message || 'Ошибка удаления транзакции');
      }
    },
    retry: 0,
  });

  /* -------------------- UI state -------------------- */
  const [secPagination, setSecPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [editSectionRow, setEditSectionRow] = useState<ProjectRow | null>(null);

  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txForm, setTxForm] = useState<Partial<Transaction>>({});
  const isTxEdit = Boolean(txForm && 'id' in txForm);

  /* -------------------- Users -------------------- */
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    enabled: true,
    queryFn: () => api<User[]>(`${API}/users`),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const usersByLogin = useMemo(() => {
    const m = new Map<string, User>();
    users.forEach(u => m.set(u.login, u));
    return m;
  }, [users]);

  /* -------------------- Columns -------------------- */
  const baseCols: GridColDef<ProjectRow>[] = [
    { field: 'section', headerName: 'Раздел', flex: 1.6, cellClassName: 'cell-section-white' },
    {
      field: 'direction',
      headerName: 'Тип операции',
      flex: 1.0,
      renderCell: (p) => {
        const isIncome = p.value === 'нам должны';
        const cls = `amount ${isIncome ? 'amount--income' : 'amount--expense'}`;
        return <Typography className={cls}>{p.value}</Typography>;
      },
      sortComparator: (a, b) => dirRank(a as ProjectRow['direction']) - dirRank(b as ProjectRow['direction']),
    },
    {
      field: 'responsible_nickname',
      headerName: 'Ответственный',
      flex: 1,
      renderCell: (p) => <Typography className="t-primary t-strong">{p.value || '—'}</Typography>,
    },
    {
      field: 'amount',
      headerName: 'Сумма договора',
      flex: 1,
      sortComparator: (a, b) => Number(a ?? 0) - Number(b ?? 0),
      renderCell: (p) => <Typography>{fmtMoney(n((p.row as ProjectRow).amount))}</Typography>,
    },
    {
      field: 'remainder_calc',
      headerName: 'Остаток',
      flex: 1,
      sortable: false,
      renderCell: (p) => {
        const val = Number((p.row as ProjectRow).remainder_calc ?? 0);
        const cls = `amount ${val >= 0 ? 'amount--income' : 'amount--expense'}`;
        return <Typography className={cls}>{fmtMoney(val)}</Typography>;
      },
    },
  ];

  const actionCol: GridColDef<ProjectRow> = {
    field: 'actions',
    headerName: '',
    width: 64,
    sortable: false,
    filterable: false,
    renderCell: (p) => (
      <IconButton size="small" onClick={() => setEditSectionRow(p.row as ProjectRow)} className="icon-edit" aria-label="Редактировать раздел">
        <EditIcon fontSize="small" />
      </IconButton>
    ),
  };

  const sectionCols = useMemo<GridColDef<ProjectRow>[]>(() => (isAdmin ? [...baseCols, actionCol] : baseCols), [isAdmin]);

  const txColumns = useMemo<GridColDef[]>(
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
            <Typography variant="caption" className="t-secondary">план</Typography>
          ),
      },
      {
        field: 'total',
        headerName: 'Операция',
        flex: 1.6,
        sortable: false,
        renderCell: (p: any) => {
          const row = p?.row as Transaction | undefined;
          const isExpense = normalizeOp(row?.operationType) === 'Расход';
          const amount = Math.abs(row?.total ?? 0);
          const formatted = `${isExpense ? '-' : '+'}${fmtMoney(amount)}`;
          const pr = sectionRows.find(pp => Number(pp.id) === Number(row?.project_id));
          const sectionOnly = pr ? (pr.section || '').toString() : (row?.section || '');
          return (
            <Stack spacing={0.3} className="minw-0">
              <Typography className={`amount ${isExpense ? 'amount--expense' : 'amount--income'}`}>
                {formatted}
              </Typography>
              <Typography variant="body2" className="t-primary t-strong" title={sectionOnly}>
                {sectionOnly || '—'}
              </Typography>
            </Stack>
          );
        },
      },
      {
        field: 'note',
        headerName: 'Статья/описание',
        flex: 1.4,
        sortable: false,
        renderCell: (p: any) => (
          <Typography variant="body2" className="t-secondary wrap">
            {p?.value || '—'}
          </Typography>
        ),
      },
      {
        field: 'project_key',
        headerName: 'Проект',
        flex: 1.4,
        sortable: false,
        valueGetter: (params: any) => {
          const row = params?.row as Transaction | undefined;
          const pr = sectionRows.find((pp) => Number(pp.id) === Number(row?.project_id));
          return pr ? `${pr.contractor || ''} ${pr.project || ''}`.trim() : '';
        },
        renderCell: (p: any) => {
          const row = p?.row as Transaction | undefined;
          const pr = sectionRows.find((pp) => Number(pp.id) === Number(row?.project_id));
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
        headerName: 'Счёт',
        flex: 1.2,
        renderCell: (p: any) => {
          const login = String(p?.value ?? '');
          const usr = usersByLogin.get(login);
          const nick = (usr?.nickname || '').trim();
          return (
            <Typography variant="body2" className="t-primary t-strong">
              {nick || login}
            </Typography>
          );
        },
      },
      ...(isAdmin
        ? [{
            field: 'actions',
            headerName: '',
            width: 64,
            sortable: false,
            filterable: false,
            renderCell: (p: any) => (
              <IconButton
                onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); setTxForm(p.row); setTxDialogOpen(true); }}
                size="small" className="icon-edit" aria-label="Редактировать"
              >
                <EditIcon fontSize="small" />
              </IconButton>
            ),
          } as GridColDef]
        : []),
    ],
    [isAdmin, sectionRows, usersByLogin]
  );

  /* ---------------------------- Render ------------------------------------ */
  const profitValueAbs = Math.abs(profit);
  const profitDisplay = `${profit >= 0 ? '+' : '-'}${fmtMoney(profitValueAbs)}`;
  const profitClass = `amount ${profit >= 0 ? 'amount--income' : 'amount--expense'}`;

  return (
    <Box className="root pd-root transactions-root transactions-page">
      {/* Header */}
      <Box className="header pd-header transactions-header">
        <Box className="pd-header__left">
          <Tooltip title={showList ? 'Скрыть список проектов' : 'Показать список проектов'}>
            <IconButton size="small" onClick={() => setShowList((v) => !v)} className="pd-header__toggle icon-default" aria-label="Переключить список проектов">
              {showList ? <MenuOpenIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          <Typography variant="h6" className="title pd-title-override">
            <Box component="span" className="pd-breadcrumb-link no-underline" onClick={() => navigate('/projects')}>
              Проекты
            </Box>
            {' / '}
            <span className="pd-breadcrumb-current">{titleProject || 'Без проекта'}</span>
          </Typography>
        </Box>

        {isAdmin && (
          <Stack direction="row" spacing={1}>
            <Button
              className="bluebutton tiny-btn"
              variant="contained"
              size="small"
              onClick={() => {
                const firstPid = sectionRows[0]?.id ?? null;
                setTxForm({
                  contractor: titleContractor,
                  project: titleProject,
                  section: '',
                  responsible: '',
                  date: '',
                  total: 0,
                  advance: 0,
                  remainder: 0,
                  operationType: 'Доход',
                  note: '',
                  project_id: firstPid ?? null,
                });
                setTxDialogOpen(true);
              }}
            >
              Добавить транзакцию
            </Button>

            <Button
              className="bluebutton tiny-btn"
              variant="contained"
              size="small"
              onClick={() =>
                setEditSectionRow({
                  id: 0,
                  contractor: titleContractor,
                  project: titleProject,
                  section: '',
                  direction: 'нам должны',
                  grouping: '',
                  amount: 0,
                  progress: 0,
                  responsible: null,
                  responsible_nickname: '',
                  end: null,
                  name,
                  remainder_calc: 0,
                })
              }
            >
              Добавить раздел
            </Button>
          </Stack>
        )}
      </Box>

      {/* Main */}
      <Box className="content pd-main transactions-content">
        {/* Left: список проектов */}
        {showList && (
          <Box className="pd-left">
            <Box className="pd-left__scroll">
              <List disablePadding dense>
                {projectsFlat.map((p) => {
                  const active = p.name === name;
                  return (
                    <ListItemButton
                      key={p.name}
                      selected={active}
                      onClick={() => navigate(`/projects/${encodeURIComponent(p.name)}`)}
                      className={`pd-left-item ${active ? 'is-active' : ''}`}
                    >
                      <ListItemText
                        primary={p.project}
                        secondary={`${p.grouping ? p.grouping + ' / ' : ''}${p.contractor}`}
                        primaryTypographyProps={{ className: 't-primary' }}
                        secondaryTypographyProps={{ className: 't-secondary' }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          </Box>
        )}

        {/* Right */}
        <Box className={showList ? 'pd-right' : ''}>
          {/* KPI + chart */}
          <Paper variant="outlined" className="pd-card content-card bg-surface">
            <Box className="pd-card__inner">
              <Stack direction="row" className="kpi-row" spacing={2}>
                <Kpi title="Чистая прибыль" value={profitDisplay} className={profitClass} />
                <Kpi title="Доходы" value={fmtMoney(income)} />
                <Kpi title="Расходы" value={fmtMoney(expense)} />
                <Kpi title="Рентабельность" value={fmtPercent(margin)} />
              </Stack>
            </Box>

            <Box className="pd-chart">
              {chartData.length > 1 ? (
                <ResponsiveContainer width="100%" height="90%">
                  <LineChart data={chartData} className="chart chart--line">
                    <CartesianGrid vertical={false} className="grid grid--weak" />
                    <XAxis dataKey="date" className="axis axis--soft" />
                    <YAxis className="axis axis--soft" />
                    <ChartTooltip
                      wrapperClassName="recharts-tooltip tooltip-compact tooltip-unified"
                      content={<PdProfitTooltip />}
                    />
                    <Line
                      type="monotone"
                      dataKey="profit"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Typography className="pd-chart__empty">Недостаточно данных для графика</Typography>
              )}
            </Box>
          </Paper>

          {/* Разделы */}
          <Box className="grid-wrapper">
            <DataGrid
              rows={sectionRows}
              columns={sectionCols}
              getRowId={(r) => r.id}
              pageSizeOptions={[25, 50, 100]}
              paginationModel={secPagination}
              onPaginationModelChange={setSecPagination}
              disableRowSelectionOnClick
              getRowHeight={() => 'auto'}
              initialState={{
                sorting: { sortModel: [{ field: 'direction', sort: 'asc' }, { field: 'section', sort: 'asc' }] },
              }}
              getRowClassName={(p) => (p.row.direction === 'нам должны' ? 'dir-credit' : 'dir-debt')}
              loading={secLoading || txLoading || allPrjLoading}
              density="compact"
              className="transactions-grid grid--dark-head"
            />
          </Box>

          {/* Транзакции */}
          <Box className="grid-wrapper">
            <DataGrid
              rows={txRows}
              columns={txColumns}
              getRowId={(r) => r.id}
              getRowHeight={() => 'auto'}
              loading={txLoading}
              initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
              pageSizeOptions={[100, 250, 500]}
              disableRowSelectionOnClick
              density="compact"
              className="transactions-grid grid--dark-head"
            />
          </Box>
        </Box>
      </Box>

      {/* Dialog – Section */}
      {isAdmin && editSectionRow && (
        <SectionDialog
          isAdmin={isAdmin}
          section={editSectionRow}
          groupingOptions={groupingOptions}
          onClose={() => setEditSectionRow(null)}
          onSave={async (s, mode) => {
            try {
              if (mode === 'create') {
                const { id: _omit, responsible_nickname: _nick, remainder_calc: _r, ...rest } = s as any;
                await createSection.mutateAsync(rest as Omit<ProjectRow, 'id'>);
              } else {
                await updateSection.mutateAsync(s);
              }
              setEditSectionRow(null);
            } catch (e: any) {
              if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
                showError(e?.message || 'Не удалось сохранить раздел');
              }
            }
          }}
          onRemove={async (id) => {
            try {
              if (id) await deleteSection.mutateAsync(id);
              setEditSectionRow(null);
            } catch (e: any) {
              if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
                showError(e?.message || 'Не удалось удалить раздел');
              }
            }
          }}
        />
      )}

      {/* Dialog – Transaction */}
      {isAdmin && (
        <Dialog
          open={txDialogOpen}
          onClose={() => setTxDialogOpen(false)}
          fullWidth
          maxWidth="md"
          PaperProps={{ className: 'dialog-paper' }}
          disableRestoreFocus
          keepMounted
        >
          <DialogTitle className="with-bottom-border">
            {isTxEdit ? 'Редактировать транзакцию' : 'Добавить транзакцию'}
          </DialogTitle>
          <DialogContent dividers>
            <TxForm
              value={txForm}
              onChange={setTxForm}
              users={users}
              sectionRows={sectionRows}
              titleContractor={titleContractor}
              titleProject={titleProject}
            />
          </DialogContent>
          <DialogActions className="with-top-border">
            {isTxEdit && txForm.id ? (
              <Button
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => {
                  if (txForm.id && window.confirm('Удалить транзакцию?')) {
                    removeTx.mutate(txForm.id);
                    setTxDialogOpen(false);
                    setTxForm({});
                  }
                }}
                className="btn-text-no-transform"
              >
                Удалить
              </Button>
            ) : null}
            <Box className="flex-grow" />
            <Button onClick={() => setTxDialogOpen(false)} className="btn-text-no-transform">Отмена</Button>
            <Button
              variant="contained"
              className="btn-contained"
              onClick={() => {
                const dto: Transaction | Omit<Transaction, 'id'> = {
                  id: (txForm as any).id,
                  contractor: txForm.contractor ?? titleContractor,
                  project: txForm.project ?? titleProject,
                  section: txForm.section ?? '',
                  responsible: txForm.responsible ?? '',
                  date: txForm.date ?? '',
                  total: Number(txForm.total ?? 0),
                  advance: Number(txForm.advance ?? 0),
                  remainder: Number(txForm.remainder ?? txForm.total ?? 0),
                  operationType: normalizeOp(txForm.operationType),
                  note: txForm.note ?? '',
                  project_id: toIntOrNull(txForm.project_id ?? (sectionRows[0]?.id ?? null)),
                } as any;

                if (isTxEdit) {
                  updateTx.mutate(dto as Transaction);
                } else {
                  const { id, ...createDto } = dto as Transaction;
                  createTx.mutate(createDto as Omit<Transaction, 'id'>);
                }
                setTxDialogOpen(false);
                setTxForm({});
              }}
              disabled={!txForm.responsible || (!txForm.date && !txForm.note)}
            >
              Сохранить
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};

const Kpi = ({
  title,
  value,
  highlight,
  className,
}: {
  title: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) => (
  <Stack spacing={0.5} className="kpi-col">
    <Typography variant="body2" className="t-secondary">
      {title}
    </Typography>
    <Typography variant={highlight ? 'h4' : 'h5'} className={`t-strong ${className || ''}`}>
      {value}
    </Typography>
  </Stack>
);

type RTooltipProps = import('recharts').TooltipProps<number, string>;
const PdProfitTooltip: React.FC<RTooltipProps> = ({ active, label, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const sum = Number(payload[0]?.payload?.profit) || 0;
  return (
    <Box className="tooltip-card tooltip-card--funds">
      <Typography variant="body2" className="tooltip-line">Дата: {String(label)}</Typography>
      <Typography variant="body2" className="tooltip-line">{fmtMoney(sum)}</Typography>
    </Box>
  );
};

type SectionFormProps = {
  isAdmin: boolean;
  section: ProjectRow; // id=0 → новый
  groupingOptions: string[];
  onClose: () => void;
  onSave: (s: ProjectRow, mode: 'create' | 'update') => void | Promise<void>;
  onRemove: (id: number) => void | Promise<void>;
};

const SectionDialog: React.FC<SectionFormProps> = ({ isAdmin, section, groupingOptions, onClose, onSave, onRemove }) => {
  const [form, setForm] = useState<ProjectRow>(section);
  const [saving, setSaving] = useState(false);
  const isNew = !form.id;

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    enabled: isAdmin,
    queryFn: () => api<User[]>(`${API}/users`),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  const selectedUser = users.find((u) => u.id === form.responsible) ?? null;

  const doSave = async () => {
    setSaving(true);
    try {
      await onSave(form, isNew ? 'create' : 'update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{ className: 'dialog-paper' }}
      disableRestoreFocus
      keepMounted
    >
      <DialogTitle className="with-bottom-border">
        {isNew ? 'Новый раздел' : 'Редактировать раздел'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Раздел"
            value={form.section}
            onChange={(e) => setForm({ ...form, section: e.target.value })}
            className="dark-input"
          />

          <Autocomplete
            freeSolo
            options={groupingOptions}
            value={form.grouping || ''}
            onInputChange={(_, newValue) => {
              setForm({ ...form, grouping: newValue });
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Группировка"
                className="dark-input"
              />
            )}
          />

          <TextField
            label="Тип операции"
            select
            value={form.direction}
            onChange={(e) => setForm({ ...form, direction: e.target.value as ProjectRow['direction'] })}
            className="dark-input"
          >
            <MenuItem value="нам должны">нам должны</MenuItem>
            <MenuItem value="мы должны">мы должны</MenuItem>
          </TextField>

          <Autocomplete
            options={users}
            getOptionLabel={(u) => u.nickname || u.login}
            value={selectedUser}
            onChange={(_, val) =>
              setForm({
                ...form,
                responsible: val ? val.id : null,
                responsible_nickname: val ? (val.nickname || val.login) : '',
              })
            }
            renderInput={(params) => <TextField {...params} label="Ответственный" className="dark-input" />}
          />

          <TextField
            label="Сумма договора"
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: +e.target.value })}
            className="dark-input"
          />
        </Stack>
      </DialogContent>
      <DialogActions className="with-top-border">
        {!isNew && (
          <Button
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => {
              if (window.confirm('Удалить раздел?')) onRemove(form.id);
            }}
            className="btn-text-no-transform"
          >
            Удалить
          </Button>
        )}
        <Box className="flex-grow" />
        <Button onClick={onClose} disabled={saving} className="btn-text-no-transform">
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={doSave}
          disabled={saving || !form.section?.trim()}
          size="small"
          className="btn-contained"
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/* -------------------- TxForm -------------------- */
type TxFormProps = {
  value: Partial<Transaction>;
  onChange: (v: Partial<Transaction>) => void;
  users: User[];
  sectionRows: ProjectRow[];
  titleContractor: string;
  titleProject: string;
};

const TxForm: React.FC<TxFormProps> = ({ value, onChange, users, sectionRows, titleContractor, titleProject }) => {
  const selectedSection = useMemo(() => {
    const pid = toIntOrNull(value.project_id);
    return sectionRows.find(s => Number(s.id) === Number(pid)) ?? null;
  }, [value.project_id, sectionRows]);

  return (
    <Stack spacing={2}>
      <Autocomplete
        options={sectionRows}
        getOptionLabel={(s) => s.section || '—'}
        value={selectedSection}
        onChange={(_, s) => onChange({
          ...value,
          project_id: s ? s.id : null,
          section: s ? s.section : '',
          contractor: titleContractor,
          project: titleProject,
        })}
        renderInput={(params) => <TextField {...params} label="Раздел (по проекту)" className="dark-input" />}
        isOptionEqualToValue={(o, v) => o.id === v.id}
      />

      <TextField
        select
        label="Тип операции"
        value={normalizeOp(value.operationType)}
        onChange={(e) => onChange({ ...value, operationType: e.target.value as OperationType })}
        className="dark-input"
      >
        <MenuItem value="Доход">Доход</MenuItem>
        <MenuItem value="Расход">Расход</MenuItem>
      </TextField>

      <TextField
        label="Дата"
        type="date"
        value={value.date ?? ''}
        onChange={(e) => onChange({ ...value, date: e.target.value })}
        InputLabelProps={{ shrink: true }}
        className="dark-input"
      />

      <TextField
        label="Сумма"
        type="number"
        value={value.total ?? ''}
        onChange={(e) => onChange({ ...value, total: +e.target.value })}
        className="dark-input"
      />

      <TextField
        label="Примечание"
        value={value.note ?? ''}
        onChange={(e) => onChange({ ...value, note: e.target.value })}
        multiline rows={2}
        className="dark-input"
      />

      <TextField
        select
        label="Счёт"
        value={value.responsible ?? ''}
        onChange={(e) => onChange({ ...value, responsible: e.target.value })}
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

export default ProjectDetailPage;