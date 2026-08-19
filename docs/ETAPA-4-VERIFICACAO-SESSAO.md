# Etapa 4 — Verificação da sessão (Supabase Auth + sessionStorage)

> Roteiro de **verificação manual reproduzível** no formato exigido por
> **Cérebro — Testes e Verificação §9**. "Testado manualmente" sozinho não é evidência.
> Decisão aplicada: **D1 — relogin sempre, inclusive no desktop.**

## Objetivo

Provar que a sessão vive apenas em `sessionStorage` e que o comportamento resultante é o desejado:
recarregar mantém, fechar exige novo login — sem sobras de sessão em `localStorage`.

## Ambiente

- **Web:** `npm run dev` → http://localhost:5173 (ou o deploy, quando publicado)
- **Desktop:** `npm run desktop:dev`
- Navegador: registrar qual e a versão

## Pré-condições

- Credencial de teste válida (não usar conta de terceiros).
- DevTools aberto em **Application → Storage** para inspecionar `sessionStorage` e `localStorage`.
- Se a máquina já usou a versão anterior do app, deixar as chaves antigas em `localStorage`
  propositalmente — o cenário 9 depende disso.

## Matriz

| # | Cenário | Passos | Esperado | Obtido | Evidência |
|---|---|---|---|---|---|
| 1 | Login válido | Entrar com credencial correta | Entra; Dashboard carrega com perfil e rep codes | | |
| 2 | Senha errada | Entrar com senha inválida | Mensagem genérica; **não** revela se o e-mail existe | | |
| 3 | F5 na mesma aba | Logado, apertar F5 | **Continua logado** | | |
| 4 | Nova aba | Abrir `localhost:5173` numa aba nova | **Exige novo login** | | |
| 5 | Fechar e reabrir o navegador | Fechar tudo, abrir de novo | **Exige novo login** | | |
| 6 | Logout | Clicar em sair | Volta ao login; `sessionStorage` **sem** chaves `sb-*` | | |
| 7 | Expiração / refresh | Manter a aba aberta além da validade do token (padrão 1 h) e usar o app | Renova sozinho, sem derrubar a sessão | | |
| 8 | Restauração de abas | Fechar o navegador e usar "restaurar abas" | **Não** restaura a sessão | | |
| 9 | Resíduo de versão anterior | Antes de logar, conferir `localStorage`; recarregar o app | Chaves `sb-*` e `concrem_remember` **removidas** na carga | | |
| 10 | Desktop (Tauri) | Fechar o app e abrir de novo | **Exige novo login** (D1) | | |

## Como preencher

Para cada linha: escreva o **obtido** e uma evidência verificável — captura da aba
Application mostrando as chaves, ou a descrição do que apareceu na tela. Onde não for possível
executar, escrever **NÃO VERIFICADO** e o motivo. **PROIBIDO** marcar como aprovado sem ter rodado.

## Já verificado por inspeção (não precisa refazer)

| Item | Evidência |
|---|---|
| Nenhuma rota interna abre em nova aba | `grep` por `target="_blank"` e `window.open`: só anexos do ERP (URLs externas) e `/privacidade` (página estática em `public/`). A regra "nova aba = novo login" não quebra nenhum fluxo existente |
| Sem referências órfãs às funções removidas | `setSessionPersistence` / `getSessionPersistence` não são mais importadas em lugar nenhum — `tsc --noEmit` limpo |
| Build íntegro | `typecheck`, `lint --max-warnings 0` e `build` verdes |

## Observação sobre o cenário 7

`autoRefreshToken: true` continua ativo e a troca de storage não altera a lógica de renovação — mas
isso é **inferência**, não evidência. Só um teste que atravesse a expiração real prova. Enquanto não
houver, o cenário fica **NÃO VERIFICADO** e o risco é declarado, não escondido.

## Resultado

**Estado final:** `CONCLUÍDO` · `CONCLUÍDO COM RESSALVAS` · `PARCIAL` · `NÃO VERIFICADO`

Responsável pela execução: ______________  ·  Data: ______________
