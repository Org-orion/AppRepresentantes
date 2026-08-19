-- ============================================================================
-- 20260819000100 — Coluna `telefone` em concremapprep_usuarios
-- ----------------------------------------------------------------------------
-- Etapa 7.2 do docs/PLANO-SANEAMENTO.md.
--
-- Por que existe: a tela Meu Perfil grava telefone desde sempre, mas a coluna
-- nunca teve migration. A instrução vivia num COMENTÁRIO no topo de
-- PerfilPage.tsx, e a tela tratava a ausência da coluna com uma mensagem de erro
-- pedindo ao usuário que "rodasse o ALTER TABLE indicado no topo do arquivo".
--
-- Aditiva, idempotente e sem backfill: `add column` sem default não reescreve a
-- tabela, então não há lock relevante. Segura mesmo que a coluna já tenha sido
-- criada à mão em produção — que é justamente o que não se sabe.
--
-- Rollback: alter table concremapprep_usuarios drop column if exists telefone;
--           (só se a coluna NÃO existia antes — confirmar na validação)
-- ============================================================================

alter table concremapprep_usuarios
  add column if not exists telefone text;

comment on column concremapprep_usuarios.telefone is
  'Telefone de contato, editável pelo próprio usuário em Meu Perfil.';

-- Validação:
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'concremapprep_usuarios' and column_name = 'telefone';
