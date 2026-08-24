import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, UsersRound, Layers, GitBranch, ChevronLeft, ChevronRight } from 'lucide-react';
import PageContainer from '@/components/ui/PageContainer';
import { DirectorFiltersProvider } from '@/components/dashboard/DirectorFilters';
import ExecutiveHeader from '@/components/dashboard/executive/ExecutiveHeader';
import ExecutivePageNav, { type NavItem } from '@/components/dashboard/executive/ExecutivePageNav';
import ExecutivePageShell from '@/components/dashboard/executive/ExecutivePageShell';
import OverviewPage from '@/components/dashboard/executive/pages/OverviewPage';
import RepresentativesPage from '@/components/dashboard/executive/pages/RepresentativesPage';
import GroupsPage from '@/components/dashboard/executive/pages/GroupsPage';
import OperationsPage from '@/components/dashboard/executive/pages/OperationsPage';
import { useExecutiveSummary, type ExecutivePeriod } from '@/hooks/useExecutiveSummary';
import { useRepPerformance } from '@/hooks/useRepPerformance';
import { cn } from '@/utils/cn';

const KEYS = ['geral', 'representantes', 'grupos', 'operacao'] as const;
type ViewKey = typeof KEYS[number];
const STORAGE_KEY = 'concrem_exec_view';

export default function ExecutiveDashboardPager({ global = false }: { global?: boolean }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  // `mes` entra explícito para o seletor do header nascer coerente com o que os
  // dados já usavam por omissão (`dashboardJanelas` assume o mês corrente quando
  // `mes` não vem). Sem isto o select apareceria vazio na primeira renderização.
  const [period, setPeriod] = useState<ExecutivePeriod>(() => {
    const agora = new Date();
    return { periodo: 'mes', ano: agora.getFullYear(), mes: agora.getMonth() + 1 };
  });
  const [atualizadoEm, setAtualizadoEm] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const initial = (params.get('view') || (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || 'geral') as string;
  const [active, setActive] = useState<ViewKey>((KEYS as readonly string[]).includes(initial) ? (initial as ViewKey) : 'geral');
  const [direction, setDirection] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  // Contadores para a navegação (dados já escopados; cache compartilhado com as páginas)
  const summary = useExecutiveSummary(period);
  const { data: reps = [] } = useRepPerformance(period);
  const repsAtencao = useMemo(() => reps.filter(r => r.badge === 'atencao' || r.badge === 'critico').length, [reps]);

  const items: NavItem[] = [
    { key: 'geral', label: 'Geral', icon: LayoutDashboard },
    { key: 'representantes', label: 'Representantes', icon: UsersRound, count: repsAtencao, countTone: 'risco' },
    { key: 'grupos', label: 'Grupos', icon: Layers },
    { key: 'operacao', label: 'Operação', icon: GitBranch, count: summary.pendencias, countTone: 'atencao' },
  ];

  function goTo(key: string) {
    if (!(KEYS as readonly string[]).includes(key) || key === activeRef.current) return;
    setDirection(KEYS.indexOf(key as ViewKey) > KEYS.indexOf(activeRef.current) ? 1 : -1);
    setActive(key as ViewKey);
    const p = new URLSearchParams(params);
    p.set('view', key);
    setParams(p, { replace: true });
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* storage indisponível */ }
  }
  function step(delta: number) {
    const i = KEYS.indexOf(activeRef.current) + delta;
    if (i >= 0 && i < KEYS.length) goTo(KEYS[i]);
  }

  // Teclado (desktop): ← →
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Swipe (mobile)
  const touch = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) { const t = e.changedTouches[0]; touch.current = { x: t.clientX, y: t.clientY }; }
  function onTouchEnd(e: React.TouchEvent) {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x, dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    touch.current = null;
  }

  async function refresh() {
    setRefreshing(true);
    await qc.invalidateQueries();
    setAtualizadoEm(new Date());
    setTimeout(() => setRefreshing(false), 600);
  }

  const idx = KEYS.indexOf(active);

  return (
    <PageContainer>
      <DirectorFiltersProvider>
        <div className="space-y-3">
          <ExecutiveHeader period={period} onPeriodChange={setPeriod} onRefresh={refresh} atualizadoEm={atualizadoEm} refreshing={refreshing} global={global} />

          {/* Navegação */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0"><ExecutivePageNav items={items} active={active} onChange={goTo} /></div>
            <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
              <button type="button" onClick={() => step(-1)} disabled={idx === 0}
                className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" aria-label="Página anterior">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-semibold text-gray-500 tabular-nums w-9 text-center">{idx + 1}/{KEYS.length}</span>
              <button type="button" onClick={() => step(1)} disabled={idx === KEYS.length - 1}
                className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" aria-label="Próxima página">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Página ativa (só a ativa é renderizada) */}
          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className={cn('min-h-[40vh]')}>
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <ExecutivePageShell key={active} direction={direction}>
                {active === 'geral' && <OverviewPage period={period} global={global} />}
                {active === 'representantes' && <RepresentativesPage period={period} />}
                {active === 'grupos' && <GroupsPage period={period} global={global} />}
                {active === 'operacao' && <OperationsPage period={period} />}
              </ExecutivePageShell>
            </AnimatePresence>
          </div>
        </div>
      </DirectorFiltersProvider>
    </PageContainer>
  );
}
