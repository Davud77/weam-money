// src/pages/ProjectsPage.tsx
import React, { useMemo, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Collapse,
} from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import PercentIcon from '@mui/icons-material/Percent';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
// Импортируем новые иконки для доходов и расходов
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, me } from '../lib/api';
import { fmtMoney } from '../lib/format';

type ProjectRow = {
  id: number;
  contractor: string;
  project: string;
  section: string;
  direction: string;
  amount: number;
  progress: number;
  responsible?: string | number | null;
  responsible_nickname?: string;
  name?: string; // slug проекта
  remainder_calc?: number; // <-- Добавлено поле остатка
};

// Обновленный тип для группы
type ProjectGroup = {
  contractor: string;
  projects: Array<{
    project: string;
    name: string;
    sections: ProjectRow[];
    // Доходы
    incomeTotal: number;
    incomeRemainder: number;
    // Расходы
    expenseTotal: number;
    expenseRemainder: number;
    
    avgProgress: number;
    uniqueResponsibles: string[];
  }>;
};

type Organization = { id?: number; name: string };
type Props = { showError: (msg: string) => void };

const API = '/api';
const STALE_15M = 15 * 60 * 1000;

const equalsCI = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const ProjectsPage: React.FC<Props> = ({ showError }) => {
  const navigate = useNavigate();
  const qc = useQueryClient();

  /* --------- Кто я --------- */
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const isAdmin = meData?.user?.role === 'admin';

  /* --------- Данные --------- */
  const { data: projects = [], isLoading, isError, error } = useQuery<ProjectRow[]>({
    queryKey: ['projects'],
    queryFn: () => api<ProjectRow[]>(`${API}/projects`),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
  });

  const { data: organizations = [] } = useQuery<Organization[]>({
    queryKey: ['organizations'],
    queryFn: () => api<Organization[]>(`${API}/organizations`),
    staleTime: STALE_15M,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  React.useEffect(() => {
    if (isError && error instanceof Error && error.message !== 'UNAUTHORIZED') {
      showError(error.message);
    }
  }, [isError, error, showError]);

  const collator = useMemo(() => {
    try {
      return new Intl.Collator(['ru-RU', 'ru', 'en'], { sensitivity: 'base', numeric: true });
    } catch {
      return new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    }
  }, []);

  const contractorOptions = useMemo<string[]>(() => {
    const base = organizations?.length
      ? organizations.map((o) => o.name).filter(Boolean)
      : projects.map((p) => p.contractor).filter(Boolean);
    return Array.from(new Set(base)).sort((a, b) => collator.compare(a ?? '', b ?? ''));
  }, [organizations, projects, collator]);

  // --- ОБНОВЛЕННАЯ ЛОГИКА ГРУППИРОВКИ ---
  const grouped = useMemo<ProjectGroup[]>(() => {
    const byContractor = new Map<string, Map<string, ProjectRow[]>>();
    for (const r of projects) {
      if (!byContractor.has(r.contractor)) byContractor.set(r.contractor, new Map());
      const byProject = byContractor.get(r.contractor)!;
      const key = r.project || 'Без проекта';
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(r);
    }
    return Array.from(byContractor.entries())
      .map(([contractor, projMap]) => ({
        contractor,
        projects: Array.from(projMap.entries()).map(([project, sections]) => {
          
          // Фильтруем разделы по направлениям
          const incomeSections = sections.filter((x) => (x.direction || '').toLowerCase() === 'нам должны');
          const expenseSections = sections.filter((x) => (x.direction || '').toLowerCase() === 'мы должны');

          // Считаем суммы: Договор и Остаток
          const incomeTotal = incomeSections.reduce((s, x) => s + (Number(x.amount) || 0), 0);
          const incomeRemainder = incomeSections.reduce((s, x) => s + (Number(x.remainder_calc) || 0), 0);

          const expenseTotal = expenseSections.reduce((s, x) => s + (Number(x.amount) || 0), 0);
          const expenseRemainder = expenseSections.reduce((s, x) => s + (Number(x.remainder_calc) || 0), 0);

          const avgProgress =
            sections.length > 0
              ? sections.reduce((s, x) => s + (Number(x.progress) || 0), 0) / sections.length
              : 0;

          const uniqueResponsibles = Array.from(
            new Set(
              sections
                .map((x) => x.responsible_nickname || String(x.responsible ?? ''))
                .filter(Boolean),
            ),
          );

          const name = sections[0]?.name || '';
          
          return { 
            project, 
            name, 
            sections, 
            incomeTotal, 
            incomeRemainder, 
            expenseTotal, 
            expenseRemainder, 
            avgProgress, 
            uniqueResponsibles 
          };
        }),
      }))
      .sort((a, b) => collator.compare(a.contractor ?? '', b.contractor ?? ''));
  }, [projects, collator]);

  const openProjectByName = (name?: string, fallbackContractor?: string, fallbackProject?: string) => {
    if (name) {
      navigate(`/projects/${encodeURIComponent(name)}`);
    } else if (fallbackContractor && fallbackProject) {
      const key = `${fallbackContractor} / ${fallbackProject}`;
      navigate(`/projects/${encodeURIComponent(key)}`);
    }
  };

  /* -------------------- Диалог создания (без изменений) -------------------- */
  const [dlgOpen, setDlgOpen] = useState(false);
  const [newContractor, setNewContractor] = useState('');
  const [newProject, setNewProject] = useState('');
  const canSave = newContractor.trim().length > 0 && newProject.trim().length > 0;

  const createProject = useCallback(
    async (payload: { contractor: string; project: string }) => {
      const contractorName = payload.contractor.trim();
      const exists = contractorOptions.some((name) => equalsCI(name, contractorName));
      if (!exists) {
        await api(`${API}/organizations`, {
          method: 'POST',
          body: JSON.stringify({ name: contractorName }),
        });
      }
      const body = {
        contractor: contractorName,
        project: payload.project.trim(),
        section: '',
        direction: '',
        amount: 0,
        note: '',
        start: '',
        end: '',
        responsible: null,
        status: '',
        progress: 0,
      };
      return api<{ insertedID: number; name?: string }>(`${API}/projects`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    [contractorOptions]
  );

  const addMutation = useMutation<
    { insertedID: number; name?: string },
    any,
    { contractor: string; project: string }
  >({
    mutationFn: createProject,
    onSuccess: async (ret, vars) => {
      setDlgOpen(false);
      setNewContractor('');
      setNewProject('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['organizations'] }),
      ]);
      openProjectByName(ret?.name, vars.contractor, vars.project);
    },
    onError: (e: any) => {
      if (e?.message !== 'UNAUTHORIZED' && e?.message !== 'Недостаточно прав') {
        showError(e?.message || 'Не удалось создать проект');
      }
    },
    retry: 0,
  });

  /* -------------------- UI -------------------- */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (contractor: string) =>
    setCollapsed((prev) => ({ ...prev, [contractor]: !prev[contractor] }));

  return (
    <Box className="root projects-root projects-page">
      <Box className="header projects-header">
        <Typography variant="h6" className="title projects-title">
          Проекты
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" className="actions header-actions">
          {isAdmin && (
            <Button className="bluebutton tiny-btn" size="small" onClick={() => setDlgOpen(true)}>
              Добавить проект
            </Button>
          )}
        </Stack>
      </Box>

      <Box className="content projects-content">
        {isLoading ? (
          <Typography className="t-secondary">Загрузка…</Typography>
        ) : grouped.length === 0 ? (
          <Typography className="t-secondary">Данных нет.</Typography>
        ) : (
          <div className="groups">
            {grouped.map((grp) => {
              const isCollapsed = !!collapsed[grp.contractor];
              return (
                <Paper key={grp.contractor} elevation={0} className="contractor-card bg-surface2">
                  <Stack direction="row" spacing={1} alignItems="center" className="contractor-header">
                    <IconButton
                      size="small"
                      onClick={() => toggleGroup(grp.contractor)}
                      aria-label={isCollapsed ? 'Развернуть' : 'Свернуть'}
                    >
                      <ExpandMoreIcon className={`toggle-icon ${isCollapsed ? 'is-collapsed' : ''}`} fontSize="small" />
                    </IconButton>

                    <Typography variant="h6" className="contractor-title">
                      {grp.contractor}
                    </Typography>
                    <Typography variant="caption" className="contractor-count">
                      {grp.projects.length} проект(а)
                    </Typography>
                  </Stack>

                  <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
                    <Box className="project-grid">
                      {grp.projects
                        .sort((a, b) => collator.compare(a.project ?? '', b.project ?? ''))
                        .map((p) => (
                          <Paper
                            key={p.name || p.project}
                            variant="outlined"
                            className="project-card bg-surface"
                            onClick={() => openProjectByName(p.name, grp.contractor, p.project)}
                          >
                            <Stack spacing={1}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <FolderOpenIcon fontSize="small" />
                                <Typography variant="subtitle1" className="project-title t-strong" noWrap>
                                  {p.project || 'Без проекта'}
                                </Typography>
                              </Stack>

                              {/* --- НОВЫЙ БЛОК С ФИНАНСАМИ --- */}
                              <Stack spacing={0.5} sx={{ mt: 1, mb: 1 }}>
                                {/* ДОХОДЫ (Зеленые) */}
                                {(p.incomeTotal > 0 || p.incomeRemainder !== 0) && (
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <TrendingUpIcon fontSize="small" color="success" />
                                    <Stack direction="row" spacing={0.5} alignItems="baseline">
                                      <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                                        + {fmtMoney(p.incomeTotal)}
                                      </Typography>
                                      <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.8 }}>
                                        / {fmtMoney(p.incomeRemainder)}
                                      </Typography>
                                    </Stack>
                                  </Stack>
                                )}

                                {/* РАСХОДЫ (Красные) */}
                                {(p.expenseTotal > 0 || p.expenseRemainder !== 0) && (
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <TrendingDownIcon fontSize="small" color="error" />
                                    <Stack direction="row" spacing={0.5} alignItems="baseline">
                                      <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 'bold' }}>
                                        - {fmtMoney(p.expenseTotal)}
                                      </Typography>
                                      <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.8 }}>
                                        / {fmtMoney(p.expenseRemainder)}
                                      </Typography>
                                    </Stack>
                                  </Stack>
                                )}
                                
                                {/* Если вообще нет денег */}
                                {p.incomeTotal === 0 && p.expenseTotal === 0 && (
                                    <Typography variant="caption" color="text.secondary" sx={{pl: '30px'}}>Нет сумм по договору</Typography>
                                )}
                              </Stack>
                              {/* ----------------------------- */}

                              <Stack direction="row" spacing={1} alignItems="center">
                                <PercentIcon />
                                <Typography variant="body2" className="body-text">
                                  Готовность: <b>{p.avgProgress.toFixed(1)}%</b>
                                </Typography>
                              </Stack>
                            </Stack>
                          </Paper>
                        ))}
                    </Box>
                  </Collapse>
                </Paper>
              );
            })}
          </div>
        )}
      </Box>

      {/* Диалог создания */}
      {isAdmin && (
        <Dialog
          open={dlgOpen}
          onClose={() => setDlgOpen(false)}
          fullWidth
          maxWidth="sm"
          PaperProps={{ className: 'dialog-paper' }}
        >
          <DialogTitle>Новый проект</DialogTitle>
          <DialogContent className="dialog-content--compact">
            <Stack spacing={2} className="mt-1">
              <Autocomplete
                freeSolo
                options={contractorOptions}
                value={newContractor}
                inputValue={newContractor}
                onInputChange={(_, v) => setNewContractor(v)}
                onChange={(_, v) => setNewContractor(typeof v === 'string' ? v : v ?? '')}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Контрагент (выберите или введите)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canSave && !addMutation.isPending) {
                        e.preventDefault();
                        addMutation.mutate({
                          contractor: newContractor.trim(),
                          project: newProject.trim(),
                        });
                      }
                    }}
                    fullWidth
                    className="dark-input"
                  />
                )}
              />

              <TextField
                label="Проект"
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave && !addMutation.isPending) {
                    addMutation.mutate({
                      contractor: newContractor.trim(),
                      project: newProject.trim(),
                    });
                  }
                }}
                fullWidth
                className="dark-input"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDlgOpen(false)} className="btn-text-no-transform">Отмена</Button>
            <Button
              className="bluebutton"
              disabled={!canSave || addMutation.isPending}
              onClick={() =>
                addMutation.mutate({
                  contractor: newContractor.trim(),
                  project: newProject.trim(),
                })
              }
            >
              Создать
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};

export default ProjectsPage;