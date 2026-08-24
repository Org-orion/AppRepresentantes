import { RefreshCw, Layers, CalendarClock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useDataScope } from '@/hooks/useDataScope';
import { cn } from '@/utils/cn';
import type { ExecutivePeriod } from '@/hooks/useExecutiveSummary';
import type { PeriodoFiltro } from '@/services/dashboard';

const PERIODOS: { key: PeriodoFiltro; label: string }[] = [
  { key: 'mes', label: 'Mês' },
  { key: 'trimestre', label: 'Trimestre' },
  { key: 'ano', label: 'Ano' },
];

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface Props {
  period: ExecutivePeriod;
  onPeriodChange: (p: ExecutivePeriod) => void;
  onRefresh: () => void;
  atualizadoEm: Date;
  refreshing?: boolean;
  /** Diretor Geral: rótulo de visão global; senão mostra os grupos vinculados. */
  global?: boolean;
}

// Topo gerencial: identidade + período + grupos sob gestão + atualizar.
export default function ExecutiveHeader({ period, onPeriodChange, onRefresh, atualizadoEm, refreshing, global }: Props) {
  const { user } = useAuth();
  const { grupos } = useDataScope();
  const nome = user?.usuario?.nome ?? 'Diretoria';
  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth() + 1;          // 1-12, como em ExecutivePeriod
  const anos = [anoAtual, anoAtual - 1, anoAtual - 2];

  return (
    <div className="rounded-2xl border border-gray-200/70 bg-gradient-to-br from-[#0D2012] to-[#0a3d1c] text-white p-4 sm:p-5 overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        {/* Identidade */}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Sala de Comando</p>
          <h1 className="text-xl sm:text-2xl font-bold mt-0.5">Visão Gerencial</h1>
          <p className="text-[13px] text-white/60 mt-1 max-w-xl">
            Performance comercial e operacional {global ? 'de toda a operação.' : 'dos representantes sob sua gestão.'}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-[11px] text-white/50">
            <span className="inline-flex items-center gap-1.5 text-white/80 font-medium">{nome}</span>
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              {global ? 'Todos os grupos' : `${grupos?.length ?? 0} grupo(s): ${(grupos ?? []).slice(0, 3).join(' · ')}${(grupos?.length ?? 0) > 3 ? '…' : ''}`}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5" />
              Atualizado {atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Controles */}
        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
          {/* Período segmentado */}
          <div className="inline-flex rounded-lg bg-white/10 p-0.5">
            {PERIODOS.map(p => (
              <button key={p.key} type="button" onClick={() => onPeriodChange({ ...period, periodo: p.key })}
                className={cn('text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors',
                  period.periodo === p.key ? 'bg-white text-[#0D2012]' : 'text-white/70 hover:text-white')}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Ano */}
          <select
            value={period.ano ?? anoAtual}
            onChange={e => onPeriodChange({ ...period, ano: Number(e.target.value) })}
            aria-label="Ano"
            className="h-8 rounded-lg bg-white/10 text-white text-[11px] font-medium px-2 border-none outline-none focus:ring-2 focus:ring-white/30 [&>option]:text-gray-900"
          >
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {/* Mês — só faz sentido quando o período é mensal.
              Sem ele o mês ficava preso no corrente: `dashboardJanelas` cai em
              `filtros.mes ?? (now.getMonth() + 1)` quando `mes` não vem. */}
          {period.periodo === 'mes' && (
            <select
              value={period.mes ?? mesAtual}
              onChange={e => onPeriodChange({ ...period, mes: Number(e.target.value) })}
              aria-label="Mês"
              className="h-8 rounded-lg bg-white/10 text-white text-[11px] font-medium px-2 border-none outline-none focus:ring-2 focus:ring-white/30 [&>option]:text-gray-900"
            >
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          )}
          <button type="button" onClick={onRefresh}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-medium transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Atualizar
          </button>
        </div>
      </div>
    </div>
  );
}
