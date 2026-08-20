-- ============================================================================
-- Testes de isolamento do escopo — S1 a S10 (etapa E1)
-- ----------------------------------------------------------------------------
-- Somente leitura. Cada bloco roda em transação e faz ROLLBACK: nada persiste.
--
-- COMO A IMPERSONAÇÃO FUNCIONA AQUI
-- `auth.uid()` lê a claim `sub` de `request.jwt.claims`, que é estado de SESSÃO.
-- Definindo essa claim com `set local`, a função enxerga o usuário escolhido —
-- sem precisar do login dele e sem tocar em `auth.users`.
--
-- Rode como `postgres` no SQL Editor. Substitua os UUIDs pelos reais, obtidos em:
--   select id, email, perfil, ativo from concremapprep_usuarios order by perfil, email;
-- ============================================================================

-- ── Preparação: escolher os usuários de teste ──────────────────────────────
-- Rode isto primeiro e anote os UUIDs.
select u.id, u.email, u.perfil, u.admin, u.operador, u.ativo,
       (select count(*) from concremapprep_usuario_representantes ur where ur.usuario_id = u.id) as reps,
       (select count(*) from user_client_groups ucg where ucg.user_id = u.id)                    as grupos
from concremapprep_usuarios u
order by u.perfil nulls first, u.email;


-- ============================================================================
-- S1 — Representante A recebe somente o próprio escopo
-- ============================================================================
begin;
set local request.jwt.claims = '{"sub":"<UUID_REP_A>","role":"authenticated"}';
select 'S1' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='representante' · is_global=false · representantes = SÓ os de A
--           grupos={} · tem_escopo=true


-- ============================================================================
-- S2 — Representante B recebe somente o próprio escopo
-- ============================================================================
begin;
set local request.jwt.claims = '{"sub":"<UUID_REP_B>","role":"authenticated"}';
select 'S2' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: representantes = SÓ os de B


-- ============================================================================
-- S3 — Isolamento: A e B não compartilham código nenhum
-- ============================================================================
begin;
set local request.jwt.claims = '{"sub":"<UUID_REP_A>","role":"authenticated"}';
create temp table _a as select representantes from public.app_escopo_atual();
set local request.jwt.claims = '{"sub":"<UUID_REP_B>","role":"authenticated"}';
create temp table _b as select representantes from public.app_escopo_atual();

select 'S3' as teste,
       (select representantes from _a) as escopo_a,
       (select representantes from _b) as escopo_b,
       (select representantes from _a) && (select representantes from _b) as tem_intersecao;
rollback;
-- ESPERADO: tem_intersecao = FALSE
-- (se os dois representantes compartilharem código de propósito, escolher outro par)


-- ============================================================================
-- S4 — Diretor recebe somente os grupos vinculados
-- ============================================================================
begin;
set local request.jwt.claims = '{"sub":"<UUID_DIRETOR>","role":"authenticated"}';
select 'S4' as teste, * from public.app_escopo_atual();

-- conferência contra o vínculo real
select 'S4-conferencia' as teste, cg.normalized_name
from user_client_groups ucg
join client_groups cg on cg.id = ucg.client_group_id
where ucg.user_id = '<UUID_DIRETOR>'::uuid and cg.is_active is true
order by 2;
rollback;
-- ESPERADO: perfil='diretor' · is_global=FALSE · grupos = exatamente os da conferência


-- ============================================================================
-- S5 — Diretor geral
-- ============================================================================
begin;
set local request.jwt.claims = '{"sub":"<UUID_DIRETOR_GERAL>","role":"authenticated"}';
select 'S5' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='diretor_geral' · is_global=TRUE · tem_escopo=TRUE
--           (regra do projeto: vê todos os DADOS, mas não acessa gestão — a
--            restrição de gestão é de rota/policy, não deste escopo)


-- ============================================================================
-- S6 — Admin
-- ============================================================================
begin;
set local request.jwt.claims = '{"sub":"<UUID_ADMIN>","role":"authenticated"}';
select 'S6' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='admin' · is_global=TRUE · tem_escopo=TRUE


-- ============================================================================
-- S7 — Usuário sem vínculo → escopo VAZIO (jamais global)
-- ============================================================================
begin;
set local request.jwt.claims = '{"sub":"<UUID_SEM_VINCULO>","role":"authenticated"}';
select 'S7' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: is_global=FALSE · representantes={} · grupos={} · tem_escopo=FALSE
-- ⚠️ ESTE É O TESTE MAIS IMPORTANTE. tem_escopo=TRUE aqui seria falha grave.


-- ============================================================================
-- S8 — anon não consegue executar
-- ============================================================================
begin;
set local role anon;
select 'S8' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: ERRO "permission denied for function app_escopo_atual"
-- Se retornar linha, o REVOKE não foi aplicado.

-- Mesma verificação para authenticated (também não deve executar direto)
begin;
set local role authenticated;
select 'S8b' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: ERRO de permissão


-- ============================================================================
-- S9 — Usuário inexistente e usuário INATIVO falham com segurança
-- ============================================================================
begin;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
select 'S9-inexistente' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='sem_acesso' · tem_escopo=FALSE

begin;
set local request.jwt.claims = '{"sub":"<UUID_USUARIO_INATIVO>","role":"authenticated"}';
select 'S9-inativo' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: tem_escopo=FALSE
-- ⚠️ MUDANÇA DE COMPORTAMENTO: hoje usuário inativo mantém acesso (achado A13).
-- Se não houver usuário inativo cadastrado, criar um só para o teste está fora
-- de escopo — registrar como NÃO VERIFICADO.

-- Sem claim nenhuma (auth.uid() nulo)
begin;
select 'S9-sem-jwt' as teste, * from public.app_escopo_atual();
rollback;
-- ESPERADO: perfil='sem_acesso' · tem_escopo=FALSE


-- ============================================================================
-- S10 — Regressão: comparar com o que a VIEW faz hoje
-- ============================================================================
-- A view usa app_is_admin() (flag `admin`), enquanto a função nova usa a coluna
-- `perfil`. Esta consulta lista quem DIVERGE entre as duas regras.
select 'S10' as teste,
       u.email, u.perfil, u.admin, u.operador, u.ativo,
       (u.admin is true)                                          as view_trataria_como_admin,
       (coalesce(nullif(btrim(u.perfil),''),
                 case when u.admin then 'admin'
                      when u.operador then 'operador'
                      else 'representante' end)
        in ('admin','diretor_geral'))                             as escopo_novo_e_global
from concremapprep_usuarios u
where (u.admin is true)
   <> (coalesce(nullif(btrim(u.perfil),''),
                case when u.admin then 'admin'
                     when u.operador then 'operador'
                     else 'representante' end)
       in ('admin','diretor_geral'))
   or u.ativo is not true;
-- ESPERADO: idealmente ZERO linhas.
-- Cada linha é um usuário cujo acesso MUDA quando as RPCs novas entrarem.
-- Precisa ser revisado NOMINALMENTE antes de E2 — não é para ser ignorado.
