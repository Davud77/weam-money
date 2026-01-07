import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Search, 
  X, 
  Edit2, 
  Calendar,
  Settings,
  ChevronDown,
  ChevronUp,
  Layers,
  Check // Добавил иконку галочки для сохранения редактирования
} from 'lucide-react';
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
  responsible: number | null; 
  grouping?: string | null;
  [k: string]: any;
};

type ResponsibleUser = { id: number; login: string; nickname: string };

type SectionOption = {
  key: string; 
  contractor: string;
  project: string;
  section: string;
};

// colorClass теперь может хранить и класс (badge-success), и HEX (#ff0000)
type StatusDef = { key: string; label: string; colorClass?: string };

/* -------------------------------- Helpers -------------------------------- */
const DEFAULT_STATUSES: StatusDef[] = [
  { key: 'Назначена', label: 'Назначена', colorClass: 'badge-info' },
  { key: 'В работе', label: 'В работе', colorClass: 'badge-primary' },
  { key: 'На проверке', label: 'На проверке', colorClass: 'badge-warning' },
  { key: 'Пауза', label: 'Пауза', colorClass: 'badge-danger' },
  { key: 'Готово', label: 'Готово', colorClass: 'badge-success' },
];

const getStatusStyle = (color?: string) => {
  if (!color) return {};
  // Если это HEX цвет
  if (color.startsWith('#')) {
    return {
      backgroundColor: `${color}20`, // 20 - это ~12% прозрачности
      color: color,
      border: `1px solid ${color}40` // 40 - это ~25% прозрачности
    };
  }
  // Если это класс - возвращаем пустой стиль, класс применится через className
  return {};
};

const toISO = (v?: string | Date | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
};

const isOverdue = (end?: string | null, progress?: number) =>
  !!end && new Date(end).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0) && (progress ?? 0) < 100;

/* Hook: Persistent State */
function usePersistentState<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
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
}

/* --------------------------------- Components ---------------------------------- */

const BoardTaskCard: React.FC<{
  item: ProjectDto;
  user?: ResponsibleUser;
  allowDnD: boolean;
  allowProgress: boolean;
  onClickEdit: () => void;
  onUpdateProgress: (id: number, val: number) => void;
}> = ({ item, user, allowDnD, allowProgress, onClickEdit, onUpdateProgress }) => {
  const [localProgress, setLocalProgress] = useState(item.progress);
  
  useEffect(() => setLocalProgress(item.progress), [item.progress]);

  const overdue = isOverdue(item.end, item.progress);

  return (
    <div 
      className={`board-card ${!allowDnD ? 'readonly' : ''}`}
      draggable={allowDnD}
      onDragStart={(e) => {
        // Добавляем стиль наклона прямо в элемент (или через класс в CSS)
        e.currentTarget.style.transform = 'rotate(3deg)';
        e.currentTarget.style.opacity = '0.8';
        e.dataTransfer.setData('text/plain', String(item.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={(e) => {
         // Сбрасываем стили
         e.currentTarget.style.transform = '';
         e.currentTarget.style.opacity = '';
      }}
    >
       <div className="board-card-header">
         <div className="board-card-razdel truncate" title={item.section || '(без раздела)'}>
           {item.section || '(без раздела)'}
         </div>
         <button className="icon-btn tiny" onClick={onClickEdit}>
           <Edit2 size={14}/>
         </button>
       </div>

       <div className="text-xs text-soft mb-3 truncate" title={`${item.contractor} / ${item.project}`}>
         {item.contractor} / {item.project}
       </div>

       <div className="board-card-userdate flex justify-between items-center mb-3">
          <div className="flex items-center gap-1.5" title={user?.nickname || user?.login || 'Нет ответственного'}>
            <div className="avatar-xs text-[10px]">
              {(user?.nickname || user?.login || '?')[0].toUpperCase()}
            </div>
            <div className="text-xs text-soft truncate max-w-[80px]">
              {user?.nickname || user?.login || '—'}
            </div>
          </div>
          
          {item.end && (
            <div className={`text-xs flex items-center gap-1 ${overdue ? 'text-danger font-bold' : 'text-soft'}`}>
              <Calendar size={12}/>
              {new Date(item.end).toLocaleDateString('ru-RU')}
            </div>
          )}
       </div>

       <div className="range-wrapper">
          <input 
            type="range" 
            min="0" max="100" step="5"
            value={localProgress}
            disabled={!allowProgress}
            className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer range-slider"
            style={{
              background: `linear-gradient(to right, var(--primary) ${localProgress}%, var(--border) ${localProgress}%)`
            }}
            onChange={(e) => setLocalProgress(Number(e.target.value))}
            onMouseUp={() => onUpdateProgress(item.id, localProgress)}
            onTouchEnd={() => onUpdateProgress(item.id, localProgress)}
          />
          <div className="flex justify-between text-[10px] text-soft mt-1">
            <span className="text-primary font-bold">{localProgress}%</span>
          </div>
       </div>
    </div>
  );
};

/* --------------------------------- Page ---------------------------------- */
const BoardPage: React.FC<{ showError: (m: string) => void }> = ({ showError }) => {
  const qc = useQueryClient();

  /* --- Auth & Roles --- */
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => me(), staleTime: 300000 });
  const isAdmin = meData?.user?.role === 'admin';
  const allowDnD = isAdmin;
  const allowProgress = isAdmin;

  /* --- Data --- */
  const { data: projects = [] } = useQuery<ProjectDto[]>({
    queryKey: ['projects'], queryFn: () => api<ProjectDto[]>('/api/projects'), staleTime: 900000
  });

  const { data: users = [] } = useQuery<ResponsibleUser[]>({
    queryKey: ['users', 'responsible'], queryFn: () => api<ResponsibleUser[]>('/api/responsible'), staleTime: 900000
  });

  const inFlight = useRef<Set<string>>(new Set());
  
  const update = useMutation({
    mutationFn: (p: { id: number; patch: Partial<ProjectDto>; fieldKey: string }) =>
      api(`/api/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(p.patch) })
        .finally(() => inFlight.current.delete(p.fieldKey)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
    onError: (e: any) => showError(e.message || 'Ошибка'),
  });

  const userById = (id?: number | null) => users.find((u) => u.id === id);

  /* --- State --- */
  const [statuses, setStatuses] = usePersistentState<StatusDef[]>('board_custom_statuses', DEFAULT_STATUSES);
  const [savedGroups, setSavedGroups] = usePersistentState<string[]>('board_custom_groups_list', []);
  
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  
  const [search, setSearch] = useState('');
  const [selectedGroupsList, setSelectedGroupsList] = usePersistentState<string[]>('gantt_selected_groups', []);
  const selectedGroups = useMemo(() => new Set(selectedGroupsList), [selectedGroupsList]);

  const [dlg, setDlg] = useState<ProjectDto | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* --- Derived Data --- */
  const allGroups = useMemo(() => {
    const s = new Set<string>(savedGroups);
    projects.forEach(p => { if(p.grouping) s.add(p.grouping); });
    return Array.from(s).sort().map(g => ({ key: g, label: g }));
  }, [projects, savedGroups]);

  const availableGroupsForFilter = useMemo(() => {
    const s = new Set<string>();
    projects.forEach(p => { if(p.grouping) s.add(p.grouping); });
    return Array.from(s).sort();
  }, [projects]);

  const filteredProjects = useMemo(() => {
    let list = projects.filter((r) => (r.direction || '').toLowerCase() !== 'нам должны');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => `${r.section} ${r.project} ${r.contractor}`.toLowerCase().includes(q));
    }
    if (selectedGroups.size > 0) {
      list = list.filter(r => r.grouping && selectedGroups.has(r.grouping));
    }
    return list;
  }, [projects, search, selectedGroups]);

  const cols = useMemo(() => {
    const map = new Map<string, ProjectDto[]>();
    statuses.forEach((c) => map.set(c.key, []));
    const KNOWN = new Set(statuses.map(s => s.key));
    const otherTasks: ProjectDto[] = [];

    filteredProjects.filter(r => r.progress < 100).forEach((t) => {
      if (KNOWN.has(t.status)) {
        map.get(t.status)!.push(t);
      } else {
        otherTasks.push(t);
      }
    });

    const result = statuses.map((c) => ({ meta: c, items: map.get(c.key)! }));
    if (otherTasks.length > 0) {
      result.push({ meta: { key: '__OTHER__', label: 'Неизвестный статус', colorClass: 'badge-secondary' }, items: otherTasks });
    }
    return result;
  }, [filteredProjects, statuses]);

  /* --- Handlers --- */
  const handleDrop = (e: React.DragEvent, colKey: string) => {
    if (!allowDnD) return;
    const id = Number(e.dataTransfer.getData('text/plain'));
    const task = projects.find(x => x.id === id);
    if (!task) return;
    const newKey = colKey === '__OTHER__' ? task.status : colKey;
    if (task.status === newKey) return;
    const fkey = `${task.id}:status`;
    if (inFlight.current.has(fkey)) return;
    inFlight.current.add(fkey);
    update.mutate({ id: task.id, patch: { status: newKey }, fieldKey: fkey });
  };

  const handleUpdateProgress = (id: number, val: number) => {
    const fkey = `${id}:progress`;
    if (inFlight.current.has(fkey)) return;
    inFlight.current.add(fkey);
    update.mutate({ id, patch: { progress: val }, fieldKey: fkey });
  };

  const toggleDropdown = (key: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (activeDropdown === key) {
      setActiveDropdown(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 8, left: rect.left });
      setActiveDropdown(key);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      const clickedInsideFilter = dropdownRef.current && dropdownRef.current.contains(target);
      const clickedInsidePortal = target.closest('.dropdown-portal-root');
      if (!clickedInsideFilter && !clickedInsidePortal) setActiveDropdown(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="page-container board-page">
      <div className="header">
        <h2 className="text-xl font-bold m-0">Доска</h2>
        <div className="actions-block">
          {isAdmin && (
            <>
              <button className="btn" onClick={() => setGroupsModalOpen(true)} title="Настройка групп">
                <Layers size={16}/>
                <span className="unset">Группы</span>
              </button>
              <button className="btn" onClick={() => setStatusModalOpen(true)} title="Настройка статусов">
                <Settings size={16}/>
                <span className="unset">Статусы</span>
              </button>
            </>
          )}
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
        <div className="filtr" ref={dropdownRef}>
          <div className="relative">
            <button 
              className={`chip-btn ${selectedGroups.size > 0 ? 'active' : ''}`} 
              onClick={(e) => toggleDropdown('groups', e)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-funnel" aria-hidden="true"><path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"></path></svg>
              <span className="mx-1">{selectedGroups.size > 0 ? `Группы: ${selectedGroups.size}` : 'Все группы'}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-down" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
            </button>

            {activeDropdown === 'groups' && createPortal(
              <div 
                className="dropdown-menu p-2 dropdown-portal-root" 
                style={{
                  position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, width: 280, maxHeight: 400, overflowY: 'auto', marginTop: 0
                }}
              >
                <div className="actions-block">
                    <button className="btn" onClick={() => setSelectedGroupsList(availableGroupsForFilter)}>Все</button>
                    <button className="btn" onClick={() => setSelectedGroupsList([])}>Сброс</button>
                </div>
                {availableGroupsForFilter.length === 0 && <div className="text-sm text-soft p-2">Нет групп</div>}
                {availableGroupsForFilter.map(g => (
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

        {cols.every(c => c.items.length === 0) ? (
          <div className="text-soft text-center w-full mt-10">Нет активных задач</div>
        ) : (
          <div className="board-scroll-container">
            <div className="board-columns">
              {cols.map(col => {
                const colorStyle = getStatusStyle(col.meta.colorClass);
                const badgeClass = col.meta.colorClass && !col.meta.colorClass.startsWith('#') 
                  ? col.meta.colorClass 
                  : 'badge-secondary';

                return (
                  <div 
                    key={col.meta.key} 
                    className="kanban-col" 
                    onDragOver={(e) => { if (allowDnD) e.preventDefault(); }}
                    onDrop={(e) => handleDrop(e, col.meta.key)}
                    style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}
                  >
                    <div className="kanban-header">
                      <span 
                        className={`badge ${badgeClass}`} 
                        style={colorStyle}
                      >
                        {col.meta.label}
                      </span>
                      <span className="text-soft text-xs ml-2">{col.items.length}</span>
                    </div>

                    <div className="kanban-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                      {col.items.map(item => (
                        <BoardTaskCard
                          key={item.id}
                          item={item}
                          user={userById(item.responsible)}
                          allowDnD={allowDnD}
                          allowProgress={allowProgress}
                          onClickEdit={() => setDlg(item)}
                          onUpdateProgress={handleUpdateProgress}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {dlg && (
        <EditDialog 
           mode={isAdmin ? 'all' : 'limited'}
           users={users}
           sectionOptions={Array.from(new Set(projects.map(p => JSON.stringify({ key: `${p.contractor}|${p.project}|${p.section}`, contractor: p.contractor, project: p.project, section: p.section })))).map(s => JSON.parse(s))}
           statuses={statuses}
           groups={allGroups.map(g => g.key)}
           value={dlg}
           onClose={() => setDlg(null)}
           onSave={(v) => {
              const fkey = `${v.id}:dialog`;
              update.mutate({ id: v.id, patch: v, fieldKey: fkey });
              setDlg(null);
           }}
        />
      )}

      {/* Status Modal (With Colors & Editing) */}
      {statusModalOpen && (
        <GenericListManager 
          title="Редактор статусов"
          items={statuses} 
          onChange={setStatuses} 
          onClose={() => setStatusModalOpen(false)}
          withColor={true} 
        />
      )}

      {/* Groups Modal (Editing only) */}
      {groupsModalOpen && (
        <GenericListManager 
          title="Редактор групп"
          items={allGroups.map(g => ({ key: g.key, label: g.label }))} // Преобразуем в StatusDef
          onChange={(newItems) => {
             setSavedGroups(newItems.map(i => i.key)); 
          }} 
          onClose={() => setGroupsModalOpen(false)}
          withColor={false}
        />
      )}
    </div>
  );
};

/* ----------------------- Generic List Manager ----------------------- */
const GenericListManager: React.FC<{
  title: string;
  items: StatusDef[];
  onChange: (s: StatusDef[]) => void;
  onClose: () => void;
  withColor?: boolean;
}> = ({ title, items, onChange, onClose, withColor }) => {
  const [temp, setTemp] = useState(items);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const move = (idx: number, dir: -1 | 1) => {
    if (idx + dir < 0 || idx + dir >= temp.length) return;
    const next = [...temp];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    setTemp(next);
  };

  const updateColor = (idx: number, color: string) => {
    const next = [...temp];
    next[idx] = { ...next[idx], colorClass: color };
    setTemp(next);
  };

  const startEdit = (idx: number) => {
    setEditingIndex(idx);
    setEditingValue(temp[idx].label);
  };

  const saveEdit = (idx: number) => {
    if (!editingValue.trim()) return;
    const next = [...temp];
    next[idx] = { ...next[idx], label: editingValue.trim(), key: editingValue.trim() }; // Update key as well if label changes to keep consistency
    setTemp(next);
    setEditingIndex(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={20}/></button>
        </div>
        <div className="modal-body">
          <div className="modal-body-content">
            {temp.map((s, idx) => (
              <div key={idx} className="modal-body-content-item">
                {editingIndex === idx ? (
                   <div className="flex flex-1 items-center gap-2 mr-2">
                      <input 
                        className="input sm flex-1"
                        autoFocus
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit(idx)}
                      />
                      <button className="icon-btn tiny text-success" onClick={() => saveEdit(idx)}><Check size={14}/></button>
                   </div>
                ) : (
                   <span className="truncate flex-1 mr-2 cursor-pointer" onClick={() => startEdit(idx)} title="Нажмите для редактирования">{s.label}</span>
                )}
                
                <div className="flex gap-1">
                    {withColor && (
                    <div className="flex items-center gap-2 mr-2">
                      <input 
                        type="color" 
                        className="cursor-pointer border-none bg-transparent w-8 h-8 p-0"
                        value={s.colorClass?.startsWith('#') ? s.colorClass : '#868a91'}
                        onChange={(e) => updateColor(idx, e.target.value)}
                        title="Выбрать цвет"
                      />
                    </div>
                  )}
                  <button className="icon-btn tiny" onClick={() => move(idx, -1)} disabled={idx === 0}><ChevronUp size={14}/></button>
                  <button className="icon-btn tiny" onClick={() => move(idx, 1)} disabled={idx === temp.length - 1}><ChevronDown size={14}/></button>
                  {editingIndex !== idx && (
                    <button className="icon-btn tiny" onClick={() => startEdit(idx)}><Edit2 size={14}/></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Отмена</button>
          <button className="btn" onClick={() => { onChange(temp); onClose(); }}>Сохранить</button>
        </div>
      </div>
    </div>
  );
};

/* --------------------------- Edit Dialog --------------------------- */
const EditDialog: React.FC<{
  mode: 'all' | 'limited';
  users: ResponsibleUser[];
  sectionOptions: SectionOption[];
  statuses: StatusDef[];
  groups?: string[];
  value: ProjectDto;
  onClose: () => void;
  onSave: (v: ProjectDto) => void;
}> = ({ mode, users, sectionOptions, statuses, groups, value, onClose, onSave }) => {
  const [form, setForm] = useState(value);
  const isAll = mode === 'all';

  const groupedOpts = useMemo(() => {
    const grp: Record<string, SectionOption[]> = {};
    sectionOptions.forEach(o => {
      const k = `${o.contractor} / ${o.project}`;
      if (!grp[k]) grp[k] = [];
      grp[k].push(o);
    });
    return grp;
  }, [sectionOptions]);
  
  const currentKey = `${form.contractor}|${form.project}|${form.section}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
           <h3>Редактирование задачи</h3>
           <button className="icon-btn" onClick={onClose}><X size={20}/></button>
        </div>
        
        <div className="modal-body modal-body-content">
           <div className="input-group">
             <label className="input-label">Задача (раздел)</label>
             <select 
               className="input" 
               disabled={!isAll}
               value={currentKey}
               onChange={(e) => {
                 const opt = sectionOptions.find(o => o.key === e.target.value);
                 if (opt) setForm({...form, contractor: opt.contractor, project: opt.project, section: opt.section});
               }}
             >
               <option value="">-- Выберите --</option>
               {Object.entries(groupedOpts).map(([lbl, opts]) => (
                 <optgroup key={lbl} label={lbl}>
                   {opts.map(o => <option key={o.key} value={o.key}>{o.section}</option>)}
                 </optgroup>
               ))}
             </select>
           </div>

           <div className="input-group">
              <label className="input-label">Группировка</label>
              <input 
                className="input" 
                disabled={!isAll}
                list="board-group-opts"
                value={form.grouping || ''} 
                onChange={e => setForm({...form, grouping: e.target.value})}
              />
              <datalist id="board-group-opts">
                {groups?.map(g => <option key={g} value={g}/>)}
              </datalist>
           </div>

           <div className="input-group">
              <label className="input-label">Статус</label>
              <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                {statuses.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
           </div>

           <div className="flex gap-4">
              <div className="input-group flex-1">
                <label className="input-label">Начало</label>
                <input 
                  type="date" 
                  className="input" 
                  value={toISO(form.start)} 
                  onChange={e => setForm({...form, start: e.target.value || null})}
                />
              </div>
              <div className="input-group flex-1">
                <label className="input-label">Срок</label>
                <input 
                  type="date" 
                  className="input" 
                  value={toISO(form.end)} 
                  onChange={e => setForm({...form, end: e.target.value || null})}
                />
              </div>
           </div>

           <div className="input-group">
              <label className="input-label">Ответственный</label>
              <select 
                className="input" 
                disabled={!isAll} 
                value={form.responsible ?? ''} 
                onChange={e => setForm({...form, responsible: e.target.value ? Number(e.target.value) : null})}
              >
                 <option value="">(Нет)</option>
                 {users.map(u => <option key={u.id} value={u.id}>{u.nickname || u.login}</option>)}
              </select>
           </div>

           <div className="input-group">
              <label className="input-label">Сумма</label>
              <input 
                type="number" 
                className="input" 
                disabled={!isAll}
                value={form.amount} 
                onChange={e => setForm({...form, amount: +e.target.value})}
              />
           </div>

           <div className="input-group">
              <label className="input-label">Примечание</label>
              <textarea 
                className="input" 
                rows={2} 
                disabled={!isAll}
                value={form.note ?? ''} 
                onChange={e => setForm({...form, note: e.target.value})}
              />
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

export default BoardPage;