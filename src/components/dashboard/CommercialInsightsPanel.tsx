import { useMemo } from 'react';
import { Sparkles, TrendingUp, AlertTriangle, Target, Lightbulb } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useRepPerformance, useGroupPerformance } from '@/hooks/useRepPerformance';
import { formatCurrency } from '@/utils/formatters';
import { cn } from '@/utils/cn';

type Tone = 'good' | 'risk' | 'info' | 'opp';
const STYLE: Record<Tone, { chip: string; icon: React.ElementType }> = {
  good: { chip: 'bg-emerald-50 text-emerald-600', icon: TrendingUp },
  risk: { chip: 'bg-red-50 text-red-600',         icon: AlertTriangle },
  info: { chip: 'bg-blue-50 text-blue-600',       icon: Target },
  opp:  { chip: 'bg-amber-50 text-amber-600',     icon: Lightbulb },
};

// Insights automáticos derivados da performance de reps + grupos (já escopados).
export default function CommercialInsightsPanel() {
  const { data: reps = [] } = useRepPerformance();
  const { data: grupos = [] } = useGroupPerformance();

  const insights = useMemo(() => {
    const out: { tone: Tone; text: string }[] = [];

    if (grupos.length > 0) {
      const g = grupos[0];
      if (g.pctReceita >= 35) out.push({ tone: 'info', text: `Grupo ${g.grupo} concentra ${g.pctReceita.toFixed(0)}% da receita do período.` });
    }
    if (reps.length > 0) {
      const top = [...reps].sort((a, b) => b.totalVendido - a.totalVendido)[0];
      out.push({ tone: 'good', text: `${top.representante} lidera em receita com ${formatCurrency(top.totalVendido)} (score ${top.score}).` });

      const porAtraso = [...reps].sort((a, b) => (b.clientesAtrasados + b.clientesDormentes) - (a.clientesAtrasados + a.clientesDormentes))[0];
      const totAtr = porAtraso.clientesAtrasados + porAtraso.clientesDormentes;
      if (totAtr > 0) out.push({ tone: 'risk', text: `${porAtraso.representante} tem ${totAtr} cliente(s) em atraso (${porAtraso.clientesDormentes} dormente(s)).` });

      const critico = reps.find(r => r.badge === 'critico');
      if (critico) out.push({ tone: 'risk', text: `${critico.representante} está com performance crítica (score ${critico.score}) — requer atenção.` });
    }
    if (grupos.length > 0) {
      const gAtraso = [...grupos].sort((a, b) => (b.clientesAtrasados + b.clientesDormentes) - (a.clientesAtrasados + a.clientesDormentes))[0];
      const totAtr = gAtraso.clientesAtrasados + gAtraso.clientesDormentes;
      if (totAtr > 0) out.push({ tone: 'opp', text: `Grupo ${gAtraso.grupo} tem ${totAtr} cliente(s) em atraso — oportunidade de reativação.` });
    }
    return out.slice(0, 6);
  }, [reps, grupos]);

  if (insights.length === 0) return null;

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-500" />
          <CardTitle>Inteligência Comercial</CardTitle>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">automático</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {insights.map((ins, i) => {
            const s = STYLE[ins.tone];
            const Icon = s.icon;
            return (
              <div key={i} className="flex items-start gap-2.5 rounded-xl border border-gray-100 p-3">
                <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', s.chip)}><Icon className="w-4 h-4" /></span>
                <p className="text-[13px] text-gray-600 leading-snug">{ins.text}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
