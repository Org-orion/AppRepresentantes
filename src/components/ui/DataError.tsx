// ─────────────────────────────────────────────────────────────────────────────
// Estado de erro padrão das telas que dependem de dados do ERP.
//
// Por que existe: antes, quando a consulta falhava, as telas caíam no estado
// vazio e diziam "Nenhum pedido encontrado". O representante não tinha como
// distinguir "não há registros" de "o sistema está fora" — foi assim que o
// incidente INC-2026-08-19-FDW passou dias sem ser reportado.
//
// A mensagem diz explicitamente que não é ausência de dados, e oferece uma ação.
// O detalhe técnico do erro NÃO vai para a tela: nome de servidor, usuário de
// banco e motivo de falha de autenticação não são assunto do usuário final.
// ─────────────────────────────────────────────────────────────────────────────
import { ErrorCard } from '@/components/ui/cards';

export default function DataError({
  recurso,
  onRetry,
}: {
  /** O que não carregou, em minúsculas: "os pedidos", "a carteira de clientes". */
  recurso: string;
  onRetry?: () => void;
}) {
  return (
    <ErrorCard
      title={`Não foi possível carregar ${recurso}`}
      description="A consulta ao banco falhou — isto não significa que não existam registros. Tente novamente; se o erro persistir, avise o suporte."
      onRetry={onRetry}
    />
  );
}
