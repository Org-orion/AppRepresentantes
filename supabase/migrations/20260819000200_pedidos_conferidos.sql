-- ============================================================================
-- 20260819000200 — Marcação de "conferido" da Central Financeira
-- ----------------------------------------------------------------------------
-- Etapa 7.3 do docs/PLANO-SANEAMENTO.md · decisão D4.
--
-- Por que existe: hoje a marcação vive em localStorage na chave `fin_conferidos`,
-- SEM identificação de usuário. Numa máquina compartilhada, o próximo
-- representante que logar enxerga os pedidos marcados pelo anterior — e, desde
-- que a sessão passou a morrer ao fechar a aba, o dado local sobrevive à sessão.
-- Também não sincroniza entre dispositivos: marcar no computador não aparece no
-- celular.
--
-- Modelagem (aprovada): a marcação é POR USUÁRIO, não por empresa. Cada um marca
-- o que conferiu. Se um dia a regra virar "conferido pela empresa", isto muda de
-- forma — não é ajuste de policy.
--
-- Rollback: drop table if exists concremapprep_pedidos_conferidos;
--           (a partir do momento em que houver marcações reais, exportar antes)
-- ============================================================================

create table if not exists concremapprep_pedidos_conferidos (
  usuario_id    uuid        not null references auth.users(id) on delete cascade,
  numero_pedido text        not null,
  conferido_em  timestamptz not null default now(),
  primary key (usuario_id, numero_pedido)
);

comment on table concremapprep_pedidos_conferidos is
  'Pedidos que o usuário marcou como conferidos na Central Financeira. Marcação pessoal, não da empresa.';

-- PK composta: marcar duas vezes não duplica; desmarcar é DELETE.
-- O índice da PK já cobre a consulta "meus conferidos", que é a única do app.

alter table concremapprep_pedidos_conferidos enable row level security;

-- Cada um só enxerga e só escreve as PRÓPRIAS marcações. O `with check` impede
-- gravar em nome de outro usuário — sem ele, a policy protegeria a leitura e
-- deixaria a escrita aberta.
drop policy if exists conferidos_proprios on concremapprep_pedidos_conferidos;
create policy conferidos_proprios on concremapprep_pedidos_conferidos
  for all
  to authenticated
  using      (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- Sem UPDATE de propósito: a operação é marcar ou desmarcar.
grant select, insert, delete on concremapprep_pedidos_conferidos to authenticated;

-- Validação (exige DOIS usuários autenticados — não vale testar como postgres,
-- que ignora RLS):
--   usuário A: insert into concremapprep_pedidos_conferidos (usuario_id, numero_pedido)
--              values (auth.uid(), '173793');
--   usuário B: select * from concremapprep_pedidos_conferidos;  -- NÃO deve ver a linha de A
--   usuário B: insert ... values ('<id-do-A>', 'x');            -- deve ser RECUSADO
