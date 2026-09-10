-- ============================================================================
-- Restaura a policy de DELETE de concremapprep_representantes
-- ============================================================================
-- Sintoma: admin clica em "Excluir" na tela Representantes ERP, o modal fecha,
-- nenhum erro aparece e o representante continua na lista.
--
-- Causa: a tabela tem RLS habilitada e as policies rep_select / rep_insert /
-- rep_update, mas a rep_delete criada em 20260630000100_schema_v2.sql NAO esta
-- presente no banco (verificado em pg_policy: nenhuma linha com polcmd = 'd').
-- Sem policy de DELETE, o Postgres nao recusa com erro -- ele nao enxerga linha
-- alguma para apagar, e o PostgREST devolve 204 com zero linhas afetadas.
--
-- Esta migration apenas recria a policy exatamente como o schema versionado
-- define. Nao amplia permissao: continua restrita a app_is_admin().
-- ============================================================================

drop policy if exists rep_delete on public.concremapprep_representantes;
create policy rep_delete on public.concremapprep_representantes
  for delete to authenticated
  using (app_is_admin());
