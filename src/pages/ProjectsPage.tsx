import React, { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  FolderOpen, 
  TrendingUp, 
  TrendingDown, 
  PieChart, 
  ChevronDown, 
  ChevronRight, 
  Plus, 
  X 
} from 'lucide-react';

import { api, me } from '../lib/api';
import { fmtMoney } from '../lib/format';

/* --------------------------------- Types ---------------------------------- */
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
  name?: string; // slug
  remainder_calc?: number;
};

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

  // --- ГРУППИРОВКА (как было) ---
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
          
          const incomeSections = sections.filter((x) => (x.direction || '').toLowerCase() === 'нам должны');
          const expenseSections = sections.filter((x) => (x.direction || '').toLowerCase() === 'мы должны');

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

  /* -------------------- Создание проекта -------------------- */
  const [dlgOpen, setDlgOpen] = useState(false);
  const [newContractor, setNewContractor] = useState('');
  const [newProject, setNewProject] = useState('');
  const canSave = newContractor.trim().length > 0 && newProject.trim().length > 0;

  const createProject = useCallback(
    async (payload: { contractor: string; project: string }) => {
      const contractorName = payload.contractor.trim();
      // Если такого нет — создаем организацию
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

  const addMutation = useMutation({
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
  });

  /* -------------------- State для сворачивания групп -------------------- */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (contractor: string) =>
    setCollapsed((prev) => ({ ...prev, [contractor]: !prev[contractor] }));

  return (
    <div className="page-container">
      {/* Header */}
      <div className="header">
        <h2 className="header_block">Проекты</h2>
        
        {isAdmin && (
          <div className="actions-block">
            <button className="btn" onClick={() => setDlgOpen(true)}>
              <Plus size={18}/>
              <div className="unset"> Добавить проект</div> 
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="content" style={{ gap: '16px' }}>
        {isLoading ? (
          <div className="text-soft p-4">Загрузка проектов...</div>
        ) : grouped.length === 0 ? (
          <div className="text-soft p-4">Проектов пока нет.</div>
        ) : (
          grouped.map((grp) => {
            const isCollapsed = !!collapsed[grp.contractor];
            return (
              <div key={grp.contractor} className="contractor-group block">
                {/* Header группы (Контрагент) */}
                <div 
                  className="contractor-header" 
                  onClick={() => toggleGroup(grp.contractor)}
                >
                  <div className="contractor-header-spoler">
                    {isCollapsed ? <ChevronRight size={20} className="text-soft" /> : <ChevronDown size={20} className="text-soft" />}
                    <h3 className="m-0 text-lg font-medium">{grp.contractor}</h3>
                  </div>
                  <span className="badge">{grp.projects.length}</span>
                </div>

                {/* Сетка проектов */}
                {!isCollapsed && (
                  <div className="projects-grid">
                    {grp.projects
                      .sort((a, b) => collator.compare(a.project ?? '', b.project ?? ''))
                      .map((p) => (
                        <div
                          key={p.name || p.project}
                          className="project-card"
                          onClick={() => openProjectByName(p.name, grp.contractor, p.project)}
                        >
                          {/* Заголовок проекта */}
                          <div className="project-card-title">
                            <FolderOpen size={20} className="text-primary" />
                            <div className="font-bold text-ellipsis" title={p.project || 'Без проекта'}>
                              {p.project || 'Без проекта'}
                            </div>
                          </div>

                          {/* Финансы */}
                          <div className="project-card-cont">
                            {/* Доходы */}
                            {(p.incomeTotal > 0 || p.incomeRemainder !== 0) && (
                              <div className="project-card-text">
                                <TrendingUp size={16} className="text-success" />
                                <span className="text-success font-bold">+{fmtMoney(p.incomeTotal)}</span>
                                <span className="text-soft text-xs">/ {fmtMoney(p.incomeRemainder)}</span>
                              </div>
                            )}

                            {/* Расходы */}
                            {(p.expenseTotal > 0 || p.expenseRemainder !== 0) && (
                              <div className="project-card-text">
                                <TrendingDown size={16} className="text-danger" />
                                <span className="text-danger font-bold">-{fmtMoney(p.expenseTotal)}</span>
                                <span className="text-soft text-xs">/ {fmtMoney(p.expenseRemainder)}</span>
                              </div>
                            )}

                            {/* Пусто */}
                            {p.incomeTotal === 0 && p.expenseTotal === 0 && (
                              <div className="text-soft text-xs pl-6">Нет сумм по договору</div>
                            )}


                            {/* Прогресс */}
                            <div className="project-card-text">
                              <PieChart size={16} />
                              <span>Готовность</span>
                              <span className={`font-bold text-sm ${p.avgProgress >= 100 ? 'text-success' : ''}`}>
                                / {p.avgProgress.toFixed(1)}%
                              </span>
                            </div>



                          </div>

                          
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Модалка создания проекта */}
      {dlgOpen && (
        <div className="modal-overlay" onClick={() => setDlgOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Новый проект</h3>
              <button className="icon-btn" onClick={() => setDlgOpen(false)}><X size={20}/></button>
            </div>
            
            <div className="modal-body flex-col">
              <div className="input-group">
                <label className="input-label">Контрагент</label>
                {/* HTML5 Datalist вместо Autocomplete */}
                <input 
                  className="input" 
                  list="contractors-list" 
                  placeholder="Выберите или введите новое..."
                  value={newContractor}
                  onChange={(e) => setNewContractor(e.target.value)}
                />
                <datalist id="contractors-list">
                  {contractorOptions.map(opt => <option key={opt} value={opt} />)}
                </datalist>
              </div>

              <div className="input-group">
                <label className="input-label">Название проекта</label>
                <input 
                  className="input" 
                  placeholder="Например: Жилой комплекс"
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSave && !addMutation.isPending) {
                       addMutation.mutate({ contractor: newContractor, project: newProject });
                    }
                  }}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setDlgOpen(false)}>Отмена</button>
              <button 
                className="btn" 
                disabled={!canSave || addMutation.isPending}
                onClick={() => addMutation.mutate({ contractor: newContractor, project: newProject })}
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;