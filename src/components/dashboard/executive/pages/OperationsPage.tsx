import { useMemo } from 'react';
import { FileText, FileWarning, FileCheck2, ClipboardList } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import DirectorFilterBar from '@/components/dashboard/DirectorFilterBar';
import PipelineGargalos from '@/components/dashboard/PipelineGargalos';
import { useAcompanhamento } from '@/hooks/useAcompanhamento';
import { useOrcamentos } from '@/hooks/useOrcamentos';
import { useDirectorFilters, applyPedidoFilters } from '@/components/dashboard/DirectorFilters';
import { FATURADO_ALEM, classifyAnexo } from '@/utils/pipeline';
import { periodoRange } from '@/services/dashboard';
import type { ExecutivePeriod } from '@/hooks/useExecutiveSummary';
import { cn } from '@/utils/cn';

const DAY = 86_400_000;
const diasDesde = (iso?: string | null) => {
  if (!iso) return 9999;
  const s = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? Math.floor((Date.now() - new Date(`${s}T12:00:00`).getTime()) / DAY) : 9999;
};

function Stat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 flex items-center gap-2.5 min-w-0">
      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', tone)}><Icon className="w-4 h-4" /></span>
      <div className="min-w-0">
        <p className="text-lg font-bold text-gray-900 tabular-nums leading-none">{value}</p>
        <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function DocumentosPanel({ period }: { period: ExecutivePeriod }) {
  const { data: all = [] } = useAcompanhamento();
  const { filters } = useDirectorFilters();
  const pedidos = useMemo(() => {
    const scoped = applyPedidoFilters(all, filters, { ignoreStatus: true });
    const { ini, fim } = periodoRange(period);
    return scoped.filter(p => { const d = (p.data_emissao || '').slice(0, 10); return d >= ini && d <= fim; });
  }, [all, filters, period]);

  const { semNF, semBoleto, completos, pendentes } = useMemo(() => {
    let semNF = 0, semBoleto = 0, completos = 0;
    for (const p of pedidos) {
      if (!FATURADO_ALEM.has(p.status)) continue;
      const anexos = p.anexos ?? [];
      const nf = anexos.some(a => classifyAnexo(a.tipo) === 'nf');
      const bol = anexos.some(a => classifyAnexo(a.tipo) === 'boleto');
      if (!nf) semNF++;
      if (!bol) semBoleto++;
      if (nf && bol) completos++;
    }
    return { semNF, semBoleto, completos, pendentes: semNF + semBoleto };
  }, [pedidos]);

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-emerald-500" /><CardTitle>Documentos (faturados+)</CardTitle></div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={FileWarning} label="Sem NF" value={semNF} tone="bg-red-50 text-red-500" />
          <Stat icon={FileWarning} label="Sem boleto" value={semBoleto} tone="bg-amber-50 text-amber-500" />
          <Stat icon={ClipboardList} label="Pendentes (total)" value={pendentes} tone="bg-orange-50 text-orange-500" />
          <Stat icon={FileCheck2} label="Completos" value={completos} tone="bg-emerald-50 text-emerald-600" />
        </div>
      </CardContent>
    </Card>
  );
}

function OrcamentosPanel({ period }: { period: ExecutivePeriod }) {
  const { data: allOrcs = [] } = useOrcamentos();
  const c = useMemo(() => {
    const { ini, fim } = periodoRange(period);
    const orcs = allOrcs.filter(o => { const d = (o.created_at || '').slice(0, 10); return d >= ini && d <= fim; });
    const criados = orcs.length; let aprovados = 0, rejeitados = 0, analise = 0, parados = 0;
    for (const o of orcs) {
      if (o.status === 'aprovado') aprovados++;
      else if (o.status === 'rejeitado') rejeitados++;
      else if (o.status === 'enviado' || o.status === 'em_analise') {
        analise++;
        if (diasDesde(o.created_at) > 30) parados++;
      }
    }
    return { criados, aprovados, rejeitados, analise, parados };
  }, [allOrcs, period]);

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2"><ClipboardList className="w-4 h-4 text-emerald-500" /><CardTitle>Orçamentos</CardTitle></div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={ClipboardList} label="Criados" value={c.criados} tone="bg-indigo-50 text-indigo-600" />
          <Stat icon={FileCheck2} label="Aprovados" value={c.aprovados} tone="bg-emerald-50 text-emerald-600" />
          <Stat icon={FileText} label="Em análise" value={c.analise} tone="bg-blue-50 text-blue-600" />
          <Stat icon={FileWarning} label="Parados +30d" value={c.parados} tone="bg-red-50 text-red-500" />
        </div>
      </CardContent>
    </Card>
  );
}

// Página 4 — Operação: "Onde a operação está travando?"
export default function OperationsPage({ period }: { period: ExecutivePeriod }) {
  return (
    <>
      <DirectorFilterBar />
      <PipelineGargalos period={period} />
      <div className="grid gap-3 lg:grid-cols-2">
        <DocumentosPanel period={period} />
        <OrcamentosPanel period={period} />
      </div>
    </>
  );
}
