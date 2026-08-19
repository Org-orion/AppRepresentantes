# Etapa 1 — Rotação de segredos e revogação do `anon` no banco antigo

> **Executor: humano (Kaio).** Ação em produção — o Claude Code não executa nada aqui.
> Origem da pendência: `migration/RESUMO.md` §7 (aberta desde 2026-06-30).
> Plano-mãe: `docs/PLANO-SANEAMENTO.md` · Classificação: **T4 — crítica/externa**.

---

## Por que isto é a primeira etapa

Durante a migração de junho, senhas de banco apareceram em texto claro. Segredo exposto é o item de
maior autoridade na hierarquia do cérebro — vem antes de qualquer melhoria de código.

## ⚠️ O risco que define a ordem dos passos (R1)

A senha do `postgres` do **banco do ERP** não vive só no ERP: ela está gravada no **user mapping do FDW
dentro do banco do Portal** (server `erp_test`, criado em `migration/03_erp_fdw.sql`).

**Trocar a senha no ERP sem atualizar o user mapping derruba, na mesma hora:**
Pedidos · Acompanhamento · Central Financeira (NF/boleto) · Carteira de Clientes · Dashboards de diretor ·
Catálogo de produtos. Sobram apenas os Orçamentos (tabela nativa do Portal).

Por isso os passos 3 e 4 são **um bloco só**, na mesma janela, sem intervalo.

## ⚠️ Segundo ponto de atenção

O banco do ERP é **compartilhado com outra aplicação**. Antes de trocar a senha do `postgres` dele,
confirme se essa outra app se conecta com o papel `postgres` (e não com a anon key ou um papel próprio).
Se ela usar `postgres`, ela também precisa da senha nova na mesma janela.

---

## Pré-condições

- [ ] Janela combinada, fora do horário comercial dos representantes.
- [ ] Confirmado como a outra aplicação se conecta ao banco do ERP (ver acima).
- [ ] Acesso de administrador aos dois projetos Supabase:
      Portal `ikjeyaxfciferyezxskh` · ERP `ctntlgvoefdbjxvfkahp`.
- [ ] Gerenciador de senhas aberto para guardar as senhas novas (elas **não** vão para o repositório,
      nem para o Obsidian, nem para esta conversa).
- [ ] Confirmado que o backup/PITR dos dois projetos está ativo antes de mexer.

---

## Parte 1.1 — Rotação das senhas

### Passo 1 — Inventário (antes de trocar nada)

No **banco do Portal**, SQL Editor:

```sql
-- Quais servers FDW existem e para onde apontam
select srvname, srvoptions from pg_foreign_server;

-- Quais user mappings existem (mostra as opções, não a senha em claro)
select um.umuser::regrole as papel_local, s.srvname, um.umoptions
from pg_user_mapping um
join pg_foreign_server s on s.oid = um.umserver;
```

Anote o **nome exato do server** (esperado: `erp_test`) e o **papel local** do mapping — é o que você vai
usar no passo 4. Guarde a saída: é a evidência do estado anterior.

### Passo 2 — Rotacionar a senha do banco do PORTAL (baixo risco, faça primeiro)

Painel do projeto `ikjeyaxfciferyezxskh` → **Project Settings → Database → Reset database password**.

Nada no app depende dessa senha (o frontend usa a anon key + JWT), então este passo é seguro e isolado.
Se algo falhar aqui, você descobre antes de encostar no ERP.

- [ ] Senha nova gerada e guardada no gerenciador.
- [ ] App aberto e funcionando normalmente (nada deveria mudar).

### Passo 3 — Rotacionar a senha do banco do ERP

Painel do projeto `ctntlgvoefdbjxvfkahp` → **Project Settings → Database → Reset database password**.

> A partir daqui o FDW está quebrado. **Vá direto para o passo 4, sem pausa.**

- [ ] Senha nova gerada e guardada no gerenciador.

### Passo 4 — Atualizar o user mapping no banco do PORTAL (imediatamente)

No **banco do Portal**, SQL Editor — substitua `<SENHA_NOVA>` pela senha do passo 3 e ajuste o nome do
papel se o passo 1 mostrou algo diferente de `postgres`:

```sql
alter user mapping for postgres
  server erp_test
  options (set password '<SENHA_NOVA>');
```

> Se o `set` falhar dizendo que a opção não existe, use `options (add password '<SENHA_NOVA>')`.

**Depois de executar, apague o texto do SQL Editor** — ele guarda histórico de queries.

### Passo 5 — Validar a conexão no banco (evidência técnica)

Ainda no banco do Portal:

```sql
-- Se o FDW estiver ok, isto responde; se a senha estiver errada, dá erro de autenticação
select count(*) from erp.concrem_pedidos_venda;   -- esperado: ~29.269 (era esse o número na migração)
select count(*) from erp.concrem_pedidos_status;
select count(*) from erp.concrem_pedidos_status_historico;
select count(*) from erp.concrem_relatorio_entrega_anexos;
select count(*) from erp.concremprodutos_produtos;
```

- [ ] As 5 consultas responderam sem erro de autenticação. **Cole os números no registro no fim deste arquivo.**

### Passo 6 — Validar no app (evidência de comportamento)

Login como um **representante real** (não admin — o admin passa por outro caminho nas policies):

- [ ] **Pedidos** — lista com dados e contagem coerente.
- [ ] **Acompanhamento** — pipeline com pedidos nos estágios.
- [ ] **Central Financeira** — NF e boleto abrindo.
- [ ] **Carteira de Clientes** — clientes listados.
- [ ] **Dashboard** — KPIs preenchidos.

Login como **diretor** ou **diretor geral**:

- [ ] Sala de Comando carregando com dados.

### Rollback do 1.1

Se qualquer validação falhar e não for possível corrigir na janela: repita o passo 4 com a **senha
anterior** do ERP e, se necessário, reverta a senha no painel do ERP. O FDW volta a funcionar
imediatamente — não há perda de dado, porque o FDW só lê.

---

## Parte 1.2 — Revogar `anon` no banco antigo (ERP)

Hoje as tabelas `concrem_*` do ERP ainda têm `grant select to anon`, de antes da migração. O frontend do
Portal não usa mais a anon key antiga (lê tudo pelo FDW), então o acesso pode sair.

**Risco R2:** a outra aplicação que alimenta o ERP pode depender desses grants.

### Passo 1 — Inventariar antes de revogar

No **banco do ERP**:

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name;
```

- [ ] Lista salva (evidência do estado anterior — é o que permite desfazer).

### Passo 2 — Confirmar com a outra aplicação

- [ ] Verificado se a outra app usa a anon key do ERP. **Se usar, não revogue as tabelas dela.**

### Passo 3 — Revogar apenas o que o Portal deixou de usar

```sql
revoke select on public.concrem_pedidos_venda            from anon;
revoke select on public.concrem_pedidos_status           from anon;
revoke select on public.concrem_pedidos_status_historico from anon;
revoke select on public.concrem_relatorio_entrega_anexos from anon;
revoke select on public.concremprodutos_produtos         from anon;
```

### Passo 4 — Validar

- [ ] Portal continua funcionando (ele lê pelo FDW, com o papel `postgres` — não é afetado).
- [ ] A outra aplicação continua funcionando.

### Rollback do 1.2

`grant select on <tabela> to anon;` — reversível em segundos, usando a lista do passo 1.

---

## Registro da execução (preencher — **sem valores de senha**)

| Item | Estado | Data/hora | Quem | Evidência |
|---|---|---|---|---|
| Inventário do FDW (1.1 passo 1) | | | | saída da query |
| Senha do Portal rotacionada | | | | — |
| Senha do ERP rotacionada | | | | — |
| User mapping atualizado | | | | — |
| Validação das 5 views | | | | contagens: |
| Validação no app (representante) | | | | telas conferidas |
| Validação no app (diretor) | | | | — |
| Inventário dos grants `anon` (1.2) | | | | saída da query |
| Revogação do `anon` | | | | — |
| Validação da outra aplicação | | | | — |

**Estado final da Etapa 1:** `CONCLUÍDO` · `CONCLUÍDO COM RESSALVAS` · `PARCIAL` · `BLOQUEADO` · `ADIADO (risco residual registrado)`

> Se optar por adiar: registre aqui o risco residual (risco, impacto, controles atuais, responsável,
> prazo de revisão) e o plano segue para a Etapa 2 — nenhuma outra etapa depende desta.

---

## O que NÃO fazer

- ❌ Colar senha nova em commit, issue, nota do Obsidian ou nesta conversa.
- ❌ Trocar a senha do ERP e deixar o user mapping para depois.
- ❌ Revogar o `anon` sem o inventário do passo 1 (sem ele não há como desfazer com precisão).
- ❌ Executar em horário comercial.
