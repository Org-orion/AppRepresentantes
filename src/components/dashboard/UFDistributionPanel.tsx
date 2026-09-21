import { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useAcompanhamento } from '@/hooks/useAcompanhamento';
import { formatCurrency } from '@/utils/formatters';
import { periodoRange, type DashboardFiltros } from '@/services/dashboard';

interface UFAgg { uf: string; receita: number; pedidos: number; clientes: number; }

// Distribuição geográfica da receita por UF (Diretor Geral / escopo global),
// respeitando o período selecionado.
export default function UFDistributionPanel({ period }: { period?: DashboardFiltros }) {
  const { data: todos = [], isLoading } = useAcompanhamento();

  const { linhas, total } = useMemo(() => {
    // Filtra os pedidos pelo período (por data de emissão), se houver filtro
    let pedidos = todos;
    if (period) {
      const { ini, fim } = periodoRange(period);
      pedidos = todos.filter(p => { const d = (p.data_emissao || '').slice(0, 10); return d >= ini && d <= fim; });
    }
    const map = new Map<string, UFAgg & { cnpjs: Set<string> }>();
    for (const p of pedidos) {
      const uf = (p.cliente_uf || 'N/D').toUpperCase().trim() || 'N/D';
      const e = map.get(uf) ?? { uf, receita: 0, pedidos: 0, clientes: 0, cnpjs: new Set<string>() };
      e.receita += p.total_pedido_venda || 0;
      e.pedidos += 1;
      if (p.cliente_cnpj) e.cnpjs.add(p.cliente_cnpj);
      map.set(uf, e);
    }
    const linhas: UFAgg[] = [...map.values()]
      .map(e => ({ uf: e.uf, receita: e.receita, pedidos: e.pedidos, clientes: e.cnpjs.size }))
      .sort((a, b) => b.receita - a.receita);
    const total = linhas.reduce((s, l) => s + l.receita, 0);
    return { linhas, total };
  }, [todos, period]);

  const max = Math.max(1, ...linhas.map(l => l.receita));

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-500" />
          <CardTitle>Distribuição por UF</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-gray-400 py-10 text-center">Carregando…</p>
        ) : linhas.length === 0 ? (
          <p className="text-sm text-gray-400 py-10 text-center">Sem pedidos no período.</p>
        ) : (
          <>
            <p className="text-[11px] text-gray-400 mb-3 leading-snug">
              Faturamento por <strong className="text-gray-500">estado do cliente</strong> no período.
              A <span className="text-emerald-600">barra</span> mostra o tamanho em relação ao maior estado;
              o <strong className="text-gray-500">%</strong> é a participação no valor total.
            </p>
            <div className="space-y-2.5">
              {linhas.slice(0, 12).map(l => {
                const share = total > 0 ? (l.receita / total) * 100 : 0;
                return (
                  <div key={l.uf} className="flex items-center gap-2.5">
                    <span className="w-8 flex-shrink-0 text-xs font-bold text-gray-700 text-center">{l.uf}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] text-gray-500 tabular-nums">{l.pedidos} pedidos · {l.clientes} clientes</span>
                        <span className="text-xs font-bold text-emerald-700 tabular-nums">{formatCurrency(l.receita)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500/80 transition-all duration-700" style={{ width: `${(l.receita / max) * 100}%` }} />
                      </div>
                    </div>
                    <div className="w-11 flex-shrink-0 text-right">
                      <p className="text-xs font-bold text-gray-700 tabular-nums leading-none">{share.toFixed(0)}%</p>
                      <p className="text-[9px] text-gray-400 leading-tight">do total</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {linhas.length > 12 && <p className="text-[10px] text-gray-400 pt-2">+{linhas.length - 12} outras UFs (somadas no total)</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
