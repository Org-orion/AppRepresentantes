# CLAUDE.md — Concrem Connect

## Projeto

**Concrem Connect** — Portal do Representante da **Concrem Portas Premium** (cliente).
Desenvolvido pela **Nexus Labs**. Web (Vercel) + desktop (Tauri 2).

## Objetivo

Portal único para os representantes comerciais montarem orçamentos **sem preço**, acompanharem a
análise/precificação da equipe comercial, seguirem os pedidos no pipeline de produção e entrega (dados
vindos do ERP), consultarem a carteira de clientes e conferirem documentos fiscais e financeiros.

## Perfil e risco

**P3 · risco R2** — operação empresarial, multiusuário, dados pessoais e financeiros, permissões por
papel. Ver [[Cérebro — Perfis e Classificação de Projetos]]. Consequência prática: mudanças exigem
testes proporcionais, revisão de permissões e evidência antes de concluir.

## Arquitetura

Frontend SPA falando **direto com o Supabase** — não há backend HTTP próprio. Toda leitura e escrita passa
por um **único client** (`src/lib/supabase/client.ts`), concentrada na camada de serviços `src/services/`.
As "rotas de API" reais são **Edge Functions**.

Os dados do ERP **não são copiados**: o banco do Portal os lê ao vivo do banco do ERP via `postgres_fdw`
(schema local `erp`), expondo **views com RLS** em `public`. A segurança é garantida no banco (RLS), com o
escopo replicado na camada de serviço (`src/services/scope.ts`) como defesa em profundidade.

## Stack

- **Frontend:** React 19 + TypeScript 6 + Vite 8
- **UI:** Tailwind CSS v4, Radix UI, Lucide, Recharts, framer-motion
- **Estado de servidor:** TanStack React Query 5 (`staleTime` 5 min, `retry` 1)
- **Rotas:** React Router v7 (`BrowserRouter`)
- **Formulários:** react-hook-form + zod
- **PDF:** `@react-pdf/renderer` · **Datas:** date-fns
- **Backend:** Supabase (Auth, Postgres + RLS, Edge Functions, Storage)
- **Anti-robô:** Cloudflare Turnstile
- **Desktop:** Tauri 2 (`src-tauri/`, instalador NSIS)

> **Classificação:** stack **LEGADA** frente ao padrão atual da Nexus Labs (HTML/CSS/JS+TS sem framework —
> ver [[Cérebro — Padrão de Linguagem (HTML, CSS e JS)]]). Mantida por decisão de projeto; **não** serve de
> referência para projeto novo.

## Estrutura

```
src/
├── pages/              # uma página por rota (+ admin/)
├── services/           # TODO acesso ao Supabase mora aqui
├── hooks/              # React Query por domínio
├── contexts/           # AuthContext (sessão + perfil + rep codes + grupos)
├── components/
│   ├── layout/         # Layout, Header, Sidebar, MobileNav
│   ├── ui/             # base + família ui/cards/
│   ├── dashboard/      # inclui executive/ (dashboards de diretor)
│   ├── clientes/       # inclui groups/ (visão por grupo)
│   └── login/
├── alerts/             # motor de alertas (engine, registry, notify, sounds, prefs)
├── pedidos/central.ts  # etapas e regras da Central de Pedidos
├── utils/pipeline.ts   # pipeline de 9 estágios
├── constants/perfis.ts # papéis
└── types/index.ts
```

## Comandos reais

| Comando | O que faz |
|---|---|
| `npm run dev` | Vite dev server (porta 5173) |
| `npm run build` | `tsc && vite build` |
| `npm run preview` | Serve o build |
| `npm run desktop:dev` / `desktop:build` | Tauri |
| `npm run lint` | **QUEBRADO** — ver Pendências |

Pré-requisito: `.env` a partir de `.env.example`.

## Ambientes

| Ambiente | Onde |
|---|---|
| Local | `npm run dev` |
| Produção web | Vercel — https://representativesap.vercel.app |
| Produção desktop | Instalador Tauri (NSIS) |
| Banco do Portal | Supabase `ikjeyaxfciferyezxskh` ("apprepresentatives") — **plano FREE** |
| Banco do ERP | Supabase `ctntlgvoefdbjxvfkahp` ("concrem") — PRO, compartilhado com outra aplicação |

Variáveis (**só nomes, nunca valores**): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_TURNSTILE_SITE_KEY`, `VITE_USE_MOCK`.
Nas Edge Functions: `TURNSTILE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (runtime).

## Banco e dados

### Tabelas nativas do Portal

| Tabela | Descrição |
|---|---|
| `concremapprep_usuarios` | Perfil do usuário; `id` = `auth.users(id)`. Coluna `perfil` é a fonte de verdade do papel |
| `concremapprep_representantes` | Representantes do ERP cadastrados |
| `concremapprep_usuario_representantes` | Vínculo N:N usuário ↔ representante |
| `concremapprep_orcamentos` / `_orcamento_itens` | Orçamentos e itens |
| `concremapprep_notificacoes` | Notificações por usuário |
| `client_groups` / `user_client_groups` | Grupos de cliente e vínculo com diretores |

### Views do ERP (leitura, via FDW + RLS)

`concrem_pedidos_venda` · `concrem_pedidos_status` · `concrem_pedidos_status_historico` ·
`relatorio_entrega_anexos` · `concremprodutos_produtos`

Cada uma é uma view sobre uma foreign table do schema `erp`, filtrando por `app_is_admin()`,
`app_perfil()`, `app_diretor_ve_grupo()` ou `app_my_rep_codes()`.

> ⚠️ **Foram criadas com `security_barrier = true`, mas quatro delas perderam a opção** quando
> `20260706000100_diretores_e_grupos.sql` as recriou com `create or replace view` sem repetir o
> `with (...)`. Verificado no catálogo: `reloptions` de `concrem_pedidos_venda` está `null`.
> Ver achado A10 em `docs/PLANO-SANEAMENTO.md`.

> ⚠️ **A tabela real de anexos no ERP chama-se `concrem_relatorio_entrega_anexos`.** No Portal ela é
> exposta como `relatorio_entrega_anexos` — é o nome que o app usa.

### 🔴 Dependência invisível: a senha do FDW

A senha usada pelo FDW para entrar no ERP fica no **user mapping** do server `erp_test`, **dentro do banco
do Portal**. Não está no código, nem em variável de ambiente, nem em tela nenhuma.

**Rotacionar a senha do banco do ERP sem atualizar esse user mapping derruba, na mesma hora:** Pedidos,
Acompanhamento, Central Financeira, Carteira de Clientes, dashboards de diretor e catálogo de produtos.
Foi exatamente o que causou o incidente `docs/INCIDENTE-2026-08-19-FDW.md`.

Ao rotacionar, execute sempre em seguida, **no banco do Portal**:

```sql
alter user mapping for postgres server erp_test options (set password $$…$$);
```

O usuário do mapping é `postgres.<ref-do-projeto-erp>` — formato exigido pelo pooler. **Não altere.**

### Funções e RPCs

| Nome | Uso |
|---|---|
| `gerar_numero_orcamento()` | RPC chamado pelo frontend |
| `app_dashboard_serie_diaria(date, date, text)` | RPC do dashboard — série diária agregada **no ERP**. Em produção desde 21/08/2026; frontend passa a consumi-la na etapa E5 |
| `app_escopo_atual()` | **Fonte única de escopo do usuário.** Nenhuma RPC deve reimplementar essa lógica |
| `app_is_admin()` / `app_is_operador()` | Usadas dentro das policies |
| `app_my_rep_codes()` | Rep codes do usuário logado; base do escopo nas views do ERP |
| `app_can_*_orcamento()` | Autorização de orçamento nas policies |

Todas `security definer`. As antigas com `set search_path = public`; as duas novas
(`app_escopo_atual`, `app_dashboard_serie_diaria`) com **`set search_path = ''`** e todas as referências
qualificadas por schema.

**ACL — dois contratos diferentes, de propósito.** `app_escopo_atual()` concede EXECUTE só ao owner e ao
`service_role`; o frontend **não** a alcança. `app_dashboard_serie_diaria()` concede ao `authenticated`
e **não** ao `service_role`. Não uniformizar — ver `supabase/migrations/README.md`.

### Migrations

Hoje espalhadas entre `supabase/migrations/` (`schema_v2.sql`, `01`, `02`, `03_erp_fdw.sql`) e
`supabase/migrations/20260706000100_diretores_e_grupos.sql`. Consolidação prevista — ver Pendências.

Todas em `supabase/migrations/`, com nome no formato `AAAAMMDDHHMMSS_descricao.sql`. As cinco primeiras
são **histórico já aplicado** em produção — ver `supabase/migrations/README.md`, que diz o que está no
banco e o que não está. O antigo `src/lib/supabase/schema.sql` (modelo pré-migração, com
`grant ... to anon`) **foi removido**: descrevia um sistema que não existe mais.

## Autenticação

Usa **Supabase Auth** (`signInWithPassword`), com JWT por usuário e RLS no banco.

- Sessão em **`sessionStorage`**: fechar a aba, abrir aba nova ou reabrir o app (inclusive no desktop)
  **exige novo login**. Não existe "permanecer conectado". `F5` na mesma aba mantém a sessão.
- `AuthContext` reage a `onAuthStateChange` e monta o usuário (perfil + rep codes + grupos).
- ⚠️ **Nunca chame `supabase.from(...)` dentro do callback de `onAuthStateChange`** — o gotrue-js segura o
  lock de auth ali e a query trava o app. Adie com `setTimeout(0)` (já implementado).
- Turnstile no login, validado pela Edge Function `verificar-turnstile`.

Ver [[Cérebro — Autenticação e Sessões]].

## Permissões

Cinco perfis, definidos pela coluna `perfil` (fallback nos flags `admin`/`operador` — ver
`src/constants/perfis.ts`):

| Perfil | Escopo de dados | Acesso |
|---|---|---|
| `representante` | próprios rep codes | operacional, sem gestão |
| `operador` | rep codes (hoje: sem vínculo = 0 pedidos) | Aprovações, Pedidos, Dashboard |
| `admin` | global | tudo, incluindo gestão |
| `diretor` | grupos de cliente vinculados | leitura; não aprova, não cria orçamento |
| `diretor_geral` | global | tudo, exceto gestão de usuários/representantes/grupos |

Guardas em `src/App.tsx`: `AdminRoute` (só `admin`) · `OperadorRoute` (`isGlobal` ou `operador`) ·
`RepRoute` (bloqueia operador puro) · `OrcEditorRoute` (bloqueia operador e diretor).

**A guarda de rota é UX, não segurança.** Quem garante é a RLS. Escopo central em
`src/services/scope.ts` (`getUserDataScope`) — toda leitura sensível deve derivar dali.

Ver [[Cérebro — Configurações e Permissões]].

## Regras de domínio

**Vínculo com o ERP:** `concremapprep_representantes.representante_erp` precisa ser **idêntico** ao
`concrem_pedidos_venda.representante`. Divergência = representante sem dados (erro de cadastro, não de código).

**Pipeline (9 estágios):** `aprovado → liberado → mapeamento → ferragem → comercial → producao → faturado
→ entrega → finalizado`. Mapeamento DB → app em `src/services/acompanhamento.ts` (`STATUS_MAP`). Pedido sem
status entra como `aprovado`. **`liberado` existe na UI mas nenhum status do banco mapeia para ele.**

**Status de orçamento:** `rascunho → enviado → em_analise → aprovado | rejeitado`. Só `rascunho` pode ser
editado ou excluído pelo representante.

**Paginação:** `PAGE_SIZE = 50`; a Central de Pedidos carrega até `CENTRAL_CAP = 1500` (sinaliza
`truncated`). Consultas de status em lotes de 200 para não estourar o limite de URL do PostgREST.

**Vendas diretas fora da listagem:** `REP_EXCLUIDOS = ['40001498 - JANDERSON LEROY MERLIN']`
(`src/services/pedidosVenda.ts`) — um único valor. `VALID_ID_NOTA_CONF = [307, 309, 613, 665]`
(`src/constants/orderFilters.ts`) — exatamente quatro. As duas regras estão **reproduzidas dentro de
`app_dashboard_serie_diaria()`**: mudar uma exige mudar a outra.

**RPCs contra `erp.*` não garantem ordenação.** `order by` na mesma consulta agregada derruba o
aggregate pushdown do `postgres_fdw` sob generic plan (achado A16) — quem ordena é o frontend. Da mesma
família de medições: nunca usar `NULLIF`/`COALESCE` sobre coluna do ERP dentro do `WHERE`, use `CASE`
(A15); e `Max rows = 1000` vale também para RPC `returns setof`, então toda RPC que devolva conjunto
precisa de teto explícito de janela (A17).

**A RPC é a fonte canônica dos quatro campos da série do dashboard.** `totalVendidoMes`,
`totalVendidoMesAnt`, `pedidosNoPeriodo` e `vendasMensais` saem de `app_dashboard_serie_diaria()`, e o
frontend só pode **ordenar e consolidar** (`consolidarDashboardSerie`) — **nunca rederivá-los da lista
bruta de pedidos**, que continua cortada em 1.000 linhas e sem `order by`. Rederivar reintroduz o
truncamento em silêncio. Os demais campos do dashboard seguem, de propósito, na consulta bruta.

**Janela do dashboard: teto de 730 dias, margem zero.** `dashboardRpcRange()` cobre período, período
anterior e os 6 meses do gráfico numa chamada só. O pior caso (`periodo='ano'` com um 29/02 na união)
bate **exatamente** em 730, que é o máximo aceito pela RPC. Alargar a série ou criar período mais longo
estoura e devolve `22023`.

**Modo mock:** `VITE_USE_MOCK=true` bypassa o Supabase com `src/data/mockData.ts`.

## Edge Functions

| Função | Chamada por | Papel |
|---|---|---|
| `verificar-turnstile` | `LoginPage.tsx` | valida o token do Turnstile |
| `admin-criar-usuario` | `services/usuarios.ts` | cria usuário com `service_role` |
| `admin-reset-senha` | `services/usuarios.ts` | redefine senha com `service_role` |

Deployadas com **Verify JWT desligado** — a validação de admin é feita **dentro do código da função**.
Essa checagem **nunca** pode ser removida.

## Testes

**Não existe suíte automatizada** — pendência aberta. Enquanto não houver, toda mudança relevante precisa
de roteiro de verificação manual reproduzível (passos, esperado, obtido, evidência). "Testado manualmente"
sozinho **não** é evidência. Ver [[Cérebro — Testes e Verificação]].

## Segurança

- Anon key vai no bundle **por design** — quem protege é a RLS. Nunca "desligue a RLS para facilitar".
- `service_role` **só** dentro de Edge Function. Nunca no frontend.
- CSP e headers em `vercel.json`. O shell Tauri tem `csp: null` — não herda essa proteção.
- Segredos **só por nome** em qualquer documento. `.env` não é versionado.

Ver [[Cérebro — Segurança]].

## Deploy

Vercel a partir do repositório. Não há pipeline de CI (pendência). Deploy e alteração de banco em produção
**exigem autorização explícita**.

## Documentação relacionada

- **Cérebro de engenharia:** `C:\obsidian\kmz\Aplicações\Cérebro\Cérebro — Índice.md` — comece pelo Índice
  e carregue **só** o pilar aplicável.
- **Nota-mãe:** `C:\obsidian\kmz\Aplicações\AppRepresentantes - Concrem Connect.md`
- **Notas de tela:** `C:\obsidian\kmz\Aplicações\Telas - AppRepresentantes\`
- **No repositório:** `docs/PLANO-SANEAMENTO.md` · `docs/INCIDENTE-2026-08-19-FDW.md` · `SEGURANCA.md` ·
  `docs/MIGRACAO-2026-06-RESUMO.md`

> **Autoridade:** este arquivo é o **contexto local do projeto** (nível 5 da
> [[Cérebro — Hierarquia de Autoridade]]). Segurança, proteção de dados e as regras inegociáveis da Nexus
> Labs estão **acima** dele. Em conflito, aplique a regra superior e **explique a divergência** — não
> descarte nenhuma das duas em silêncio.

## 📓 Sincronização com o Obsidian (OBRIGATÓRIO)

Sempre que houver alteração relevante (nova tela ou rota, funcionalidade, regra de negócio, mudança de
stack/escopo/status, remoção de recurso), **atualize a documentação no cofre**:

- **Nota-mãe** (`tipo: projeto`): propósito, stack, banco, segurança, como rodar, riscos e o índice
  `### 3.1 Páginas`.
- **Uma nota por tela** (`tipo: pagina`) em `Telas - AppRepresentantes/`, no método módulo/página:
  `# Tela: <Nome>`, seta de volta `← [[AppRepresentantes - Concrem Connect]]`, e as seções `## Arquivos`,
  `## O que a tela faz`, `## Fluxo`, `## Observações`.

Regras: escreva em **português**; **não** cole código na nota; segredos **só por nome** de variável; não
invente dados (marque `A definir` / `NÃO VERIFICADO`); ao criar tela nova, crie a nota dela e adicione o
link no `### 3.1 Páginas`. Ao encerrar a tarefa, diga no resumo se a documentação foi atualizada — ou que
não havia mudança relevante a documentar.

## Ações que exigem autorização

Commit, push, PR, merge · qualquer migration ou alteração no banco remoto · rotação de segredo · deploy ·
alteração de configuração no painel do Supabase, Vercel ou Cloudflare · exclusão de dados · comunicação
externa.

## Ações proibidas

Expor segredo (inclusive em log ou commit) · desabilitar RLS · usar `service_role` no frontend · remover a
validação de admin das Edge Functions · alterar a opção `user` do user mapping do FDW · apresentar mudança
não verificada como concluída · sobrescrever trabalho não commitado de outra pessoa.

## Definition of Done

Ver [[Cérebro — Definition of Done]]. Mínimo neste projeto: comportamento entregue · `tsc` e `build` verdes ·
verificação proporcional ao risco **com evidência** · permissões conferidas quando a mudança tocar dados ·
documentação do Obsidian avaliada · limitações e riscos residuais declarados · estado final classificado.

## Pendências conhecidas

Rastreadas em `docs/PLANO-SANEAMENTO.md`, com evidência e estado por etapa.

**Abertas:**

1. **Truncamento em 1.000 registros** — o Data API corta toda consulta em `Max rows = 1000` e vários
   agregados são calculados sobre esse recorte. **Parcialmente resolvido no dashboard (E5, 21/08/2026):**
   `totalVendidoMes`, `totalVendidoMesAnt`, `pedidosNoPeriodo` e `vendasMensais` vêm de
   `app_dashboard_serie_diaria()`, agregados no ERP e **fora do teto**. Continuam sobre o recorte, na
   mesma tela: `totalPedidos`, `ticketMedio`, `pipeline`, `totalFaturadoMes`, `faturadosNoPeriodo` e
   `truncado` — todos precisam de `numero_pedido`, que a RPC não devolve. **Por isso o
   `TruncationNotice` continua na tela**: mudou de significado, não deixou de valer. As demais telas
   seguem inteiramente sobre o recorte.
2. **CAPTCHA nativo não habilitado** — o código já envia `captchaToken`; sem ligar no painel do Auth,
   `signInWithPassword` segue chamável direto.
3. **`performance.ts` e `clientGroups.ts`** ainda operam sobre dados truncados e sem aviso.
4. **Código morto** — `services/{clientes,titulos,pedidos}.ts` + hooks correspondentes e 7 componentes órfãos.
5. **Bundle único de ~3,3 MB**, sem code-splitting por rota.
6. **Sem observabilidade** — nenhum registro de evento crítico, nenhum alerta.
7. **Banco do Portal em plano FREE** — pausa por inatividade, **sem backup gerenciado nenhum** e sem
   PITR, num sistema de uso diário. Não é retenção curta: o painel informa *"Free Plan does not include
   project backups"*. **Parcialmente tratado, com primeiro ciclo real MANUAL em 26/08/2026:** a rotina de
   `scripts/backup/` (PowerShell, sem Docker) **executou contra produção com exit 0**, disparada à
   mão — set
   `2026-08-26T144106`, 8 artefatos, 10 tabelas `public`, 39 blocos `COPY`, `auth.users` presente,
   2 objetos de Storage. O set local foi verificado por fora (8/8 íntegros) e a **cópia externa cifrada
   AES256 no OneDrive foi descriptografada, extraída e validada** — byte a byte igual ao set local.
   **A execução diária automática está ATIVA desde 26/08/2026:** a tarefa
   `Concrem Connect - Backup do Portal (A9)` roda todo dia às **10:30** como `kmzkmz`, com
   `LogonType Interactive` e `RunLevel Limited` — **não** SYSTEM, **não** elevada, porque o `.pgpass` e
   a passphrase pertencem ao usuário e o **OneDrive recusa operar sob token elevado**. Validada por
   execução real (`LastTaskResult 0x0`, set `2026-08-26T164034`) feita primeiro com
   `-WhatIfRetention`; só depois a flag foi removida. **Continua aberto:** a retenção está
   **habilitada operacionalmente**, mas sua **primeira exclusão real ainda não foi observada** — com
   2 conjuntos e `Daily = 7` não há o que apagar, e a primeira remoção deve ocorrer por volta do 8º
   ciclo diário; não há **backup gerenciado nem PITR**; o **restore integral da plataforma
   (`auth`, `storage`) não foi testado**. `exit 0` prova gravação local e hash na pasta do OneDrive,
   **não** upload concluído — a conferência do status verde continua humana. Permanência no Free registrada como **aceitação explícita de
   risco**, com quatro gatilhos de reavaliação. Ver `docs/A9-ROTINA-BACKUP.md` §8 e §9 e
   `docs/A9-BACKUP-RESTORE.md`. Achado A9.
8. **`anon` ainda com `select`** em tabelas do banco do ERP.
9. **Falha transitória desloga sessão válida** — `AuthContext` trata erro ao carregar o perfil como
   ausência de usuário e joga na tela de login.
10. **Três pedidos com status forjado** em `AcompanhamentoPage.tsx` (`STATUS_OVERRIDE`) — aguardando
    decisão sobre serem resíduo de demonstração.
11. **`classifyAnexo` classifica por substring solta** — "conferência" vira nota fiscal. Comportamento
    travado por teste de caracterização até a regra ser decidida.
12. **Foreign table sem `ANALYZE` periódico** — `autovacuum` **não** analisa foreign table. O `ANALYZE`
    de `erp.concrem_pedidos_venda` foi manual e único; as estatísticas envelhecem e nada as renova.
    Risco hoje baixo (o pushdown que sobrou é decisão de capacidade, não de custo), mas cresce com o
    tempo. Achado A18.
13. **"Trimestre" na UI não é o trimestre civil** — `dashboardJanelas` ignora `filtros.trimestre` e usa
    janela móvel de 3 meses; o `<Select>` de T1–T4 do dashboard operacional é decorativo. Achado A20.

**Resolvidas neste ciclo:** `npm run lint` funcionando com ESLint em flat config · CI no GitHub Actions
(typecheck, lint, testes, build) · 56 testes automatizados · estados de erro nas telas · sessão em
`sessionStorage` · rewrite de SPA da Vercel (404 ao recarregar) · migrations consolidadas ·
**escopo centralizado no banco (E1)** · **primeira RPC de negócio com agregação empurrada ao ERP,
aplicada e validada (E2/E3)** · **série do dashboard consumindo a RPC (E5)** ·
**seletor de representantes completo (A19)**.

> **A19 — seletor de representantes, resolvido em 21/08/2026.** A lista vinha cortada: das 7.682 linhas
> elegíveis com 243 representantes distintos, só **14** apareciam. Duas correções: `valoresDistintos`
> **pagina o fallback** com `.range()` até esgotar, e as `queryKey` de `representantes-unicos` e
> `situacoes-entrega` passaram a **incluir `scopeKey`** — as duas listas saem da view com RLS, e a chave
> fixa reaproveitava a lista de outro usuário na mesma aba.
>
> **Agregações do PostgREST continuam desabilitadas** (`PGRST123 — Use of aggregate functions is not
> allowed`). A tentativa agregada segue no código de propósito: se for habilitada um dia, o caminho
> barato volta a valer sozinho.
>
> ⚠️ **Não trocar a fonte para `concremapprep_representantes` sem decisão de negócio.** A semântica é
> outra: hoje a lista traz quem **tem pedido** no ERP dentro do escopo; aquela tabela traz quem está
> **cadastrado no Portal**, e a policy dela é `using (true)` — todo autenticado veria todos.
