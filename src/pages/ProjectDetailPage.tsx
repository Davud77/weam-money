// src/pages/ProjectDetailPage.tsx
import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip as ChartTooltip
} from 'recharts';
import dayjs from 'dayjs';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  ChevronLeft, 
  Plus, 
  Minus,
  Edit2, 
  Trash2, 
  X, 
  PanelLeftClose, 
  PanelLeftOpen,
  Menu
} from 'lucide-react';

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
  date: string;
  total: number;
  advance: number;
  remainder: number;
  operationType: OperationType | string;
  note?: string;
  project_id?: number | null;
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
  name?: string;
  remainder_calc?: number;
}

interface User {
  id: number; login: string; nickname: string;
}

/* ------------------------------ Utils ------------------------------------ */
const API = '/api';
const STALE_15M = 15 * 60 * 1000;

const dirRank = (d: ProjectRow['direction']) => (d === 'нам должны' ? 0 : 1);

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

const normalizeOp = (v: unknown): OperationType => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'расход' ? 'Расход' : 'Доход';
};

/* -------------------------------- Page ----------------------------------- */
const ProjectDetailPage: React.FC<{ showError: (msg: string) => void }> = ({ showError }) => {
  const { name = '' } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [showList, setShowList] = useState(true);

  /* -------- Auth -------- */
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => me(), staleTime: 300000 });
  const isAdmin = meData?.user?.role === 'admin';

  /* -------- Data -------- */
  const { data: allTx = [], isError: txErr, error: txError, isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions'], queryFn: () => api<Transaction[]>(`${API}/transactions`), refetchOnWindowFocus: false,
  });
  if (txErr && txError instanceof Error && txError.message !== 'UNAUTHORIZED') showError(txError.message);

  const { data: allProjects = [], isLoading: allPrjLoading } = useQuery<ProjectRow[]>({
    queryKey: ['projects'], queryFn: () => api<ProjectRow[]>(`${API}/projects`), staleTime: STALE_15M,
  });

  // Sidebar list
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
      const g = (a.grouping || '').localeCompare(b.grouping || '');
      if (g !== 0) return g;
      const c = a.contractor.localeCompare(b.contractor);
      return c !== 0 ? c : a.project.localeCompare(b.project);
    });
  }, [allProjects]);

  const groupingOptions = useMemo(() => {
    // Explicit type guard to ensure we have string[]
    const groups = allProjects
      .map(p => p.grouping)
      .filter((g): g is string => !!g);
    return Array.from(new Set(groups)).sort();
  }, [allProjects]);

  // Current Project Sections
  const { data: sectionRowsRaw = [], isLoading: secLoading, isError: secErr, error: secError } = useQuery<ProjectRow[]>({
    queryKey: ['projects-by-name', name],
    enabled: !!name,
    queryFn: () => api<ProjectRow[]>(`${API}/projects/by-name/${encodeURIComponent(name)}`),
    retry: 1
  });
  if (secErr && secError instanceof Error && secError.message !== 'UNAUTHORIZED') showError(secError.message);

  const sectionRows = useMemo(() => 
    sectionRowsRaw.slice().sort((a, b) => {
      const byDir = dirRank(a.direction) - dirRank(b.direction);
      return byDir !== 0 ? byDir : a.section.localeCompare(b.section);
    }), 
  [sectionRowsRaw]);

  const titleProject = sectionRows[0]?.project || 'Без проекта';
  const titleContractor = sectionRows[0]?.contractor || '';

  // Calculate Stats
  const sectionIdSet = useMemo(() => new Set(sectionRows.map(s => Number(s.id))), [sectionRows]);
  const txRows = useMemo(() => allTx.filter((t) => t.project_id != null && sectionIdSet.has(Number(t.project_id))), [allTx, sectionIdSet]);

  const income = txRows.filter((r) => normalizeOp(r.operationType) === 'Доход').reduce((s, r) => s + r.total, 0);
  const expense = txRows.filter((r) => normalizeOp(r.operationType) === 'Расход').reduce((s, r) => s + r.total, 0);
  const profit = income - expense;
  const margin = income ? (profit / income) * 100 : 0;

  const chartData = useMemo(() => {
    const m = new Map<string, number>();
    txRows.filter((r) => r.date).forEach((r) => {
      const delta = normalizeOp(r.operationType) === 'Доход' ? r.total : -r.total;
      m.set(r.date, (m.get(r.date) ?? 0) + delta);
    });
    const dates = Array.from(m.keys()).sort();
    let acc = 0;
    return dates.map((d) => ({ date: dayjs(d).format('DD.MM.YYYY'), profit: (acc += m.get(d)!) }));
  }, [txRows]);

  /* -------- Mutations -------- */
  const invalidateList = () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['projects-by-name', name] }); };
  const invalidateTx = () => { qc.invalidateQueries({ queryKey: ['transactions'] }); };

  const updateSection = useMutation({
    mutationFn: async (p: ProjectRow) => {
      const dto = { ...toProjectDTO(p), section: String(p.section||''), amount: Number(p.amount)||0 };
      return api(`${API}/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(dto) });
    },
    onSuccess: invalidateList,
    onError: (e: any) => showError(e.message || 'Ошибка')
  });

  const createSection = useMutation({
    mutationFn: async (p: Omit<ProjectRow, 'id'>) => {
      const dto = { ...toProjectDTO({ ...p, id: 0 } as ProjectRow), name };
      return api(`${API}/projects`, { method: 'POST', body: JSON.stringify(dto) });
    },
    onSuccess: invalidateList,
    onError: (e: any) => showError(e.message || 'Ошибка')
  });

  const deleteSection = useMutation({
    mutationFn: (id: number) => api(`${API}/projects/${id}`, { method: 'DELETE' }),
    onSuccess: invalidateList,
    onError: (e: any) => showError(e.message || 'Ошибка')
  });

  const createTx = useMutation({ mutationFn: (d: any) => api(`${API}/transactions`, { method: 'POST', body: JSON.stringify(d) }), onSuccess: invalidateTx });
  const updateTx = useMutation({ mutationFn: (d: any) => api(`${API}/transactions/${d.id}`, { method: 'PUT', body: JSON.stringify(d) }), onSuccess: invalidateTx });
  const removeTx = useMutation({ mutationFn: (id: number) => api(`${API}/transactions/${id}`, { method: 'DELETE' }), onSuccess: invalidateTx });

  /* -------- UI State -------- */
  const [editSectionRow, setEditSectionRow] = useState<ProjectRow | null>(null);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txForm, setTxForm] = useState<Partial<Transaction>>({});
  const isTxEdit = Boolean(txForm && 'id' in txForm);

  const { data: users = [] } = useQuery<User[]>({ queryKey: ['users'], enabled: true, queryFn: () => api<User[]>(`${API}/users`), staleTime: STALE_15M });
  const usersByLogin = useMemo(() => {
    const m = new Map<string, User>();
    users.forEach(u => m.set(u.login, u));
    return m;
  }, [users]);

  /* -------- Render -------- */
  return (
    <div className="page-container pd-page">
      {/* Header */}
      <div className="header">
        <div className="header_block">
          <button className="icon-btn" onClick={() => setShowList(v => !v)} title="Список проектов">
            {showList ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
          
          <div className="header_block">
             <div className="text-xs text-soft cursor-pointer hover:text-white flex items-center gap-1" onClick={() => navigate('/projects')}>
               <ChevronLeft size={12}/> Проекты
             </div>
             <h2 className="text-xl font-bold m-0">{titleProject}</h2>
          </div>
        </div>

        {isAdmin && (
           <div className="actions-block">
             <button className="btn" onClick={() => {
                const firstPid = sectionRows[0]?.id ?? null;
                setTxForm({ contractor: titleContractor, project: titleProject, section: '', responsible: '', date: '', total: 0, advance: 0, remainder: 0, operationType: 'Доход', note: '', project_id: firstPid ?? null });
                setTxDialogOpen(true);
             }}>
               <Plus size={16}/>
               <div className="unset">Транзакция</div>  
             </button>
             <button className="btn secondary" onClick={() => setEditSectionRow({ id: 0, contractor: titleContractor, project: titleProject, section: '', direction: 'нам должны', grouping: '', amount: 0, progress: 0, responsible: null, responsible_nickname: '', end: null, name, remainder_calc: 0 })}>
               <Plus size={16}/>
               <div className="unset">Раздел</div>
             </button>
           </div>
        )}
      </div>

      <div className="content pd-content">
         {/* Sidebar List */}
         {showList && (
           <div className="card pd-sidebar block">
              {projectsFlat.map(p => {
                const active = p.name === name;
                return (
                  <div 
                    key={p.name} 
                    className={`pd-nav-item ${active ? 'active' : ''}`}
                    onClick={() => navigate(`/projects/${encodeURIComponent(p.name)}`)}
                  >
                    <div className="font-medium text-sm truncate">{p.project}</div>
                    <div className="text-xs text-soft truncate">{p.grouping ? `${p.grouping} / ` : ''}{p.contractor}</div>
                  </div>
                )
              })}
           </div>
         )}

         {/* Main Content */}
         <div className="projectdetailmain">
            
            {/* KPI & Chart */}
            <div className="card projectdetailcard pd-stats block">
               <div className="projectdetail-kpis">
                 <Kpi title="Чистая прибыль" value={`${profit >= 0 ? '+' : '-'}${fmtMoney(Math.abs(profit))}`} className={profit >= 0 ? 'text-success' : 'text-danger'} />
                 <Kpi title="Доходы" value={fmtMoney(income)} />
                 <Kpi title="Расходы" value={fmtMoney(expense)} />
                 <Kpi title="Рентабельность" value={fmtPercent(margin)} />
               </div>

               <div style={{ height: 250, width: '100%' }}>
                  {chartData.length > 1 ? (
                    <ResponsiveContainer>
                      <LineChart data={chartData}>
                        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3"/>
                        <XAxis dataKey="date" stroke="var(--text-soft)" fontSize={11} tickLine={false} axisLine={false}/>
                        <YAxis stroke="var(--text-soft)" fontSize={11} tickLine={false} axisLine={false}/>
                        <ChartTooltip 
                           content={({ active, payload, label }) => {
                             if (!active || !payload?.length) return null;
                             return (
                               <div className="chart-tooltip">
                                 <div className="text-soft text-xs">{label}</div>
                                 <div className="font-bold">{fmtMoney(Number(payload[0].value))}</div>
                               </div>
                             )
                           }} 
                        />
                        <Line type="monotone" dataKey="profit" stroke="var(--primary)" strokeWidth={2} dot={{r:3}} isAnimationActive={false}/>
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div className="text-soft text-center text-sm py-10">Недостаточно данных для графика</div>}
               </div>
            </div>

            {/* Table: Sections */}
            <div className="card projectdetailcard block">
               <div className="p-3 border-b border-white-5 font-bold text-sm bg-white-5">Разделы проекта</div>
               <div className="overflow-x-auto">
                 <table className="table w-full">
                   <thead>
                     <tr>
                       <th>Раздел</th>
                       <th>Тип операции</th>
                       <th>Ответственный</th>
                       <th className="text-right">Сумма договора</th>
                       <th className="text-right">Остаток</th>
                       {isAdmin && <th className="text-center w-10"></th>}
                     </tr>
                   </thead>
                   <tbody>
                      {secLoading ? <tr><td colSpan={6} className="p-4 text-center text-soft">Загрузка...</td></tr> :
                       sectionRows.map(r => (
                         <tr key={r.id} className="hover:bg-sidebar">
                           <td className="font-medium">{r.section}</td>
                           <td>
                             <span className={r.direction === 'нам должны' ? 'text-success' : 'text-danger'}>
                               {r.direction}
                             </span>
                           </td>
                           <td className="text-soft text-sm">{r.responsible_nickname || '—'}</td>
                           <td className="text-right font-mono">{fmtMoney(r.amount)}</td>
                           <td className={`text-right font-mono font-bold ${(r.remainder_calc??0) >= 0 ? 'text-success' : 'text-danger'}`}>
                             {fmtMoney(r.remainder_calc??0)}
                           </td>
                           {isAdmin && (
                             <td className="text-center">
                               <button className="icon-btn" onClick={() => setEditSectionRow(r)}>
                                 <Edit2 size={16}/>
                               </button>
                             </td>
                           )}
                         </tr>
                       ))}
                   </tbody>
                 </table>
               </div>
            </div>

            {/* Table: Transactions */}
            <div className="card projectdetailcard block">
               <div className="p-3 border-b border-white-5 font-bold text-sm bg-white-5">Транзакции по проекту</div>
               <div className="overflow-x-auto">
                 <table className="table w-full sticky-header">
                   <thead>
                     <tr>
                       <th className="w-24 text-center">Дата</th>
                       <th className="text-right">Сумма</th>
                       <th>Раздел</th>
                       <th>Описание</th>
                       <th>Счёт</th>
                       {isAdmin && <th className="text-center w-10"></th>}
                     </tr>
                   </thead>
                   <tbody>
                      {txLoading ? <tr><td colSpan={6} className="p-4 text-center text-soft">Загрузка...</td></tr> :
                       txRows.map(t => {
                         const isExpense = normalizeOp(t.operationType) === 'Расход';
                         const pr = sectionRows.find(s => s.id === t.project_id);
                         const secName = pr ? pr.section : t.section;
                         const nick = usersByLogin.get(t.responsible)?.nickname || t.responsible;
                         return (
                           <tr key={t.id} className="hover:bg-sidebar">
                             <td className="text-center text-sm">
                               {t.date ? new Date(t.date).toLocaleDateString('ru') : <span className="badge badge-secondary">План</span>}
                             </td>
                             <td className="text-right font-mono">
                               <span className={isExpense ? 'text-danger' : 'text-success'}>
                                 {isExpense ? '-' : '+'}{fmtMoney(Math.abs(t.total))}
                               </span>
                             </td>
                             <td className="text-sm font-medium">{secName || '—'}</td>
                             <td className="text-sm text-soft" title={t.note}>{t.note || '—'}</td>
                             <td className="text-sm text-soft">{nick}</td>
                             {isAdmin && (
                               <td className="text-center">
                                 <button className="icon-btn" onClick={() => { setTxForm(t); setTxDialogOpen(true); }}>
                                   <Edit2 size={16}/>
                                 </button>
                               </td>
                             )}
                           </tr>
                         )
                       })}
                   </tbody>
                 </table>
               </div>
            </div>
         </div>
      </div>

      {/* MODAL: Section */}
      {isAdmin && editSectionRow && (
        <div className="modal-overlay" onClick={() => setEditSectionRow(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
             <div className="modal-header">
               <h3>{editSectionRow.id ? 'Редактировать раздел' : 'Новый раздел'}</h3>
               <button className="icon-btn" onClick={() => setEditSectionRow(null)}><X size={20}/></button>
             </div>
             <div className="modal-body flex flex-col gap-4">
               <div className="input-group">
                 <label className="input-label">Название раздела</label>
                 <input className="input" value={editSectionRow.section || ''} onChange={e => setEditSectionRow({...editSectionRow, section: e.target.value})} />
               </div>
               
               <div className="input-group">
                 <label className="input-label">Группировка</label>
                 <input className="input" list="group-opts" value={editSectionRow.grouping ?? ''} onChange={e => setEditSectionRow({...editSectionRow, grouping: e.target.value})} />
                 <datalist id="group-opts">{groupingOptions.map(g => <option key={g} value={g}/>)}</datalist>
               </div>

               <div className="input-group">
                 <label className="input-label">Тип</label>
                 <select className="input" value={editSectionRow.direction} onChange={e => setEditSectionRow({...editSectionRow, direction: e.target.value as any})}>
                   <option value="нам должны">Нам должны (Доход)</option>
                   <option value="мы должны">Мы должны (Расход)</option>
                 </select>
               </div>

               <div className="input-group">
                 <label className="input-label">Ответственный</label>
                 <select className="input" value={editSectionRow.responsible ?? ''} onChange={e => setEditSectionRow({...editSectionRow, responsible: e.target.value ? Number(e.target.value) : null})}>
                   <option value="">(Нет)</option>
                   {users.map(u => <option key={u.id} value={u.id}>{u.nickname || u.login}</option>)}
                 </select>
               </div>

               <div className="input-group">
                 <label className="input-label">Сумма договора</label>
                 <input type="number" className="input" value={editSectionRow.amount} onChange={e => setEditSectionRow({...editSectionRow, amount: +e.target.value})} />
               </div>
             </div>
             
             <div className="modal-footer justify-between">
                {editSectionRow.id ? (
                  <button className="btn danger" onClick={() => { if(window.confirm('Удалить раздел?')) deleteSection.mutate(editSectionRow.id); setEditSectionRow(null); }}>
                    <Trash2 size={16} className="mr-2"/> Удалить
                  </button>
                ) : <div/>}
                <div className="actions-block">
                   <button className="btn secondary" onClick={() => setEditSectionRow(null)}>Отмена</button>
                   <button className="btn" onClick={() => {
                      if (editSectionRow.id) updateSection.mutate(editSectionRow);
                      else createSection.mutate(editSectionRow);
                      setEditSectionRow(null);
                   }}>Сохранить</button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* MODAL: Transaction */}
      {isAdmin && txDialogOpen && (
        <div className="modal-overlay" onClick={() => setTxDialogOpen(false)}>
           <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{isTxEdit ? 'Редактировать транзакцию' : 'Новая транзакция'}</h3>
                <button className="icon-btn" onClick={() => setTxDialogOpen(false)}><X size={20}/></button>
              </div>
              <div className="modal-body flex flex-col gap-4">
                 <div className="input-group">
                    <label className="input-label">Раздел</label>
                    <select 
                      className="input" 
                      value={txForm.project_id || ''} 
                      onChange={e => {
                        const pid = Number(e.target.value);
                        const s = sectionRows.find(x => x.id === pid);
                        setTxForm({...txForm, project_id: pid, section: s?.section || '', contractor: titleContractor, project: titleProject });
                      }}
                    >
                      <option value="">-- Выберите --</option>
                      {sectionRows.map(s => <option key={s.id} value={s.id}>{s.section}</option>)}
                    </select>
                 </div>

                 <div className="input-group">
                   <label className="input-label">Тип</label>
                   <select className="input" value={normalizeOp(txForm.operationType)} onChange={e => setTxForm({...txForm, operationType: e.target.value as any})}>
                     <option value="Доход">Доход</option>
                     <option value="Расход">Расход</option>
                   </select>
                 </div>

                 <div className="flex gap-4">
                    <div className="input-group flex-1">
                      <label className="input-label">Дата</label>
                      <input type="date" className="input" value={txForm.date || ''} onChange={e => setTxForm({...txForm, date: e.target.value})} />
                    </div>
                    <div className="input-group flex-1">
                      <label className="input-label">Сумма</label>
                      <input type="number" className="input" value={txForm.total || ''} onChange={e => setTxForm({...txForm, total: +e.target.value})} />
                    </div>
                 </div>

                 <div className="input-group">
                   <label className="input-label">Счёт</label>
                   <select className="input" value={txForm.responsible || ''} onChange={e => setTxForm({...txForm, responsible: e.target.value})}>
                     <option value="">-- Выберите --</option>
                     {users.map(u => <option key={u.id} value={u.login}>{u.nickname || u.login}</option>)}
                   </select>
                 </div>

                 <div className="input-group">
                   <label className="input-label">Примечание</label>
                   <textarea className="input" rows={2} value={txForm.note || ''} onChange={e => setTxForm({...txForm, note: e.target.value})} />
                 </div>
              </div>

              <div className="modal-footer justify-between">
                {isTxEdit && txForm.id ? (
                   <button className="btn danger" onClick={() => { if(window.confirm('Удалить?')) removeTx.mutate(txForm.id!); setTxDialogOpen(false); }}>
                     <Trash2 size={16} className="mr-2"/> Удалить
                   </button>
                ) : <div/>}
                <div className="flex gap-2">
                   <button className="btn secondary" onClick={() => setTxDialogOpen(false)}>Отмена</button>
                   <button className="btn" onClick={() => {
                      const dto = { 
                        ...txForm, 
                        contractor: titleContractor, project: titleProject, 
                        remainder: Number(txForm.total)||0 
                      };
                      if (isTxEdit) updateTx.mutate(dto);
                      else createTx.mutate(dto);
                      setTxDialogOpen(false);
                   }}>Сохранить</button>
                </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

// Helper Component for KPI
const Kpi = ({ title, value, className }: { title: string, value: string, className?: string }) => (
  <div className="component-kpi">
    <span className="component-kpi-text">{title}</span>
    <span className={`component-kpi-title ${className || ''}`}>{value}</span>
  </div>
);

export default ProjectDetailPage;