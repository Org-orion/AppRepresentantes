import { useMemo } from 'react';
import { Activity, TrendingUp, AlertTriangle, GitBranch } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useExecutiveSummary, type ExecutivePeriod } from '@/hooks/useExecutiveSummary';
import { useGroupPerformance } from '@/hooks/useRepPerformance';
import { PIPELINE_STAGES } from '@/components/dashboard/DirectorFilters';
import { cn } from '@/utils/cn';

type Tone = 'bom' | 'atencao' | 'critico' | 'info';
const TONE: Record<Tone, { chip: string; icon: React.ElementType }> = {
  bom:     { chip: 'bg-emerald-50 text-emerald-600', icon: TrendingUp },
  atencao: { chip: 'bg-amber-50 text-amber-600',     icon: AlertTriangle },
  critico: { chip: 'bg-red-50 text-red-600',         icon: AlertTriangle },
  info:    { chip: 'bg-blue-50 text-blue-600',       icon: GitBranch },
};

// "Diagnóstico do Período": Resultado · Atenção · Gargalo · Oportunidade.
// Frases geradas por regras a partir dos dados reais (nunca genéricas).
export default function ManagementDiagnosis({ period }: { period: ExecutivePeriod }) {
  const d = useExecutiveSummary(period);
  const { data: grupos = [] } = useGroupPerformance();

  const cards = useMemo(() => {
    // Resultado
    const rd = d.receitaDelta;
    const resultado = rd === null
      ? { tone: 'info' as Tone, titulo: 'Resultado', texto: 'Sem base comparável no período anterior.' }
      : rd >= 0
        ? { tone: 'bom' as Tone, titulo: 'Resultado', texto: `Valor em crescimento de ${rd.toFixed(1)}% vs período anterior.` }
        : { tone: 'critico' as Tone, titulo: 'Resultado', texto: `Valor em queda de ${Math.abs(rd).toFixed(1)}% vs período anterior.` };

    // Atenção
    const atencao = d.clientesRisco > 0
      ? { tone: 'atencao' as Tone, titulo: 'Atenção', texto: `${d.clientesRisco} cliente(s) com recompra atrasada (${d.dormentes} dormente(s)).` }
      : { tone: 'bom' as Tone, titulo: 'Atenção', texto: 'Carteira em dia — sem clientes em risco relevante.' };

    // Gargalo — etapa do pipeline com maior concentração (exceto finalizado)
    const pl = d.pipeline;
    let gargalo = { tone: 'info' as Tone, titulo: 'Gargalo', texto: 'Pipeline sem dados no período.' };
    if (pl) {
      const cand = PIPELINE_STAGES.filter(s => s.key !== 'finalizado')
        .map(s => ({ label: s.label, n: (pl as unknown as Record<string, number>)[s.key] ?? 0 }))
        .sort((a, b) => b.n - a.n)[0];
      if (cand && cand.n > 0) gargalo = { tone: 'info', titulo: 'Gargalo', texto: `Maior concentração de pedidos está em ${cand.label} (${cand.n}).` };
    }

    // Oportunidade — grupo líder em receita (proteger/expandir) ou reativação
    let oportunidade = { tone: 'info' as Tone, titulo: 'Oportunidade', texto: 'Sem grupos com dados no escopo.' };
    if (grupos.length > 0) {
      const lider = [...grupos].sort((a, b) => b.receita - a.receita)[0];
      const reativa = [...grupos].sort((a, b) => (b.clientesAtrasados + b.clientesDormentes) - (a.clientesAtrasados + a.clientesDormentes))[0];
      const totReativa = reativa.clientesAtrasados + reativa.clientesDormentes;
      oportunidade = totReativa > 0
        ? { tone: 'atencao', titulo: 'Oportunidade', texto: `Grupo ${reativa.grupo} tem ${totReativa} cliente(s) para reativar.` }
        : { tone: 'bom', titulo: 'Oportunidade', texto: `Grupo ${lider.grupo} lidera com ${lider.pctReceita.toFixed(0)}% do valor.` };
    }

    return [resultado, atencao, gargalo, oportunidade];
  }, [d, grupos]);

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-500" />
          <CardTitle>Diagnóstico do Período</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {cards.map((c, i) => {
            const t = TONE[c.tone];
            const Icon = t.icon;
            return (
              <div key={i} className="rounded-2xl border border-gray-100 p-3 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', t.chip)}><Icon className="w-4 h-4" /></span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{c.titulo}</span>
                </div>
                <p className="text-[13px] text-gray-700 leading-snug mt-2">{c.texto}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
