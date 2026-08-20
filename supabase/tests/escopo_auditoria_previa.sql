-- ============================================================================
-- Auditoria PRÉVIA — rodar ANTES de aplicar 20260819000300
-- ----------------------------------------------------------------------------
-- Somente leitura. Nada é alterado. Nenhuma dessas consultas depende da função
-- nova existir — todas podem rodar agora.
-- ============================================================================


-- ############################################################################
-- P1 — Usuários NÃO-DIRETOR com vínculo em user_client_groups
-- ############################################################################
-- Motivação: a função nova ignora grupos para quem não é diretor. Esta consulta
-- mostra QUEM tem cadastro residual — e portanto quem seria afetado se a regra
-- fosse a errada (carregar grupos para todo mundo).
select u.id, u.nome, u.email,
       u.perfil, u.admin, u.operador, u.ativo,
       coalesce(nullif(btrim(u.perfil), ''),
                case when u.admin    then 'admin'
                     when u.operador then 'operador'
                     else 'representante' end)                as perfil_efetivo,
       count(ucg.id)                                          as qtd_grupos_vinculados,
       array_agg(cg.normalized_name order by cg.normalized_name) as grupos
from public.concremapprep_usuarios u
join public.user_client_groups ucg on ucg.user_id = u.id
join public.client_groups cg       on cg.id = ucg.client_group_id
group by u.id, u.nome, u.email, u.perfil, u.admin, u.operador, u.ativo
having coalesce(nullif(btrim(u.perfil), ''),
                case when u.admin    then 'admin'
                     when u.operador then 'operador'
                     else 'representante' end) <> 'diretor'
order by u.email;
-- ESPERADO IDEAL: zero linhas.
-- Se houver linhas, são vínculos RESIDUAIS. A função nova os ignora (correto,
-- e igual ao que a view já faz). NÃO apagar nada automaticamente — revisar.


-- ############################################################################
-- P2 — Valores distintos de `perfil` hoje no banco
-- ############################################################################
-- Define se a whitelist da função cobre a realidade.
select coalesce(u.perfil, '(NULL)')             as perfil_bruto,
       count(*)                                 as usuarios,
       count(*) filter (where u.ativo is true)  as ativos,
       count(*) filter (where u.admin)          as com_flag_admin,
       count(*) filter (where u.operador)       as com_flag_operador
from public.concremapprep_usuarios u
group by 1
order by 2 desc;
-- ESPERADO: só 'representante', 'operador', 'admin', 'diretor', 'diretor_geral'
--           e, possivelmente, '(NULL)'.
-- Qualquer OUTRO valor precisa entrar na whitelist da função OU ser corrigido
-- no cadastro — decisão sua, e não automática.


-- ############################################################################
-- P3 — A constraint que hoje protege o domínio de `perfil`
-- ############################################################################
select con.conname, pg_get_constraintdef(con.oid) as definicao, con.convalidated
from pg_constraint con
join pg_class c     on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'concremapprep_usuarios'
  and con.contype = 'c';
-- Confirma se `usuarios_perfil_chk` existe e está validada. Ela é a primeira
-- barreira; a whitelist da função é a segunda.
-- Nota: CHECK aceita NULL — por isso `perfil` pode ser nulo mesmo com a constraint.


-- ############################################################################
-- P4 — SEARCH_PATH: quem pode criar objetos no schema `public`?
-- ############################################################################
-- Se algum papel não confiável tiver CREATE em `public`, então
-- `search_path = public` numa função SECURITY DEFINER é vetor de sequestro de
-- nome. A migration usa `search_path = ''` justamente para não depender disto.
select n.nspname                                            as schema,
       n.nspowner::regrole                                  as dono,
       has_schema_privilege('public',        n.oid, 'CREATE') as public_pode_criar,
       has_schema_privilege('anon',          n.oid, 'CREATE') as anon_pode_criar,
       has_schema_privilege('authenticated', n.oid, 'CREATE') as authenticated_pode_criar,
       has_schema_privilege('anon',          n.oid, 'USAGE')  as anon_usa,
       has_schema_privilege('authenticated', n.oid, 'USAGE')  as authenticated_usa,
       n.nspacl                                             as acl_bruta
from pg_namespace n
where n.nspname = 'public';
-- LEITURA:
--   qualquer *_pode_criar = true  → `search_path = public` seria INACEITÁVEL
--                                   numa função SECURITY DEFINER.
--   todos false                   → `search_path = public` seria tolerável,
--                                   mas `search_path = ''` continua melhor.
-- NÃO alterar privilégio de schema nesta etapa — só medir.


-- ############################################################################
-- P5 — Outras funções SECURITY DEFINER do projeto e seus search_path
-- ############################################################################
-- Contexto: se P4 acusar CREATE para papel não confiável, TODAS estas funções
-- passam a ser candidatas ao mesmo problema — não só a nova.
select p.proname,
       p.prosecdef      as security_definer,
       p.provolatile    as volatilidade,
       p.proconfig      as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef is true
order by p.proname;
-- Achado esperado: as funções existentes usam `search_path=public`.
-- Registrar como pendência se P4 der positivo — corrigir NÃO é escopo da E1.


-- ############################################################################
-- P6 — Asserção de OWNER (rodar DEPOIS da migration, junto da validação B3)
-- ############################################################################
-- SECURITY DEFINER executa com os privilégios do DONO. A migration não fixa o
-- owner de propósito (ver comentário no topo dela) — em vez disso, confere.
select p.proname,
       p.proowner::regrole                      as dono,
       (p.proowner::regrole::text = 'postgres') as dono_correto,
       p.prosecdef                              as security_definer,
       p.provolatile                            as volatilidade,
       p.proconfig                              as config,
       case
         when p.proowner::regrole::text <> 'postgres'
           then 'REPROVADO — dono diferente de postgres; a função roda com privilégios errados'
         when p.prosecdef is not true
           then 'REPROVADO — não é SECURITY DEFINER'
         when p.provolatile <> 's'
           then 'REPROVADO — não é STABLE'
         when p.proconfig is null or not (p.proconfig @> array['search_path='])
           then 'REVISAR — search_path não está vazio'
         else 'OK'
       end as veredito
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'app_escopo_atual';
-- ESPERADO: veredito = 'OK'
