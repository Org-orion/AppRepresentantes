# Etapa 5 — CAPTCHA nativo no Supabase Auth

> Decisão **D2** aprovada. Executor da parte de painel: humano (ação em produção).
> Código já ajustado — ver commit da Etapa 5.

## O problema que isto resolve

O Turnstile existia, mas era **portão de interface**. O fluxo era:

```
tela → Edge Function verificar-turnstile → (se ok) → signInWithPassword
```

Nada impedia pular o primeiro passo. A anon key vai no bundle do navegador, então qualquer um podia
chamar `signInWithPassword` direto e tentar senhas à vontade. A única barreira real contra força bruta
era o rate limit nativo do Supabase.

Agora o token viaja **junto do login** (`options.captchaToken`) e quem o valida é o próprio servidor de
auth. Com o CAPTCHA habilitado no painel, chamada sem token válido é recusada — inclusive a direta.

## ⚠️ Ordem obrigatória (e por quê)

O token do Turnstile é de **uso único**. As duas verificações **não podem coexistir**: se a Edge Function
resgatasse o token primeiro, o servidor de auth recusaria o mesmo token em seguida. Por isso a chamada à
Edge Function foi **removida**, não mantida em paralelo.

Consequência prática:

| Situação | Efeito |
|---|---|
| Habilitar o CAPTCHA no painel **antes** do código novo estar em produção | **Todo login quebra** — o código antigo não envia `captchaToken` |
| Publicar o código novo e demorar para habilitar o painel | Login funciona, mas **sem** verificação de captcha nesse intervalo |

Então: **publicar primeiro, habilitar logo em seguida.** A janela entre os dois passos deve ser de
minutos, e nela a proteção é praticamente a de hoje (o portão atual já é contornável) — apenas sem a
barreira de interface. Isso é **risco aceito e declarado**, não descuido.

## Passo a passo

### 1. Publicar o código (você decide quando)

A branch `chore/saneamento` precisa chegar em produção. Confira antes, no preview, que a tela de login
carrega e o widget do Turnstile aparece.

### 2. Habilitar o CAPTCHA no painel — **imediatamente após o passo 1**

🔗 https://supabase.com/dashboard/project/ikjeyaxfciferyezxskh/auth/providers
(seção **Bot and Abuse Protection** / **Enable Captcha protection**)

- **Provider:** Turnstile (Cloudflare)
- **Secret key:** a mesma `TURNSTILE_SECRET_KEY` que hoje está nos secrets das Edge Functions
- O **site key** já está no frontend (`VITE_TURNSTILE_SITE_KEY`) — não muda

### 3. Validar que o bypass morreu

Este é o teste que prova a etapa. Com uma credencial de teste, chame a API direto:

```bash
curl -i -X POST 'https://ikjeyaxfciferyezxskh.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: <ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"email":"<conta-de-teste>","password":"<senha>"}'
```

- ✅ **Esperado:** recusa por captcha ausente (erro do tipo *captcha protection: token verification failed*).
- ❌ Se retornar `access_token`, o CAPTCHA **não** está ativo — revisar o passo 2.

E pela tela: login normal continua funcionando.

### 4. Aposentar a Edge Function `verificar-turnstile`

O código não a chama mais. Depois de validar o passo 3, remova o deploy dela:

```bash
supabase functions delete verificar-turnstile --project-ref ikjeyaxfciferyezxskh
```

Enquanto ela existir sem uso, é superfície exposta à toa.

### 5. Aproveitar que está no painel de Auth

- **Leaked password protection** (bloqueia senhas vazadas conhecidas) — ligar, se disponível no plano.
- Conferir a política de senha mínima.

Não fazem parte da D2; são ganho barato no mesmo lugar.

## Registro

| Passo | Estado | Data | Evidência |
|---|---|---|---|
| 1. Código em produção | | | |
| 2. CAPTCHA habilitado | | | |
| 3. `curl` recusado | | | saída do comando (sem a anon key nem a senha) |
| 3. Login pela tela ok | | | |
| 4. Edge Function removida | | | |
| 5. Proteção de senha vazada | | | |

**Estado final:** `CONCLUÍDO` · `CONCLUÍDO COM RESSALVAS` · `PARCIAL` · `NÃO VERIFICADO`

## Rollback

Desabilitar o CAPTCHA no painel restaura o login imediatamente, sem tocar no código. O commit da etapa
também é revertível sozinho — nesse caso o app volta a não enviar `captchaToken` e o painel **precisa**
estar desabilitado, senão o login para.
