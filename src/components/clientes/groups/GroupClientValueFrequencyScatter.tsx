import { Sparkles } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrencyK, formatDate } from '@/utils/formatters';
import { MOV_META } from '@/pages/ClientesPage';
import { STATUS_COLOR, type ClientStat } from '@/hooks/useGroupClientVisualAnalytics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload as ClientStat;
  const meta = MOV_META[s.status];
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-lg px-3 py-2 max-w-[240px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[13px] font-semibold text-gray-900 truncate">{s.nome}</span>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${meta.chip}`}>{meta.label}</span>
      </div>
      <div className="text-[11px] text-gray-500 space-y-0.5 tabular-nums">
        <p>Valor total: <b className="text-gray-800">{formatCurrencyK(s.total)}</b> · {s.pct.toFixed(0)}% do grupo</p>
        <p>Média/pedido: <b className="text-gray-800">{formatCurrencyK(s.ticket)}</b> · {s.pedidos} pedidos</p>
        <p>Compra a cada <b className="text-gray-800">{s.intervalo} dias</b></p>
        {s.ultimo && <p>Última compra: {formatDate(s.ultimo)}</p>}
      </div>
    </div>
  );
}

// Gráfico H — Matriz estratégica: valor total (Y) × frequência (X) × média/pedido (tamanho) × status (cor).
export default function GroupClientValueFrequencyScatter({ data, onOpen }: { data: ClientStat[]; onOpen?: (s: ClientStat) => void }) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-4 min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Matriz estratégica dos clientes</p>
      <p className="text-[11px] text-gray-400 mb-2 mt-0.5">Valor × frequência · tamanho = média por pedido · cor = status. Bolhas grandes no alto-esquerda = clientes-chave.</p>
      {data.length === 0 ? (
        <p className="text-xs text-gray-400 py-10 text-center">Sem clientes com histórico suficiente (2+ compras).</p>
      ) : (
        <div className="h-[300px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2ee" />
              <XAxis type="number" dataKey="intervalo" name="Intervalo" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }}
                label={{ value: 'dias entre compras  (← mais frequente)', position: 'insideBottom', offset: -12, fontSize: 10, fill: '#9ca3af' }} />
              <YAxis type="number" dataKey="total" name="Valor" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={(v) => formatCurrencyK(Number(v))} width={54} />
              <ZAxis type="number" dataKey="ticket" range={[50, 420]} name="Média/pedido" />
              <Tooltip content={<Tip />} cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={data} fillOpacity={0.72} onClick={(p: { payload?: ClientStat }) => p?.payload && onOpen?.(p.payload)} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
                {data.map(s => <Cell key={s.cnpj} fill={STATUS_COLOR[s.status]} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
