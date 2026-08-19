-- ============================================================================
-- CONCREM CONNECT — Schema v2 (banco dedicado, Supabase Auth + RLS)
-- ----------------------------------------------------------------------------
-- Mudança de modelo:
--   ANTES: login via RPC custom, tudo acessado como `anon`, segurança por GRANT.
--   AGORA: Supabase Auth (JWT por usuário), acesso como `authenticated`,
--          segurança por RLS + policies usando auth.uid().
--
-- Ordem de aplicação (ver migration/README.md):
--   1. Este arquivo (estrutura + RLS + policies + grants)
--   2. 01_migrate_auth_users.sql (cria os usuários em auth.users)
--   3. 02 — carga de dados das tabelas do portal
--
-- IMPORTANTE: rode este arquivo ANTES de migrar os dados. As tabelas de perfil
-- têm FK para auth.users, então os usuários precisam existir primeiro (passo 2).
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. TABELAS
-- ============================================================================

-- ─── Perfil do usuário (1:1 com auth.users) ────────────────────────────────
-- A senha NÃO fica mais aqui — vive em auth.users (gerenciada pelo GoTrue).
-- O id é o mesmo de auth.users (FK), mantendo o vínculo de identidade.
create table if not exists concremapprep_usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text not null unique,
  admin       boolean not null default false,
  operador    boolean not null default false,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ─── Representantes ERP cadastrados pelo admin ─────────────────────────────
create table if not exists concremapprep_representantes (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null,
  nome_erp            text not null,
  representante_erp   text not null unique,   -- match exato com concrem_pedidos_venda.representante
  comissao_percentual numeric(5,2) not null default 0,
  ativo               boolean not null default true,
  created_at          timestamptz not null default now()
);

-- ─── Vínculo N:N usuário ↔ representante ────────────────────────────────────
create table if not exists concremapprep_usuario_representantes (
  usuario_id        uuid not null references concremapprep_usuarios(id) on delete cascade,
  representante_id  uuid not null references concremapprep_representantes(id) on delete cascade,
  primary key (usuario_id, representante_id)
);

-- ─── Notificações ───────────────────────────────────────────────────────────
create table if not exists concremapprep_notificacoes (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references concremapprep_usuarios(id) on delete cascade,
  tipo        text not null check (tipo in ('pedido','financeiro','sistema','orcamento','cliente')),
  titulo      text not null,
  mensagem    text not null,
  lida        boolean not null default false,
  link        text,
  created_at  timestamptz not null default now()
);

-- ─── Orçamentos ─────────────────────────────────────────────────────────────
create table if not exists concremapprep_orcamentos (
  id                  uuid primary key default gen_random_uuid(),
  numero              text not null unique,
  usuario_id          uuid not null references concremapprep_usuarios(id),
  representante_erp   text,
  cliente_cnpj        text not null,
  cliente_nome        text not null,
  cliente_fantasia    text,
  obra_referencia     text,
  condicao_pagamento  text,
  validade            date,
  endereco_entrega    text,
  frete_tipo          text,
  frete_valor         numeric(12,2),
  status              text not null default 'rascunho'
                        check (status in ('rascunho','enviado','em_analise','aprovado','rejeitado')),
  observacoes         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─── Itens do orçamento ─────────────────────────────────────────────────────
-- NOTA: produto_id era FK para concremprodutos_produtos (tabela do ERP). Como o
-- banco dedicado NÃO tem as tabelas do ERP (decisão de acesso ao ERP parqueada),
-- produto_id passa a ser uuid simples, SEM foreign key. Reavaliar quando a
-- estratégia de acesso ao ERP for definida.
create table if not exists concremapprep_orcamento_itens (
  id                uuid primary key default gen_random_uuid(),
  orcamento_id      uuid not null references concremapprep_orcamentos(id) on delete cascade,
  produto_id        uuid,                              -- sem FK (ver nota acima)
  produto_codigo    text not null,
  produto_descricao text not null,
  unidade           text not null default 'UN',
  quantidade        numeric(10,2) not null default 1,
  preco_unitario    numeric(12,2),
  is_adicional      boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ─── Histórico de status de pedidos ────────────────────────────────────────
-- Tabela do portal (sem prefixo concremapprep_, como no schema original).
-- Liga com concrem_pedidos_venda.numero_pedido (ERP). Enquanto o acesso ao ERP
-- está parqueado, esta tabela existe mas não é escopável por representante.
create table if not exists pedidos_status_historico (
  id            uuid primary key default gen_random_uuid(),
  numero_pedido text not null,
  status        text not null
                  check (status in ('aprovado','liberado','mapeamento','ferragem','comercial','producao','faturado','entrega','finalizado')),
  observacao    text,
  responsavel   text,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- 2. FUNÇÕES AUXILIARES (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
-- Usadas dentro das policies. São SECURITY DEFINER para conseguir ler
-- concremapprep_usuarios sem disparar a própria RLS (evita recursão infinita).
-- `set search_path = public` previne ataques de search_path em SECURITY DEFINER.
-- ============================================================================

create or replace function app_is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from concremapprep_usuarios where id = auth.uid()), false);
$$;

create or replace function app_is_operador()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select operador from concremapprep_usuarios where id = auth.uid()), false);
$$;

-- Pode LER o orçamento? dono OU operador OU admin.
create or replace function app_can_read_orcamento(p_orc uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from concremapprep_orcamentos o
    where o.id = p_orc
      and (o.usuario_id = auth.uid() or app_is_operador() or app_is_admin())
  );
$$;

-- Pode EDITAR os itens do orçamento? só o dono e só enquanto rascunho.
create or replace function app_can_edit_orcamento(p_orc uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from concremapprep_orcamentos o
    where o.id = p_orc
      and o.usuario_id = auth.uid()
      and o.status = 'rascunho'
  );
$$;

-- updated_at automático em orçamentos
create or replace function touch_orcamento_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_orc_updated_at on concremapprep_orcamentos;
create trigger trg_orc_updated_at
  before update on concremapprep_orcamentos
  for each row execute function touch_orcamento_updated_at();

-- Trava de privilégio: um não-admin não pode elevar a si mesmo nem mexer em
-- campos sensíveis do próprio perfil (admin/operador/ativo/email).
create or replace function app_guard_usuario_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not app_is_admin() then
    if new.admin    is distinct from old.admin
       or new.operador is distinct from old.operador
       or new.ativo    is distinct from old.ativo
       or new.email    is distinct from old.email then
      raise exception 'Sem permissão para alterar admin/operador/ativo/email';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_usuario on concremapprep_usuarios;
create trigger trg_guard_usuario
  before update on concremapprep_usuarios
  for each row execute function app_guard_usuario_update();

-- Número automático de orçamento por ano: ORC-2026-0001
create or replace function gerar_numero_orcamento()
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ano text := to_char(now(), 'YYYY');
  v_seq int;
begin
  select coalesce(max(cast(split_part(numero, '-', 3) as int)), 0) + 1
  into   v_seq
  from   concremapprep_orcamentos
  where  numero like 'ORC-' || v_ano || '-%';
  return 'ORC-' || v_ano || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- ============================================================================
-- 3. RLS — habilitar em todas as tabelas do portal
-- ============================================================================

alter table concremapprep_usuarios               enable row level security;
alter table concremapprep_representantes          enable row level security;
alter table concremapprep_usuario_representantes  enable row level security;
alter table concremapprep_notificacoes            enable row level security;
alter table concremapprep_orcamentos              enable row level security;
alter table concremapprep_orcamento_itens         enable row level security;
alter table pedidos_status_historico              enable row level security;

-- ============================================================================
-- 4. POLICIES
-- ----------------------------------------------------------------------------
-- Regra geral: nada para `anon`. Tudo escopado para `authenticated` via auth.uid().
-- Criação de usuários e reset de senha por terceiros NÃO têm policy aqui —
-- são feitos por Edge Functions com service_role (que ignora RLS).
-- ============================================================================

-- ─── concremapprep_usuarios ────────────────────────────────────────────────
drop policy if exists usuarios_select on concremapprep_usuarios;
create policy usuarios_select on concremapprep_usuarios
  for select to authenticated
  using (id = auth.uid() or app_is_admin());

-- Update do próprio perfil (campos sensíveis bloqueados pelo trigger guard)
drop policy if exists usuarios_update_self on concremapprep_usuarios;
create policy usuarios_update_self on concremapprep_usuarios
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admin pode atualizar qualquer perfil
drop policy if exists usuarios_update_admin on concremapprep_usuarios;
create policy usuarios_update_admin on concremapprep_usuarios
  for update to authenticated
  using (app_is_admin())
  with check (app_is_admin());

-- ─── concremapprep_representantes ──────────────────────────────────────────
-- Leitura liberada a qualquer autenticado (necessária para selects/dropdowns).
drop policy if exists rep_select on concremapprep_representantes;
create policy rep_select on concremapprep_representantes
  for select to authenticated
  using (true);

drop policy if exists rep_insert on concremapprep_representantes;
create policy rep_insert on concremapprep_representantes
  for insert to authenticated
  with check (app_is_admin());

drop policy if exists rep_update on concremapprep_representantes;
create policy rep_update on concremapprep_representantes
  for update to authenticated
  using (app_is_admin())
  with check (app_is_admin());

drop policy if exists rep_delete on concremapprep_representantes;
create policy rep_delete on concremapprep_representantes
  for delete to authenticated
  using (app_is_admin());

-- ─── concremapprep_usuario_representantes ──────────────────────────────────
drop policy if exists ur_select on concremapprep_usuario_representantes;
create policy ur_select on concremapprep_usuario_representantes
  for select to authenticated
  using (usuario_id = auth.uid() or app_is_admin());

drop policy if exists ur_insert on concremapprep_usuario_representantes;
create policy ur_insert on concremapprep_usuario_representantes
  for insert to authenticated
  with check (app_is_admin());

drop policy if exists ur_delete on concremapprep_usuario_representantes;
create policy ur_delete on concremapprep_usuario_representantes
  for delete to authenticated
  using (app_is_admin());

-- ─── concremapprep_notificacoes ────────────────────────────────────────────
drop policy if exists notif_select on concremapprep_notificacoes;
create policy notif_select on concremapprep_notificacoes
  for select to authenticated
  using (usuario_id = auth.uid() or app_is_admin());

-- Update apenas das próprias notificações (marcar como lida)
drop policy if exists notif_update on concremapprep_notificacoes;
create policy notif_update on concremapprep_notificacoes
  for update to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- Admin pode inserir notificações (criação em massa normalmente via service_role)
drop policy if exists notif_insert on concremapprep_notificacoes;
create policy notif_insert on concremapprep_notificacoes
  for insert to authenticated
  with check (app_is_admin());

-- ─── concremapprep_orcamentos ──────────────────────────────────────────────
drop policy if exists orc_select on concremapprep_orcamentos;
create policy orc_select on concremapprep_orcamentos
  for select to authenticated
  using (usuario_id = auth.uid() or app_is_operador() or app_is_admin());

-- Representante cria os próprios orçamentos
drop policy if exists orc_insert on concremapprep_orcamentos;
create policy orc_insert on concremapprep_orcamentos
  for insert to authenticated
  with check (usuario_id = auth.uid());

-- Dono edita apenas enquanto rascunho
drop policy if exists orc_update_owner on concremapprep_orcamentos;
create policy orc_update_owner on concremapprep_orcamentos
  for update to authenticated
  using (usuario_id = auth.uid() and status = 'rascunho')
  with check (usuario_id = auth.uid());

-- Operador/Admin alteram (transições de status: em_analise, aprovado, rejeitado)
drop policy if exists orc_update_staff on concremapprep_orcamentos;
create policy orc_update_staff on concremapprep_orcamentos
  for update to authenticated
  using (app_is_operador() or app_is_admin())
  with check (app_is_operador() or app_is_admin());

-- Dono exclui apenas rascunho
drop policy if exists orc_delete_owner on concremapprep_orcamentos;
create policy orc_delete_owner on concremapprep_orcamentos
  for delete to authenticated
  using (usuario_id = auth.uid() and status = 'rascunho');

-- ─── concremapprep_orcamento_itens ─────────────────────────────────────────
drop policy if exists orcitem_select on concremapprep_orcamento_itens;
create policy orcitem_select on concremapprep_orcamento_itens
  for select to authenticated
  using (app_can_read_orcamento(orcamento_id));

drop policy if exists orcitem_insert on concremapprep_orcamento_itens;
create policy orcitem_insert on concremapprep_orcamento_itens
  for insert to authenticated
  with check (app_can_edit_orcamento(orcamento_id));

drop policy if exists orcitem_update on concremapprep_orcamento_itens;
create policy orcitem_update on concremapprep_orcamento_itens
  for update to authenticated
  using (app_can_edit_orcamento(orcamento_id))
  with check (app_can_edit_orcamento(orcamento_id));

drop policy if exists orcitem_delete on concremapprep_orcamento_itens;
create policy orcitem_delete on concremapprep_orcamento_itens
  for delete to authenticated
  using (app_can_edit_orcamento(orcamento_id));

-- ─── pedidos_status_historico ──────────────────────────────────────────────
-- ATENÇÃO: não escopável por representante até o acesso ao ERP ser definido
-- (o vínculo é por numero_pedido, que vive nas tabelas do ERP). Por ora:
-- leitura para autenticados; escrita para operador/admin.
drop policy if exists psh_select on pedidos_status_historico;
create policy psh_select on pedidos_status_historico
  for select to authenticated
  using (true);

drop policy if exists psh_insert on pedidos_status_historico;
create policy psh_insert on pedidos_status_historico
  for insert to authenticated
  with check (app_is_operador() or app_is_admin());

-- ============================================================================
-- 5. GRANTS
-- ----------------------------------------------------------------------------
-- No Supabase, RLS só age se a tabela também tiver GRANT para o role. Damos
-- acesso ao role `authenticated` (RLS filtra as linhas) e REVOGAMOS de `anon`.
-- ============================================================================

-- Trancar o anon em tudo do schema public (login agora é via GoTrue, não toca tabela)
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

grant usage on schema public to authenticated;

grant select, update                 on concremapprep_usuarios              to authenticated;
grant select, insert, update, delete on concremapprep_representantes        to authenticated;
grant select, insert, delete         on concremapprep_usuario_representantes to authenticated;
grant select, insert, update         on concremapprep_notificacoes          to authenticated;
grant select, insert, update, delete on concremapprep_orcamentos            to authenticated;
grant select, insert, update, delete on concremapprep_orcamento_itens       to authenticated;
grant select, insert                 on pedidos_status_historico            to authenticated;

-- Funções
grant execute on function app_is_admin()                  to authenticated;
grant execute on function app_is_operador()               to authenticated;
grant execute on function app_can_read_orcamento(uuid)    to authenticated;
grant execute on function app_can_edit_orcamento(uuid)    to authenticated;
grant execute on function gerar_numero_orcamento()        to authenticated;

-- ============================================================================
-- 6. ÍNDICES
-- ============================================================================

create index if not exists idx_orc_usuario        on concremapprep_orcamentos(usuario_id);
create index if not exists idx_orc_status          on concremapprep_orcamentos(status);
create index if not exists idx_orc_cnpj            on concremapprep_orcamentos(cliente_cnpj);
create index if not exists idx_orc_itens           on concremapprep_orcamento_itens(orcamento_id);
create index if not exists idx_usuarios_email      on concremapprep_usuarios(email);
create index if not exists idx_ur_usuario          on concremapprep_usuario_representantes(usuario_id);
create index if not exists idx_ur_representante    on concremapprep_usuario_representantes(representante_id);
create index if not exists idx_rep_erp             on concremapprep_representantes(representante_erp);
create index if not exists idx_notif_usuario       on concremapprep_notificacoes(usuario_id);
create index if not exists idx_ped_historico       on pedidos_status_historico(numero_pedido);
create index if not exists idx_ped_hist_dt         on pedidos_status_historico(created_at desc);

-- ============================================================================
-- FIM — schema_v2.sql
-- Próximo: 01_migrate_auth_users.sql (criar usuários em auth.users)
-- ============================================================================
