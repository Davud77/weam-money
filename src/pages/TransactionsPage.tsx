import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Minus,
  Download, 
  Filter, 
  Edit, 
  Trash2, 
  Calendar as CalendarIcon, 
  ChevronDown, 
  X,
  Users,
  LayoutGrid,
  ArrowRightLeft
} from 'lucide-react';
import dayjs, { Dayjs } from 'dayjs';
import 'dayjs/locale/ru';

import { api, me } from '../lib/api';
import { fmtMoney } from '../lib/format';

/* ------------------------------- Types ----------------------------------- */
type OperationType = 'Расход' | 'Доход';
type PresetKey = 'currentMonth' | 'currentQuarter' | 'currentYear' | 'prevMonth' | 'prevQuarter' | 'prevYear' | 'allTime' | 'custom';

export interface Transaction {
  id: number;
  contractor: string;
  project: string;
  section: string;
  responsible: string;
  date: string | ''; 
  total: number;
  remainder: number;
  operationType: OperationType;
  note?: string;
  project_id?: number | null;
}

interface ResponsibleUser {
  id: number; login: string; nickname: string;
}

interface ProjectRow {
  id: number; contractor: string; project: string; section?: string; sections?: string;
}

type SectionOption = {
  key: string; projectId: number; contractor: string; project: string; section: string;
};

type QueryResponse = { rows: Transaction[] };

/* ------------------------------ Constants -------------------------------- */
const API = '/api';
const STALE_15M = 15 * 60 * 1000;

const empty: Omit<Transaction, 'id' | 'remainder' | 'contractor' | 'project' | 'section'> = {
  responsible: '', date: '', total: 0, operationType: 'Расход', note: '', project_id: null,
};

/* ---------- Ключи LocalStorage (Одинаковые с Dashboard) ---------- */
const STORAGE_KEYS = {
  PRESET: 'dash_preset',
  DATE_START: 'dash_date_start',
  DATE_END: 'dash_date_end',
  USERS: 'dash_selected_users',
  PROJECTS: 'dash_selected_projects',
};

const presetLabel: Record<PresetKey, string> = {
  currentMonth: 'Текущий месяц', currentQuarter: 'Текущий квартал', currentYear: 'Текущий год',
  prevMonth: 'Прошлый месяц', prevQuarter: 'Прошлый квартал', prevYear: 'Прошлый год',
  allTime: 'Все время', custom: 'Период',
};

/* Хелперы дат */
const quarterBounds = (d: Dayjs) => {
  const qStartMonth = d.month() - (d.month() % 3);
  const start = dayjs(d).month(qStartMonth).startOf('month');
  const end = start.add(2, 'month').endOf('month');
  return { start, end };
};

const getPresetRange = (k: PresetKey): { start: Dayjs | null; end: Dayjs | null } => {
  const today = dayjs();
  switch (k) {
    case 'currentMonth':   return { start: today.startOf('month'), end: today.endOf('month') };
    case 'currentQuarter': return quarterBounds(today);
    case 'currentYear':    return { start: today.startOf('year'), end: today.endOf('year') };
    case 'prevMonth': {
      const prev = today.subtract(1, 'month');
      return { start: prev.startOf('month'), end: prev.endOf('month') };
    }
    case 'prevQuarter':    return quarterBounds(today.subtract(3, 'month'));
    case 'prevYear':       return { start: today.subtract(1, 'year').startOf('year'), end: today.subtract(1, 'year').endOf('year') };
    case 'allTime':        return { start: null, end: null };
    default:               return { start: null, end: null };
  }
};

function getProjectSection(projects: ProjectRow[], pid?: number | null): string {
  if (!Number.isFinite(Number(pid))) return '—';
  const pr = projects.find(p => Number(p.id) === Number(pid));
  if (!pr) return '—';
  const raw = (pr.section ?? pr.sections ?? '').toString().trim();
  const parts = raw.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  return (parts[0] || raw) || '—';
}

/* ------------------------------ Form Component --------------------------- */
type FormProps = {
  value: Partial<Transaction>;
  users: ResponsibleUser[];
  onChange: (v: Partial<Transaction>) => void;
  sectionOptions: SectionOption[];
};

const TransactionForm: React.FC<FormProps> = ({ value, onChange, users, sectionOptions }) => {
  const groupedOptions = useMemo(() => {
    const groups: Record<string, SectionOption[]> = {};
    sectionOptions.forEach(opt => {
      const label = `${opt.contractor || 'Без контрагента'} • ${opt.project || 'Без проекта'}`;
      if (!groups[label]) groups[label] = [];
      groups[label].push(opt);
    });
    return groups;
  }, [sectionOptions]);

  const currentKey = value.project_id && value.section 
    ? `${value.project_id}|${value.section}` 
    : '';

  return (
    <div className="modal-body-content">
      <div className="input-group">
        <label className="input-label">Проект / Раздел</label>
        <select 
          className="input"
          value={currentKey}
          onChange={(e) => {
             const key = e.target.value;
             const opt = sectionOptions.find(o => o.key === key);
             if (opt) onChange({ ...value, project_id: opt.projectId, section: opt.section });
             else onChange({ ...value, project_id: null, section: '' });
          }}
        >
          <option value="">-- Не выбрано --</option>
          {Object.entries(groupedOptions).map(([groupLabel, opts]) => (
            <optgroup key={groupLabel} label={groupLabel}>
              {opts.map(opt => (
                <option key={opt.key} value={opt.key}>{opt.section || 'Основной'}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="input-group">
        <label className="input-label">Тип операции</label>
        <select 
          className="input"
          value={value.operationType ?? 'Расход'}
          onChange={(e) => onChange({ ...value, operationType: e.target.value as OperationType })}
        >
          <option value="Расход">Расход</option>
          <option value="Доход">Доход</option>
        </select>
      </div>

      <div className="flex gap-4">
        <div className="input-group flex-1">
          <label className="input-label">Дата</label>
          <input 
            type="date" 
            className="input"
            value={value.date ?? ''} 
            onChange={(e) => onChange({ ...value, date: e.target.value })}
          />
        </div>
        <div className="input-group flex-1">
          <label className="input-label">Сумма</label>
          <input 
            type="number" 
            className="input"
            value={value.total ?? ''} 
            onChange={(e) => onChange({ ...value, total: +e.target.value })}
          />
        </div>
      </div>

      <div className="input-group">
        <label className="input-label">Счёт / Ответственный</label>
        <select 
          className="input"
          value={value.responsible ?? ''}
          onChange={(e) => onChange({ ...value, responsible: e.target.value })}
        >
          <option value="">-- Выберите --</option>
          {users.map((u) => (
            <option key={u.id} value={u.login}>
              {u.nickname ? `${u.nickname} (${u.login})` : u.login}
            </option>
          ))}
        </select>
      </div>

      <div className="input-group">
        <label className="input-label">Примечание</label>
        <textarea 
          className="input" 
          rows={2}
          value={value.note ?? ''}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      </div>
    </div>
  );
};

/* ------------------------------ Page ------------------------------------- */
const TransactionsPage: React.FC<{ showError: (msg: string) => void }> = ({ showError }) => {
  const qc = useQueryClient();
  
  // Auth
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => me(), staleTime: 300000 });
  const isAdmin = meData?.user?.role === 'admin';

  // Data
  const { data: users = [] } = useQuery<ResponsibleUser[]>({
    queryKey: ['users', 'responsible'], queryFn: () => api<ResponsibleUser[]>(`${API}/responsible`), staleTime: STALE_15M
  });
  const { data: projects = [] } = useQuery<ProjectRow[]>({
    queryKey: ['projects'], queryFn: () => api<ProjectRow[]>(`${API}/projects`), staleTime: STALE_15M
  });

  // --- Основные фильтры (как на Dashboard) ---
  const [activeDropdown, setActiveDropdown] = useState<'date' | 'users' | 'projects' | 'op' | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 1. Дата (Инициализация из памяти)
  const [preset, setPreset] = useState<PresetKey>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PRESET);
    return (saved as PresetKey) || 'currentYear';
  });

  const [dateRange, setDateRange] = useState<{ start: Dayjs | null; end: Dayjs | null }>(() => {
    const savedStart = localStorage.getItem(STORAGE_KEYS.DATE_START);
    const savedEnd = localStorage.getItem(STORAGE_KEYS.DATE_END);
    const savedPreset = localStorage.getItem(STORAGE_KEYS.PRESET);

    if (savedPreset === 'custom' && savedStart) {
      return { 
        start: dayjs(savedStart), 
        end: savedEnd ? dayjs(savedEnd) : null 
      };
    }
    return getPresetRange((savedPreset as PresetKey) || 'currentYear');
  });

  // 2. Пользователи (Инициализация из памяти)
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.USERS);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  
  // 3. Проекты (Инициализация из памяти - храним ИМЕНА проектов)
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PROJECTS);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Флаги инициализации "Выбрать всё"
  const [shouldInitUsers, setShouldInitUsers] = useState(() => !localStorage.getItem(STORAGE_KEYS.USERS));
  const [shouldInitProjects, setShouldInitProjects] = useState(() => !localStorage.getItem(STORAGE_KEYS.PROJECTS));

  // 4. Дополнительные фильтры
  const [operationFilter, setOperationFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [amountRange, setAmountRange] = useState<{ min?: number; max?: number }>({});
  
  // -- Эффекты сохранения в LocalStorage --
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PRESET, preset);
  }, [preset]);

  useEffect(() => {
    if (dateRange.start) localStorage.setItem(STORAGE_KEYS.DATE_START, dateRange.start.format('YYYY-MM-DD'));
    else localStorage.removeItem(STORAGE_KEYS.DATE_START);
    
    if (dateRange.end) localStorage.setItem(STORAGE_KEYS.DATE_END, dateRange.end.format('YYYY-MM-DD'));
    else localStorage.removeItem(STORAGE_KEYS.DATE_END);
  }, [dateRange]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(Array.from(selectedUsers)));
  }, [selectedUsers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(Array.from(selectedProjects)));
  }, [selectedProjects]);

  // -- Инициализация "Выбрать всё" --
  useEffect(() => {
    if (users.length > 0 && shouldInitUsers) {
      setSelectedUsers(new Set(users.map(u => u.id)));
      setShouldInitUsers(false);
    }
    if (projects.length > 0 && shouldInitProjects) {
      // Собираем все уникальные имена проектов
      const names = new Set<string>();
      projects.forEach(p => { if (p.project) names.add(p.project); });
      setSelectedProjects(names);
      setShouldInitProjects(false);
    }
  }, [users, projects, shouldInitUsers, shouldInitProjects]);


  // Подготовка списка пользователей
  const userOptions = useMemo(() => {
    return users.map(u => ({ id: u.id, label: u.nickname || u.login }));
  }, [users]);

  // Группировка проектов (Как на Dashboard: Контрагент -> [Имена проектов])
  const projectGroups = useMemo(() => {
    const groups: Record<string, Set<string>> = {};
    projects.forEach(p => {
      const contr = p.contractor || 'Без контрагента';
      const name = p.project;
      if (!name) return;
      
      if (!groups[contr]) groups[contr] = new Set();
      groups[contr].add(name);
    });

    // Преобразуем Set в Array и сортируем
    const result: Record<string, string[]> = {};
    Object.keys(groups).sort().forEach(key => {
      result[key] = Array.from(groups[key]).sort();
    });
    return result;
  }, [projects]);

  // Плоский список всех имен проектов для проверки "Выбрано всё"
  const allProjectNames = useMemo(() => {
    return Object.values(projectGroups).flat();
  }, [projectGroups]);


  // Modals State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formState, setFormState] = useState<Partial<Transaction>>(empty);
  const [amountDialogOpen, setAmountDialogOpen] = useState(false);
  const [amountTemp, setAmountTemp] = useState<{ min?: number; max?: number }>({});

  const isEdit = 'id' in formState;

  // Логика открытия портала фильтров
  const toggleDropdown = (key: 'date' | 'users' | 'projects' | 'op', e: React.MouseEvent<HTMLButtonElement>) => {
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

  // Section Options for Form
  const sectionOptions = useMemo<SectionOption[]>(() => {
    const opts: SectionOption[] = [];
    projects.forEach((p) => {
      const pid = Number(p.id);
      const raw = (p.sections ?? p.section ?? '').toString();
      const parts = raw ? raw.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean) : [];
      parts.forEach((sec) => opts.push({ key: `${pid}|${sec}`, projectId: pid, contractor: p.contractor || '—', project: p.project || '—', section: sec }));
    });
    return opts.sort((a, b) => a.contractor.localeCompare(b.contractor));
  }, [projects]);


  // Query Params
  const params = useMemo(() => {
    const usp = new URLSearchParams();
    if (dateRange.start) usp.set('start', dateRange.start.format('YYYY-MM-DD'));
    if (dateRange.end)   usp.set('end',   dateRange.end.format('YYYY-MM-DD'));
    if (operationFilter !== 'all') usp.set('op', operationFilter);
    if (amountRange.min != null)   usp.set('min', String(amountRange.min));
    if (amountRange.max != null)   usp.set('max', String(amountRange.max));
    return usp.toString();
  }, [dateRange, operationFilter, amountRange]);

  const { data: queryData, isLoading: rowsLoading, isError, error } = useQuery<QueryResponse>({
    queryKey: ['transactions-query', params],
    queryFn: () => api(`${API}/transactions/query?${params}`),
    refetchOnWindowFocus: false,
    retry: 1
  });

  if (isError && error instanceof Error && error.message !== 'UNAUTHORIZED') showError(error.message);

  const rows = queryData?.rows ?? [];
  
  // Client-side Filtering
  const viewRows = useMemo(() => {
    return rows.filter(r => {
      // 1. Filter Users
      const user = users.find(u => u.login === r.responsible);
      if (user && !selectedUsers.has(user.id)) return false;

      // 2. Filter Projects (By Name)
      if (r.project_id) {
        const proj = projects.find(p => p.id === r.project_id);
        if (proj && proj.project && !selectedProjects.has(proj.project)) return false;
      }

      return true;
    });
  }, [rows, selectedUsers, selectedProjects, users, projects]);

  // Mutations
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['transactions-query'] }); };
  
  const mutationConfig = {
    onSuccess: () => { invalidate(); setDialogOpen(false); setFormState(empty); },
    onError: (e: any) => showError(e.message || 'Ошибка')
  };

  const create = useMutation({ ...mutationConfig, mutationFn: (d: any) => api(`${API}/transactions`, { method: 'POST', body: JSON.stringify(d) }) });
  const update = useMutation({ ...mutationConfig, mutationFn: (d: any) => api(`${API}/transactions/${d.id}`, { method: 'PUT', body: JSON.stringify(d) }) });
  const remove = useMutation({ ...mutationConfig, mutationFn: (id: number) => api(`${API}/transactions/${id}`, { method: 'DELETE' }) });

  // Export
  const handleExport = () => {
    const header = ['ID','Дата','Тип','Проект','Раздел','Счёт','Сумма','Остаток','Примечание'].join(',');
    const body = viewRows.map((r) => {
      const pr = projects.find((pp) => Number(pp.id) === Number(r.project_id));
      const project_key = pr ? `${pr.contractor || ''} ${pr.project || ''}`.trim() : '';
      const section = getProjectSection(projects, r.project_id);
      return [
        r.id, r.date, r.operationType, `"${project_key}"`, `"${section}"`, 
        r.responsible, r.total, r.remainder, `"${(r.note || '').replace(/"/g, '""')}"`
      ].join(',');
    }).join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'transactions.csv';
    link.click();
  };

  return (
    <div className="page-container transactions-page">
      {/* Header */}
      <div className="header">
        <h2 className="text-xl font-bold m-0">Транзакции</h2>
        
        {isAdmin && (
          <div className="actions-block">
            <button className="btn" onClick={() => { setFormState({...empty, operationType: 'Доход'}); setDialogOpen(true); }}>
              <Plus size={16}/>
              <div className="unset"> Приход</div> 
            </button>
            <button className="btn" onClick={() => { setFormState({...empty, operationType: 'Расход'}); setDialogOpen(true); }}>
              <Minus size={16}/> 
              <div className="unset"> Расход</div>
            </button>
            <button className="btn secondary" onClick={handleExport} title="Экспорт в CSV">
              <Download size={16}/>
            </button>
          </div>
        )}
      </div>

      <div className="content">

      {/* Filters Bar */}
        <div className="filtr" ref={dropdownRef}>
          
          {/* 1. DATE Filter */}
          <div className="relative">
            <button 
              className={`chip-btn ${activeDropdown === 'date' ? 'active' : ''}`}
              onClick={(e) => toggleDropdown('date', e)}
            >
              <CalendarIcon size={16} />
              {preset === 'custom' 
                ? `${dateRange.start?.format('DD.MM.YY') ?? '...'} — ${dateRange.end?.format('DD.MM.YY') ?? '...'}`
                : presetLabel[preset]
              }
              <ChevronDown size={14} />
            </button>
            
            {activeDropdown === 'date' && createPortal(
              <div 
                className="dropdown-menu p-3 dropdown-portal-root" 
                style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, marginTop: 0 }}
              >
                <div className="flex gap-2 mb-3">
                  <div className="input-group flex-1 mb-0">
                    <label className="input-label">От</label>
                    <input 
                      type="date" className="input sm" 
                      value={dateRange.start ? dateRange.start.format('YYYY-MM-DD') : ''}
                      onChange={(e) => {
                        const d = e.target.value ? dayjs(e.target.value) : null;
                        setDateRange(prev => ({ ...prev, start: d }));
                        setPreset('custom');
                      }}
                    />
                  </div>
                  <div className="input-group flex-1 mb-0">
                    <label className="input-label">До</label>
                    <input 
                      type="date" className="input sm"
                      value={dateRange.end ? dateRange.end.format('YYYY-MM-DD') : ''}
                      onChange={(e) => {
                        const d = e.target.value ? dayjs(e.target.value) : null;
                        setDateRange(prev => ({ ...prev, end: d }));
                        setPreset('custom');
                      }}
                    />
                  </div>
                </div>
                <div className="actions-block actions-block-wrap">
                  {(['currentMonth','currentQuarter','currentYear','prevMonth','prevQuarter','prevYear','allTime'] as PresetKey[]).map(k => (
                    <button 
                      key={k} className={`btn ${preset === k ? 'active' : ''}`}
                      onClick={() => { setPreset(k); setDateRange(getPresetRange(k)); setActiveDropdown(null); }}
                    >
                      {presetLabel[k]}
                    </button>
                  ))}
                </div>
              </div>,
              document.body
            )}
          </div>

          {/* 2. USERS Filter */}
          <div className="relative">
            <button 
              className={`chip-btn ${activeDropdown === 'users' ? 'active' : ''}`}
              onClick={(e) => toggleDropdown('users', e)}
            >
              <Users size={16} />
              {selectedUsers.size === users.length ? 'Все пользователи' : `Выбрано: ${selectedUsers.size}`}
              <ChevronDown size={14} />
            </button>

            {activeDropdown === 'users' && createPortal(
              <div 
                className="dropdown-menu p-2 dropdown-portal-root" 
                style={{ 
                  position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, 
                  width: 250, maxHeight: 400, overflowY: 'auto', marginTop: 0
                }}
              >
                <div className="actions-block">
                    <button className="btn" onClick={() => setSelectedUsers(new Set(users.map(u => u.id)))}>Все</button>
                    <button className="btn" onClick={() => setSelectedUsers(new Set())}>Очистить</button>
                </div>
                {userOptions.length === 0 && <div className="text-sm text-soft p-2">Нет данных</div>}
                {userOptions.map(u => (
                  <label key={u.id} className="dropdown-item checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={selectedUsers.has(u.id)}
                      onChange={(e) => {
                        const next = new Set(selectedUsers);
                        e.target.checked ? next.add(u.id) : next.delete(u.id);
                        setSelectedUsers(next);
                      }}
                    />
                    <span>{u.label}</span>
                  </label>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* 3. PROJECTS Filter */}
          <div className="relative">
            <button 
              className={`chip-btn ${activeDropdown === 'projects' ? 'active' : ''}`}
              onClick={(e) => toggleDropdown('projects', e)}
            >
              <LayoutGrid size={16} />
              {selectedProjects.size === allProjectNames.length ? 'Все проекты' : `Выбрано: ${selectedProjects.size}`}
              <ChevronDown size={14} />
            </button>

            {activeDropdown === 'projects' && createPortal(
              <div 
                className="dropdown-menu p-2 dropdown-portal-root" 
                style={{ 
                  position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, 
                  width: 300, maxHeight: 400, overflowY: 'auto', marginTop: 0
                }}
              >
                <div className="actions-block">
                    <button className="btn" onClick={() => setSelectedProjects(new Set(allProjectNames))}>Все</button>
                    <button className="btn" onClick={() => setSelectedProjects(new Set())}>Очистить</button>
                </div>
                {Object.entries(projectGroups).map(([contr, projs]) => (
                  <div key={contr} className="mb-3">
                    <div className="text-xs font-bold text-soft mb-1 uppercase tracking-wider">{contr}</div>
                    {projs.map(pName => (
                        <label key={pName} className="dropdown-item checkbox-label">
                          <input 
                            type="checkbox" 
                            checked={selectedProjects.has(pName)}
                            onChange={(e) => {
                              const next = new Set(selectedProjects);
                              e.target.checked ? next.add(pName) : next.delete(pName);
                              setSelectedProjects(next);
                            }}
                          />
                          <span className="truncate">{pName}</span>
                        </label>
                    ))}
                  </div>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* 4. OPERATION Filter */}
          <div className="relative">
            <button className={`chip-btn ${operationFilter !== 'all' ? 'active' : ''}`} onClick={(e) => toggleDropdown('op', e)}>
              <ArrowRightLeft size={16} /> {operationFilter === 'all' ? 'Все операции' : operationFilter === 'income' ? 'Доход' : 'Расход'} <ChevronDown size={14}/>
            </button>
            {activeDropdown === 'op' && createPortal(
              <div 
                className="dropdown-menu p-1 dropdown-portal-root" 
                style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, marginTop: 0 }}
              >
                {[{v:'all',l:'Все'},{v:'income',l:'Доход'},{v:'expense',l:'Расход'}].map(o => (
                  <div key={o.v} className="dropdown-item" onClick={() => { setOperationFilter(o.v as any); setActiveDropdown(null); }}>{o.l}</div>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* 5. AMOUNT Filter */}
          <button className={`chip-btn ${amountRange.min||amountRange.max ? 'active' : ''}`} onClick={() => { setAmountTemp(amountRange); setAmountDialogOpen(true); }}>
            <Filter size={16} /> Сумма {amountRange.min||amountRange.max ? '...' : ''}
          </button>

        </div>

        {/* DATA TABLE */}
        <div className="card block" style={{ padding: 0, overflow: 'hidden', height: 'calc(100vh - 160px)' }}>
          <div style={{ overflow: 'auto', height: '100%' }}>
            <table className="table w-full sticky-header">
              <thead>
                <tr>
                  <th style={{width: 100, textAlign: 'center'}}>Дата</th>
                  <th style={{width: 140, textAlign: 'right'}}>Сумма</th>
                  <th>Описание</th>
                  <th style={{width: 200}}>Проект</th>
                  <th style={{width: 120}}>Счёт</th>
                  {isAdmin && <th style={{width: 60, textAlign: 'center'}}></th>}
                </tr>
              </thead>
              <tbody>
                {rowsLoading ? (
                  <tr><td colSpan={6} className="p-4 text-center text-soft">Загрузка...</td></tr>
                ) : viewRows.length === 0 ? (
                  <tr><td colSpan={6} className="p-4 text-center text-soft">Нет данных</td></tr>
                ) : (
                  viewRows.map(row => {
                    const isExpense = row.operationType === 'Расход';
                    const pr = projects.find(p => Number(p.id) === Number(row.project_id));
                    const section = getProjectSection(projects, row.project_id);
                    
                    return (
                      <tr key={row.id} className="hover:bg-sidebar">
                        <td style={{textAlign: 'center'}} className="text-sm">
                          {row.date ? dayjs(row.date).format('DD.MM.YYYY') : <span className="badge badge-primary">План</span>}
                        </td>
                        <td style={{textAlign: 'right'}}>
                          <div className={`font-mono font-bold ${isExpense ? 'text-danger' : 'text-success'}`}>
                            {isExpense ? '-' : '+'}{fmtMoney(Math.abs(row.total))}
                          </div>
                          <div className="text-xs text-soft truncate max-w-[120px] ml-auto" title={section}>{section}</div>
                        </td>
                        <td className="text-sm text-soft wrap-text">{row.note || '—'}</td>
                        <td>
                          {pr ? (
                            <div className="project-col">
                              <span className="font-medium text-sm truncate" title={pr.contractor}>{pr.contractor}</span>
                              <span className="text-xs text-soft truncate" title={pr.project}>{pr.project}</span>
                            </div>
                          ) : '—'}
                        </td>
                        <td className="text-sm">{users.find(u => u.login === row.responsible)?.nickname || row.responsible}</td>
                        {isAdmin && (
                          <td style={{textAlign: 'center'}}>
                            <button className="icon-btn" onClick={() => { setFormState(row); setDialogOpen(true); }}>
                              <Edit size={16}/>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* EDIT/CREATE MODAL */}
        {dialogOpen && (
          <div className="modal-overlay" onClick={() => setDialogOpen(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{isEdit ? 'Редактировать' : 'Новая транзакция'}</h3>
                <button className="icon-btn" onClick={() => setDialogOpen(false)}><X size={20}/></button>
              </div>
              <div className="modal-body">
                <TransactionForm 
                  value={formState} 
                  onChange={v => setFormState(prev => ({ ...prev, ...v }))}
                  users={users}
                  sectionOptions={sectionOptions}
                />
              </div>
              <div className="modal-footer justify-between">
                {isEdit ? (
                  <button className="btn danger" onClick={() => { if(window.confirm('Удалить?')) remove.mutate(formState.id!); }}>
                    <Trash2 size={16} className="mr-1"/> Удалить
                  </button>
                ) : <div/>}
                <div className="flex gap-2">
                  <button className="btn secondary" onClick={() => setDialogOpen(false)}>Отмена</button>
                  <button className="btn" onClick={() => {
                    const dto = { ...formState, remainder: formState.total || 0 };
                    isEdit ? update.mutate(dto) : create.mutate(dto);
                  }}>Сохранить</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AMOUNT FILTER MODAL */}
        {amountDialogOpen && (
          <div className="modal-overlay" onClick={() => setAmountDialogOpen(false)}>
            <div className="modal-content" style={{maxWidth: 300}} onClick={e => e.stopPropagation()}>
              <div className="modal-header"><h3>Фильтр суммы</h3></div>
              <div className="modal-body flex flex-col gap-3">
                <div className="input-group">
                  <label className="input-label">Минимум</label>
                  <input type="number" className="input" value={amountTemp.min ?? ''} onChange={e => setAmountTemp({...amountTemp, min: e.target.value ? +e.target.value : undefined})}/>
                </div>
                <div className="input-group">
                  <label className="input-label">Максимум</label>
                  <input type="number" className="input" value={amountTemp.max ?? ''} onChange={e => setAmountTemp({...amountTemp, max: e.target.value ? +e.target.value : undefined})}/>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn secondary" onClick={() => { setAmountRange({}); setAmountDialogOpen(false); }}>Сброс</button>
                <button className="btn" onClick={() => { setAmountRange(amountTemp); setAmountDialogOpen(false); }}>Применить</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionsPage;