// ─────────────────────────────────────────────────────────────────────────────
// Aviso de recorte: a consulta bateu no teto do Data API (Max rows = 1000) e a
// tela está mostrando um subconjunto — não o total.
//
// Existe porque o contrário é pior: exibir "1.000 pedido(s)" ao lado de KPIs de
// parados e atrasados, como se fosse o quadro inteiro, faz alguém priorizar
// produção com número errado. Enquanto os agregados não vierem prontos do banco
// (Etapa 7), o mínimo é dizer a verdade sobre o que está na tela.
//
// O texto evita prometer o que não sabemos: o teto corta em 1.000, mas o total
// real só é conhecido quando a tela também faz um count exato.
// ─────────────────────────────────────────────────────────────────────────────
import { AlertTriangle } from 'lucide-react';
import { API_MAX_ROWS } from '@/constants/apiLimits';

export default function TruncationNotice({
  /** Total real, quando a tela souber (ex.: vindo de um count exato). */
  total,
  /** O que está sendo listado, no plural: "pedidos", "clientes", "documentos". */
  itens = 'registros',
  /** Recebidos de fato; por padrão, o teto. */
  carregados = API_MAX_ROWS,
}: {
  total?: number;
  itens?: string;
  carregados?: number;
}) {
  const fmt = (n: number) => n.toLocaleString('pt-BR');

  return (
    <div
      role="status"
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3"
    >
      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-amber-900">
          Exibindo apenas {fmt(carregados)}
          {total ? ` de ${fmt(total)} ${itens}` : ` ${itens}`}
        </p>
        <p className="text-xs text-amber-700 mt-0.5">
          O servidor limita cada consulta a {fmt(API_MAX_ROWS)} registros. Os indicadores desta tela
          são calculados sobre os <strong>mais recentes</strong> — os mais antigos ficaram de fora,
          então números de itens parados e atrasados podem estar <strong>subestimados</strong>.
        </p>
      </div>
    </div>
  );
}
