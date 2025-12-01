import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box, Stack, TextField, Typography, Chip, InputAdornment, IconButton,
  MenuItem, Autocomplete, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Menu, Checkbox, FormControlLabel, FormGroup, CircularProgress, ToggleButton, ToggleButtonGroup
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import FilterListIcon from '@mui/icons-material/FilterList';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';

import { api, me } from '../lib/api';

/* ==================================================================================
   CONFIG & TYPES
   ================================================================================== */

const STORAGE_KEYS = {
  SEARCH: 'gantt_search',
  GRID_COLLAPSED: 'gantt_grid_collapsed',
  EXPANDED_IDS: 'gantt_expanded_ids',
  SELECTED_GROUPS: 'gantt_selected_groups',
  VIEW_MODE: 'gantt_view_mode',
} as const;

const STATUSES = [
  { key: 'Назначена', label: 'Назначена', color: 'var(--text)', bg: 'var(--status-assigned-border)' },
  { key: 'В работе', label: 'В работе', color: '#fff', bg: 'var(--primary)' },
  { key: 'На проверке', label: 'На проверке', color: '#fff', bg: '#9c27b0' },
  { key: 'Пауза', label: 'Пауза', color: '#fff', bg: 'var(--danger)' },
  { key: 'Готово', label: 'Готово', color: '#fff', bg: 'var(--success)' },
] as const;

const getStatusStyle = (s: string) => {
  const found = STATUSES.find(x => x.key === s);
  return found || { key: s, label: s || '—', color: 'var(--text-soft)', bg: 'var(--line-weak)' };
};

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
  responsible: number | null;
  grouping?: string | null;
};

type ResponsibleUser = { id: number; login: string; nickname: string };
type SectionOption = { key: string; contractor: string; project: string; section: string };

const getValidDate = (d: string | Date | null | undefined, fallback = new Date()) => {
  if (!d) return fallback;
  const date = new Date(d);
  return isNaN(date.getTime()) ? fallback : date;
};

const toISO = (d: Date) => d.toISOString().split('T')[0];

/* Hook: Persistent State */
const usePersistentState = <T,>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });
  
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  
  return [state, setState];
};

/* ==================================================================================
   MAIN COMPONENT
   ================================================================================== */

const GantPage: React.FC<{ showError: (m: string) => void }> = ({ showError }) => {
  const qc = useQueryClient();

  // UI State
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [dlgTask, setDlgTask] = useState<ProjectDto | null>(null);

  // Persistent State
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEYS.VIEW_MODE, ViewMode.Month);
  const [search, setSearch] = usePersistentState(STORAGE_KEYS.SEARCH, '');
  const [gridCollapsed, setGridCollapsed] = usePersistentState(STORAGE_KEYS.GRID_COLLAPSED, false);
  const [expandedGroupIds, setExpandedGroupIds] = usePersistentState<string[]>(STORAGE_KEYS.EXPANDED_IDS, []);
  const [selectedGroupsList, setSelectedGroupsList] = usePersistentState<string[]>(STORAGE_KEYS.SELECTED_GROUPS, []);

  const selectedGroups = useMemo(() => new Set(selectedGroupsList), [selectedGroupsList]);
  const expandedSet = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds]);

  // Data Loading
  const { data: meData } = useQuery({ 
    queryKey: ['me'], 
    queryFn: () => me(), 
    staleTime: 5 * 60 * 1000 
  });
  const isAdmin = meData?.user?.role === 'admin';

  const { data: projects = [], isLoading } = useQuery<ProjectDto[]>({
    queryKey: ['projects'],
    queryFn: () => api<ProjectDto[]>('/api/projects'),
    staleTime: 15 * 60 * 1000,
  });

  const { data: users = [] } = useQuery<ResponsibleUser[]>({
    queryKey: ['users', 'responsible'],
    queryFn: () => api<ResponsibleUser[]>('/api/responsible'),
    staleTime: 15 * 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ProjectDto> }) =>
      api(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
    onError: (e: any) => showError(e.message || 'Ошибка сохранения'),
  });

  // Data Transformation
  const { tasks, availableGroups, sectionOptions, groupingOptions } = useMemo(() => {
    const q = search.toLowerCase();

    const filtered = projects.filter((p) => {
      const notDebt = (p.direction || '').toLowerCase() !== 'нам должны';
      const matchSearch = !q || `${p.section} ${p.project} ${p.contractor}`.toLowerCase().includes(q);
      const matchGroup = selectedGroups.size === 0 || (p.grouping && selectedGroups.has(p.grouping));
      return notDebt && matchSearch && matchGroup;
    });

    const groups: Record<string, ProjectDto[]> = {};
    filtered.forEach((p) => {
      const key = `${p.contractor} / ${p.project}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    const ganttTasks: Task[] = [];
    const sortedKeys = Object.keys(groups).sort();

    sortedKeys.forEach((groupKey) => {
      const groupItems = groups[groupKey];
      groupItems.sort((a, b) => getValidDate(a.start).getTime() - getValidDate(b.start).getTime());

      const minStart = new Date(Math.min(...groupItems.map((i) => getValidDate(i.start).getTime())));
      const maxEnd = new Date(
        Math.max(...groupItems.map((i) => getValidDate(i.end, new Date(Date.now() + 86400000 * 7)).getTime()))
      );
      const projectId = `grp-${groupKey}`;
      const isExpanded = expandedSet.has(projectId);

      // Project Group
      ganttTasks.push({
        start: minStart,
        end: maxEnd,
        name: groupKey,
        id: projectId,
        progress: 0,
        type: 'project',
        hideChildren: !isExpanded,
        styles: {
          progressColor: 'transparent',
          progressSelectedColor: 'transparent',
          backgroundColor: 'transparent',
          backgroundSelectedColor: 'transparent',
        },
        // @ts-ignore
        _isGroup: true,
      });

      // Tasks
      groupItems.forEach((item) => {
        const user = users.find((u) => u.id === item.responsible);
        const statusStyle = getStatusStyle(item.status);

        ganttTasks.push({
          start: getValidDate(item.start),
          end: getValidDate(item.end, new Date(getValidDate(item.start).getTime() + 86400000 * 2)),
          name: item.section || '(без раздела)',
          id: String(item.id),
          progress: 0,
          type: 'task',
          project: projectId,
          isDisabled: !isAdmin,
          hideChildren: !isExpanded,
          styles: {
            progressColor: 'transparent',
            progressSelectedColor: 'transparent',
            backgroundColor: statusStyle.bg,
            backgroundSelectedColor: statusStyle.bg,
          },
          // @ts-ignore
          _raw: item,
          _user: user ? user.nickname || user.login : null,
        });
      });
    });

    const allGroups = Array.from(new Set(projects.map((p) => p.grouping).filter(Boolean) as string[])).sort();
    const opts = projects.map((p) => ({
      key: `${p.contractor}|${p.project}|${p.section}`,
      contractor: p.contractor,
      project: p.project,
      section: p.section,
    }));
    const allGroupingOptions = Array.from(
      new Set(projects.map((p) => p.grouping).filter(Boolean) as string[])
    ).sort((a, b) => a.localeCompare(b, 'ru'));

    return { tasks: ganttTasks, availableGroups: allGroups, sectionOptions: opts, groupingOptions: allGroupingOptions };
  }, [projects, users, search, selectedGroups, expandedSet]);

  // Handlers
  const handleTaskChange = useCallback(
    (task: Task) => {
      if (!isAdmin) return;
      // @ts-ignore
      const raw = task._raw as ProjectDto | undefined;
      if (!raw) return;

      updateMutation.mutate({
        id: Number(task.id),
        patch: { start: toISO(task.start), end: toISO(task.end) },
      });
    },
    [isAdmin, updateMutation]
  );

  const handleExpander = useCallback(
    (task: Task) => {
      setExpandedGroupIds((prev) => {
        const next = new Set(prev);
        next.has(task.id) ? next.delete(task.id) : next.add(task.id);
        return Array.from(next);
      });
    },
    [setExpandedGroupIds]
  );

  const handleExpandAll = useCallback(() => {
    const allGroupIds = tasks.filter((t) => t.type === 'project').map((t) => t.id);
    setExpandedGroupIds(allGroupIds);
  }, [tasks, setExpandedGroupIds]);

  const handleCollapseAll = useCallback(() => setExpandedGroupIds([]), [setExpandedGroupIds]);

  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Custom Grid Renderers
  const GridHeader = ({ headerHeight }: { headerHeight: number }) => (
    <div className="gantt-grid-header" style={{ height: headerHeight }}>
      <div className="gantt-grid-header__cell gantt-grid-header__cell--main">
        Задача / Проект
      </div>
      {!gridCollapsed && (
        <>
          <div className="gantt-grid-header__cell gantt-grid-header__cell--responsible">
            Исполнитель
          </div>
          <div className="gantt-grid-header__cell gantt-grid-header__cell--status">
            Статус
          </div>
        </>
      )}
    </div>
  );

  const TaskListTable = ({
    tasks,
    rowHeight,
    onExpanderClick,
  }: {
    tasks: Task[];
    rowHeight: number;
    onExpanderClick: (task: Task) => void;
  }) => (
    <div className="gantt-grid-body">
      {tasks.map((task) => {
        const t = task as any;
        const isGroup = t.type === 'project';
        const st = getStatusStyle(t._raw?.status);
        const uName = t._user;
        const uInit = uName ? uName[0].toUpperCase() : '?';
        const isExpanded = expandedSet.has(t.id);

        return (
          <div
            key={t.id}
            className={`gantt-grid-row ${isGroup ? 'gantt-grid-row--group' : 'gantt-grid-row--task'}`}
            style={{ height: rowHeight }}
            onClick={() => (isGroup ? onExpanderClick(t) : isAdmin && setDlgTask(t._raw))}
            title={t.name}
          >
            <div className={`gantt-grid-cell gantt-grid-cell--main ${isGroup ? 'gantt-grid-cell--group' : ''}`}>
              {isGroup && (
                <div className="gantt-grid-expander">
                  {isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                </div>
              )}
              <span className="gantt-grid-cell__text">{t.name}</span>
            </div>

            {!gridCollapsed && !isGroup && (
              <>
                <div className="gantt-grid-cell gantt-grid-cell--responsible">
                  {uName ? (
                    <>
                      <div className="gantt-user-avatar">{uInit}</div>
                      <span className="gantt-user-name">{uName}</span>
                    </>
                  ) : (
                    <span className="gantt-empty">—</span>
                  )}
                </div>
                <div className="gantt-grid-cell gantt-grid-cell--status">
                  {t._raw?.status ? (
                    <Chip
                      size="small"
                      label={st.label}
                      className="gantt-status-chip"
                      sx={{
                        height: 22,
                        fontSize: 10,
                        fontWeight: 700,
                        bgcolor: st.bg,
                        color: st.color,
                        border: '1px solid var(--border)',
                      }}
                    />
                  ) : (
                    <span className="gantt-empty">—</span>
                  )}
                </div>
              </>
            )}

            {!gridCollapsed && isGroup && (
              <>
                <div className="gantt-grid-cell gantt-grid-cell--empty"></div>
                <div className="gantt-grid-cell gantt-grid-cell--empty"></div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <Box className="gantt-page">
      {/* Header */}
      <Box className="gantt-header">
        <Typography variant="h6" className="title">
          План-график
        </Typography>

        <Stack direction="row" spacing={1.5} alignItems="center">
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            size="small"
            onChange={(_, v) => v && setViewMode(v)}
            className="gantt-view-toggle"
          >
            <ToggleButton value={ViewMode.Day}>День</ToggleButton>
            <ToggleButton value={ViewMode.Week}>Неделя</ToggleButton>
            <ToggleButton value={ViewMode.Month}>Месяц</ToggleButton>
          </ToggleButtonGroup>

          <TextField
            size="small"
            placeholder="Поиск…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search"
            sx={{ maxWidth: 220 }}
            InputProps={{
              endAdornment: search && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearch('')}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </Box>

      {/* Filters */}
      <Box className="gantt-filters">
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip
            label={expandedSet.size > 0 ? 'Свернуть все' : 'Развернуть все'}
            onClick={expandedSet.size > 0 ? handleCollapseAll : handleExpandAll}
            className="chip chip--clickable"
            icon={expandedSet.size > 0 ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />}
          />
          <Chip
            label={gridCollapsed ? 'Показать таблицу' : 'Скрыть таблицу'}
            onClick={() => setGridCollapsed((v) => !v)}
            className={`chip chip--clickable ${gridCollapsed ? 'chip--active' : ''}`}
          />
          <Chip
            label={selectedGroups.size ? `Группы: ${selectedGroups.size}` : 'Все группы'}
            icon={<FilterListIcon />}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            className={`chip chip--clickable ${selectedGroups.size ? 'chip--active' : ''}`}
          />

          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            PaperProps={{ sx: { maxHeight: 400, width: 280 } }}
          >
            <Box sx={{ px: 2, py: 1, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
              <Button size="small" onClick={() => setSelectedGroupsList(availableGroups)}>Выбрать все</Button>
              <Button size="small" onClick={() => setSelectedGroupsList([])}>Сбросить</Button>
            </Box>
            <FormGroup sx={{ px: 2, py: 1 }}>
              {availableGroups.map((g) => (
                <FormControlLabel
                  key={g}
                  control={
                    <Checkbox
                      checked={selectedGroups.has(g)}
                      onChange={() => {
                        const newSet = new Set(selectedGroups);
                        newSet.has(g) ? newSet.delete(g) : newSet.add(g);
                        setSelectedGroupsList(Array.from(newSet));
                      }}
                      size="small"
                    />
                  }
                  label={<Typography variant="body2">{g}</Typography>}
                />
              ))}
            </FormGroup>
          </Menu>
        </Stack>
      </Box>

      {/* Chart */}
      <Box className="gantt-chart-container">
        {tasks.length > 0 ? (
          <div className="gantt-chart-wrapper gantt-dark-theme">
            <Gantt
              tasks={tasks}
              viewMode={viewMode}
              onDateChange={handleTaskChange}
              onProgressChange={handleTaskChange}
              onDoubleClick={(t) => {
                // @ts-ignore
                if (t.type === 'task' && isAdmin) setDlgTask(t._raw);
              }}
              onExpanderClick={handleExpander}
              listCellWidth={gridCollapsed ? '0px' : '450px'}
              columnWidth={viewMode === ViewMode.Month ? 150 : viewMode === ViewMode.Week ? 65 : 60}
              rowHeight={40}
              headerHeight={50}
              barFill={70}
              ganttHeight={0}
              locale="ru"
              TooltipContent={() => <></>}
              TaskListHeader={GridHeader}
              TaskListTable={TaskListTable}
              fontFamily="var(--font-sans)"
              fontSize="13px"
              arrowColor="var(--text-soft)"
              todayColor="rgba(32, 160, 255, 0.08)"
            />
          </div>
        ) : (
          <Box display="flex" height="100%" alignItems="center" justifyContent="center" color="text.secondary">
            Нет задач для отображения
          </Box>
        )}
      </Box>

      {/* Dialog */}
      {isAdmin && (
        <TaskDialog
          open={!!dlgTask}
          task={dlgTask}
          onClose={() => setDlgTask(null)}
          isAdmin={isAdmin}
          users={users}
          sectionOptions={sectionOptions}
          groupingOptions={groupingOptions}
          onSave={(dto) => {
            updateMutation.mutate({ id: dto.id, patch: dto });
            setDlgTask(null);
          }}
        />
      )}
    </Box>
  );
};

/* ==================================================================================
   TASK DIALOG
   ================================================================================== */

const TaskDialog: React.FC<{
  open: boolean;
  task: ProjectDto | null;
  onClose: () => void;
  onSave: (dto: ProjectDto) => void;
  isAdmin: boolean;
  users: ResponsibleUser[];
  sectionOptions: SectionOption[];
  groupingOptions: string[];
}> = ({ open, task, onClose, onSave, isAdmin, users, sectionOptions, groupingOptions }) => {
  const [form, setForm] = useState<ProjectDto | null>(null);

  useEffect(() => {
    if (task) setForm(task);
  }, [task]);

  if (!form) return null;

  const isReadOnly = !isAdmin;
  const currentSection =
    sectionOptions.find(
      (o) => o.contractor === form.contractor && o.project === form.project && o.section === form.section
    ) || { key: 'custom', contractor: form.contractor, project: form.project, section: form.section };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ className: 'board-dialog-paper' }}>
      <DialogTitle>Редактирование задачи</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Autocomplete
            options={sectionOptions}
            value={currentSection}
            disabled={isReadOnly}
            groupBy={(opt) => `${opt.contractor} / ${opt.project}`}
            getOptionLabel={(opt) => opt.section}
            renderInput={(params) => <TextField {...params} label="Раздел" />}
            onChange={(_, v) =>
              v && setForm({ ...form, contractor: v.contractor, project: v.project, section: v.section })
            }
          />
          <Autocomplete
            freeSolo
            options={groupingOptions}
            value={form.grouping || ''}
            disabled={isReadOnly}
            onInputChange={(_, v) => setForm({ ...form, grouping: v })}
            renderInput={(params) => <TextField {...params} label="Группировка" />}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Начало"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={form.start ? toISO(new Date(form.start)) : ''}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
            <TextField
              label="Срок"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={form.end ? toISO(new Date(form.end)) : ''}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              select
              fullWidth
              label="Статус"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {STATUSES.map((s) => (
                <MenuItem key={s.key} value={s.key}>{s.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              label="Ответственный"
              disabled={isReadOnly}
              value={form.responsible ?? ''}
              onChange={(e) => setForm({ ...form, responsible: e.target.value ? Number(e.target.value) : null })}
            >
              {users.map((u) => (
                <MenuItem key={u.id} value={u.id}>{u.nickname || u.login}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2" sx={{ minWidth: 100, color: 'var(--text-soft)' }}>
              Прогресс: {form.progress}%
            </Typography>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              style={{ flex: 1 }}
              value={form.progress}
              onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
            />
          </Stack>
          <TextField
            label="Сумма"
            type="number"
            fullWidth
            disabled={isReadOnly}
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
          />
          {isAdmin && (
            <TextField
              label="Примечание"
              multiline
              rows={2}
              value={form.note || ''}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} className="btn-cancel">Отмена</Button>
        <Button variant="contained" className="bluebutton" onClick={() => onSave(form)}>Сохранить</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GantPage;
