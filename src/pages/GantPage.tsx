import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom'; // <--- Добавлен импорт
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { 
  Search, 
  X, 
  Filter, 
  ChevronDown, 
  ChevronRight, 
  Maximize2, 
  Minimize2, 
  Layout, 
  Calendar,
  Columns
} from 'lucide-react';

import { api, me } from '../lib/api';

/* ================================= CONFIG & TYPES ================================= */

const STORAGE_KEYS = {
  SEARCH: 'gantt_search',
  GRID_COLLAPSED: 'gantt_grid_collapsed',
  EXPANDED_IDS: 'gantt_expanded_ids',
  SELECTED_GROUPS: 'gantt_selected_groups',
  VIEW_MODE: 'gantt_view_mode',
} as const;

const STATUSES = [
  { key: 'Назначена', label: 'Назначена', color: '#e6edf3', bg: 'rgba(56, 139, 253, 0.15)', border: 'rgba(56, 139, 253, 0.4)' },
  { key: 'В работе', label: 'В работе', color: '#fff', bg: '#238636', border: 'transparent' },
  { key: 'На проверке', label: 'На проверке', color: '#fff', bg: '#8957e5', border: 'transparent' },
  { key: 'Пауза', label: 'Пауза', color: '#e6edf3', bg: 'rgba(110, 118, 129, 0.4)', border: 'transparent' },
  { key: 'Готово', label: 'Готово', color: '#fff', bg: '#1f6feb', border: 'transparent' },
] as const;

const getStatusStyle = (s: string) => {
  const found = STATUSES.find(x => x.key === s);
  return found || { key: s, label: s || '—', color: '#9fb0bf', bg: 'rgba(110, 118, 129, 0.1)', border: 'transparent' };
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

const toISO = (d: string | Date | null | undefined): string => {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
};

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
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  
  return [state, setState];
};

/* ================================= MAIN COMPONENT ================================= */

const GantPage: React.FC<{ showError: (m: string) => void }> = ({ showError }) => {
  const qc = useQueryClient();

  // UI State
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 }); // <--- Позиция портала
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dlgTask, setDlgTask] = useState<ProjectDto | null>(null);

  // Persistent State
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEYS.VIEW_MODE, ViewMode.Month);
  const [search, setSearch] = usePersistentState(STORAGE_KEYS.SEARCH, '');
  const [gridCollapsed, setGridCollapsed] = usePersistentState(STORAGE_KEYS.GRID_COLLAPSED, false);
  const [expandedGroupIds, setExpandedGroupIds] = usePersistentState<string[]>(STORAGE_KEYS.EXPANDED_IDS, []);
  const [selectedGroupsList, setSelectedGroupsList] = usePersistentState<string[]>(STORAGE_KEYS.SELECTED_GROUPS, []);

  const selectedGroups = useMemo(() => new Set(selectedGroupsList), [selectedGroupsList]);
  const expandedSet = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds]);

  // Логика открытия портала фильтров
  const toggleDropdown = (key: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (activeDropdown === key) {
      setActiveDropdown(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        left: rect.left
      });
      setActiveDropdown(key);
    }
  };

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      const clickedInsideFilter = dropdownRef.current && dropdownRef.current.contains(target);
      const clickedInsidePortal = target.closest('.dropdown-portal-root');

      if (!clickedInsideFilter && !clickedInsidePortal) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Data Loading
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => me(), staleTime: 300000 });
  const isAdmin = meData?.user?.role === 'admin';

  const { data: projects = [], isLoading } = useQuery<ProjectDto[]>({
    queryKey: ['projects'], queryFn: () => api<ProjectDto[]>('/api/projects'), staleTime: 900000
  });

  const { data: users = [] } = useQuery<ResponsibleUser[]>({
    queryKey: ['users', 'responsible'], queryFn: () => api<ResponsibleUser[]>('/api/responsible'), staleTime: 900000
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

      // Group Task
      ganttTasks.push({
        start: minStart,
        end: maxEnd,
        name: groupKey,
        id: projectId,
        progress: 0,
        type: 'project',
        hideChildren: !isExpanded,
        styles: { progressColor: 'transparent', progressSelectedColor: 'transparent', backgroundColor: 'transparent', backgroundSelectedColor: 'transparent' },
        // @ts-ignore
        _isGroup: true,
      });

      // Child Tasks
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

    return { tasks: ganttTasks, availableGroups: allGroups, sectionOptions: opts, groupingOptions: allGroups };
  }, [projects, users, search, selectedGroups, expandedSet, isAdmin]);

  // Handlers
  const handleTaskChange = useCallback((task: Task) => {
    if (!isAdmin) return;
    // @ts-ignore
    const raw = task._raw;
    if (!raw) return;
    updateMutation.mutate({ id: Number(task.id), patch: { start: toISO(task.start), end: toISO(task.end) } });
  }, [isAdmin, updateMutation]);

  const handleExpander = useCallback((task: Task) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      next.has(task.id) ? next.delete(task.id) : next.add(task.id);
      return Array.from(next);
    });
  }, [setExpandedGroupIds]);

  const handleExpandAll = () => setExpandedGroupIds(tasks.filter((t) => t.type === 'project').map((t) => t.id));
  const handleCollapseAll = () => setExpandedGroupIds([]);

  /* --- Render Custom Columns --- */
  const GridHeader = ({ headerHeight }: { headerHeight: number }) => (
    <div className="gantt-header-row" style={{ height: headerHeight }}>
      <div className="gantt-cell cell-main">Проект</div>
      {!gridCollapsed && (
        <>
          <div className="gantt-cell cell-user">Исполнитель</div>
          <div className="gantt-cell cell-status">Статус</div>
        </>
      )}
    </div>
  );

  const TaskListTable = ({ tasks, rowHeight, onExpanderClick }: any) => (
    <div className="gantt-table-body">
      {tasks.map((task: any) => {
        const isGroup = task.type === 'project';
        const st = getStatusStyle(task._raw?.status);
        const uName = task._user;
        const isExpanded = expandedSet.has(task.id);

        return (
          <div
            key={task.id}
            className={`gantt-row ${isGroup ? 'row-group' : 'row-task'}`}
            style={{ height: rowHeight }}
            onClick={() => (isGroup ? onExpanderClick(task) : isAdmin && setDlgTask(task._raw))}
            title={task.name}
          >
            <div className="gantt-cell cell-main">
              {isGroup && (
                <div className="expander-icon">
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
              )}
              <span className="cell-text">{task.name}</span>
            </div>

            {!gridCollapsed && !isGroup && (
              <>
                <div className="gantt-cell cell-user">
                  {uName ? (
                    <div className="flex items-center gap-2">
                      <div className="avatar-xs text-[10px]">{uName[0].toUpperCase()}</div>
                      <span className="truncate text-xs">{uName}</span>
                    </div>
                  ) : <span className="text-soft">—</span>}
                </div>
                <div className="gantt-cell cell-status">
                  {task._raw?.status ? (
                    <span 
                      className="badge" 
                      style={{ 
                        backgroundColor: st.bg, 
                        color: st.color, 
                        border: `1px solid ${st.border}`,
                        fontSize: '10px', padding: '2px 6px' 
                      }}
                    >
                      {st.label}
                    </span>
                  ) : <span className="text-soft">—</span>}
                </div>
              </>
            )}
            {!gridCollapsed && isGroup && <div className="flex-grow"></div>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="page-container gantt-page">
      {/* Header */}
      <div className="header">
        <h2 className="text-xl font-bold m-0 flex items-center gap-2">
          Гант
        </h2>

        <div className="actions-block">
          {/* View Mode Toggle */}
          <div className="btn-group">
            <button className={`btn-group-item ${viewMode === ViewMode.Day ? 'active' : ''}`} onClick={() => setViewMode(ViewMode.Day)}>День</button>
            <button className={`btn-group-item ${viewMode === ViewMode.Week ? 'active' : ''}`} onClick={() => setViewMode(ViewMode.Week)}>Неделя</button>
            <button className={`btn-group-item ${viewMode === ViewMode.Month ? 'active' : ''}`} onClick={() => setViewMode(ViewMode.Month)}>Месяц</button>
          </div>

          {/* Search */}
          <div className="relative">
             <input 
               className="input" 
               placeholder="Поиск..." 
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
             {search && (
               <button className="absolute right-2 top-1/2 transform -translate-y-1/2 text-soft hover:text-white" onClick={() => setSearch('')}>
                 <X size={14}/>
               </button>
             )}
          </div>
        </div>
      </div>

      <div className="content">

        {/* Filters Bar */}
        <div className="filtr" ref={dropdownRef}>
          <button className="chip-btn" onClick={expandedSet.size > 0 ? handleCollapseAll : handleExpandAll}>
            {expandedSet.size > 0 ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
            {expandedSet.size > 0 ? 'Свернуть' : 'Развернуть'}
          </button>
          
          <button className={`chip-btn ${gridCollapsed ? 'active' : ''}`} onClick={() => setGridCollapsed(v => !v)}>
            {gridCollapsed ? <Layout size={14}/> : <Columns size={14}/>}
            {gridCollapsed ? 'Показать таблицу' : 'Скрыть таблицу'}
          </button>

          {/* Groups Filter */}
          <div className="relative">
            <button 
              className={`chip-btn ${selectedGroups.size > 0 ? 'active' : ''}`} 
              onClick={(e) => toggleDropdown('groups', e)}
            >
              <Filter size={14}/>
              {selectedGroups.size ? `Группы: ${selectedGroups.size}` : 'Все группы'}
              <ChevronDown size={14}/>
            </button>
            
            {activeDropdown === 'groups' && createPortal(
              <div 
                className="dropdown-menu p-2 dropdown-portal-root" 
                style={{
                  position: 'fixed', 
                  top: dropdownPos.top, 
                  left: dropdownPos.left, 
                  zIndex: 9999, 
                  width: 280, 
                  maxHeight: 400, 
                  overflowY: 'auto',
                  marginTop: 0
                }}
              >
                <div className="actions-block">
                    <button className="btn" onClick={() => setSelectedGroupsList(availableGroups)}>Все</button>
                    <button className="btn" onClick={() => setSelectedGroupsList([])}>Сброс</button>
                </div>
                {availableGroups.map(g => (
                  <label key={g} className="dropdown-item checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={selectedGroups.has(g)}
                      onChange={() => {
                          const newSet = new Set(selectedGroups);
                          newSet.has(g) ? newSet.delete(g) : newSet.add(g);
                          setSelectedGroupsList(Array.from(newSet));
                      }}
                    />
                    <span className="truncate">{g}</span>
                  </label>
                ))}
              </div>,
              document.body
            )}
          </div>
        </div>

        {/* Chart Container */}
        <div className="card gantt-container block">
          {isLoading ? (
            <div className="flex justify-center items-center h-full text-soft">Загрузка...</div>
          ) : tasks.length === 0 ? (
            <div className="flex justify-center items-center h-full text-soft">Нет задач для отображения</div>
          ) : (
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
              listCellWidth={gridCollapsed ? '' : '450px'}
              columnWidth={viewMode === ViewMode.Month ? 150 : viewMode === ViewMode.Week ? 65 : 60}
              rowHeight={40}
              headerHeight={50}
              barFill={70}
              ganttHeight={0}
              locale="ru"
              TooltipContent={() => <></>} // Отключаем стандартный тултип
              TaskListHeader={GridHeader}
              TaskListTable={TaskListTable}
              fontFamily="var(--font-family)"
              fontSize="13px"
              arrowColor="var(--text-soft)"
              todayColor="rgba(32, 160, 255, 0.05)"
            />
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {isAdmin && dlgTask && (
        <TaskModal
          task={dlgTask}
          onClose={() => setDlgTask(null)}
          onSave={(dto) => {
            updateMutation.mutate({ id: dto.id, patch: dto });
            setDlgTask(null);
          }}
          users={users}
          sectionOptions={sectionOptions}
          groupingOptions={groupingOptions}
        />
      )}
    </div>
  );
};

/* ================================= TASK MODAL ================================= */

const TaskModal: React.FC<{
  task: ProjectDto;
  onClose: () => void;
  onSave: (d: ProjectDto) => void;
  users: ResponsibleUser[];
  sectionOptions: SectionOption[];
  groupingOptions: string[];
}> = ({ task, onClose, onSave, users, sectionOptions, groupingOptions }) => {
  const [form, setForm] = useState(task);

  // Группировка опций разделов
  const groupedOpts = useMemo(() => {
    const grp: Record<string, SectionOption[]> = {};
    sectionOptions.forEach(o => {
      const k = `${o.contractor} / ${o.project}`;
      if (!grp[k]) grp[k] = [];
      grp[k].push(o);
    });
    return grp;
  }, [sectionOptions]);

  const currentSectionKey = `${form.contractor}|${form.project}|${form.section}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Редактирование задачи</h3>
          <button className="icon-btn" onClick={onClose}><X size={20}/></button>
        </div>
        
        <div className="modal-body flex flex-col gap-4">
          {/* Section Select */}
          <div className="input-group">
            <label className="input-label">Раздел</label>
            <select 
              className="input"
              value={currentSectionKey}
              onChange={(e) => {
                const opt = sectionOptions.find(o => o.key === e.target.value);
                if(opt) setForm({...form, contractor: opt.contractor, project: opt.project, section: opt.section});
              }}
            >
              <option value="">-- Выберите --</option>
              {Object.entries(groupedOpts).map(([label, opts]) => (
                <optgroup key={label} label={label}>
                  {opts.map(o => <option key={o.key} value={o.key}>{o.section}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Grouping Datalist */}
          <div className="input-group">
            <label className="input-label">Группировка</label>
            <input 
              className="input" 
              list="gantt-group-opts" 
              value={form.grouping || ''} 
              onChange={e => setForm({...form, grouping: e.target.value})}
            />
            <datalist id="gantt-group-opts">
              {groupingOptions.map(g => <option key={g} value={g}/>)}
            </datalist>
          </div>

          <div className="flex gap-4">
            <div className="input-group flex-1">
              <label className="input-label">Начало</label>
              <input type="date" className="input" value={toISO(form.start)} onChange={e => setForm({...form, start: e.target.value || null})} />
            </div>
            <div className="input-group flex-1">
              <label className="input-label">Срок</label>
              <input type="date" className="input" value={toISO(form.end)} onChange={e => setForm({...form, end: e.target.value || null})} />
            </div>
          </div>

          <div className="flex gap-4">
             <div className="input-group flex-1">
               <label className="input-label">Статус</label>
               <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                 {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
               </select>
             </div>
             <div className="input-group flex-1">
               <label className="input-label">Ответственный</label>
               <select className="input" value={form.responsible || ''} onChange={e => setForm({...form, responsible: e.target.value ? Number(e.target.value) : null})}>
                 <option value="">(Нет)</option>
                 {users.map(u => <option key={u.id} value={u.id}>{u.nickname || u.login}</option>)}
               </select>
             </div>
          </div>

          <div className="input-group">
             <div className="flex justify-between mb-1">
               <label className="input-label">Прогресс</label>
               <span className="text-xs font-bold text-primary">{form.progress}%</span>
             </div>
             <input 
               type="range" min="0" max="100" step="5" 
               className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer range-slider"
               style={{background: `linear-gradient(to right, var(--primary) ${form.progress}%, var(--border) ${form.progress}%)`}}
               value={form.progress} 
               onChange={e => setForm({...form, progress: Number(e.target.value)})}
             />
          </div>

          <div className="input-group">
            <label className="input-label">Примечание</label>
            <textarea className="input" rows={2} value={form.note || ''} onChange={e => setForm({...form, note: e.target.value})} />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Отмена</button>
          <button className="btn" onClick={() => onSave(form)}>Сохранить</button>
        </div>
      </div>
    </div>
  );
};

export default GantPage;