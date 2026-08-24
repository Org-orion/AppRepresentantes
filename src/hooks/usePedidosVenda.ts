import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { fetchPedidosVenda, fetchPedidosCompleto, fetchRepresentantesUnicos, fetchSituacoesEntrega, type FetchPedidosParams } from '@/services/pedidosVenda';
import { useDataScope } from '@/hooks/useDataScope';

export function usePedidosVenda(params: Omit<FetchPedidosParams, 'repCodes' | 'admin' | 'grupos'> = {}) {
  const { user } = useAuth();
  const { admin, repCodes, grupos, scopeKey } = useDataScope();

  return useQuery({
    queryKey: ['pedidos-venda', { ...params, scopeKey }],
    queryFn: () => fetchPedidosVenda({ ...params, repCodes, admin, grupos }),
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });
}

/** Conjunto filtrado completo (até CENTRAL_CAP) para a Central de Pedidos. */
export function usePedidosCompleto(params: Omit<FetchPedidosParams, 'repCodes' | 'admin' | 'grupos' | 'page'> = {}) {
  const { user } = useAuth();
  const { admin, repCodes, grupos, scopeKey } = useDataScope();

  return useQuery({
    queryKey: ['pedidos-completo', { ...params, scopeKey }],
    queryFn: () => fetchPedidosCompleto({ ...params, repCodes, admin, grupos }),
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });
}

// As duas listas abaixo saem da view `concrem_pedidos_venda`, que aplica RLS —
// ou seja, o CONTEÚDO depende de quem está logado: um representante vê só os
// próprios códigos, um diretor vê o escopo dele, um admin vê todos.
//
// Por isso `scopeKey` entra na chave. Sem ele, trocar de usuário na mesma aba
// (a sessão vive em sessionStorage, então logout + login não recarrega a página)
// reaproveitava a lista do usuário anterior enquanto o cache estivesse quente —
// e o filtro de Pedidos, que não tem guarda de perfil, exibiria nomes que aquele
// usuário não deveria ver. Não era falha de acesso a dado (a RLS segue valendo),
// mas era exibição indevida. Achado A19.
//
// É o mesmo padrão dos demais hooks: ['dashboard-stats', scopeKey, …],
// ['carteira', { scopeKey, rep }], ['acompanhamento', { scopeKey }].

export function useRepresentantesUnicos() {
  const { user } = useAuth();
  const { scopeKey } = useDataScope();
  return useQuery({
    queryKey: ['representantes-unicos', scopeKey],
    queryFn: fetchRepresentantesUnicos,
    enabled: !!user,
    staleTime: 1000 * 60 * 30,
  });
}

export function useSituacoesEntrega() {
  const { user } = useAuth();
  const { scopeKey } = useDataScope();
  return useQuery({
    queryKey: ['situacoes-entrega', scopeKey],
    queryFn: fetchSituacoesEntrega,
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });
}
