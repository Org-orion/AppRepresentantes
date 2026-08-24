# E7 — Comunicação da mudança de escopo do diretor

> ✅ **CONCLUÍDA em 2026-08-21.** Impacto medido na base de produção: **0 usuários afetados**.
> Comunicação no app **dispensada**. Nenhuma notificação enviada, nenhum banner criado, nenhuma
> alteração de interface.
>
> Etapa E7 de `docs/PLANO-DASHBOARD-RPC.md`. Somente `SELECT` — nenhuma escrita no banco.

---

## A. Objetivo

Comunicar corretamente a mudança de números causada pela centralização do escopo do diretor, sem sugerir
erro anterior, duplicação de dados, perda de segurança ou alteração arbitrária de informação.

A etapa nasceu como um lembrete de uma linha — "comunicar que os números mudaram" — de quando a
expectativa era mudança apenas de **precisão**. A DIV-1 mudou a natureza do problema: o número do
diretor poderia mudar de **valor**. Faltava definir canal, público, texto, duração e o que contaria como
"comunicado".

## B. Motivo

A medição **E5-0** provou que o contrato correto do diretor é a **união** dos representantes e dos
grupos sob sua gestão, e não apenas os grupos. É a mesma regra que o banco já aplicava; o frontend é que
estava mais estreito.

Consequência potencial: **o indicador de um diretor que tivesse os dois tipos de vínculo passaria a
mostrar um valor maior.** Isso é correção de um filtro incompleto, não mudança de dado — mas, do ponto
de vista de quem lê o número, é uma mudança que precisa de explicação.

Daí a E7.

## C. Fontes usadas na medição

Os mesmos critérios de `public.app_escopo_atual()`
(`supabase/migrations/20260819000300_escopo_centralizado.sql`), para que a medição descreva o escopo
real e não uma aproximação.

| Conceito | Fonte | Critério |
|---|---|---|
| Diretor ativo | `concremapprep_usuarios` | `ativo is true` **e** perfil efetivo `= 'diretor'` |
| Perfil efetivo | idem | `coalesce(nullif(btrim(perfil),''), …flags…)` — a coluna `perfil` decide; os flags `admin`/`operador` só entram quando ela é nula ou vazia (achado A12) |
| Representantes | `concremapprep_usuario_representantes` ⋈ `concremapprep_representantes` | `representante_erp` não nulo e não vazio |
| Grupos | `user_client_groups` ⋈ `client_groups` | `is_active is true`, `normalized_name` não nulo e não vazio |

## D. Nuance A14 — o que conta como "representante no escopo"

`app_escopo_atual()` **não filtra `r.ativo`**, de propósito, para preservar o comportamento de
`app_my_rep_codes()` (achado **A14**, decisão de negócio em aberto).

Isso importa para esta medição: **um diretor vinculado a um representante inativo no cadastro está
afetado pela DIV-1**, porque o código desse representante entra no escopo dele hoje mesmo. Filtrar
`r.ativo = true` contaria **menos** diretores do que a realidade.

- **`reps_escopo`** — sem filtro de `ativo` — é a **métrica canônica** de impacto;
- `reps_ativos` — com o filtro — foi medida em paralelo apenas para informar a decisão sobre A14;
- **grupos** exigem `is_active = true`, sem ambiguidade.

Neste snapshot as duas deram o mesmo resultado, então a ambiguidade não alterou a conclusão. Ela pode
alterar no futuro.

## E. Consultas executadas

**Somente `SELECT`.** Nenhum `INSERT`, `UPDATE`, `DELETE`, DDL, função temporária, vínculo temporário ou
transação com escrita.

### E.1 — Contagens agregadas

```sql
with diretores as (
  select u.id, u.nome, u.email
  from public.concremapprep_usuarios u
  where u.ativo is true
    and coalesce(nullif(btrim(u.perfil), ''),
                 case when u.admin then 'admin'
                      when u.operador then 'operador'
                      else 'representante' end) = 'diretor'
),
medido as (
  select d.id,
         -- REGRA REAL de escopo: app_escopo_atual() NÃO filtra r.ativo (A14)
         (select count(*) from public.concremapprep_usuario_representantes ur
            join public.concremapprep_representantes r on r.id = ur.representante_id
           where ur.usuario_id = d.id
             and r.representante_erp is not null
             and btrim(r.representante_erp) <> '')                as reps_escopo,
         -- Variante com o filtro de ativo, só para a decisão sobre A14
         (select count(*) from public.concremapprep_usuario_representantes ur
            join public.concremapprep_representantes r on r.id = ur.representante_id
           where ur.usuario_id = d.id
             and r.ativo is true
             and r.representante_erp is not null
             and btrim(r.representante_erp) <> '')                as reps_ativos,
         (select count(*) from public.user_client_groups ucg
            join public.client_groups cg on cg.id = ucg.client_group_id
           where ucg.user_id = d.id
             and cg.is_active is true
             and cg.normalized_name is not null
             and btrim(cg.normalized_name) <> '')                 as grupos_ativos
  from diretores d
)
select count(*)                                                      as diretores_ativos,
       count(*) filter (where reps_escopo  > 0)                      as com_reps_escopo,
       count(*) filter (where reps_ativos  > 0)                      as com_reps_ativos,
       count(*) filter (where grupos_ativos > 0)                     as com_grupos,
       count(*) filter (where reps_escopo  > 0 and grupos_ativos > 0) as AFETADOS_DIV1,
       count(*) filter (where reps_ativos  > 0 and grupos_ativos > 0) as afetados_se_filtrar_ativo,
       count(*) filter (where reps_escopo = 0 and grupos_ativos = 0) as sem_escopo_nenhum
from medido;
```

### E.2 — Tabela mínima dos afetados

Devolve **só** o necessário para destinar a comunicação: identificador, nome e as duas contagens. Sem
pedidos, sem valores, sem clientes, sem nomes de representantes, sem nomes de grupos.

```sql
with diretores as (
  select u.id, u.nome
  from public.concremapprep_usuarios u
  where u.ativo is true
    and coalesce(nullif(btrim(u.perfil), ''),
                 case when u.admin then 'admin'
                      when u.operador then 'operador'
                      else 'representante' end) = 'diretor'
)
select d.id                                                          as usuario_id,
       d.nome,
       (select count(*) from public.concremapprep_usuario_representantes ur
          join public.concremapprep_representantes r on r.id = ur.representante_id
         where ur.usuario_id = d.id
           and r.representante_erp is not null
           and btrim(r.representante_erp) <> '')                     as qtd_representantes,
       (select count(*) from public.user_client_groups ucg
          join public.client_groups cg on cg.id = ucg.client_group_id
         where ucg.user_id = d.id
           and cg.is_active is true
           and cg.normalized_name is not null
           and btrim(cg.normalized_name) <> '')                      as qtd_grupos
from diretores d
where (select count(*) from public.concremapprep_usuario_representantes ur
         join public.concremapprep_representantes r on r.id = ur.representante_id
        where ur.usuario_id = d.id
          and r.representante_erp is not null
          and btrim(r.representante_erp) <> '') > 0
  and (select count(*) from public.user_client_groups ucg
         join public.client_groups cg on cg.id = ucg.client_group_id
        where ucg.user_id = d.id
          and cg.is_active is true
          and cg.normalized_name is not null
          and btrim(cg.normalized_name) <> '') > 0
order by d.nome;
```

### E.3 — Diretores gerais ativos

```sql
select count(*) as diretor_geral_ativos
from public.concremapprep_usuarios u
where u.ativo is true
  and coalesce(nullif(btrim(u.perfil), ''),
               case when u.admin then 'admin'
                    when u.operador then 'operador'
                    else 'representante' end) = 'diretor_geral';
```

### E.4 — Sanidade dos perfis

Protege contra o caso em que a coluna `perfil` esteja nula e o perfil venha do fallback — o que mudaria
a contagem sem aviso.

```sql
select coalesce(nullif(btrim(u.perfil), ''),
                case when u.admin then 'admin'
                     when u.operador then 'operador'
                     else 'representante' end) as perfil_efetivo,
       count(*) filter (where u.ativo is true)     as ativos,
       count(*) filter (where u.ativo is not true) as inativos
from public.concremapprep_usuarios u
group by 1 order by 2 desc;
```

## F. Resultados — snapshot de 2026-08-21

### Diretores

| Métrica | Valor |
|---|---|
| Diretores ativos | **1** |
| …com representantes no escopo (`reps_escopo > 0`) | **0** |
| …com representantes ativos (`reps_ativos > 0`) | **0** |
| …com grupos ativos | **1** |
| …com **ambos — afetados pela DIV-1** | **0** |
| …com ambos, se filtrasse `r.ativo` | **0** |
| …sem escopo nenhum | **0** |

**E.2 devolveu 0 linhas.**

### Diretor geral

| Métrica | Valor |
|---|---|
| Diretores gerais ativos | **1** |

Escopo global desde sempre — **não afetado** pela DIV-1. O número entra aqui para dimensionar o público
de uma eventual comunicação, não para contar afetados.

### Base de usuários (E.4)

| Perfil | Ativos | Inativos |
|---|---|---|
| `admin` | 2 | 0 |
| `representante` | 2 | 0 |
| `diretor` | 1 | 0 |
| `operador` | 1 | 0 |
| `diretor_geral` | 1 | 0 |

Nenhum usuário inativo nesses perfis, e nenhum perfil inesperado — a whitelist de `app_escopo_atual()`
cobre a realidade da base.

## G. Conclusão

**Nenhum diretor real foi afetado pela DIV-1 neste snapshot.** O único diretor ativo tem grupo e nenhum
representante no escopo: para ele, a regra nova (`representantes + grupos`) produz exatamente o mesmo
resultado da regra antiga (só grupos).

A afirmação registrada durante a E5 — *"nenhum diretor real possui simultaneamente representantes e
grupos"* — **está comprovada para o estado atual da base**. Durante a E5-0 ela era evidência indireta: o
cenário precisou ser construído em transação e desfeito. Agora é medição direta sobre a base inteira.

> ⚠️ **Isto é um snapshot, não uma invariável de negócio.** Basta um vínculo novo entre diretor e
> representante para o cenário passar a existir. A regra continua valendo; o que não existe hoje é quem
> a exerça.

## H. Decisão

| | Decisão |
|---|---|
| ❌ | **não** enviar notificação no app |
| ❌ | **não** criar banner, tooltip ou modal |
| ❌ | **não** alterar interface nesta etapa |
| ❌ | **não** inserir nada em `concremapprep_notificacoes` |
| ❌ | **não** notificar `diretor_geral` — escopo já era global |
| ❌ | **não** notificar `representante`, `operador` nem `admin` — escopo inalterado |
| ✅ | documentação interna é suficiente neste momento |
| ✅ | o contrato **permanece** `representantes + grupos` quando ambos existirem |

**O motivo de não comunicar é o mesmo de comunicar bem:** avisar "seus valores mudaram" a quem não teve
mudança nenhuma destrói a confiança no indicador exatamente onde ela precisa existir. Comunicação sem
fato correspondente não é zelo — é ruído que custa credibilidade.

## I. Texto de domínio recomendado

Para documentação e para uso futuro, quando houver a quem comunicar:

> **Os indicadores de diretores passam a considerar, em conjunto, os representantes e os grupos sob sua
> gestão.**

Tempo verbal **"passam a considerar"**, não "agora consideram". E **nunca** "seus valores mudaram" ou
"agora seus valores estão maiores" — seria falso para todos os usuários atuais.

Sem termo técnico: nada de nome de função, de tabela, de protocolo ou de mecanismo de autorização.

## J. Gatilho futuro

**Se um diretor passar a ter, ao mesmo tempo, pelo menos um representante no escopo e pelo menos um
grupo ativo, reavaliar a comunicação.** A consulta **E.1** responde isso em segundos e pode ser repetida
a qualquer momento.

Nesse momento:

- o tempo verbal pode mudar para **"agora consideram"**, porque passará a haver mudança observável;
- o canal natural é a notificação por usuário (`concremapprep_notificacoes` → sino e tela de Alertas),
  com `tipo = 'sistema'`, que já existe e alcança exatamente quem precisa;
- **isso é uma nova decisão operacional**, a ser tomada com a medição da época — **não** um envio
  automático definido por esta E7. Esta etapa não deixa gatilho armado, deixa critério escrito.

## K. Segurança

Nenhum conteúdo deste documento, e nenhum texto proposto para o usuário, inclui:

| | |
|---|---|
| ✅ | nomes de usuários — nem reais, nem de teste |
| ✅ | UUIDs ou qualquer identificador interno |
| ✅ | nomes de grupos de cliente |
| ✅ | valores financeiros |
| ✅ | os números do experimento transacional da E5-0 |

Os dados da DIV-1 (3 → 15 pedidos, R$ 61.979,72, +400 %) são **evidência técnica interna** e vivem em
`docs/E5-VERIFICACAO-DASHBOARD.md`. **Não podem ser usados como conteúdo de comunicação ao usuário** —
descrevem um vínculo artificial, criado em transação e desfeito, que nunca existiu em produção.

---

## Critério de conclusão

Fixado nesta etapa, porque a E7 não tinha um:

| | Critério | Estado |
|---|---|---|
| 1 | Impacto atual **medido** na base, não estimado | ✅ E.1 a E.4 |
| 2 | Público **determinado** a partir da medição | ✅ ninguém, hoje |
| 3 | Decisão de comunicação **registrada**, com o porquê | ✅ seção H |
| 4 | **Nenhuma comunicação enviada** quando não existe usuário afetado | ✅ nada enviado |
