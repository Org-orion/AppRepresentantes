# Plano de migration — Etapa 7

> Formato: **Template — Plano de Migration** (Nexus Labs). Classificação: **T4 — crítica/externa**.
> **Criar este arquivo não autoriza aplicar nada.** Nenhum comando foi executado no banco.
> Pré-requisitos abertos: decisão **D3** e autorização explícita para o banco remoto.

---

## Objetivo

Cinco coisas, na mesma janela porque tocam o mesmo schema:

1. **Consolidar as migrations** num diretório único e numerado, com registro do que já está aplicado.
2. **Versionar a coluna `telefone`** de `concremapprep_usuarios`, hoje um `ALTER TABLE` solto num
   comentário de código.
3. **Criar a tabela do "conferido"** da Central Financeira, com RLS (decisão **D4**).
4. **Levar os agregados para o banco** — Opção B do achado **A5**, para as telas pararem de contar
   sobre 1.000 registros de 7.600.
5. **Aposentar o `schema.sql` legado**, que ainda descreve o modelo pré-migração com `grant … to anon`.

## Schema atual

**Nativas do Portal:** `concremapprep_usuarios` (com `perfil`, sem `telefone`),
`concremapprep_representantes`, `concremapprep_usuario_representantes`, `concremapprep_orcamentos`,
`concremapprep_orcamento_itens`, `concremapprep_notificacoes`, `client_groups`, `user_client_groups`.

**Views sobre o ERP** (schema `erp` via `postgres_fdw`, server `erp_test`):
`concrem_pedidos_venda`, `concrem_pedidos_status`, `concrem_pedidos_status_historico`,
`relatorio_entrega_anexos`, `concremprodutos_produtos` — todas `security_barrier`, filtrando por
`app_is_admin()`, `app_perfil()`, `app_diretor_ve_grupo()` e `app_my_rep_codes()`.

**Funções existentes:** `app_is_admin`, `app_is_operador`, `app_perfil`, `app_my_rep_codes`,
`app_diretor_ve_grupo`, `app_can_*_orcamento`, `gerar_numero_orcamento` — todas
`security definer set search_path = public`.

**Onde o SQL está hoje (o problema):**

| Arquivo | Situação |
|---|---|
| `supabase/migrations/20260630000100_schema_v2.sql` | aplicado |
| `supabase/migrations/20260630000200_migrate_auth_users.sql` | aplicado |
| `supabase/migrations/20260630000300_migrate_data.sql` | aplicado |
| `supabase/migrations/20260630000400_erp_fdw.sql` | aplicado |
| `supabase/migrations/20260706000100_diretores_e_grupos.sql` | aplicado — vinha de `src/lib/supabase/` |
| `src/lib/supabase/schema.sql` | **LEGADO** — removido do repositório na parte 7.1 |
| `ALTER TABLE … ADD COLUMN telefone` | **não versionado** — vive num comentário de `PerfilPage.tsx` |

---

## Mudança

### 7.1 — Consolidação (sem efeito no banco)

Novo diretório `supabase/migrations/` com numeração cronológica. Os arquivos existentes entram como
**histórico já aplicado**, sem reexecução, e um `README` declara o que está em produção. `schema.sql`
legado é removido do repositório.

**Nada roda no banco nesta parte.** É organização de repositório.

### 7.2 — Coluna `telefone`

```sql
alter table concremapprep_usuarios add column if not exists telefone text;
```

Idempotente, aditiva, sem backfill, sem lock relevante. Depois disso, `PerfilPage.tsx` perde o
comentário-instrução e a mensagem de erro improvisada que hoje aparece quando a coluna não existe.

**Pendência de verificação:** não sei se a coluna **já** foi aplicada manualmente em produção. O `if not
exists` torna a migration segura nos dois casos, mas a validação precisa confirmar qual era o estado.

### 7.3 — Tabela do "conferido" (D4)

```sql
create table if not exists concremapprep_pedidos_conferidos (
  usuario_id     uuid not null references auth.users(id) on delete cascade,
  numero_pedido  text not null,
  conferido_em   timestamptz not null default now(),
  primary key (usuario_id, numero_pedido)
);

alter table concremapprep_pedidos_conferidos enable row level security;

create policy conferidos_proprios on concremapprep_pedidos_conferidos
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

create index if not exists idx_conferidos_usuario
  on concremapprep_pedidos_conferidos (usuario_id);

grant select, insert, delete on concremapprep_pedidos_conferidos to authenticated;
```

**Decisões embutidas, para você contestar se discordar:**

- **PK composta** `(usuario_id, numero_pedido)` — marcar duas vezes não duplica; desmarcar é `delete`.
- **`on delete cascade`** — excluir usuário leva junto as marcações dele. São dados de trabalho pessoal,
  não histórico auditável.
- **Marcação é por usuário, não por equipe.** É o comportamento atual (cada um marca o que conferiu).
  Se a intenção for "conferido pela empresa", a modelagem muda e precisa ser decidido **agora**.
- **Sem `update`** no grant: só existe marcar e desmarcar.

### 7.4 — Agregados no banco (A5, Opção B) — **a parte grande**

**Problema:** hoje o navegador baixa até 1.000 pedidos e conta em JavaScript. São 13% da base, com viés
para os mais recentes — justamente onde NÃO estão os pedidos parados.

**Regra que precisa ser replicada com exatidão** (extraída de `src/services/acompanhamento.ts` e
`src/utils/pipeline.ts`, hoje coberta por testes):

| Indicador | Definição atual no app |
|---|---|
| `estagio` | `mapStatus(histórico mais recente)` senão `mapStatus(pedidos_status.status_atual)` senão `aprovado` |
| `parado` | `estagio <> 'finalizado'` **e** `hoje - coalesce(status_updated_at, data_emissao) > 7 dias` |
| `atrasado` | `estagio <> 'finalizado'` **e** `previsao_embarque < hoje` |
| `docs_pendentes` | `estagio in (faturado, entrega, finalizado)` **e** (sem NF **ou** sem boleto) |

**Proposta:**

```sql
-- 1) O mapa de status vira dado, não código duplicado
create table if not exists app_status_pipeline_map (
  status_erp text primary key,
  estagio    text not null
);
-- populado com o mesmo conteúdo de STATUS_MAP (12 entradas)

create or replace function app_map_status(s text) returns text
language sql stable set search_path = public as $$
  select coalesce((select estagio from app_status_pipeline_map where status_erp = s), 'aprovado');
$$;

-- 2) Estágio + data da última transição, por pedido
create or replace view v_pedido_estagio ... ;   -- lateral no histórico + fallback em pedidos_status

-- 3) Indicadores agregados, já no escopo do usuário logado
create or replace function app_indicadores_acompanhamento()
returns table (estagio text, total bigint, parados bigint, atrasados bigint, docs_pendentes bigint)
language sql stable security definer set search_path = public as $$ ... $$;
```

O escopo (`app_is_admin` / `app_perfil` / `app_diretor_ve_grupo` / `app_my_rep_codes`) é aplicado
**dentro** da função — o cliente não escolhe o que agrega.

**O risco que quero deixar explícito:** a regra passa a existir em dois lugares — TypeScript (para exibir
um pedido) e SQL (para agregar). Duas fontes para a mesma regra é o que o pilar de fórmulas manda evitar.
**Mitigação proposta:** o mapa vira **tabela**, exposta por função, e um teste compara `STATUS_MAP` do TS
com o conteúdo do banco. Divergiu, o CI quebra. Sem isso, as duas versões vão separar em algum momento e
ninguém vai perceber.

### 7.5 — D3, se for aprovado

Se operador sem rep codes deve ver tudo: `or app_is_operador()` nas views de pedidos e status.
**Isto amplia acesso a dados** — não entra sem decisão explícita sua.

---

## Dados existentes

- **7.2** aditiva, nada a migrar.
- **7.3** tabela nova, vazia. O front migra o que estiver no `localStorage` de cada usuário na primeira
  carga (Etapa 8) — sem perder as marcações já feitas.
- **7.4** só leitura; nenhuma linha alterada.
- **Nenhuma migration destrutiva neste plano.** Sem `drop table`, sem `delete`, sem alteração de tipo.

## Compatibilidade (versão anterior e nova)

Todas as mudanças são **aditivas**: o app atual continua funcionando com o banco novo. Isso permite
aplicar as migrations **antes** de publicar o front, que é a ordem segura. As funções novas simplesmente
ficam sem uso até o front chamá-las.

Único ponto de atenção: se o front novo for publicado **antes** das migrations, as telas que chamarem
`app_indicadores_acompanhamento()` recebem erro de função inexistente — e, com os estados de erro da
Etapa 3.5, isso aparece como cartão vermelho em vez de tela vazia. Ruim, mas visível e reversível.

## Consumidores

Frontend (`services/acompanhamento.ts`, `dashboard.ts`, `financeiro.ts`, `carteira.ts`, `performance.ts`,
`clientGroups.ts`), Edge Functions (`admin-criar-usuario`, `admin-reset-senha` — não afetadas) e a
**outra aplicação que alimenta o ERP** — que **não** é afetada: todas as mudanças são no banco do Portal.

## Locks e duração

`add column` sem default não reescreve a tabela — lock momentâneo. `create table`, `create view` e
`create function` são instantâneos. **Estimativa: segundos.** Nenhuma operação bloqueante relevante.

O que pode demorar é a **primeira execução** dos agregados, não a migration — ver risco abaixo.

## Backup e recuperação

**CORRIGIDO em 2026-08-19 — o pressuposto original desta seção estava errado.**

Não existe backup a confirmar: o painel informa *"Free Plan does not include project backups"*. O banco
do Portal está **sem backup diário e sem PITR** (achado **A9**).

Consequência para este plano:

- **Dump manual é pré-requisito de execução**, não conforto. Procedimento em `docs/BACKUP-MANUAL.md`.
- Nenhuma das migrations é destrutiva, o que mantém o risco baixo — mas "baixo" com zero rede é
  diferente de "baixo" com restauração possível.
- A restauração **nunca foi testada**. Estado honesto: existe cópia, não existe recuperação comprovada.

## Ordem de aplicação

1. Confirmar backup e janela.
2. **7.2** `telefone` (menor risco, valida o processo).
3. **7.3** tabela do conferido + RLS.
4. **7.4** mapa de status → view → função de indicadores.
5. **7.5** D3, se aprovado.
6. Validar (abaixo).
7. Só então publicar o front que consome as novidades (Etapa 8 em diante).

## Rollback

Escrito **antes** de aplicar, um por parte:

```sql
-- 7.2  (só se a coluna não existia antes; conferir na validação)
alter table concremapprep_usuarios drop column if exists telefone;
-- 7.3
drop table if exists concremapprep_pedidos_conferidos;
-- 7.4
drop function if exists app_indicadores_acompanhamento();
drop view if exists v_pedido_estagio;
drop function if exists app_map_status(text);
drop table if exists app_status_pipeline_map;
-- 7.5
-- recriar as views sem `or app_is_operador()`
```

Como tudo é aditivo, o rollback não perde dado do app — **exceto** o 7.3 depois que houver marcações
gravadas. A partir daí, o rollback do 7.3 exige export antes.

## Rollforward

Se uma parte falhar no meio, as anteriores permanecem válidas (são independentes). Retomar da parte que
falhou; não é necessário desfazer o que passou.

## Validações

**No banco, após aplicar:**

```sql
-- 7.2
select column_name from information_schema.columns
 where table_name = 'concremapprep_usuarios' and column_name = 'telefone';

-- 7.3 — RLS de verdade, com DOIS usuários
--   usuário A insere; usuário B faz select e NÃO vê a linha de A.

-- 7.4 — o número novo tem que bater com a realidade, não com a tela antiga
select sum(total) from app_indicadores_acompanhamento();
select count(*) from concrem_pedidos_venda;   -- ordens de grandeza compatíveis
```

**Comparação obrigatória:** rodar os indicadores **e** conferir contra uma contagem manual em SQL. Se o
número novo bater com o antigo (1.000), é sinal de que a agregação foi cortada também — e aí o plano
falhou em silêncio, exatamente o que ele existe para corrigir.

**No app:** salvar telefone no Perfil; marcar/desmarcar conferido com dois usuários diferentes; conferir
que a faixa de truncamento **desaparece** das telas que passaram a usar agregados.

**Testes (6.3):** suíte de integração de RLS contra banco controlado, provando isolamento entre
representantes, entre grupos de diretor, e o `default deny`.

## Ambiente

⚠️ **Problema em aberto.** O cérebro exige aplicar em ambiente controlado antes de produção, e o Portal
está em plano **FREE** — sem *branching* do Supabase. Opções:

| Opção | Custo | Observação |
|---|---|---|
| Supabase CLI local (`supabase start`) | grátis | **ESCOLHIDA** — mas exige **Docker Desktop**, que não está instalado nesta máquina. Não reproduz o FDW: valida schema e RLS, não os agregados |
| Projeto Supabase free separado | grátis | precisa recriar FDW e dados de amostra |
| Upgrade do Portal para plano pago | pago | destrava branching, PITR e backup — e, depois do A9, deixou de ser conveniência |

**Estado do ambiente local (verificado em 2026-08-19):** `supabase` CLI 2.114.0 ✅ · `pg_dump` e `psql`
18.6 ✅ · **Docker ❌ não instalado** · nenhum PostgreSQL local rodando.

`supabase start` depende de Docker. Sem ele, a opção A não sai do papel.

**Limitação adicional, independente do Docker:** as cinco migrations históricas **não** rodam num banco
limpo — `20260630000200` e `20260630000300` são geradores de `INSERT` executados à mão, e
`20260630000400` (FDW) e `20260706000100` (views sobre `erp.*`) dependem do banco do ERP. Um
`supabase db reset` falharia. O ensaio local viável é: subir o stack, aplicar **`20260630000100`** e
depois as duas migrations novas — o suficiente para exercitar `telefone`, a tabela de conferidos e a RLS
com dois usuários.

**Sem definir isto, a parte 7.4 não deve ir para produção.** As partes 7.2 e 7.3 são pequenas e
aditivas o bastante para irem direto, com backup confirmado — mas isso é **decisão sua**, não minha.

## Autorização

**Necessária e ainda não concedida:**

- [ ] **D3** — operador sem rep codes: 0 pedidos (hoje) ou tudo?
- [ ] Escolha do ambiente de validação (tabela acima)
- [ ] Autorização para aplicar 7.2 e 7.3 em produção
- [ ] Autorização para aplicar 7.4 em produção
- [ ] Confirmação do backup mais recente

## Observabilidade

Nenhuma das mudanças gera evento auditável hoje — a auditoria é a Etapa 11. Registrar manualmente:
data, quem aplicou, quais partes, e o resultado das validações.

## Risco residual

| # | Risco | Avaliação |
|---|---|---|
| M1 | **Agregar sobre FDW pode ser lento.** O `postgres_fdw` empurra agregação para o servidor remoto em alguns casos, mas as views com `security_barrier` e funções de escopo provavelmente impedem isso — e aí as linhas vêm todas para o Portal antes de contar | **O maior risco do plano.** Medir com `explain analyze` antes de liberar. Se for inviável: *materialized view* com refresh agendado, aceitando defasagem declarada na tela |
| M2 | Regra de negócio em dois lugares (TS e SQL) | Mitigado pelo mapa em tabela + teste comparando as duas fontes no CI |
| M3 | Coluna `telefone` já aplicada manualmente | `if not exists` cobre; a validação confirma o estado real |
| M4 | Rollback do 7.3 perde marcações após o uso | Export antes, se já houver dados |
| M5 | Portal em plano FREE — sem PITR, sem branching | Precede este plano; decisão de negócio |
| M6 | `performance.ts` e `clientGroups.ts` continuam truncados até virarem agregados | Declarado; entram na mesma etapa ou logo depois |

---

## O que eu recomendo

**Fatiar.** As partes 7.1, 7.2 e 7.3 são pequenas, aditivas e de baixo risco — dá para fazer já, com
backup confirmado. A parte **7.4 é outra conversa**: mexe em como os números do negócio são calculados,
tem risco de desempenho real (M1) e merece medição antes de qualquer coisa.

Se você concordar, eu proponho:

1. **Agora:** 7.1 (repositório), 7.2 e 7.3 (migrations pequenas) + os testes de RLS.
2. **Depois, com medição:** 7.4, começando por um `explain analyze` da agregação para saber se o
   caminho é função direta ou *materialized view*.

Assim o "conferido" sai do `localStorage` rápido e o pedaço arriscado recebe a atenção que merece.
