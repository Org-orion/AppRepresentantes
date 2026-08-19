-- ============================================================================
-- Perfis Diretor / Diretor Geral + Grupos de Cliente (escopo por grupo_cliente)
-- Concrem Connect — aplicar no Supabase (SQL Editor). Idempotente onde possível.
--
-- Decisões: grupo_cliente vive em concrem_pedidos_venda; perfil é coluna única
-- em concremapprep_usuarios; enforcement por RLS no banco.
-- ============================================================================

-- 1) PERFIL (coluna única) ----------------------------------------------------
alter table concremapprep_usuarios add column if not exists perfil text;

-- Backfill a partir dos flags atuais (não quebra usuários existentes)
update concremapprep_usuarios
set perfil = case when admin then 'admin'
                  when operador then 'operador'
                  else 'representante' end
where perfil is null;

alter table concremapprep_usuarios drop constraint if exists usuarios_perfil_chk;
alter table concremapprep_usuarios add constraint usuarios_perfil_chk
  check (perfil in ('representante','operador','admin','diretor','diretor_geral'));

-- 2) GRUPOS DE CLIENTE --------------------------------------------------------
create table if not exists client_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  normalized_name text generated always as (upper(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into client_groups (name) values
  ('LEROY MERLIN'), ('ENGENHARIA'), ('DISTRIBUIDORA CONCREM'), ('REVENDA'),
  ('OUTROS'), ('ENGENHARIA JANDERSON'), ('DAG COMERCIO'), ('SEM GRUPO'),
  ('SIGNATURE'), ('ENGENHARIA KRIZIA')
on conflict (name) do nothing;

-- 3) VÍNCULO DIRETOR ↔ GRUPO (N:N) -------------------------------------------
create table if not exists user_client_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references concremapprep_usuarios(id) on delete cascade,
  client_group_id uuid not null references client_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, client_group_id)
);
create index if not exists idx_ucg_user on user_client_groups(user_id);

-- 4) FUNÇÕES DE ESCOPO (SECURITY DEFINER) ------------------------------------
create or replace function app_perfil()
returns text language sql stable security definer set search_path = public as $$
  select perfil from concremapprep_usuarios where id = auth.uid()
$$;

-- Normaliza grupo (null/vazio -> 'SEM GRUPO')
create or replace function app_norm_grupo(g text)
returns text language sql immutable as $$
  select coalesce(nullif(btrim(g), ''), 'SEM GRUPO')
$$;

-- true se o pedido está num grupo vinculado ao diretor logado
create or replace function app_diretor_ve_grupo(g text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from user_client_groups ucg
    join client_groups cg on cg.id = ucg.client_group_id
    where ucg.user_id = auth.uid()
      and cg.normalized_name = upper(app_norm_grupo(g))
  )
$$;

-- 5) RLS DAS TABELAS DE GRUPO -------------------------------------------------
alter table client_groups enable row level security;
drop policy if exists cg_read on client_groups;
create policy cg_read on client_groups for select using (true);
-- escrita (criar/renomear/ativar grupo pela tela de gestão): só admin/diretor geral
drop policy if exists cg_admin_write on client_groups;
create policy cg_admin_write on client_groups for all
  using (app_perfil() in ('admin','diretor_geral'))
  with check (app_perfil() in ('admin','diretor_geral'));

alter table user_client_groups enable row level security;
drop policy if exists ucg_self on user_client_groups;
create policy ucg_self on user_client_groups for select
  using (user_id = auth.uid() or app_perfil() in ('admin','diretor_geral'));
drop policy if exists ucg_admin_write on user_client_groups;
create policy ucg_admin_write on user_client_groups for all
  using (app_perfil() in ('admin','diretor_geral'))
  with check (app_perfil() in ('admin','diretor_geral'));

-- 6) VIEWS SEGURAS — escopo de DIRETOR / DIRETOR GERAL ------------------------
-- concrem_pedidos_venda (e afins) são VIEWS sobre erp.* que já filtram por
-- app_is_admin() OR representante IN app_my_rep_codes(). Estendemos o WHERE para:
--   diretor_geral → tudo (como admin)
--   diretor       → só pedidos cujo grupo_cliente está nos grupos vinculados
-- NÃO usar security_invoker: estas views precisam rodar como definer p/ ler erp.*.
-- create or replace preserva dono/permissões. Colunas mantidas idênticas.

create or replace view public.concrem_pedidos_venda as
  select id, numero_pedido, id_nota_conf, ped_compra_cliente, data_emissao,
    data_validade, previsao_embarque, cliente_codigo, cliente_nome, cliente_cnpj,
    cliente_fantasia, cliente_cidade, cliente_uf, cliente_cep, cliente_endereco,
    cliente_bairro, cliente_telefone, cliente_email, cliente_inscest, cliente_estab,
    representante, dados_tabela, frete, desconto, total_qtd, total_qtd_m3,
    total_produtos, total_pedido_venda, created_at, updated_at, peso_liquido_item,
    grupo_cliente, situacao_entrega
  from erp.concrem_pedidos_venda v
  where app_is_admin()
     or app_perfil() = 'diretor_geral'
     or (app_perfil() = 'diretor' and app_diretor_ve_grupo(grupo_cliente))
     or (representante in ( select app_my_rep_codes() ));

create or replace view public.concrem_pedidos_status as
  select id, pedido_id, numero_pedido, status_atual, atualizado_em, atualizado_por,
    criado_em, mes_programacao, data_embarque_programacao
  from erp.concrem_pedidos_status s
  where app_is_admin()
     or app_perfil() = 'diretor_geral'
     or (numero_pedido in ( select v.numero_pedido from erp.concrem_pedidos_venda v
          where v.representante in ( select app_my_rep_codes() ) ))
     or (app_perfil() = 'diretor' and numero_pedido in ( select v.numero_pedido
          from erp.concrem_pedidos_venda v where app_diretor_ve_grupo(v.grupo_cliente) ));

create or replace view public.concrem_pedidos_status_historico as
  select id, pedido_id, numero_pedido, status_anterior, status_novo, alterado_em,
    alterado_por, observacao, notificado_representante, notificado_em,
    notificacao_provider_id, notificacao_erro
  from erp.concrem_pedidos_status_historico h
  where app_is_admin()
     or app_perfil() = 'diretor_geral'
     or (numero_pedido in ( select v.numero_pedido from erp.concrem_pedidos_venda v
          where v.representante in ( select app_my_rep_codes() ) ))
     or (app_perfil() = 'diretor' and numero_pedido in ( select v.numero_pedido
          from erp.concrem_pedidos_venda v where app_diretor_ve_grupo(v.grupo_cliente) ));

create or replace view public.relatorio_entrega_anexos as
  select id, carregamento_id, pedido_id, tipo, arquivo_nome, arquivo_url,
    criado_em, criado_por
  from erp.concrem_relatorio_entrega_anexos a
  where app_is_admin()
     or app_perfil() = 'diretor_geral'
     or (pedido_id in ( select v.numero_pedido from erp.concrem_pedidos_venda v
          where v.representante in ( select app_my_rep_codes() ) ))
     or (app_perfil() = 'diretor' and pedido_id in ( select v.numero_pedido
          from erp.concrem_pedidos_venda v where app_diretor_ve_grupo(v.grupo_cliente) ));

-- concremprodutos_produtos: catálogo global (sem escopo por usuário) — inalterada.
-- ============================================================================
