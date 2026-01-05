import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom'; // <--- Добавлен импорт
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Download, 
  Filter, 
  Edit, 
  Trash2, 
  Calendar as CalendarIcon, 
  ChevronDown, 
  Search, 
  X,
  CreditCard,
  Briefcase,
  ArrowRightLeft,
  Minus
} from 'lucide-react';

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

/* Хелперы дат */
const formatISO = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const presets = [
  { label: 'Текущий месяц',   from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0) },
  { label: 'Прошлый месяц',   from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 0) },
  { label: 'Текущий год',     from: new Date(today.getFullYear(), 0, 1),    to: new Date(today.getFullYear(), 11, 31) },
  { label: 'Все время',       from: null, to: null },
];

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

  // Filters State
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 }); // <--- Состояние позиции портала
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const [operationFilter, setOperationFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [planFilter, setPlanFilter] = useState<'all' | 'planned' | 'actual'>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [projectKeyFilter, setProjectKeyFilter] = useState<number | 'all'>('all');
  const [amountRange, setAmountRange] = useState<{ min?: number; max?: number }>({});
  
  // Modals State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formState, setFormState] = useState<Partial<Transaction>>(empty);
  const [amountDialogOpen, setAmountDialogOpen] = useState(false);
  const [amountTemp, setAmountTemp] = useState<{ min?: number; max?: number }>({});

  const isEdit = 'id' in formState;

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

  // Click outside listener for dropdowns
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

  // Filter Options Preparation
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

  const projectKeyOptions = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const p of projects) {
      const label = `${p.contractor || '—'} • ${p.project || '—'}`.trim();
      const pid = Number(p.id);
      const arr = groups.get(label) || [];
      arr.push(pid);
      groups.set(label, arr);
    }
    return Array.from(groups.entries()).map(([label, ids]) => ({
      id: ids[0], ids: Array.from(new Set(ids)), label 
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  const selectedProjectGroup = useMemo(() => {
    if (projectKeyFilter === 'all') return null;
    return projectKeyOptions.find(o => o.id === projectKeyFilter) || null;
  }, [projectKeyFilter, projectKeyOptions]);

  // Query Params
  const params = useMemo(() => {
    const usp = new URLSearchParams();
    if (dateRange.from) usp.set('start', dateRange.from);
    if (dateRange.to)   usp.set('end',   dateRange.to);
    if (operationFilter !== 'all') usp.set('op', operationFilter);
    if (planFilter !== 'all')      usp.set('plan', planFilter);
    if (accountFilter !== 'all')   usp.set('account', accountFilter);
    if (selectedProjectGroup && selectedProjectGroup.ids.length === 1) {
      usp.set('project_id', String(selectedProjectGroup.ids[0]));
    }
    if (amountRange.min != null)   usp.set('min', String(amountRange.min));
    if (amountRange.max != null)   usp.set('max', String(amountRange.max));
    return usp.toString();
  }, [dateRange, operationFilter, planFilter, accountFilter, selectedProjectGroup, amountRange]);

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
    const group = selectedProjectGroup;
    if (!group || group.ids.length <= 1) return rows;
    const set = new Set(group.ids.map(Number));
    return rows.filter(r => set.has(Number(r.project_id)));
  }, [rows, selectedProjectGroup]);

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
          
          {/* DATE Filter */}
          <div className="relative">
            <button className={`chip-btn ${dateRange.from ? 'active' : ''}`} onClick={(e) => toggleDropdown('date', e)}>
              <CalendarIcon size={16} /> {dateRange.from ? `${dateRange.from}..` : 'Дата'} <ChevronDown size={14}/>
            </button>
            {activeDropdown === 'date' && createPortal(
              <div 
                className="dropdown-menu p-3 dropdown-portal-root" 
                style={{
                  position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, marginTop: 0
                }}
              >
                <div className="flex gap-2 mb-2">
                  <input type="date" className="input sm" value={dateRange.from||''} onChange={e=>setDateRange({...dateRange, from: e.target.value})}/>
                  <input type="date" className="input sm" value={dateRange.to||''} onChange={e=>setDateRange({...dateRange, to: e.target.value})}/>
                </div>
                <div className="actions-block actions-block-wrap">
                  {presets.map(p => (
                    <button key={p.label} className="btn" onClick={() => {
                      setDateRange({ from: p.from ? formatISO(p.from) : undefined, to: p.to ? formatISO(p.to) : undefined });
                      setActiveDropdown(null);
                    }}>{p.label}</button>
                  ))}
                </div>
              </div>,
              document.body
            )}
          </div>

          {/* OPERATION Filter */}
          <div className="relative">
            <button className={`chip-btn ${operationFilter !== 'all' ? 'active' : ''}`} onClick={(e) => toggleDropdown('op', e)}>
              <ArrowRightLeft size={16} /> {operationFilter === 'all' ? 'Все операции' : operationFilter === 'income' ? 'Доход' : 'Расход'} <ChevronDown size={14}/>
            </button>
            {activeDropdown === 'op' && createPortal(
              <div 
                className="dropdown-menu p-1 dropdown-portal-root" 
                style={{
                  position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, marginTop: 0
                }}
              >
                {[{v:'all',l:'Все'},{v:'income',l:'Доход'},{v:'expense',l:'Расход'}].map(o => (
                  <div key={o.v} className="dropdown-item" onClick={() => { setOperationFilter(o.v as any); setActiveDropdown(null); }}>{o.l}</div>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* ACCOUNT Filter */}
          <div className="relative">
            <button className={`chip-btn ${accountFilter !== 'all' ? 'active' : ''}`} onClick={(e) => toggleDropdown('acc', e)}>
              <CreditCard size={16} /> {accountFilter === 'all' ? 'Все счета' : users.find(u=>u.login===accountFilter)?.nickname} <ChevronDown size={14}/>
            </button>
            {activeDropdown === 'acc' && createPortal(
              <div 
                className="dropdown-menu p-1 dropdown-portal-root" 
                style={{
                  position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, maxHeight: 300, overflowY: 'auto', marginTop: 0
                }}
              >
                <div className="dropdown-item" onClick={() => { setAccountFilter('all'); setActiveDropdown(null); }}>Все счета</div>
                {users.map(u => (
                  <div key={u.id} className="dropdown-item" onClick={() => { setAccountFilter(u.login); setActiveDropdown(null); }}>
                    {u.nickname || u.login}
                  </div>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* PROJECT Filter */}
          <div className="relative">
            <button className={`chip-btn ${projectKeyFilter !== 'all' ? 'active' : ''}`} onClick={(e) => toggleDropdown('proj', e)}>
              <Briefcase size={16} /> {projectKeyFilter === 'all' ? 'Все проекты' : 'Выбран проект'} <ChevronDown size={14}/>
            </button>
            {activeDropdown === 'proj' && createPortal(
              <div 
                className="dropdown-menu p-1 dropdown-portal-root" 
                style={{
                  position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, maxHeight: 400, overflowY: 'auto', marginTop: 0
                }}
              >
                <div className="dropdown-item" onClick={() => { setProjectKeyFilter('all'); setActiveDropdown(null); }}>Все проекты</div>
                {projectKeyOptions.map(p => (
                  <div key={p.id} className="dropdown-item" onClick={() => { setProjectKeyFilter(p.id); setActiveDropdown(null); }}>
                    <div className="truncate text-sm">{p.label}</div>
                  </div>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* AMOUNT Filter (Modal based, no portal needed) */}
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
                          {row.date ? new Date(row.date).toLocaleDateString('ru') : <span className="badge badge-primary">План</span>}
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