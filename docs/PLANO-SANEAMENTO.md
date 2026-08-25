# Plano de execução — Saneamento técnico do Concrem Connect

> Formato: **Template — Plano de Execução** (Nexus Labs). Classificação da tarefa: **T3 — estrutural**
> (toca autenticação, banco, portões de qualidade e documentação). Projeto: **P3 / risco R2**.
> Data do plano: 2026-08-19 · Baseline: commit `fa53856` (branch `main`).

---

## Objetivo

Fechar as pendências levantadas na revisão de 2026-08-19 — segurança, portões de qualidade,
verdade documental, dívidas de código e verificação — **uma etapa por vez**, cada uma com
evidência própria, reversão própria e ponto de parada, sem misturar assuntos num mesmo commit.

## Estado atual (baseline — EVIDÊNCIA coletada em 2026-08-19)

| Item | Estado |
|---|---|
| `npx tsc --noEmit` | ✅ limpo (exit 0) |
| `npx vite build` | ✅ 13,1s — chunk único de 3.312 kB (1.002 kB gzip) |
| `npm run lint` | ❌ ESLint ausente do projeto e sem `eslint.config.js` |
| Testes automatizados | ❌ nenhum (sem runner, sem `*.test.*`) |
| CI | ❌ sem `.github/` |
| Segredos versionados | ✅ nenhum; `.env` nunca commitado |
| Working tree | 3 arquivos modificados não commitados (`CLAUDE.md`, `client.ts`, `LoginPage.tsx`) |
| Advisors do Supabase | ⚠️ NÃO VERIFICADO — MCP negou permissão |

## Resultado esperado

- Nenhum segredo exposto pendente de rotação; banco antigo sem acesso `anon` desnecessário.
- `CLAUDE.md` descrevendo a arquitetura real (Supabase Auth + RLS + sessionStorage, 5 perfis).
- `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` funcionando e rodando em CI a cada push.
- Mudança de sessão commitada com a matriz de verificação de autenticação registrada.
- Vazamento de "conferido" entre usuários corrigido.
- Anti-força-bruta com decisão registrada (nativo no Supabase Auth ou risco residual aceito).
- Suíte de testes cobrindo os fluxos C2/C3 (escopo, comissão, pipeline, guardas de rota).
- Migrations num único diretório numerado, com a coluna `telefone` versionada.
- Código morto removido (~660 linhas), rotas com code-splitting, auditoria mínima de eventos críticos.
- Documentação do Obsidian em dia (Carteira, Dashboard, nota-mãe, SDD) e docs da raiz consolidados.

## Escopo

As 13 etapas abaixo, na ordem indicada. Cada etapa é um commit (ou um conjunto pequeno e coeso
de commits) e termina com evidência registrada neste arquivo.

## Fora do escopo

- Reescrever a stack (React/Vite é LEGADO frente ao padrão novo Nexus Labs, mas **não** se troca aqui).
- Novas funcionalidades de negócio.
- Redesign visual das telas.
- Refatoração das páginas grandes (>800 linhas) — vira dívida registrada, não entra agora.

## Dados e integrações

Supabase do Portal (`ikjeyaxfciferyezxskh`) · Supabase do ERP (`ctntlgvoefdbjxvfkahp`) via `postgres_fdw` ·
Edge Functions (`verificar-turnstile`, `admin-criar-usuario`, `admin-reset-senha`) · Cloudflare Turnstile ·
Vercel (web) · Tauri (desktop).

## Dependências a introduzir (Etapas 3 e 6)

`eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`,
`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`. Todas dev-only, origem oficial,
avaliadas conforme **Cérebro — Dependências e Cadeia de Suprimentos**; lockfile commitado junto.

## Riscos do plano

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R1 | Rotacionar a senha do `postgres` do ERP **quebra o FDW** (a senha vive no *user mapping* do banco do Portal) → pedidos, status, anexos e telas de diretor ficam vazios | **Crítico** | Ordem obrigatória: rotacionar → `ALTER USER MAPPING` no Portal → validar as 5 views → só então encerrar. Janela combinada e rollback pronto |
| R2 | Revogar `anon` no banco antigo quebra a outra aplicação que o consome | Alto | Inventariar consumidores antes; revogar por tabela; validar a outra app; reversível por `GRANT` |
| R3 | ESLint estreando num projeto de 145 arquivos pode acusar centenas de problemas | Médio | Etapa própria; começar com o conjunto recomendado; corrigir de verdade o que for real e registrar exceções justificadas em vez de baixar a régua |
| R4 | Remover código morto pode derrubar algo que o `tsc` não vê | Médio | Só depois de lint+CI+testes; `grep` por nome antes de cada remoção; um commit por grupo; build a cada passo |
| R5 | Code-splitting pode quebrar o empacotamento Tauri (base path / chunks) | Médio | Validar `npm run desktop:build` na mesma etapa |
| R6 | Sobrescrever a mudança de sessão que já está no working tree | Alto | Etapa 4 trata explicitamente esse diff; **PROIBIDO** `checkout`/`reset` nesses arquivos |

## Decisões APROVADAS (2026-08-19)

| # | Decisão | Efeito no plano |
|---|---|---|
| **D1** | **Relogin sempre**, inclusive no desktop (Tauri): fechou o app, acabou a sessão. Sem exceção para o shell desktop | Etapa 4 mantém `sessionStorage` como está e valida o cenário 10 da matriz |
| **D2** | Ativar o **CAPTCHA nativo do Supabase Auth** com o mesmo site key do Turnstile | Etapa 5 (anti-força-bruta); `verificar-turnstile` vira redundante e é aposentada |
| **D4** | "Conferido" da Central Financeira vai para **tabela no banco com RLS** (corrige o vazamento **e** sincroniza entre dispositivos) | Vira migration: passa a depender da consolidação de migrations (Etapas 7 e 8) |
| **D5** | **Branch + commit + push** autorizados: branch `chore/saneamento`, um commit por etapa, PR para revisão | Todas as etapas |

## Decisões pendentes (podem esperar)

| # | Decisão | Quando preciso |
|---|---|---|
| **D3** | Operador sem rep codes hoje vê **0 pedidos**. É o comportamento correto? | Etapa 7 (policy/view) |
| **D6** | Consolidar os 7 `.md` da raiz em `docs/`? | Etapa 12 |

## Autorizações necessárias (não executo sem seu "pode ir")

- **Git:** criar branch, commit, push (D5).
- **Banco remoto:** qualquer migration, `ALTER USER MAPPING`, `REVOKE`, rotação de senha (Etapas 1, 7 e 11).
- **Painel Supabase / Cloudflare:** rotação de segredos, configuração de CAPTCHA nativo (Etapas 1 e 5).
- **Deploy:** publicar na Vercel ao final (Etapa 13).

---

# Passos

> Regra do plano: **uma etapa por vez**. Só começo a seguinte depois da evidência da anterior
> estar registrada e de você dar o aval. Nenhuma etapa deixa o projeto sem buildar.

## Etapa 0 — Preparar a rede de segurança · T1 · ~15 min

**O que faço:** registro do baseline neste arquivo (já feito acima); criação da branch de trabalho
`chore/saneamento`; confirmação de que os 3 arquivos modificados no working tree serão tratados na Etapa 4
e não serão descartados.
**Verificação:** `git status` mostrando os mesmos 3 arquivos; `git branch` na nova branch; `tsc` e `build` verdes.
**Reversão:** `git checkout main` (nada foi alterado).
**Autorização:** D5.

## Etapa 1 — Segredos e banco antigo · T4 · execução sua, roteiro meu

Segurança vem primeiro na hierarquia de autoridade — e é a pendência mais antiga (§7 do `docs/MIGRACAO-2026-06-RESUMO.md`).

**1.1 Rotação das senhas expostas durante a migração**
Eu entrego o roteiro; **você executa** no painel (é ação em produção).
Ordem obrigatória por causa do **R1**:

1. Janela combinada (fora do horário comercial dos representantes).
2. Trocar a senha do `postgres` no banco do ERP.
3. No banco do Portal: `ALTER USER MAPPING FOR ... OPTIONS (SET password '...')` no server `erp_test`.
4. Validar as 5 views (`concrem_pedidos_venda`, `concrem_pedidos_status`, `concrem_pedidos_status_historico`, `relatorio_entrega_anexos`, `concremprodutos_produtos`) com `select count(*)` autenticado como representante.
5. Abrir o app e conferir Pedidos, Acompanhamento e Financeiro com dados.

**Rollback:** voltar a senha anterior e o user mapping.

**1.2 Revogar `anon` no banco antigo**
Inventariar antes quem ainda usa a anon key antiga; revogar por tabela; validar a outra aplicação.
**Rollback:** `GRANT SELECT` de volta.

**Evidência esperada:** saída das queries de validação + confirmação visual das 3 telas + registro
da rotação (data, quem executou, o que foi rotacionado — **sem os valores**).
**Se você preferir adiar:** vira RISCO RESIDUAL registrado com responsável e prazo, e o plano segue
para a Etapa 2 (as demais etapas não dependem desta).

## Etapa 2 — Verdade documental: `CLAUDE.md` · T1 · ~40 min

A DoD §6 trata "documentação crítica divergente" como impeditivo de conclusão — e hoje o `CLAUDE.md`
ensina o modelo errado para qualquer pessoa **ou agente** que abra o projeto.

**O que faço:**

- Reescrevo **Autenticação** (Supabase Auth, `signInWithPassword`, JWT, RLS, sessionStorage — não mais RPC `login`/`anon`/`concrem_session`).
- Reescrevo **Banco de dados**: tabelas reais, views do FDW, `client_groups`/`user_client_groups`; removo `clientes`/`titulos`.
- Corrijo **RPCs**: só `gerar_numero_orcamento` existe; `criar_usuario`/`alterar_senha` viraram Edge Functions.
- Corrijo **perfis**: 5 (`representante`, `operador`, `admin`, `diretor`, `diretor_geral`) e as guardas reais (`AdminRoute`, `OperadorRoute`, `RepRoute`, `OrcEditorRoute`).
- **Elimino a seção duplicada** de sincronização com o Obsidian (fica só a do cofre `C:\obsidian\kmz`; sai a do OneDrive).
- Alinho a estrutura ao **Template — CLAUDE md**.

**Verificação:** leitura cruzada afirmação-a-afirmação contra `AuthContext.tsx`, `client.ts`, `App.tsx`,
`perfis.ts`, `supabase/migrations/*.sql` — cada linha do arquivo apontando para código real.
**Reversão:** `git revert` do commit (arquivo isolado).
**Fora do escopo aqui:** os outros `.md` da raiz (Etapa 12).

## Etapa 3 — Portão de qualidade: ESLint + CI · T2 · ~2–3 h

Sem isto, toda etapa seguinte é feita no escuro.

**3.1 ESLint**

- `eslint.config.js` (flat config) com `@eslint/js` recomendado, `typescript-eslint`, `react-hooks`, `react-refresh`; ignorando `dist/`, `node_modules/`, `src-tauri/`, `scripts/`.
- Instalar as devDependencies e commitar o lockfile.
- Rodar, **ler cada erro** e corrigir de verdade. Onde a correção for arriscada, `eslint-disable` **com justificativa escrita** — nunca afrouxando a regra global.
- Validar as 8 diretivas `eslint-disable` já existentes: as que forem desnecessárias caem por `--report-unused-disable-directives`.
- Adicionar script `typecheck` (`tsc --noEmit`) ao `package.json`.

**3.2 CI (GitHub Actions)**
`.github/workflows/ci.yml` rodando em `push` e `pull_request`: `npm ci` → `typecheck` → `lint` → `build`.
Permissões mínimas (`contents: read`), Node fixado, cache de npm.

**Verificação:** `npm run lint` com exit 0 e `--max-warnings 0`; `npm run typecheck` verde; `npm run build` verde;
workflow verde no GitHub.
**Reversão:** remover config + workflow (nenhuma mudança de comportamento em runtime).
**Ponto de atenção (R3):** se o volume de erros for grande, eu paro, mostro a lista agrupada e a gente decide
o corte antes de eu sair corrigindo em massa.

## Etapa 4 — Fechar a mudança de sessão · T3 · ~1–2 h

Trata o diff que já está no seu working tree (`client.ts` + `LoginPage.tsx`).

**O que faço:**

- Reviso a implementação: `storage: sessionStorage`, remoção do "Permanecer conectado" e a limpeza
  defensiva de chaves `sb-*`/`concrem_remember` do localStorage.
- **D1 aprovada:** relogin sempre, inclusive no desktop — nada de exceção para o Tauri. O cenário 10
  da matriz vira verificação de que o comportamento é esse mesmo, não uma decisão em aberto.
- Executo e registro a **matriz de verificação de autenticação** do cérebro, no formato reproduzível
  (objetivo / ambiente / pré-condições / passos / esperado / obtido / evidência):

| # | Cenário | Esperado |
|---|---|---|
| 1 | Login válido | Entra e carrega perfil + rep codes |
| 2 | Senha errada | Erro genérico, sem enumerar usuário |
| 3 | F5 na mesma aba | Continua logado |
| 4 | Nova aba na mesma janela | **Exige novo login** |
| 5 | Fechar e reabrir o navegador | **Exige novo login** |
| 6 | Logout | Volta ao login; `sessionStorage` sem chave `sb-*` |
| 7 | Expiração / refresh de token | Renova sem derrubar a sessão |
| 8 | Restauração de abas do navegador | Não restaura sessão |
| 9 | Resíduo em `localStorage` de versão anterior | Removido na carga |
| 10 | Tauri: fechar e reabrir o app | **Exige novo login** (D1) |

**Verificação:** a tabela acima preenchida com obtido + evidência.
**Reversão:** o commit isolado volta ao comportamento anterior.
**Documentação:** a nota **AppRep — Login** já descreve o `sessionStorage` — confirmo e ajusto se a D1 mudar algo.

## Etapa 5 — Anti-força-bruta no login · T3 · ~1 h

**Problema:** o Turnstile hoje é portão de UI. Com a anon key (que vai no bundle) dá para chamar
`signInWithPassword` direto, sem passar pela Edge Function.

**D2 aprovada — CAPTCHA nativo do Supabase Auth:**

1. Ativar o provider Turnstile no Auth do projeto do Portal, com o **mesmo site key** já usado na tela
   (e o secret key configurado no painel, nunca no bundle).
2. Passar o token do widget no `options.captchaToken` do `signInWithPassword` — o servidor de auth
   passa a **exigir** o token e o bypass pela anon key deixa de existir.
3. Com o captcha validado na origem, a Edge Function `verificar-turnstile` fica redundante:
   removo a chamada de `LoginPage.tsx` e aposento a função (a remoção do deploy é ação sua no painel).
4. Conferir a política de senha e a proteção contra senha vazada do projeto enquanto estou no painel.

**Verificação:** `curl` chamando `/auth/v1/token?grant_type=password` direto com a anon key e credencial
de teste → deve ser **rejeitado** por falta de captcha (evidência: corpo da resposta); login pela tela
continuando a funcionar; login com token de captcha reutilizado sendo recusado.
**Reversão:** desligar o provider no painel e reverter o commit (o widget volta a ser só de UI).
**Autorização:** configuração no painel do Supabase — ação sua.

## Etapa 6 — Testes automatizados · T2 · ~4–6 h

Cérebro — Testes §4: P3 exige unitário de domínio, casos de uso, autenticação, autorização, escopo e RLS.

**6.1 Infra:** Vitest + Testing Library + jsdom; script `test` e `test:watch`; CI passa a rodar `npm test`.

**6.2 Primeiros testes, priorizados por criticidade:**

| Alvo | Criticidade | O que se prova |
|---|---|---|
| `services/scope.ts` (`getUserDataScope`) | **C3** | Cada perfil recebe o escopo certo; representante nunca recebe escopo global |
| Comissão prevista (`dashboard`/`performance`) | **C2** | Cálculo com zero, nulo, percentual ausente, arredondamento |
| `utils/pipeline.ts` + `services/acompanhamento.ts` | **C2** | Mapeamento status DB → 9 estágios, incluindo pedido sem status |
| Guardas de rota (`App.tsx`) | **C3** | Matriz perfil × rota, positiva **e negativa** |
| `alerts/prefs.ts` | **C1** | Preferências isoladas por usuário |
| `constants/perfis.ts` | **C1** | `perfilDoUsuario` com `perfil` ausente cai nos flags corretamente |

**6.3 (fase 2, recomendado agora que D4 foi aprovada):** teste de integração de RLS contra um banco de
teste — prova o isolamento **no banco**, não na UI. Vira o teste de regressão natural da nova tabela
de "conferido" da Etapa 8.

**Verificação:** suíte verde no CI; cada teste **falha** se eu quebrar de propósito a regra que ele cobre
(teste que não pode falhar não vale).
**Reversão:** não altera runtime.

## Etapa 7 — Consolidar migrations + `telefone` + tabela de "conferido" · T3/T4 · ~3 h

**Estado atual:** SQL espalhado em `supabase/migrations/` (4 arquivos), `supabase/migrations/20260706000100_diretores_e_grupos.sql`
e o legado `src/lib/supabase/schema.sql`; sem numeração única nem registro de aplicação. A coluna `telefone`
não tem migration nenhuma — vive como comentário no topo de `PerfilPage.tsx`.

**O que faço:**

- Diretório único `supabase/migrations/` com numeração cronológica; os arquivos existentes entram como
  histórico já aplicado, com um `README` dizendo **o que já está aplicado em produção**.
- Migration nova e idempotente para `telefone` (`add column if not exists`), removendo o comentário-instrução
  e a mensagem de erro improvisada de `PerfilPage.tsx`.
- **Migration da tabela `concremapprep_pedidos_conferidos` (D4):** `usuario_id` → `auth.users`, chave do
  pedido, timestamp; PK composta para ser idempotente; **RLS ligada** com policy de que cada um só lê e
  escreve as próprias marcações; índice por usuário; grants para `authenticated`.
- Se D3 disser que operador deve ver tudo: `or app_is_operador()` nas views de pedidos/status.
- **Agregados no banco (Opção B do achado A5 — APROVADA em 2026-08-19):** funções/views que devolvem
  os indicadores prontos em vez de o navegador baixar milhares de linhas para contar — contagem por
  estágio do pipeline, pedidos parados, atrasados, documentos pendentes, totais por representante e
  por grupo de cliente. As listas continuam paginadas. Depois disso, os avisos de truncamento saem
  das telas de indicador (deixam de ser necessários) e `performance.ts` / `clientGroups.ts` param de
  operar sobre recorte.
- Remoção do `src/lib/supabase/schema.sql` legado (modelo antigo, com `grant ... to anon`).

**Verificação:** aplicar num banco/branch de teste antes; depois, com autorização, em produção; validar
salvando telefone no Perfil; provar a RLS da nova tabela com dois usuários (o B não enxerga a marcação do A).
**Reversão:** migration de rollback escrita antes da aplicação (Template — Plano de Migration).
**Autorização:** obrigatória para tocar o banco remoto.

## Etapa 8 — "Conferido" sincronizado no banco · T2 · ~2 h

**Defeito que isto fecha:** `fin_conferidos` em `localStorage` sem chave por usuário → em máquina
compartilhada, o próximo representante que logar vê os pedidos marcados pelo anterior; e o dado sobrevive
à sessão. **D4** escolheu a solução completa, então a correção do vazamento vem junto com a sincronização.

**O que faço:**

- Serviço + hook React Query lendo e gravando em `concremapprep_pedidos_conferidos` (Etapa 7).
- `FinanceiroPage.tsx` passa a usar o hook, com atualização otimista para não perder a resposta imediata
  do clique que existe hoje.
- **Migração do dado local:** na primeira carga, o que estiver em `fin_conferidos` sobe para o banco
  como marcação do usuário atual e a chave local é apagada — sem perder o trabalho já feito.
- Limpeza das chaves de preferência do usuário no `logout`.
- Estados de erro/carregamento da tela cobertos (o clique não pode mentir se a gravação falhar).

**Verificação:** teste de RLS (6.3) provando o isolamento no banco; roteiro manual reproduzível —
usuário A marca → logout → usuário B entra na mesma máquina → **não vê**; usuário A entra em outro
dispositivo → **vê**.
**Reversão:** commit isolado (a tabela pode ficar; o front volta ao localStorage).

## Etapa 9 — Remover código morto · T2 · ~1 h

Só agora, com lint + CI + testes de pé (R4). Um commit por grupo:

1. Mock legado: `services/{clientes,titulos,pedidos}.ts` + `hooks/{useClientes,useTitulos,usePedidos}.ts`.
2. Componentes órfãos: `RisksPage`, `CommercialInsightsPanel`, `FilteredKPIStrip`, `AppCard`, `ListItemCard`, `PageHeader`, `ResponsiveGrid`.
3. Avaliar `src/data/mockData.ts` (952 linhas) e a flag `VITE_USE_MOCK`: ainda usada? Se sim, fica; se não, sai.

**Verificação:** `grep` por cada nome antes de remover; `typecheck` + `lint` + `test` + `build` a cada commit;
comparação do tamanho do bundle antes/depois.
**Reversão:** `git revert` por grupo.

## Etapa 10 — Code-splitting por rota · T2 · ~1–2 h

Hoje: 1 chunk de 3.312 kB (1.002 kB gzip) — a tela de login baixa o app inteiro.
**O que faço:** `React.lazy` + `Suspense` nas rotas de `App.tsx`, com fallback consistente com o design atual;
separar os pesos óbvios (`@react-pdf/renderer`, `recharts`) em chunks próprios.
**Verificação:** tamanho do bundle antes/depois registrado; navegação por todas as rotas sem tela branca;
`npm run desktop:build` validado (R5).
**Reversão:** commit isolado.

## Etapa 11 — Observabilidade mínima · T2 · ~2 h

Hoje há 1 `console` em todo o `src/` e nenhum registro de evento crítico — para P3 com autenticação e
permissões, o pilar de Observabilidade pede auditoria mínima.
**O que faço:** tabela de auditoria no Supabase (append-only, RLS de leitura só para admin) registrando
login, falha de login, logout, criação/reset de usuário, mudança de perfil/vínculo e aprovação de orçamento —
**sem token, sem senha, sem PII desnecessária**. Escrita a partir das Edge Functions e dos serviços admin.
**Verificação:** cada evento gerando 1 registro; consulta de amostra provando ausência de segredo/PII.
**Autorização:** migration remota.

## Etapa 12 — Documentação (Obsidian + raiz do repo) · T1 · ~2 h

- **AppRep — Carteira de Clientes**: documentar a *Análise Visual dos Clientes do Grupo* (destaques,
  rankings, radar, donut, dispersão valor×frequência, matriz) — commit `fa53856`.
- **AppRep — Dashboard**: descrever o pager executivo (Visão Geral / Operações / Representantes / Grupos)
  e a remoção da visão Riscos (commit `78876e6`).
- **Nota-mãe**: corrigir "Sem repositório git" (há git e remoto no GitHub); atualizar §8 Riscos com o que
  este plano fechou e o que virou risco residual.
- **SDD**: refletir ESLint/CI/testes/migrations.
- **Raiz do repo (D6)**: mover `SEGURANCA.md`, `SECURITY_DNS_SETUP.md`, `DESKTOP_BUILD.md`, `INSTRUCOES.md`,
  `SSD.md`, `CLAUDE_AGENTE.md` para `docs/`, deixando na raiz só `README`/`CLAUDE.md`.

**Verificação:** links do vault válidos; frontmatter correto; cada afirmação nova conferida contra o código.

## Etapa 13 — Encerramento · T1 · ~1 h

- **Relatório Final** (Template — Relatório Final): arquivos alterados, evidências, o que ficou de fora.
- **Checklist DoD** preenchido com evidência (não com boa vontade).
- **Riscos residuais** registrados com responsável e prazo — incluindo os que ficarem abertos aqui
  (stack LEGADA, FDW como ponto único de falha, páginas >800 linhas, CSP ausente no shell Tauri).
- Estado final classificado: `CONCLUÍDO` · `CONCLUÍDO COM RESSALVAS` · `PARCIAL`.
- Deploy, se autorizado, com validação pós-deploy dos fluxos críticos.

---

## Verificações transversais (valem para toda etapa)

Antes de encerrar qualquer etapa: `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`,
mais a verificação específica da etapa. Falha preexistente é separada da falha causada pela mudança.
**PROIBIDO** registrar "testado manualmente" sem roteiro reproduzível.

## Reversão

Cada etapa é um commit (ou poucos, coesos) → `git revert` isolado. Mudanças de banco só com migration de
rollback escrita **antes** da aplicação. Ações no painel (rotação, captcha) com o passo de volta anotado
no roteiro.

## Ordem resumida

```text
0 Baseline → 1 Segredos → 2 CLAUDE.md → 3 ESLint+CI → 4 Sessão → 5 Anti-brute-force
→ 6 Testes → 7 Migrations → 8 Conferido no banco → 9 Código morto
→ 10 Code-splitting → 11 Observabilidade → 12 Documentação → 13 Encerramento
```

Etapa 1 é executada por você (ação em produção) e **não bloqueia** as demais: se preferir adiar,
ela vira risco residual registrado e eu sigo pela Etapa 2.

---

## Achados durante a execução

### A1 — INCIDENTE **ENCERRADO** (2026-08-19): FDW fora do ar

> **Resolvido no mesmo dia.** Causa: a senha do banco do ERP havia sido rotacionada sem atualizar o
> user mapping do FDW no banco do Portal. Corrigido com nova rotação + `alter user mapping`.
> Registro completo, linha do tempo, fatores contribuintes e ações corretivas em
> `docs/INCIDENTE-2026-08-19-FDW.md`. O texto abaixo é o estado no momento da detecção.

**Evidência:** logs Postgres do Portal com centenas de `could not connect to server "erp_test"`;
Central de Pedidos exibindo **0 pedidos** para um usuário administrador; Portal saudável
(9/60 conexões, CPU 2,91%, nenhuma query bloqueada) — ou seja, o problema é o **lado do ERP**, não o Portal.

**Impacto:** Pedidos, Acompanhamento, Central Financeira, Carteira e dashboards de diretor sem dados
para **todos** os perfis. Orçamentos (tabela nativa) seguem normais.

**Consequência no plano:** a **Etapa 1 está BLOQUEADA**. Rotacionar a senha do ERP com o FDW já caído
impede a própria validação do passo 5 e mistura duas causas no mesmo diagnóstico.

**Tratamento:** restabelecer a conexão primeiro (ver `docs/ETAPA-1-ROTACAO-SEGREDOS.md`, seção de
diagnóstico), depois retomar a Etapa 1.

### A2 — DEFEITO: falha do backend é exibida como "nenhum resultado"

`src/pages/PedidosPage.tsx:523` consome apenas `isLoading` e `isFetching` do React Query — **nunca `isError`**.
O serviço faz `throw error` corretamente (`pedidosVenda.ts:122`), mas a tela renderiza o estado vazio.

Foi exatamente o que aconteceu no incidente A1: o app disse **"Nenhum pedido encontrado"** enquanto o
banco não conseguia falar com o ERP. O representante não tem como distinguir "não há pedidos" de
"o sistema está fora".

Contraria [[Cérebro — Acessibilidade, UX e Padrões de Interface]] (estados obrigatórios: carregando,
vazio, **erro**, sucesso) e esconde incidente de produção.

**Escopo da correção:** estado de erro real em Pedidos, Acompanhamento, Central Financeira, Carteira e
Dashboard — com mensagem acionável e opção de tentar de novo. **Proposta:** virar a **Etapa 3.5**,
logo depois do portão de qualidade e antes da mudança de sessão, por ser defeito visível em produção.

### A3 — Vulnerabilidades conhecidas em dependências de runtime

Detectado ao instalar o ESLint (Etapa 3). **`npm audit` reporta 6 vulnerabilidades high — nenhuma
introduzida pelo ESLint.** `npm ls` confirma a origem: todas vêm de `vite` e `react-router-dom`, que já
estavam no projeto. É **falha preexistente**, registrada como tal.

| Pacote | Origem | Observação |
|---|---|---|
| `react-router` 7.13.2 | `react-router-dom` | 10 advisories: RCE via turbo-stream, CSRF, XSS, open redirect, DoS |
| `vite` 8.0.3 | direta | path traversal em `.map`, bypass de `server.fs.deny` |
| `postcss` / `nanoid` | via `vite` | XSS no stringify, leitura arbitrária via `sourceMappingURL` |

**Exposição real, avaliada:** a maioria dos advisories do react-router exige SSR, RSC ou framework mode —
este app é SPA pura com `BrowserRouter`, sem loaders/actions no servidor. Os que **podem** aplicar são os
de **open redirect** (`<Link>`/`useNavigate` com barra invertida ou `//`). Os de `vite`, `postcss` e
`nanoid` afetam o **dev server e o build**, não o bundle publicado.

**Por que não corrigi agora:** são dependências de runtime de um app em produção **sem nenhum teste
automatizado**. Subir versão sem rede de segurança é trocar um risco conhecido e contido por um risco
desconhecido. `npm audit fix` (sem `--force`) resolve dentro do semver e é de baixo risco.

**Proposta:** virar etapa própria **depois da Etapa 6 (testes)**, ou antes disso se você preferir aceitar
o risco de regressão. **PROIBIDO** `npm audit fix --force` — ver [[Cérebro — Dependências e Cadeia de Suprimentos]].

### A4 — Status inventado para três pedidos, fixo no código

`src/pages/AcompanhamentoPage.tsx:501-502`:

```ts
const STATUS_OVERRIDE = { '135732': 'mapeamento', '135128': 'producao', '133469': 'finalizado' };
const OVERRIDE_ORDER  = ['133469', '135128', '135732'];
```

Três números de pedido fixos que **sobrescrevem o status real vindo do ERP**, **apagam o histórico**
desses pedidos na tela (`logs: []`) e os **empurram para o topo** da lista, fora de qualquer ordenação.

Se o pedido `133469` estiver em produção no ERP, a Central de Acompanhamento afirma "finalizado".
Tem cara de ajuste de demonstração que ficou no código. **Aguarda decisão:** intencional ou resíduo?

### A5 — Truncamento silencioso em 1.000 registros

**CONFIRMADO** com evidência HTTP: a consulta da Central de Acompanhamento volta
`Status 200` · `Content-Range: 0-999/*` · payload com exatamente 1.000 itens — e a tela anuncia
**"1.000 pedido(s) em acompanhamento"** como se fosse o total. A base tem ~7.600 pedidos válidos.

**Causa:** `fetchAcompanhamento` (`src/services/acompanhamento.ts:72`) não define `.limit()` nem
`.range()`. O PostgREST aplica o teto do projeto (aparentemente `db-max-rows = 1000`) e devolve a
primeira página **sem que nada no app perceba**.

**Consequência:** todos os KPIs da tela — 260 aprovados, 303 em produção, 266 parados, 338 docs
pendentes, 481 em atraso — são calculados sobre um subconjunto arbitrário (os 1.000 mais recentes por
`data_emissao`), e apresentados como se fossem o quadro completo. Um gestor decide prioridade de
produção olhando esses números.

**Mesma falta em outros serviços** (consultam `concrem_pedidos_venda` sem `limit`/`range`):

| Serviço | Alimenta |
|---|---|
| `dashboard.ts:102` | KPIs do Dashboard, pipeline, insights, tendência |
| `financeiro.ts:55` e `:152` | Central Financeira e anexos |

**CONFIRMADO (2026-08-19):** o painel do Supabase mostra **Max rows = 1000** em
*Integrations → Data API → Settings*. O teto é **global** e corta **toda** consulta, inclusive as que
pedem mais. Logo, **todos** estes `limit` são ficção:

| Onde | Pede | Recebe | Consequência |
|---|---|---|---|
| `acompanhamento.ts:72` | sem limit | 1.000 | KPIs de parados/atraso/docs sobre recorte |
| `dashboard.ts:102` | sem limit | 1.000 | KPIs, pipeline, insights e tendência |
| `financeiro.ts:55,152` | sem limit | 1.000 | documentos fiscais |
| `carteira.ts:47` | 5.000 | 1.000 | "462 clientes ativos" sai de 1.000 pedidos |
| `pedidosVenda.ts:189` | 1.500 | 1.000 | a tela **afirma** "exibindo os 1.500 mais recentes" |
| `performance.ts:37,129` | 50.000 | 1.000 | ranking de representantes |
| `clientGroups.ts:11,62` | 50.000 | 1.000 | análise por grupo de cliente |

O total de 7.600 exibido na Central de Pedidos está correto — vem de `count: 'exact'`, que não sofre o
teto. É só a **lista e os agregados derivados dela** que vêm truncados. Isso torna o erro mais difícil
de perceber: o total certo ao lado de números derivados errados.

**Viés do recorte:** a ordenação é `data_emissao desc`, então o que fica de fora é sempre **o mais
antigo** — exatamente onde se concentram os pedidos parados e atrasados. O corte não é neutro:
subestima sistematicamente os indicadores de problema.

Contraria [[Cérebro — Acessibilidade, UX e Padrões de Interface]] e o princípio de **não truncar em
silêncio**: se um recorte é aplicado, a tela precisa dizer — como a Central de Pedidos já faz com
`truncated`.

### A6 — Falha de rede momentânea desloga quem tem sessão válida

`src/contexts/AuthContext.tsx:156-161`:

```ts
try {
  const user = await buildUser(session.user);
  ...
} catch {
  setAuthState({ user: null, loading: false, error: 'Falha ao carregar perfil' });
}
```

A sessão do Supabase Auth continua **válida** em `sessionStorage`, mas o app zera o usuário — e como
`App.tsx` renderiza `LoginPage` para qualquer rota sem usuário, a pessoa é jogada na tela de login.

**Confunde duas coisas diferentes:** "não há sessão" e "há sessão, mas a consulta do perfil falhou".
A segunda é transitória; tratá-la como a primeira faz o usuário achar que caiu a conta.

**Quando morde:** queda momentânea de rede, instabilidade do banco, ou um novo episódio como o
INC-2026-08-19-FDW — se `concremapprep_usuarios` ficar inacessível, **todo mundo** é mandado para o
login, com sessão boa no bolso.

**Correção proposta:** distinguir os dois casos — manter o usuário na aplicação, exibir estado de erro
com "tentar novamente" (mesmo padrão do `DataError`) e só derrubar a sessão quando o Supabase Auth
disser que ela acabou. Entra como **Etapa 4.1**, junto do resto de autenticação.

### A7 — 404 em produção ao recarregar qualquer rota (desde 2026-07-07)

**Sintoma reproduzido:** `https://representativesap.vercel.app/dashboard` recarregado direto devolve a
página **404 NOT_FOUND da Vercel**. Vale para qualquer rota interna. Navegar por dentro do app funciona,
porque aí quem resolve é o roteador no cliente — o servidor nunca é consultado.

**Quem sofre:** todo mundo que aperta F5, usa um favorito, abre um link compartilhado ou volta ao app
pela URL. O app parece fora do ar.

**Causa (identificada no histórico):** o commit `b271f33` (2026-07-07, "404 real para caminhos falsos de
log — validação pós-scanner") trocou o rewrite de SPA:

```diff
- { "source": "/(.*)",                             "destination": "/index.html" }
+ { "source": "/((?!.*\.log$|logs$|log$).*)",   "destination": "/index.html" }
```

A intenção era fazer `/logs`, `/log` e `*.log` caírem no 404 nativo para satisfazer um apontamento de
scanner. O efeito real foi o padrão **deixar de casar com qualquer coisa** na Vercel, então **nenhuma**
rota é reescrita e todas caem no 404. O `source` da Vercel é *path-to-regexp*, não regex livre.

**Detalhe que fecha a lição:** a própria mensagem do commit diz "comportamento validado por **simulação**
do path-to-regexp". Foi validado contra um modelo, não contra a plataforma. É a mesma família do A2 —
uma mudança que parecia certa, uma falha que ninguém viu por semanas.

**Está em produção há ~6 semanas.**

**Correção proposta:**

1. Restaurar `"/(.*)"`, que comprovadamente funcionava (`29ad1d2` existe justamente para isso).
2. Sobre o apontamento do scanner: uma SPA devolver `index.html` para caminho desconhecido **não é
   vulnerabilidade** — é como SPA funciona. Trocar o app inteiro por um item cosmético de relatório foi
   um mau negócio. Se ainda assim for exigido, tratar com uma regra específica **antes** do catch-all e
   **validar num preview da Vercel**, nunca por simulação.
3. Confirmar para onde o projeto da Vercel aponta: o repositório mudou de `ConcremPortas` para
   `Org-orion` e o push responde com aviso de redirecionamento. Se a conexão do deploy ficou na origem
   antiga, correção nenhuma chega em produção.

**Prioridade:** alta — quebra de uso diário, correção de uma linha, mas exige deploy (autorização).

**Correção aplicada** em `2752398` (2026-08-19): rewrite restaurado para `"/(.*)"`. CSP, HSTS, os outros
8 cabeçalhos e o `cleanUrls` seguem intactos. O apontamento do scanner **não** foi reintroduzido — ver
motivo no commit.

**Confirmado:** o projeto da Vercel está conectado a `https://github.com/Org-orion/AppRepresentantes`.
O `git remote` local foi atualizado para essa URL (antes apontava para `ConcremPortas`, respondendo por
redirecionamento).

**Verificação — só um deploy prova.** A branch `chore/saneamento` gera **preview** na Vercel: abrir
`<url-do-preview>/dashboard` e apertar F5. Se carregar, a correção está provada **na plataforma**, que é
justamente o que faltou em `b271f33`. Só então promover para produção.

### A8 — `classifyAnexo` classifica por substring solta

Descoberto ao escrever os testes da Etapa 6. A regra é `tipo.toLowerCase().includes('nf')`, então
**qualquer** texto que contenha essas duas letras vira "nota fiscal" — `conferência`, `informe`,
`confirmação`. Um falso positivo aqui faz um pedido faturado **parecer documentado** e sumir da lista
de pendências: some da tela justamente quem precisava de atenção.

`DANFE` também cai como NF, e isso está **correto** (é documento de nota fiscal) — o problema não é a
intenção, é a largura da regra.

**Registrado com TESTE DE CARACTERIZAÇÃO** em `src/utils/pipeline.test.ts`: o comportamento atual está
travado por teste, com comentário explicando que ele documenta o que É, não o que deveria ser. Quem
mudar a regra vai ver o teste falhar e precisar decidir conscientemente.

**Para decidir antes de corrigir:** quais valores de `tipo` o ERP realmente usa? Sem essa lista, trocar
`includes` por igualdade ou por regex ancorada pode deixar de reconhecer documento legítimo — o que é
pior. Levantamento simples: `select distinct tipo from erp.concrem_relatorio_entrega_anexos`.

### A9 — O banco do Portal não tem backup gerenciado — 🟡 PARCIALMENTE TRATADO em 2026-08-25

**Evidência (2026-08-19):** painel do Portal → Database → Backups:
*"Free Plan does not include project backups. Upgrade to the Pro Plan for up to 7 days of scheduled
backups."*

Não é retenção curta. É **zero**. Nem backup diário, nem PITR.

**O que está sem rede:** tudo que é nativo do Portal — usuários e seus vínculos, representantes,
orçamentos e itens, grupos de cliente, notificações, e (quando existir) as marcações de conferido.
Perda ou corrupção nesse banco é **irrecuperável**.

Os dados do ERP **não** correm esse risco: vivem no outro projeto, que é PRO. Mas o Portal não é só uma
casca de leitura — os orçamentos, que são o trabalho dos representantes, nascem e morrem aqui.

**Corrige o pressuposto do plano de migration:** a seção "Backup e recuperação" dizia "confirmar o backup
mais recente". Não existe backup a confirmar. Qualquer aplicação em produção passa a exigir **dump manual
antes**.

**Ações:**

1. **Imediata, hoje:** dump manual com `pg_dump`/`supabase db dump` — ver `docs/BACKUP-MANUAL.md`. As
   ferramentas já estão instaladas na máquina.
2. **Estrutural:** plano pago. Não pelo branching — por um sistema de uso diário estar sem recuperação
   possível. Isto tem precedência sobre boa parte do que resta no plano.
3. Enquanto o plano for free, o dump manual vira **rotina**, não evento.

**Severidade:** alta. Um erro de operação, uma exclusão acidental ou uma migration mal escrita hoje não
tem volta.

#### 🟡 Parcialmente tratado em 2026-08-25 — o que mudou, e o que não

**Quatro coisas diferentes, e vale não confundi-las:**

| | Estado |
|---|---|
| Backup manual verificado | ✅ **realizado** |
| Restore da aplicação (`public`) | ✅ **testado com sucesso** |
| Restore integral da plataforma (`auth`, `storage`) | ❌ **não testado** |
| Backup automático / gerenciado | ❌ **ainda ausente** |

**O risco não foi eliminado.** O projeto segue no Free Plan, sem backup automático. O que caiu foi a
parte mais aguda: até 24/08 não havia **nem cópia nem prova de recuperação**.

**Backup executado.** Destino `C:\Users\1kmz\AppRepresentatives-Backups\2026-08-24`, **fora do
repositório**. Os três dumps na ordem documentada, mais os `.raw.sql` preservados, o manifesto
`SHA256SUMS-20260825.txt` e o `BACKUP-EVIDENCE-20260825.txt`. **8/8 artefatos validados por SHA-256.**
Nenhuma credencial gravada em nenhum deles.

**Conteúdo conferido:** 39 blocos `COPY`, 10 tabelas `public` no schema, e — respondendo a dúvida aberta
desde 19/08 — **o dump de dados contém `auth.users`**. O procedimento documentado serve como está; não
precisa de dump adicional do schema `auth`.

**Restore ensaiado.** PostgreSQL 18.6 local isolado, banco `apprepresentatives_restore_test`, **sem
tocar a produção**: 10/10 tabelas `public` restauradas, dados restaurados, e **contagens comparadas com
produção: 10/10 idênticas**.

> ⚠️ **Não houve restore integral da plataforma Supabase.** Os schemas gerenciados `auth` e `storage`
> não foram reproduzidos num PostgreSQL vanilla; validar o schema da aplicação exigiu adaptações
> **apenas nas cópias locais de teste** — não recriar o role `postgres`, remover
> `GRANTED BY supabase_admin`, ausência de `supabase_vault` e `supabase_realtime`, stubs locais para
> `auth.users`/`auth.uid()`, e assinatura diferente de `postgres_fdw_get_connections`.
>
> A formulação correta é: **backup de schema e dados da aplicação `public` restaurado e validado com
> sucesso.**

**Storage — ponto cego descoberto e coberto.** O bucket `avatars` é **público**, tinha **2 objetos**, e
ambos foram baixados com tamanho conferido contra `storage.objects` e hash no manifesto. Nenhum
documento anterior mencionava esse bucket, e **os dumps não o cobrem**: um backup do Portal tem duas
partes — os dumps do banco e os objetos do Storage.

**Continua sem cobertura:** backup automático e PITR · retenção e frequência definidas · restore
integral da plataforma · senha do user mapping do FDW · configurações de painel · secrets das Edge
Functions e da Vercel.

**Critério de conclusão — proposto aqui, porque a A9 não tinha:**

| | Critério | Estado |
|---|---|---|
| 1 | Cópia verificada por hash, fora do repositório | ✅ cumprido |
| 2 | Cópia **restaurada** e conferida contra a origem | ✅ cumprido para `public` |
| 3 | Rotina com frequência e retenção definidas | ❌ aberto |
| 4 | Backup gerenciado, ou decisão explícita de não ter | ❌ aberto |

**Enquanto 3 e 4 estiverem abertos, A9 permanece como risco.** Detalhamento e decisões pendentes em
`docs/A9-BACKUP-RESTORE.md`.

### A10 — As views do ERP perderam o `security_barrier`

**Evidência (PASSO 1 do C0, consulta 1.5):** `pg_class.reloptions` de `public.concrem_pedidos_venda`
está **`null`**. Se a opção estivesse ativa, apareceria `{security_barrier=true}`.

**Como se perdeu:** `20260630000400_erp_fdw.sql` criou as cinco views **com** a opção:

```sql
create view public.concrem_pedidos_venda with (security_barrier = true) as …
```

`20260706000100_diretores_e_grupos.sql` recriou quatro delas com `create or replace view … as`, **sem
repetir o `with (...)`** — e a opção não sobreviveu. Atingidas: `concrem_pedidos_venda`,
`concrem_pedidos_status`, `concrem_pedidos_status_historico` e `relatorio_entrega_anexos`.
`concremprodutos_produtos` não foi recriada e **provavelmente ainda tem** a opção (confirmar).

**O que `security_barrier` faz:** garante que as condições da própria view sejam avaliadas **antes** de
qualquer condição vinda de fora. Sem ela, o planejador pode antecipar uma função ou operador *leaky* do
usuário e executá-lo sobre linhas que o filtro de escopo ainda descartaria — canal para inferir dados de
fora do escopo (ex.: uma função que levanta erro contendo o valor da linha).

**Severidade: moderada, não crítica.** O risco depende de o usuário conseguir injetar uma expressão
arbitrária na consulta. Pelo PostgREST isso é limitado, e as tabelas nativas continuam protegidas por
**RLS de verdade** — o `security_barrier` protegia apenas estas views sobre o FDW. Ainda assim, é uma
proteção que o projeto decidiu ter, documentou ter, e não tem mais.

**Duas consequências:**

1. **Segurança:** proteção documentada no `CLAUDE.md` e no plano não existe no banco. Documentação e
   realidade divergiam de novo.
2. **Diagnóstico — e esta é boa:** a ausência do `security_barrier` **enfraquece a hipótese da camada 3**.
   Era o principal mecanismo que eu apontava para explicar a falta de pushdown. Sem barreira, o
   planejador está livre para empurrar os filtros do usuário para o ERP. A medição A–G ficou mais
   importante, não menos.

**Não proposto agora** — restaurar a opção é alteração de view, fora do escopo autorizado. Fica
registrado para decisão.

### A11 — O FDW não tem `fetch_size` configurado

**Evidência (1.1):** as opções do server `erp_test` são apenas
`host`, `port`, `dbname`, `sslmode`. Sem `fetch_size`, o `postgres_fdw` usa o padrão de **100 linhas por
viagem**. Trazer 7.600 linhas vira ~76 idas e voltas até o ERP, atravessando o pooler.

Também ausentes: `use_remote_estimate` (por isso o planejador não tem estatística real da tabela remota),
`keep_connections`, `async_capable`, `extensions`.

Observação, não proposta: qualquer ajuste aqui é alteração de FDW e depende de decisão.

### A12 — A view usa o flag `admin`; o app usa a coluna `perfil`

`app_is_admin()` lê **`concremapprep_usuarios.admin`** (flag legado). O frontend
(`src/constants/perfis.ts`) usa a coluna **`perfil`** como fonte de verdade, com os flags apenas como
*fallback* — regra documentada no `CLAUDE.md` e **coberta por teste** desde a Etapa 6.

**As duas regras discordam quando divergem:**

| Situação | App decide | Banco decide | Efeito |
|---|---|---|---|
| `perfil='diretor'` **e** `admin=true` | diretor | **admin** | **o banco entrega acesso global** a quem o app trata como diretor |
| `perfil='admin'` **e** `admin=false` | admin | não-admin | o banco nega o que o app permite |

O primeiro caso é o perigoso: sobra do backfill de junho, que preencheu `perfil` **sem** limpar os flags.
Um usuário promovido a diretor mantendo `admin=true` **vê tudo pela view**.

**Severidade: alta**, condicionada a existir esse par no banco. Verificável pelo teste **S10**.

### A13 — Usuário desativado continua com acesso aos dados

Nem o app nem o banco bloqueiam `concremapprep_usuarios.ativo = false`:

- `AuthContext` carrega `ativo` para o objeto do usuário e **nunca o consulta**;
- `app_is_admin()`, `app_perfil()` e `app_my_rep_codes()` **não filtram por `ativo`**;
- nenhuma policy usa `ativo`.

Desativar alguém na tela de Usuários é, hoje, **puramente cosmético**: enquanto o login no Supabase Auth
funcionar, a pessoa continua lendo tudo do escopo dela.

**Severidade: alta.** É o caminho normal de desligamento de um representante.

`app_escopo_atual()` (E1) exige `ativo is true` — mas **a view continua sem exigir**, então o problema só
some quando as telas migrarem para as RPCs.

### A14 — `app_my_rep_codes()` ignora `representante.ativo`

A função junta `concremapprep_usuario_representantes` com `concremapprep_representantes` **sem filtrar
`r.ativo`**. Representante desativado no cadastro continua concedendo escopo.

**Severidade: a decidir** — pode ser intencional (manter histórico visível). `app_escopo_atual()`
**preserva o comportamento atual de propósito**; mudar exige decisão de negócio.

### A15 — `NULLIF` sobre coluna do ERP bloqueia o pushdown do `postgres_fdw`

Medido no E2-0/N1e. `nullif(upper(btrim(grupo_cliente)), '')` some do `Remote SQL`, cai em `Filter`
local **e arrasta a agregação junto** — o `GroupAggregate` volta para o Portal e a foreign table entrega
linhas cruas. As mesmas funções de texto **isoladas** (N1b `btrim`, N1c `upper`) e **compostas**
(N1d `upper(btrim(...))`) descem sem problema, assim como a coluna crua (N1a).

**O bloqueio é do `NULLIF`, não das funções de texto.** Substituto medido e aprovado — N1f:

```sql
case when grupo_cliente is null or btrim(grupo_cliente) = ''
       then 'SEM GRUPO'
     else upper(btrim(grupo_cliente))
end
```

**Regra que sai daqui:** nenhuma expressão contra coluna do ERP pode usar `NULLIF`/`COALESCE` dentro do
`WHERE`. Sobre **parâmetro** é inofensivo — a proibição vale para coluna.

**Severidade: informativa, mas travante.** Custou a reprovação do primeiro desenho do ramo do diretor.

### A16 — `ORDER BY` faz o generic plan abandonar o aggregate pushdown

Medido no E2-0, N5 contra N5b. A **mesma** consulta, parametrizada com `force_generic_plan`:

| | `ORDER BY` | Filtros | Agregação |
|---|---|---|---|
| N5 | sim | remotos | **local** |
| N5b | não | remotos | **remota** |

Só a agregação muda de lado. Confirmado depois em N6, N7c e N8, e novamente no T1 pós-migration.

**Regra que sai daqui:** nenhuma RPC contra `erp.*` pode ordenar. `app_dashboard_serie_diaria()` **não
garante ordem das linhas** — está escrito no `comment on function`. Quem ordena é o cliente (Etapa E5).

**Severidade: informativa, permanente.** Vale para toda RPC futura contra o FDW.

### A17 — `Max rows = 1000` também limita RPC `returns setof`

Não é um limite exclusivo de `select` em tabela: o PostgREST corta **qualquer** resposta, RPC incluída.
Uma série diária de mais de ~1.000 dias seria truncada **em silêncio**, reintroduzindo exatamente a
pendência que a RPC veio matar (A5).

Por isso o teto de **730 dias** em `app_dashboard_serie_diaria()` — 2 anos, no máximo 731 linhas. É
número **derivado do limite**, não arbitrário. Janela maior levanta `22023`.

Verificado no T7: janela máxima devolveu 366 linhas, `Content-Range: 0-365/366`, sem corte.

**Severidade: informativa.** Toda RPC futura que devolva conjunto precisa de teto explícito.

### A18 — Foreign table nunca recebe `autoanalyze` — PENDÊNCIA ABERTA

`autovacuum` **não** analisa foreign table. O `ANALYZE erp.concrem_pedidos_venda` do C0-ter foi manual e
único; as estatísticas que sustentam o plano vão envelhecer sozinhas e nada as renova.

**Risco hoje é baixo:** com o `ORDER BY` removido (A16), o pushdown que sobrou é decisão de
**capacidade** do `postgres_fdw`, não de **custo** — logo, pouco sensível a estatística ruim. O que era
cost-based (o pushdown de `ORDER BY`/`LIMIT` do C0-ter) saiu do desenho.

**Risco cresce com o tempo** e com qualquer RPC futura cujo plano dependa de seletividade.

**Ação proposta, não executada:** `ANALYZE` periódico da foreign table. Decidir entre `pg_cron` no
Portal e execução manual registrada. Ver etapa E8 de `docs/PLANO-DASHBOARD-RPC.md`.

**Severidade: manutenção.** Não bloqueia a E5.

### A19 — Seletor de representantes devolve lista incompleta — ✅ RESOLVIDO em 2026-08-21

Encontrado durante a verificação manual da E5-6: `10008082 - DANILO AUGUSTO REHNEIN` **não aparecia** no
seletor "Todos os representantes", embora tenha pedidos válidos (12 medidos na E5-0).

Três defeitos somados, todos em código **não tocado pela E5**:

1. **`queryKey` sem escopo** — `useRepresentantesUnicos` usa `['representantes-unicos']`
   (`src/hooks/usePedidosVenda.ts:34`), sem `scopeKey` nem `uid`. É o **único** hook de dado sensível
   nessa condição; compare com `['dashboard-stats', scopeKey, …]` ou `['carteira', { scopeKey, rep }]`.
   Trocar de usuário na mesma aba, sem recarregar, reaproveita a lista do anterior por até 30 min.

2. **A agregação falha com HTTP 400** — `valoresDistintos()` tenta
   `select=representante,count()` (`src/services/pedidosVenda.ts:256`), que é o **único `count()` do
   projeto**. O 400 aparece no console; o código o engole e cai no fallback. Causa provável:
   `db-aggregates-enabled` desligado no PostgREST — **NÃO VERIFICADO**, falta ler a resposta.

3. **O fallback é truncado** — `select=representante` **sem `limit`/`range`**, com `ORDER BY
   representante`. O Data API corta em 1.000 e o `Set` é montado só sobre elas. Como a ordem é pela
   própria coluna, o resultado é um **prefixo alfabético**: todo representante cuja posição acumulada
   passe de 1.000 linhas desaparece.

> O comentário de `pedidosVenda.ts:230-235` descreve o corte como "as 1.000 linhas **mais recentes**".
> Está desatualizado: com `.order(coluna)` o corte é **alfabético**. O mecanismo é o mesmo; a descrição,
> não.

**Efeito colateral:** em produção nem o `console.warn` aparece — ele está atrás de `import.meta.env.DEV`.
A lista chega curta, sem nenhum sinal.

**Impacto na verificação:** impediu testar o `p_representante` do admin com o Danilo, que é o
representante das medições da E5-0. Contornado usando `1000325 - CEDRO REPRESENTAÇÕES LTDA - ME`.

**Severidade: média.** Não é falha de segurança — a view aplica RLS e ninguém vê dado alheio. É perda de
função: o admin não consegue filtrar por quem não está na lista. **`situacoes-entrega` tem exatamente o
mesmo problema.** Não corrigido na E5, de propósito: é anterior a ela e mereceu etapa própria.

#### ✅ Resolvido em 2026-08-21

**Duas causas, medidas antes de qualquer código.**

**Causa 1 — o agregado não é utilizável neste projeto.** O PostgREST responde
`HTTP 400 · PGRST123 — Use of aggregate functions is not allowed`: agregação está desabilitada
(`db-aggregates-enabled`). Não é sintaxe nem bug do código; é configuração de plataforma.

**Causa 2 — o fallback lia uma página só, e caía no teto.** `select=coluna` sem `range`, cortado em 1.000
pelo Data API. Como a consulta ordena por `order(representante)`, **o corte é alfabético, não temporal**:
o que chegava era um PREFIXO da lista ordenada, e todo valor cuja posição acumulada passasse de 1.000
linhas sumia.

**Medição em produção, somente `SELECT`:**

| | |
|---|---|
| Linhas elegíveis | **7.682** |
| Representantes distintos | **243** |
| Distintos que sobreviviam ao fallback antigo | **14** |
| Último antes do corte | `1000325 - CEDRO REPRESENTAÇÕES LTDA - ME` |
| `10008082 - DANILO AUGUSTO REHNEIN` no fallback | **não** |

**14 de 243.** O corte era severo, não marginal.

**Correção — duas partes, ambas em `src/`:**

1. **`valoresDistintos` pagina o fallback** com `.range()` até uma página vir incompleta. A tentativa
   agregada continua primeiro, para o caminho barato voltar a valer sozinho se a agregação for
   habilitada um dia. Filtros, tabela e `order` idênticos; deduplicação só depois de reunir todas as
   páginas; erro de qualquer página continua propagando.
2. **`queryKey` com escopo** em `useRepresentantesUnicos` e `useSituacoesEntrega`. As duas listas saem
   da view com RLS, então o conteúdo depende de quem está logado — a chave fixa permitia reaproveitar a
   lista do usuário anterior na mesma aba.

**Validação manual (2026-08-21):**

- **admin** — Danilo passou a aparecer no seletor do Dashboard e, ao ser escolhido, a tela carregou
  R$ 671,05 · 1 pedido · −87,5 %, batendo com a RPC;
- **troca de escopo na mesma aba** — admin carregou a lista global, logout, login como representante,
  filtro de Pedidos: apareceram **somente os três códigos do próprio escopo**. Nenhum representante
  alheio.

**Nada de RLS, escopo ou backend mudou.** Sem migration, sem SQL, sem alteração de configuração do
Supabase. Cobertura nova: 26 testes (`pedidosVenda.test.ts` e `usePedidosVenda.test.ts`); suíte em 212.

Detalhamento reproduzível em `docs/A19-SELETOR-REPRESENTANTES.md`.

> ⚠️ **O comentário de `pedidosVenda.ts` dizia "as 1.000 linhas mais recentes"** — descrição errada do
> mesmo mecanismo. Corrigido para "primeiras 1.000 em ordem alfabética da coluna".

### A20 — "Trimestre" na UI não é o trimestre civil

`DashboardPage.tsx:793` renderiza um `<Select>` de **T1/T2/T3/T4**, e `ExecutivePeriod` carrega o campo
`trimestre`. Mas `dashboardJanelas` **nunca lê `filtros.trimestre`**: no ramo do trimestre usa

```ts
const mFim = ano === now.getFullYear() ? now.getMonth() : 11;
```

ou seja, **janela móvel de 3 meses** terminando no mês corrente — dezembro, quando o ano selecionado não
é o atual. Verificado na E5-6: período **Jun–Ago**, anterior **Mar–Mai**, com o relógio em agosto.

**O seletor de trimestre do dashboard operacional é decorativo:** muda o estado e não muda número
nenhum. Foi por isso que o seletor de mês acrescentado ao dashboard executivo **não** ganhou um par de
trimestre — replicar seria propagar a mentira.

**A E5 preservou a semântica de propósito.** Mudá-la alteraria números sem pedido, no meio de uma
migração cujo objetivo era não alterar número nenhum além do corrigido pela DIV-1.

**Severidade: UX/semântica, a decidir.** Duas saídas: fazer `trimestre` valer de verdade (T1 = jan–mar…)
ou remover o seletor e rotular como "Últimos 3 meses". É decisão de negócio, não de código.

### Dívidas conhecidas assumidas na E5 — não corrigidas

| | Dívida | Situação |
|---|---|---|
| **D-a** | `if (pedidosErr) return EMPTY_STATS` em `fetchDashboardStats` | **Piorou com a E5.** Antes não havia série a perder; agora um erro na consulta bruta descarta uma série válida que a RPC já entregou. Preservado porque a E5 não redesenharia tratamento de erro. Há comentário no código e teste fixando o comportamento atual |
| **D-b** | Erros dos lotes de status e de anexos são silenciosos | `fetchDashboardStats` desestrutura só `data` nas linhas 514 e 540. Falha ali zera pipeline/faturado **sem aviso**. Pré-existente, fora do escopo |

## Verificação visual pendente — Etapa 3.5

Roteiro reproduzível, ~2 minutos, sem tocar em nada:

1. Abrir o portal e fazer login normalmente.
2. DevTools (F12) → aba Network → marcar **Offline**.
3. Navegar para Pedidos, Acompanhamento, Financeiro e Carteira de Clientes.
   **Esperado:** cartão vermelho "Não foi possível carregar …" com botão
   "Tentar novamente" — **nunca** "Nenhum pedido encontrado".
4. Abrir o Dashboard. **Esperado:** faixa âmbar "Alguns dados não puderam ser
   carregados" acima dos KPIs.
5. Desmarcar Offline e clicar em "Tentar novamente". **Esperado:** os dados voltam
   sem precisar recarregar a página.

Evidência a registrar: uma captura por tela. Enquanto não houver, a etapa fica
como CONCLUÍDO COM RESSALVAS. A evidência definitiva vem na Etapa 6, com um teste
que renderiza cada tela em estado de erro.

## Registro de execução

| Etapa | Assunto | Estado | Data | Evidência | Observações |
|---|---|---|---|---|---|
| 0 | Baseline + branch | **CONCLUÍDO** | 2026-08-19 | branch `chore/saneamento` criada de `fa53856`; commit `452b2f3`; working tree com os 3 arquivos preservados | baseline da tabela acima; nada de código alterado |
| 1 | Segredos e banco antigo | **PARCIAL** | 2026-08-19 | senhas do ERP e do Portal rotacionadas; user mapping atualizado; `count(*)` = 31.906; app com 7.595 pedidos | 1.1 concluída (incidente A1 resolvido). **Falta 1.2** (revogar `anon`) — travada até saber quem pediu a migration `grant_anon_access_co…` no ERP |
| 2 | `CLAUDE.md` | **CONCLUÍDO** | 2026-08-19 | commit `45c0397`; `tsc --noEmit` verde; cada afirmação conferida contra `App.tsx`, `client.ts`, `perfis.ts`, `scope.ts`, `acompanhamento.ts`, `pedidosVenda.ts` e `supabase/migrations/*.sql` | inclui a ação corretiva AC3 (dependência do user mapping) e as 12 pendências conhecidas |
| 3 | ESLint + CI | **CONCLUÍDO** | 2026-08-19 | commit `1a6a311`; 32 problemas encontrados e tratados; `lint` exit 0 com --max-warnings 0, `typecheck` exit 0, `build` 12,03s | 1 exceção documentada (react-refresh). Achado A3 registrado |
| 3.6 | Visibilidade do corte (A5) | **CONCLUÍDO COM RESSALVAS** | 2026-08-19 | commit `5ca1931`; typecheck, lint e build verdes | mitigação, não correção: os números seguem sobre recorte até a Etapa 7. `performance.ts` e `clientGroups.ts` ainda sem aviso |
| 3.5 | Estados de erro (AC1) | **CONCLUÍDO COM RESSALVAS** | 2026-08-19 | commit `abf4435`; typecheck, lint e build verdes | ressalva: verificação visual pendente — roteiro abaixo |
| 4 | Sessão | **CONCLUÍDO COM RESSALVAS** | 2026-08-19 | commit `96a7d12`; typecheck, lint e build verdes; inspeção descarta quebra de fluxo por nova aba | ressalva: matriz de 10 cenários em `docs/ETAPA-4-VERIFICACAO-SESSAO.md` aguarda execução manual; cenário de expiração de token NÃO VERIFICADO |
| 5 | Anti-força-bruta | **PARCIAL** | 2026-08-19 | commit da etapa; typecheck, lint e build verdes | código pronto (envia `captchaToken`, Edge Function não é mais chamada). **Falta a parte de painel** — roteiro em `docs/ETAPA-5-CAPTCHA-NATIVO.md`, com ordem obrigatória |
| 6 | Testes | **CONCLUÍDO COM RESSALVAS** | 2026-08-19 | 56 testes em 6 arquivos, 1,1s; mutação proposital (`diretor` virando global) derrubou 6 testes em 3 arquivos e a restauração devolveu 56 verdes | ressalva: falta o teste de integração de RLS (6.3), que prova o isolamento **no banco** — vai junto da Etapa 7 |
| E1 | Escopo centralizado (`app_escopo_atual`) | **CONCLUÍDO** | 2026-08-20 | migration `20260819000300` aplicada; B1–B4, P6, S1–S8, S11, S12, S16 aprovados | fonte única de escopo; owner `postgres`, `search_path=""`; EXECUTE só para owner e `service_role` |
| E2 | RPC `app_dashboard_serie_diaria` | **CONCLUÍDO** | 2026-08-21 | migration `20260819000400` aplicada; T6 veredito OK | 5 ramos explícitos (A1, A2, B, C, B-grupos), todos em forma medida; teto de 730 dias; sem `ORDER BY` |
| E3 | Verificação da RPC | **CONCLUÍDO** | 2026-08-21 | T1–T8 + API real; SQL versionado em `supabase/tests/e3_rpc_dashboard_serie_diaria.sql`; resultados em `docs/E2-PLANO-RPC-DASHBOARD.md` §Resultados | pushdown nos 5 ramos; equivalência **sem divergência** em 7 perfis; fail-closed em 4 cenários; 117 ms contra teto de 8 s |
| E5 | Dashboard consome a RPC | **CONCLUÍDO** | 2026-08-21 | E5-0 a E5-6 em `docs/E5-VERIFICACAO-DASHBOARD.md`; 115 testes de dashboard, suíte 171/171, `tsc` e `eslint` verdes; 9 cenários manuais em 5 perfis, tela × RPC no mesmo instante | 4 campos migrados (`totalVendidoMes`, `totalVendidoMesAnt`, `pedidosNoPeriodo`, `vendasMensais`); os outros 6 seguem na consulta bruta e o `TruncationNotice` continua válido. DIV-1 muda o número do diretor: +12 pedidos e +R$ 61.979,72 no caso medido. Achados novos: A19, A20. Dívidas assumidas: D-a, D-b |
| E7 | Comunicar a mudança de escopo do diretor | **CONCLUÍDO** | 2026-08-21 | medição read-only na base: 1 diretor ativo, **0 com representantes + grupos**; 1 diretor_geral (escopo já global). Consultas e decisão em `docs/E7-COMUNICACAO-DIRETORES.md` | **0 usuários afetados** pela DIV-1 no snapshot. Comunicação no app **dispensada por ausência de impacto real** — nada enviado, nenhum banner, nenhuma alteração de UI. Contrato `representantes + grupos` permanece; reavaliar quando surgir o primeiro diretor com os dois vínculos |
| 7 | Migrations | PENDENTE | — | — | aguarda D3 + autorização de banco |
| 8 | Conferido no banco | PENDENTE | — | — | D4 aprovada; depende da Etapa 7 |
| 9 | Código morto | PENDENTE | — | — | — |
| 10 | Code-splitting | PENDENTE | — | — | — |
| 11 | Observabilidade | PENDENTE | — | — | autorização de migration |
| 12 | Documentação | PENDENTE | — | — | aguarda D6 |
| 13 | Encerramento | PENDENTE | — | — | — |
