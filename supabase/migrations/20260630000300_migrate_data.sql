-- ============================================================================
-- 02_migrate_data_sqleditor.sql — Migrar DADOS do portal pelo SQL Editor (web)
-- ----------------------------------------------------------------------------
-- Sem pg_dump: para cada tabela, rode o gerador no banco ANTIGO, copie o texto
-- do resultado (um comando INSERT completo) e execute no banco NOVO.
--
-- ORDEM OBRIGATÓRIA (por causa das foreign keys):
--   1. representantes
--   2. usuario_representantes   (FK -> usuarios + representantes)
--   3. notificacoes             (FK -> usuarios)
--   4. orcamentos               (FK -> usuarios)
--   5. orcamento_itens          (FK -> orcamentos)
--   6. pedidos_status_historico (sem FK)
--
-- usuarios JÁ foi migrada (01_migrate_auth_users.sql) — NÃO migrar de novo.
--
-- Observações:
-- - Os filtros `where ... in (select id from concremapprep_usuarios where ativo)`
--   garantem que só entram dados de usuários que existem no banco novo (ativos),
--   evitando erro de foreign key.
-- - Se o resultado de um gerador vier VAZIO/NULL, a tabela não tem linhas
--   (ou não existe) — pule.
-- - Se o resultado for muito grande e o editor truncar, me avise que a gente
--   gera em lotes (com `limit/offset` ou por faixa de data).
-- ============================================================================


-- ─── 1. representantes ─── (rodar no ANTIGO → colar no NOVO) ────────────────
select 'insert into concremapprep_representantes (id,codigo,nome_erp,representante_erp,comissao_percentual,ativo,created_at) values ' ||
  string_agg(format('(%L,%L,%L,%L,%L,%L,%L)',
    id::text, codigo, nome_erp, representante_erp, comissao_percentual, ativo, created_at::text), E',\n')
  || E'\non conflict (id) do nothing;'
from concremapprep_representantes;


-- ─── 2. usuario_representantes ─── (rodar no ANTIGO → colar no NOVO) ────────
select 'insert into concremapprep_usuario_representantes (usuario_id,representante_id) values ' ||
  string_agg(format('(%L,%L)', usuario_id::text, representante_id::text), E',\n')
  || E'\non conflict do nothing;'
from concremapprep_usuario_representantes
where usuario_id in (select id from concremapprep_usuarios where ativo = true);


-- ─── 3. notificacoes ─── (rodar no ANTIGO → colar no NOVO) ──────────────────
select 'insert into concremapprep_notificacoes (id,usuario_id,tipo,titulo,mensagem,lida,link,created_at) values ' ||
  string_agg(format('(%L,%L,%L,%L,%L,%L,%L,%L)',
    id::text, usuario_id::text, tipo, titulo, mensagem, lida, link, created_at::text), E',\n')
  || E'\non conflict (id) do nothing;'
from concremapprep_notificacoes
where usuario_id in (select id from concremapprep_usuarios where ativo = true);


-- ─── 4. orcamentos ─── (rodar no ANTIGO → colar no NOVO) ────────────────────
select 'insert into concremapprep_orcamentos (id,numero,usuario_id,representante_erp,cliente_cnpj,cliente_nome,cliente_fantasia,obra_referencia,condicao_pagamento,validade,endereco_entrega,frete_tipo,frete_valor,status,observacoes,created_at,updated_at) values ' ||
  string_agg(format('(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
    id::text, numero, usuario_id::text, representante_erp, cliente_cnpj, cliente_nome, cliente_fantasia,
    obra_referencia, condicao_pagamento, validade::text, endereco_entrega, frete_tipo, frete_valor,
    status, observacoes, created_at::text, updated_at::text), E',\n')
  || E'\non conflict (id) do nothing;'
from concremapprep_orcamentos
where usuario_id in (select id from concremapprep_usuarios where ativo = true);


-- ─── 5. orcamento_itens ─── (rodar no ANTIGO → colar no NOVO) ───────────────
select 'insert into concremapprep_orcamento_itens (id,orcamento_id,produto_id,produto_codigo,produto_descricao,unidade,quantidade,preco_unitario,is_adicional,created_at) values ' ||
  string_agg(format('(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
    id::text, orcamento_id::text, produto_id::text, produto_codigo, produto_descricao, unidade,
    quantidade, preco_unitario, is_adicional, created_at::text), E',\n')
  || E'\non conflict (id) do nothing;'
from concremapprep_orcamento_itens
where orcamento_id in (
  select id from concremapprep_orcamentos
  where usuario_id in (select id from concremapprep_usuarios where ativo = true)
);


-- ─── 6. pedidos_status_historico ─── (rodar no ANTIGO → colar no NOVO) ──────
-- (Se a tabela não existir no banco antigo ou estiver vazia, o resultado vem
--  NULL — pule este passo.)
select 'insert into pedidos_status_historico (id,numero_pedido,status,observacao,responsavel,created_at) values ' ||
  string_agg(format('(%L,%L,%L,%L,%L,%L)',
    id::text, numero_pedido, status, observacao, responsavel, created_at::text), E',\n')
  || E'\non conflict (id) do nothing;'
from pedidos_status_historico;


-- ============================================================================
-- CONFERÊNCIA — rodar no banco NOVO (comparar com as contagens do antigo)
-- ============================================================================
-- select 'representantes' t, count(*) from concremapprep_representantes
-- union all select 'usuario_representantes', count(*) from concremapprep_usuario_representantes
-- union all select 'notificacoes', count(*) from concremapprep_notificacoes
-- union all select 'orcamentos', count(*) from concremapprep_orcamentos
-- union all select 'orcamento_itens', count(*) from concremapprep_orcamento_itens
-- union all select 'pedidos_status_historico', count(*) from pedidos_status_historico;
-- ============================================================================
