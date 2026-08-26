# A9 — Backup e recuperação do banco do Portal

> **Estado em 2026-08-26.** Oito coisas distintas, e vale não confundi-las:
>
> | | Estado |
> |---|---|
> | Backup manual verificado (25/08) | ✅ **realizado** |
> | Restore da aplicação (`public`) | ✅ **testado com sucesso** |
> | Rotina — primeiro ciclo real, execução manual | ✅ **concluído em 26/08, exit 0** |
> | Cópia externa cifrada — recuperação testada | ✅ **descriptografada, extraída e validada** |
> | **Execução diária automática (Task Scheduler)** | ✅ **ATIVA às 10:30**, validada com exit 0 |
> | **Retenção** | ✅ habilitada · 🟡 **primeira exclusão real ainda não observada** |
> | Restore integral da plataforma (`auth`, `storage`) | ❌ **não testado** |
> | Backup gerenciado / PITR | ❌ **ausente** |
>
> **O risco A9 NÃO foi eliminado.** O projeto segue no Supabase Free Plan, sem backup
> gerenciado e sem PITR. O que mudou é grande: além da cópia manual verificada de 25/08,
> existe uma **rotina que roda sozinha todo dia às 10:30**, produz um conjunto selado, cifra
> uma segunda cópia fora da máquina, e essa cópia já foi **recuperada e conferida byte a byte**.
>
> 📌 **Marcos de 2026-08-26.** Primeiro ciclo manual (`setId 2026-08-26T144106`, exit 0) e
> primeira execução via Task Scheduler (`setId 2026-08-26T164034`, `LastTaskResult 0x0`).
> Detalhamento em `docs/A9-ROTINA-BACKUP.md` §8 e §9.
>
> ⚠️ **O que continua aberto:** a retenção está **habilitada operacionalmente**, mas sua
> **primeira exclusão real ainda não foi observada** — existem 2 conjuntos e a política mantém
> 7 diários, então não há o que apagar; não há backup gerenciado nem PITR; e o restore integral
> da plataforma segue sem teste.
---

## 1. O que motivou

Achado **A9**, registrado em `docs/PLANO-SANEAMENTO.md`: o painel do Portal informa
*"Free Plan does not include project backups"*. Não é retenção curta — é **zero**. Sem backup diário,
sem PITR.

Tudo que é nativo do Portal ficava sem rede: usuários e vínculos, representantes, **orçamentos e itens**,
grupos de cliente, notificações. Os dados do ERP não correm esse risco — vivem em outro projeto, que é
PRO — mas o Portal não é casca de leitura: os orçamentos nascem e morrem aqui.

O procedimento manual já estava escrito em `docs/BACKUP-MANUAL.md` desde 19/08, com duas dúvidas em
aberto e **nenhuma execução registrada**. Esta rodada executou, verificou e ensaiou a recuperação.

## 2. Backup executado — 2026-08-25

**Destino:** `C:\Users\1kmz\AppRepresentatives-Backups\2026-08-24`

> ⚠️ **A pasta e os arquivos têm datas diferentes — é conhecido e proposital.** O diretório físico foi
> criado originalmente como `...\2026-08-24`, mas o backup efetivamente executado e todos os artefatos
> são de **2026-08-25**. A divergência no nome da pasta foi **preservada** para não alterar artefatos já
> verificados por hash: renomear o diretório depois do manifesto seria mexer no que já foi conferido.
>
> **A data autoritativa desta execução é 2026-08-25.** O nome da pasta é apenas onde os arquivos estão.

**Fora do repositório, de propósito.** Os artefatos contêm dados pessoais — usuários, clientes,
orçamentos. Nenhum backup foi copiado para dentro do repositório, e nenhum deve ser.

### Artefatos

| Arquivo | Papel |
|---|---|
| `backup-portal-roles-20260825.sql` | papéis e permissões |
| `backup-portal-schema-20260825.sql` | estrutura — versão final |
| `backup-portal-dados-20260825.sql` | dados — versão final |
| *`.raw.sql` de schema e dados* | **preservados** — as saídas originais, antes das adaptações do ensaio |
| `SHA256SUMS-20260825.txt` | manifesto de integridade |
| `BACKUP-EVIDENCE-20260825.txt` | registro da execução |

**Integridade: 8/8 artefatos do manifesto validados por SHA-256.**

**Nenhuma credencial foi gravada em nenhum desses arquivos.**

> ⚠️ Os `.raw.sql` **não podem ser apagados**. São a saída original do banco; as versões finais passaram
> por adaptações feitas para o ensaio de restauração (ver §5). Confundir os dois é perder a referência
> do que o banco realmente entregou.

## 3. Verificação do conteúdo

| Verificação | Resultado |
|---|---|
| Blocos `COPY` no dump completo | **39** |
| Tabelas `public` presentes no schema | **10** |
| **`auth.users` presente no dump de dados** | ✅ **sim** |

### A dúvida do Auth, respondida

`docs/BACKUP-MANUAL.md` registrava, desde 19/08, um **NÃO VERIFICADO**: não se sabia se
`supabase db dump` incluía o schema `auth`. Se não incluísse, um restore recriaria o sistema **sem
nenhum login possível** — e `concremapprep_usuarios.id` referencia `auth.users(id)`, então nem a chave
estrangeira fecharia.

**Está respondido: o dump de dados contém `auth.users`.** O procedimento documentado **serve**, e não
precisa de um dump adicional do schema `auth`.

## 4. Restore-test — o que foi provado

**Ambiente:** PostgreSQL **18.6 local isolado**, banco `apprepresentatives_restore_test`.

**A produção não foi alterada em nenhum momento do ensaio.**

| | Resultado |
|---|---|
| Tabelas `public` restauradas | **10/10** |
| Dados `public` restaurados | ✅ |
| Contagens restore × produção | **10/10 idênticas** |

**É isto que ficou provado: o backup de schema e dados da aplicação `public` restaura e confere.** A
comparação de contagens tabela a tabela é o que transforma "o arquivo abriu" em "os dados estão lá".

## 5. Limitações do restore-test — leia antes de concluir demais

> **NÃO houve restore integral da plataforma Supabase.** Os schemas internos gerenciados — `auth` e
> `storage` — não foram reproduzidos num PostgreSQL vanilla.

Para validar o schema e os dados da aplicação, foram necessárias adaptações **somente no ambiente local
de teste**:

- **não recriar nem alterar o role `postgres`**;
- **remover `GRANTED BY supabase_admin`** — apenas das cópias usadas no teste, nunca dos `.raw.sql`;
- **`supabase_vault` não existe** no PostgreSQL vanilla;
- **`auth.users` e `auth.uid()` foram representados por stubs locais**, exclusivamente para permitir
  validar o schema `public`;
- **`supabase_realtime` é gerenciado pela plataforma** e não existe localmente;
- **`postgres_fdw_get_connections` tem assinatura diferente** no PostgreSQL vanilla.

**O que isso significa na prática.** Um PostgreSQL comum não é um projeto Supabase: falta a camada que a
plataforma administra. O ensaio provou que **os dados e a estrutura da aplicação sobrevivem e voltam**.
Ele **não** provou que um projeto Supabase inteiro pode ser reconstituído a partir destes arquivos —
autenticação de ponta a ponta, Storage, Realtime e as configurações de painel não foram exercitadas.

**A frase correta é:** *backup de schema e dados da aplicação `public` restaurado e validado com
sucesso.* Qualquer formulação mais forte que isso seria falsa.

## 6. Storage

| | |
|---|---|
| Bucket `avatars` | **público** |
| Objetos existentes | **2** |
| Objetos baixados | **2** |
| Tamanhos locais × `storage.objects` | **bateram exatamente** |
| No manifesto SHA-256 | ✅ ambos |

O bucket foi descoberto na auditoria da A9 e **não constava de nenhum documento anterior**. Era um ponto
cego: `pg_dump` e `supabase db dump` produzem dump **lógico do banco** — os objetos binários do Storage
**não entram** em nenhum dos três arquivos. A cópia dos dois objetos foi feita à parte, e a conferência
de tamanho contra `storage.objects` é o que garante que vieram íntegros.

**Consequência para a rotina:** todo backup do Portal precisa de **duas** partes — os dumps do banco e a
cópia dos objetos do Storage. Um sem o outro é backup incompleto.

## 7. O que continua sem cobertura

| | Item | Situação |
|---|---|---|
| ❌ | **Backup automático / gerenciado** | plano Free não inclui. **Este é o núcleo do A9, e continua aberto.** Decisão registrada: permanecer no Free como aceitação explícita de risco, com quatro gatilhos de reavaliação — ver `docs/A9-ROTINA-BACKUP.md` §1.1 |
| ❌ | **PITR** | idem |
| 🟡 | Retenção | **política aprovada** (7/4/3), implementada e **habilitada na tarefa agendada**. O caminho **destrutivo** ainda não foi observado: com 2 conjuntos e `Daily = 7` não há o que apagar — a primeira remoção deve ocorrer por volta do 8º ciclo diário |
| ✅ | Frequência | **política aprovada** (diária + `prechange`) e **em vigor**: a tarefa do Task Scheduler executa o backup `scheduled` **todo dia às 10:30** |
| ✅ | **Segunda cópia, cifrada e fora da máquina** | AES256 no OneDrive, sincronização confirmada, **recuperação testada** — ver `docs/A9-ROTINA-BACKUP.md` §8.3. ⚠️ `exit 0` prova gravação local e hash, **não** upload concluído: a sincronização é assíncrona e a conferência do status verde continua humana |
| ✅ | **Execução diária automática** | Task Scheduler **ATIVO** — diário às 10:30, `Interactive` + `Limited`, validado com exit 0 — ver `docs/A9-ROTINA-BACKUP.md` §9 |
| ❌ | Restore integral da plataforma | ver §5 |
| ❌ | **Senha do user mapping do FDW** | não está em nenhum artefato de backup, por decisão de segurança. Rotacioná-la sem atualizar o mapping derruba metade do sistema — ver `docs/INCIDENTE-2026-08-19-FDW.md` |
| ❌ | Configurações de painel | `Max rows = 1000`, agregações desabilitadas, CAPTCHA do Auth, política de senha |
| ❌ | Secrets das Edge Functions e da Vercel | por nome apenas: `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `VITE_*` |

**O RPO passou a depender da tarefa agendada, e não mais da memória de alguém.** A política
define 24 h e a tarefa roda diariamente às 10:30. Duas ressalvas: a tarefa é `Interactive`,
então **um dia sem logon é um dia sem backup** (mitigado por `StartWhenAvailable`, que
recupera o horário perdido no próximo logon); e o RPO só se confirma acompanhando a série de
execuções. Até 26/08 houve **duas** execuções bem-sucedidas — uma manual, uma pela tarefa.

## 8. Decisões que continuam com o dono

Nenhuma delas foi tomada nesta rodada:

| # | Decisão |
|---|---|
| 1 | **Assinar o plano Pro?** É a única opção que traz backup gerenciado, cobrindo `auth` e Storage sem construir nada |
| 2 | **RPO aceitável** — 24 h exige automação; manual, na prática, dá semanal |
| 3 | **Retenção** — quantos backups, por quanto tempo, quem apaga |
| 4 | **Frequência** — o que transforma esta execução em rotina |
| 5 | **Quem pode restaurar** — restore é destrutivo no destino |
| 6 | **Cifragem e destino de longo prazo** — hoje os artefatos estão numa pasta local |
| 7 | **Periodicidade do ensaio de restore** — backup nunca restaurado deixa de ser backup com o tempo |

## 9. Segurança dos artefatos

- **Nenhuma credencial** foi gravada nos arquivos de backup, no manifesto ou no arquivo de evidência.
- Nenhuma connection string, senha, token ou secret aparece nesta documentação.
- Os artefatos **não estão no repositório** e não devem entrar. O `.gitignore` bloqueia
  `backup-*.sql`, `*.dump` e `dump-*.sql` — **rede de segurança, não permissão**.
- Os dumps contêm **dados pessoais**: usuários, clientes e orçamentos. O destino atual é uma pasta
  local; cifragem e destino de longo prazo são a decisão 6 acima.
- O ensaio rodou em banco local isolado. **A produção não foi tocada.**

---

## Critério de conclusão da A9

| | Critério | Estado |
|---|---|---|
| 1 | Existe cópia verificada por hash, fora do repositório | ✅ **cumprido** — 8/8 artefatos |
| 2 | A cópia foi **restaurada** e conferida contra a origem | ✅ **cumprido** para `public` — 10/10 contagens |
| 3 | Existe rotina com frequência e retenção definidas, **que executa sozinha** | ✅ **cumprido** — Task Scheduler ativo, diário às 10:30, validado com `LastTaskResult 0x0`; retenção habilitada |
| 4 | Existe backup gerenciado, ou decisão explícita de não ter | 🟡 **parcial** — não há backup gerenciado; a permanência no Free está registrada como **aceitação explícita de risco**, com quatro gatilhos de reavaliação |
| 5 | A segunda cópia é **recuperável**, não apenas íntegra | ✅ **cumprido** — decrypt + extract + verify sobre o artefato sincronizado |

**A9 permanece 🟡 PARCIALMENTE TRATADO.** Até 24/08 não havia nem cópia nem prova de
recuperação; em 25/08 passou a haver as duas, manualmente; em 26/08 passou a haver uma
**rotina agendada que sela, cifra, e cuja cópia externa comprovadamente volta**.

O que falta agora é de outra natureza: **observar a retenção apagando de verdade** — ela está
habilitada, mas ainda não teve o que apagar — e a decisão de negócio sobre backup gerenciado
e PITR.
O restore integral da plataforma (`auth`, `storage`) segue sem teste, e nada nesta rodada
mudou isso.
