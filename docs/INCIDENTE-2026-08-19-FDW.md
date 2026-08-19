# Incidente — FDW do ERP fora do ar (pedidos invisíveis no portal)

> Estrutura: **Cérebro — Resposta a Incidentes** §13/§17. Status: **ENCERRADO** (fase emergencial).

## Identificação

| Campo | Valor |
|---|---|
| ID | INC-2026-08-19-FDW |
| Projeto | Concrem Connect (AppRepresentantes) |
| Ambiente | Produção |
| Severidade | **SEV-2** — funcionalidade principal indisponível para todos os perfis, sem perda de dados |
| Categorias | Disponibilidade · Integração · Gestão de credenciais |
| Detectado em | 2026-08-19, ~09:55 (America/Sao_Paulo) |
| Início real | **NÃO DETERMINADO** — ver Risco residual |
| Recuperado em | 2026-08-19, durante a sessão |
| Coordenação | Kaio (execução) · Claude Code (diagnóstico) |

## Resumo

O banco do Portal lê os dados do ERP ao vivo por `postgres_fdw`. A senha usada nessa conexão fica no
*user mapping* do server `erp_test`, dentro do banco do Portal. Em algum momento a senha do banco do ERP
foi rotacionada **sem** atualizar esse user mapping. A partir daí toda leitura do ERP passou a falhar com
`FATAL: password authentication failed`, e o portal passou a exibir zero pedidos para todo mundo.

## Impacto

**Indisponível:** Central de Pedidos · Acompanhamento · Central Financeira (NF/boleto) · Carteira de
Clientes · Dashboards de diretor e diretor geral · Catálogo de produtos.
**Não afetado:** Orçamentos, usuários, representantes e grupos (tabelas nativas do Portal); login.
**Dados:** nenhuma perda. O FDW é somente leitura e o ERP nunca foi alterado.

## Como foi detectado

Por acaso, durante o passo 1 da Etapa 1 do plano de saneamento. Uma query de catálogo no SQL Editor
retornou timeout; a investigação mostrou o app com 0 pedidos e os logs do Postgres cheios de erros.
**Nenhum alerta disparou. Nenhum usuário reportou.**

## Linha do tempo

| Quando | O quê |
|---|---|
| Data desconhecida | Senha do banco do ERP rotacionada; user mapping do FDW não atualizado |
| — | Portal passa a exibir 0 pedidos; ninguém percebe (ver Fator contribuinte 2) |
| 2026-08-19 ~09:52 | Timeout no SQL Editor do Portal ao rodar query de inventário do FDW |
| ~09:55 | Logs do Portal com centenas de `could not connect to server "erp_test"` |
| ~09:58 | App confirmado com 0 pedidos logado como Administrador |
| — | Portal descartado como causa: 9/60 conexões, CPU 2,91%, 0 queries bloqueadas |
| — | ERP descartado como pausado: **Healthy**, plano PRO, backup de 8h atrás |
| — | Detalhe do log revela a causa: `password authentication failed for user "postgres"` |
| — | Inventário confirma que o `user` do mapping já estava correto (`postgres.<ref>`) → resta a senha |
| — | Senha do ERP rotacionada e gravada no user mapping do Portal |
| — | `select count(*) from erp.concrem_pedidos_venda` → **31.906** |
| — | App com **7.595 pedidos** e KPIs preenchidos. Incidente encerrado |

## Evidências

- Logs Postgres do Portal: `could not connect to server "erp_test"`, com
  `detail: connection to server at "aws-1-sa-east-1.pooler.supabase.com" (64:ff9b::12e4:a3f5), port 5432 failed: FATAL: password authentication failed for user "postgres"`.
- Observability do Portal: 9/60 conexões, CPU 2,91%, nenhuma query bloqueada, nenhuma sessão ativa.
- Project Overview do ERP: STATUS Healthy, compute MICRO, último backup 8 horas antes.
- Inventário do user mapping: papel local `postgres`, server `erp_test`, `user=postgres.ctntlgvoefdbjxvfkahp`.
- Pós-correção: `count(*)` = 31.906; Central de Pedidos com 7.595 pedidos, R$ 37,6M em valor total.

## Hipóteses consideradas

| Hipótese | Veredito |
|---|---|
| Soluço do SQL Editor | **Descartada** — o app também estava sem dados |
| Projeto do ERP pausado por inatividade (plano free) | **Descartada** — ERP está Healthy e é PRO |
| Portal sem conexões / sobrecarregado | **Descartada** — 9/60 conexões, CPU 3% |
| Usuário do pooler sem o ref do projeto | **Descartada** — inventário mostrou `postgres.<ref>`, já correto |
| **Senha do mapping desatualizada** | **CONFIRMADA** — mensagem explícita do servidor |

## Causa confirmada

Rotação da senha do banco do ERP sem a atualização correspondente do user mapping do FDW no banco do
Portal. A senha da integração é uma **dependência invisível** da senha do banco: ela não está no código,
não está em variável de ambiente e não aparece em nenhuma tela — vive apenas dentro do catálogo do Postgres.

## Fatores contribuintes

1. **Dependência não documentada no ponto de uso.** O acoplamento estava descrito em `migration/03_erp_fdw.sql`
   e no `RESUMO.md`, mas nada avisa quem aperta "Reset database password" no painel do ERP.
2. **A interface escondeu a falha.** `PedidosPage.tsx` consome apenas `isLoading`/`isFetching` e nunca
   `isError`, então a queda apareceu como **"Nenhum pedido encontrado"** (defeito A2 do plano de saneamento).
   Sem isso, alguém teria reportado no primeiro dia.
3. **Sem observabilidade.** Não há alerta de erro de banco nem monitoramento do FDW — a falha se repetiu
   centenas de vezes nos logs sem gerar nenhum sinal.
4. **Atrito operacional no SQL Editor.** O `Run` executa apenas o trecho selecionado, e o comando de
   correção chegou a rodar pela metade (`role "mapping" does not exist`). O mesmo atrito já havia causado
   falhas na migração de junho (`RESUMO.md` §8).

## O que funcionou

- Os logs do Postgres continham a causa exata, com host, porta e motivo.
- O risco **R1** do plano de saneamento já descrevia esse acoplamento — o plano previu o mecanismo da
  falha antes de saber que ela já estava acontecendo.
- O ERP nunca foi tocado: diagnóstico e correção ficaram inteiramente do lado do Portal.

## Correção aplicada

1. Reset da senha do banco do ERP (`ctntlgvoefdbjxvfkahp`), painel do Supabase.
2. No banco do **Portal** (`ikjeyaxfciferyezxskh`):
   `alter user mapping for postgres server erp_test options (set password $$…$$);`
3. Validação por `count(*)` nas foreign tables e conferência visual no app.

Efeito colateral positivo: a senha exposta durante a migração de junho — pendência aberta em
`migration/RESUMO.md` §7 — deixou de valer. A parte da rotação do ERP da Etapa 1 está cumprida.

## Risco residual

| Risco | Detalhe |
|---|---|
| **Duração desconhecida** | Não foi possível determinar quando a rotação original ocorreu. Não sabemos por quanto tempo a operação ficou cega, nem se decisões comerciais foram tomadas com telas vazias. Investigar exige log retido além da janela disponível |
| **Autor desconhecido** | Não se sabe quem rotacionou a senha do ERP nem se outras integrações do mesmo banco ficaram quebradas junto |
| **Recorrência** | Enquanto o defeito A2 existir, a próxima queda também será silenciosa |
| **Portal em plano FREE** | Projeto de produção sujeito a pausa por inatividade e com retenção de backup limitada |

## Ações corretivas

| # | Ação | Onde entra | Dono |
|---|---|---|---|
| AC1 | Estado de erro real nas telas que dependem do ERP — falha nunca mais aparecer como "nenhum resultado" | Etapa 3.5 do plano | Claude Code |
| AC2 | Alerta de erro de banco / falha do FDW | Etapa 11 (Observabilidade) | Claude Code |
| AC3 | Aviso da dependência do user mapping onde a rotação acontece (runbook + `CLAUDE.md` + nota-mãe) | Etapa 2 e Etapa 12 | Claude Code |
| AC4 | Descobrir quem rotacionou a senha do ERP e se outras integrações quebraram | — | Kaio |
| AC5 | Avaliar migrar o Portal para plano pago (pausa por inatividade + backup) | Etapa 13 (riscos) | Kaio |
| AC6 | Concluir o restante da Etapa 1 (senha do Portal, revogação do `anon`) | Etapa 1 | Kaio |

## Pendência de verificação (fora do incidente)

Após a recuperação, a Central de Pedidos mostra **FATURADOS 0** convivendo com 344 entregues, 97 em
entrega e 371 "Com NF". Pode ser recorte de período legítimo ou defeito de KPI. **NÃO VERIFICADO** —
checar durante a Etapa 6 (testes) ou antes, se você achar que o número está errado.
