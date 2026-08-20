-- ============================================================================
-- Testes de isolamento do escopo — S1 a S10 (etapa E1)
-- ----------------------------------------------------------------------------
-- Somente leitura. Cada bloco roda em transação e faz ROLLBACK: nada persiste.
--
-- COMO A IMPERSONAÇÃO FUNCIONA
-- `auth.uid()` lê a claim `sub` de `request.jwt.claims`, que é estado de SESSÃO.
-- Definindo essa claim com `set local`, a função enxerga o usuário escolhido —
-- sem precisar do login dele, sem senha, sem token e sem tocar em `auth.users`.
--
-- Rode como `postgres` no SQL Editor.
-- Nenhum UUID está preenchido: o PASSO 0 abaixo localiza cada um no seu banco.
-- ============================================================================


-- ############################################################################
-- PASSO 0 — Localizar os usuários de teste (somente leitura)
-- ############################################################################

-- 0.1 — Panorama: todos os usuários com contagem de vínculos.
--       Use esta visão para escolher os UUIDs de todos os cenários.
select u.id, u.nome, u.email, u.perfil, u.admin, u.operador, u.ativo,
       (select count(*) from public.concremapprep_usuario_representantes ur
         where ur.usuario_id = u.id)                                  as qtd_representantes,
       (select count(*) from public.user_client_groups g
         where g.user_id = u.id)                                      as qtd_grupos
from public.concremapprep_usuarios u
order by u.perfil nulls first, u.email;


-- 0.2 — REPRESENTANTE A e REPRESENTANTE B
--       Precisa de DOIS representantes ativos, cada um com vínculo próprio.
select u.id, u.nome, u.email,
       array(select r.representante_erp
               from public.concremapprep_usuario_representantes ur
               join public.concremapprep_representantes r on r.id = ur.representante_id
              where ur.usuario_id = u.id) as codigos
from public.concremapprep_usuarios u
where coalesce(nullif(btrim(u.perfil),''), 'representante') = 'representante'
  and u.ativo is true
  and exists (select 1 from public.concremapprep_usuario_representantes ur
               where ur.usuario_id = u.id)
order by u.email;
-- Escolha dois com `codigos` DIFERENTES → <UUID_REP_A> e <UUID_REP_B>.


-- 0.3 — DIRETOR (com grupos vinculados)
select u.id, u.nome, u.email,
       array(select cg.normalized_name
               from public.user_client_groups ucg
               join public.client_groups cg on cg.id = ucg.client_group_id
              where ucg.user_id = u.id and cg.is_active is true) as grupos
from public.concremapprep_usuarios u
where u.perfil = 'diretor' and u.ativo is true
order by u.email;
-- → <UUID_DIRETOR>


-- 0.4 — DIRETOR GERAL e ADMIN
select u.id, u.nome, u.email, u.perfil, u.admin, u.ativo
from public.concremapprep_usuarios u
where u.perfil in ('diretor_geral','admin') or u.admin is true
order by u.perfil, u.email;
-- → <UUID_DIRETOR_GERAL> e <UUID_ADMIN>


-- 0.5 — USUÁRIO SEM VÍNCULO (nenhum representante, nenhum grupo, não global)
select u.id, u.nome, u.email, u.perfil, u.admin, u.operador, u.ativo
from public.concremapprep_usuarios u
where u.ativo is true
  and coalesce(nullif(btrim(u.perfil),''),
               case when u.admin then 'admin'
                    when u.operador then 'operador'
                    else 'representante' end) not in ('admin','diretor_geral')
  and not exists (select 1 from public.concremapprep_usuario_representantes ur
                   where ur.usuario_id = u.id)
  and not exists (select 1 from public.user_client_groups g
                   where g.user_id = u.id)
order by u.email;
-- → <UUID_SEM_VINCULO>
-- Se não houver NENHUM, registrar S7 como NÃO VERIFICADO. **Não criar usuário
-- só para o teste** — criação de usuário está fora do escopo da E1.


-- 0.6 — USUÁRIO INATIVO (de preferência um que TENHA vínculo, para o teste valer)
select u.id, u.nome, u.email, u.perfil, u.admin, u.ativo,
       (select count(*) from public.concremapprep_usuario_representantes ur
         where ur.usuario_id = u.id) as qtd_representantes
from public.concremapprep_usuarios u
where u.ativo is not true
order by qtd_representantes desc, u.email;
-- → <UUID_USUARIO_INATIVO>
-- Se não houver nenhum, registrar S9-inativo como NÃO VERIFICADO.


-- ############################################################################
-- S1 — Representante A recebe somente o próprio escopo
-- ############################################################################
begin;
set local request.jwt.claims = '{"sub":"<UUID_REP_A>","role":"authenticated"}';
select 'S1' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='representante' · is_global=false · representantes = SÓ os de A
--           grupos={} · tem_escopo=true


-- ############################################################################
-- S2 — Representante B recebe somente o próprio escopo
-- ############################################################################
begin;
set local request.jwt.claims = '{"sub":"<UUID_REP_B>","role":"authenticated"}';
select 'S2' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: representantes = SÓ os de B


-- ############################################################################
-- S3 — Isolamento: A e B não compartilham código nenhum
-- ############################################################################
begin;
set local request.jwt.claims = '{"sub":"<UUID_REP_A>","role":"authenticated"}';
create temp table _a as select representantes from public.app_escopo_atual();

set local request.jwt.claims = '{"sub":"<UUID_REP_B>","role":"authenticated"}';
create temp table _b as select representantes from public.app_escopo_atual();

select 'S3' as teste,
       (select representantes from _a)                              as escopo_a,
       (select representantes from _b)                              as escopo_b,
       (select representantes from _a) && (select representantes from _b) as tem_intersecao;
rollback;
-- ESPERADO: tem_intersecao = FALSE
-- (se os dois compartilharem código de propósito, escolher outro par no 0.2)


-- ############################################################################
-- S4 — Diretor recebe somente os grupos vinculados
-- ############################################################################
begin;
set local request.jwt.claims = '{"sub":"<UUID_DIRETOR>","role":"authenticated"}';
select 'S4' as teste, * from public.app_escopo_atual();
rollback;

-- Conferência independente (fora da transação, leitura direta do vínculo):
select 'S4-conferencia' as teste, cg.normalized_name
from public.user_client_groups ucg
join public.client_groups cg on cg.id = ucg.client_group_id
where ucg.user_id = '<UUID_DIRETOR>'::uuid
  and cg.is_active is true
order by 2;
-- ESPERADO: perfil='diretor' · is_global=FALSE · `grupos` idêntico à conferência


-- ############################################################################
-- S5 — Diretor geral
-- ############################################################################
begin;
set local request.jwt.claims = '{"sub":"<UUID_DIRETOR_GERAL>","role":"authenticated"}';
select 'S5' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='diretor_geral' · is_global=TRUE · tem_escopo=TRUE
-- Regra do projeto: vê todos os DADOS; a restrição de GESTÃO é de rota/policy,
-- não deste escopo.


-- ############################################################################
-- S6 — Admin
-- ############################################################################
begin;
set local request.jwt.claims = '{"sub":"<UUID_ADMIN>","role":"authenticated"}';
select 'S6' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='admin' · is_global=TRUE · tem_escopo=TRUE


-- ############################################################################
-- S7 — Usuário sem vínculo → escopo VAZIO (jamais global)
-- ############################################################################
begin;
set local request.jwt.claims = '{"sub":"<UUID_SEM_VINCULO>","role":"authenticated"}';
select 'S7' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: is_global=FALSE · representantes={} · grupos={} · tem_escopo=FALSE
-- ⚠️ TESTE MAIS IMPORTANTE. tem_escopo=TRUE aqui é falha grave — não prosseguir.


-- ############################################################################
-- S8 — anon e authenticated NÃO conseguem executar
-- ############################################################################
begin;
set local role anon;
select 'S8-anon' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: ERRO "permission denied for function app_escopo_atual"
-- Se retornar linha, o REVOKE não foi aplicado.

begin;
set local role authenticated;
select 'S8-authenticated' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: ERRO de permissão (o frontend não deve chamar direto)


-- ############################################################################
-- S9 — Falhas seguras
-- ############################################################################

-- 9a — usuário inexistente
begin;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
select 'S9-inexistente' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='sem_acesso' · tem_escopo=FALSE

-- 9b — usuário INATIVO (mesmo com vínculos)
begin;
set local request.jwt.claims = '{"sub":"<UUID_USUARIO_INATIVO>","role":"authenticated"}';
select 'S9-inativo' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='sem_acesso' · tem_escopo=FALSE
-- ⚠️ MUDANÇA DE COMPORTAMENTO (achado A13): hoje o inativo mantém acesso pela view.

-- 9c — sem claim nenhuma (auth.uid() nulo)
begin;
select 'S9-sem-jwt' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='sem_acesso' · tem_escopo=FALSE


-- ############################################################################
-- S10 — REGRESSÃO: quem muda de acesso entre a view atual e a função nova
-- ############################################################################
-- Não altera nada. Lista NOMINALMENTE cada usuário cujo acesso mudaria, com a
-- classificação da diferença, para revisão humana antes da E2.
with base as (
  select u.id, u.nome, u.email, u.perfil, u.admin, u.operador, u.ativo,
         coalesce(nullif(btrim(u.perfil), ''),
                  case when u.admin    then 'admin'
                       when u.operador then 'operador'
                       else 'representante' end)                     as perfil_efetivo,
         (select count(*) from public.concremapprep_usuario_representantes ur
           where ur.usuario_id = u.id)                               as qtd_representantes,
         (select count(*) from public.user_client_groups g
           where g.user_id = u.id)                                   as qtd_grupos
  from public.concremapprep_usuarios u
),
calc as (
  select b.*,
         -- Regra da VIEW hoje: app_is_admin() lê o FLAG; diretor_geral vem do perfil.
         ((b.admin is true) or b.perfil = 'diretor_geral')            as view_global,
         -- Regra NOVA: perfil efetivo, e só para usuário ativo.
         (b.ativo is true and b.perfil_efetivo in ('admin','diretor_geral')) as novo_global,
         -- Novo: perde todo o acesso?
         (b.ativo is not true)                                        as novo_bloqueado_por_inativo
  from base b
)
select 'S10' as teste,
       id, nome, email, perfil, admin, operador, ativo,
       qtd_representantes, qtd_grupos,
       view_global as acesso_global_hoje,
       novo_global as acesso_global_novo,
       case
         when view_global and not novo_global and ativo is true
              then 'PERDE ACESSO GLOBAL — flag admin sem perfil correspondente (A12)'
         when not view_global and novo_global
              then 'GANHA ACESSO GLOBAL — revisar com atenção (A12)'
         when novo_bloqueado_por_inativo and (view_global or qtd_representantes > 0 or qtd_grupos > 0)
              then 'PERDE TODO O ACESSO — usuário inativo (A13)'
         else 'sem mudança'
       end as classificacao
from calc
where (view_global <> novo_global)
   or (novo_bloqueado_por_inativo and (view_global or qtd_representantes > 0 or qtd_grupos > 0))
order by classificacao, email;
-- ESPERADO IDEAL: zero linhas.
-- Cada linha é um usuário cujo acesso MUDA quando as RPCs novas entrarem.
-- Revisar NOMINALMENTE antes da E2. Não corrigir nada automaticamente:
-- 'GANHA ACESSO GLOBAL' é o caso que exige decisão explícita.
