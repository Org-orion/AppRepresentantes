-- ============================================================================
-- 01_migrate_auth_users.sql — Migrar usuários do portal para Supabase Auth
-- ----------------------------------------------------------------------------
-- Objetivo: criar em auth.users (banco NOVO) um registro para cada usuário do
-- banco ANTIGO, PRESERVANDO o id e o hash de senha bcrypt — assim ninguém
-- precisa redefinir senha.
--
-- Por que dá pra reaproveitar o hash:
--   O schema antigo gera senha com crypt(..., gen_salt('bf')) → bcrypt ($2a$...).
--   O GoTrue (Supabase Auth) também usa bcrypt em auth.users.encrypted_password,
--   então o mesmo hash é aceito no login via signInWithPassword.
--
-- ⚠️ RISCO A VALIDAR ANTES DE RODAR EM PRODUÇÃO:
--   1. O schema interno de auth.users/auth.identities VARIA por versão do GoTrue.
--      Confira as colunas no banco novo:  \d auth.users   e   \d auth.identities
--   2. Teste com UM usuário primeiro e valide o login pelo app antes do lote.
--   3. Se o hash não for aceito (formato $2a$ vs $2b$, etc.), use o Plano B no
--      final deste arquivo (forçar reset de senha).
--
-- PRÉ-REQUISITO: schema_v2.sql já aplicado no banco NOVO.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- COMO POPULAR _import_usuarios
-- ----------------------------------------------------------------------------
-- Escolha UMA das vias conforme onde você está rodando:
--
-- ════ VIA 1 — SQL Editor do Supabase (web) — RECOMENDADA p/ poucos usuários ═══
--   Não use \copy/\i nem `create temp table` (a temp some entre execuções).
--
--   1) No banco NOVO — crie a tabela de import (NORMAL, não temp):
--        create table _import_usuarios (
--          id uuid, nome text, email text, senha text,
--          admin boolean, operador boolean, ativo boolean, created_at timestamptz
--        );
--
--   2) No banco ANTIGO — rode a query abaixo; ela GERA o INSERT como texto.
--      Copie o resultado.
--        select 'insert into _import_usuarios (id,nome,email,senha,admin,operador,ativo,created_at) values ' ||
--          string_agg(
--            format('(%L,%L,%L,%L,%L,%L,%L,%L)',
--              id::text, nome, lower(trim(email)), senha,
--              coalesce(admin,false), coalesce(operador,false), coalesce(ativo,true),
--              coalesce(created_at, now())::text),
--            E',\n') || ';'
--        from concremapprep_usuarios;
--      (Se `operador` não existir no banco antigo, troque por: false)
--
--   3) No banco NOVO — cole e execute o INSERT gerado no passo 2.
--   4) No banco NOVO — execute o PASSO C abaixo.
--   5) No banco NOVO — limpeza:  drop table _import_usuarios;
--
-- ════ VIA 2 — psql (terminal) ════════════════════════════════════════════════
--   Use um here-doc para manter a sessão (ver migration/README.md):
--     psql "$NEW_DB" <<'EOF'
--     create temp table _import_usuarios (id uuid, nome text, email text, senha text,
--       admin boolean, operador boolean, ativo boolean, created_at timestamptz);
--     \copy _import_usuarios from 'usuarios_export.csv' with (format csv, header true)
--     \i 01_migrate_auth_users.sql
--     EOF
--   (CSV gerado no antigo com:
--     \copy (select id,nome,lower(trim(email)) email,senha,coalesce(admin,false) admin,
--            coalesce(operador,false) operador,coalesce(ativo,true) ativo,
--            coalesce(created_at,now()) created_at from concremapprep_usuarios)
--      to 'usuarios_export.csv' with (format csv, header true) )

-- ----------------------------------------------------------------------------
-- PASSO C — No banco NOVO: inserir em auth.users + auth.identities + perfil
-- ----------------------------------------------------------------------------
-- ⚠️ EXECUTE O BLOCO INTEIRO DE UMA VEZ (do `begin;` ao `commit;`). NÃO rode só
--    a parte do auth.identities — ela tem FK para auth.users e falha se o passo
--    (1) auth.users não tiver rodado antes (erro identities_user_id_fkey).
-- Pré-requisito: _import_usuarios já carregada.

begin;

-- 1) auth.users — identidade + senha (hash bcrypt reaproveitado)
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,      -- confirma o e-mail para permitir login imediato
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  i.id,
  'authenticated',
  'authenticated',
  i.email,
  i.senha,                 -- hash $2a$ vindo do banco antigo
  coalesce(i.created_at, now()),
  coalesce(i.created_at, now()),
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('nome', i.nome),
  '', '', '', ''
from _import_usuarios i
where i.ativo = true        -- usuários inativos não são migrados para auth (ajuste se quiser migrar todos)
on conflict (id) do nothing;

-- 2) auth.identities — necessário para login por e-mail nas versões recentes do GoTrue
--    (provider_id passou a ser NOT NULL em versões novas; usamos o id como provider_id)
insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  i.id::text,
  i.id,
  jsonb_build_object('sub', i.id::text, 'email', i.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from _import_usuarios i
where i.ativo = true
on conflict do nothing;

-- 3) Perfil do portal (FK = auth.users.id)
insert into concremapprep_usuarios (id, nome, email, admin, operador, ativo, created_at)
select i.id, i.nome, i.email, i.admin, i.operador, i.ativo, coalesce(i.created_at, now())
from _import_usuarios i
where i.ativo = true
on conflict (id) do update
  set nome = excluded.nome,
      admin = excluded.admin,
      operador = excluded.operador,
      ativo = excluded.ativo;

commit;

-- Conferência rápida (contagens devem bater):
--   select count(*) from auth.users;
--   select count(*) from concremapprep_usuarios;
--   select count(*) from auth.identities where provider = 'email';

-- ----------------------------------------------------------------------------
-- PLANO B — Se o hash NÃO for aceito no login
-- ----------------------------------------------------------------------------
-- Em vez de reaproveitar o hash, crie os usuários SEM senha utilizável e force
-- reset. Use a Edge Function de reset ou o painel do Supabase para disparar
-- e-mails de recuperação, ou rode (no banco novo) para marcar reset:
--
--   update auth.users set encrypted_password = ''  -- sem senha válida
--   where id in (select id from _import_usuarios);
--
-- E então peça a cada usuário "Esqueci minha senha" no primeiro acesso.
-- ============================================================================
