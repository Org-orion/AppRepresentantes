import { cn } from '@/utils/cn';

// ─────────────────────────────────────────────────────────────────────────────
// Valor numérico que encolhe para caber na largura do próprio card.
//
// Existe porque a interface deixou de abreviar valores: onde antes aparecia
// "R$ 24,3M" agora aparece "R$ 24.312.480,00". Os cards de KPI têm largura fixa
// em grade, então um valor longo estouraria o card — e `truncate` seria pior
// ainda, porque cortaria justamente o número ("R$ 24.312…").
//
// A fonte é calculada em `cqi` (1% da largura do container), dividida pelo
// número de caracteres: quanto mais longo o valor, menor a fonte, até o piso.
// O `clamp` garante que valor curto NÃO cresça além do tamanho de origem e que
// valor muito longo não fique ilegível.
//
// O fator 1.6 vem da largura do dígito tabular (~0.6em): para N caracteres
// caberem em 100cqi, cada um pode ocupar 100cqi/N, logo a fonte pode ser
// (100cqi/N)/0.6 ≈ 1.6 × 100cqi/N. Fica uma folga pequena de propósito, porque
// "R$", pontos e vírgula são mais estreitos que um dígito.
// ─────────────────────────────────────────────────────────────────────────────

export default function ValorAjustavel({
  valor,
  className,
  max = '1.125rem',
  min = '0.6875rem',
  title,
}: {
  valor: string;
  /** Classes do texto (peso, cor). O tamanho é calculado — não passe text-*. */
  className?: string;
  /** Tamanho máximo: o que o card usava antes. */
  max?: string;
  /** Piso de legibilidade. */
  min?: string;
  title?: string;
}) {
  const chars = Math.max(valor.length, 1);
  return (
    <div className="min-w-0" style={{ containerType: 'inline-size' }}>
      <p
        className={cn('tabular-nums whitespace-nowrap leading-tight', className)}
        style={{ fontSize: `clamp(${min}, calc(100cqi / ${chars} * 1.6), ${max})` }}
        title={title ?? valor}
      >
        {valor}
      </p>
    </div>
  );
}
