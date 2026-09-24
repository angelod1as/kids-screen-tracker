# Passagem de bastão

Estado do projeto e como o trabalho anda, para uma sessão nova.

**Retrato de 23/09/2026, `main` em `052d8cc` (PR #2).** Não se atualiza
sozinho: confira com `gh pr list`, `gh issue list` e `git log -5`.

Normativo é o [`decisions.md`](decisions.md) (47 decisões, D1–D47); convenções
no [`CLAUDE.md`](../CLAUDE.md). Se esta página discordar, vale o `decisions.md`.

---

## Repositório

**Público desde 23/09/2026, com histórico reiniciado.** Commits, PRs até o #119
e issues fechadas estão no repositório privado
`angelod1as/kids-screen-tracker-archive` (`gh -R ...`). Número de issue ou PR
citado em documento ou código anterior a 23/09 é de lá.

As issues abertas foram migradas e renumeradas:

| aqui | arquivo | o quê |
|---|---|---|
| #3 | #116 | `/entrar` não limita tentativa de login. Opções listadas, nenhuma escolhida. |
| #4 | #103 | Build num worktree falha: varlock acha valor do ambiente num chunk do cliente. Com os valores descartáveis do CI, passa. |
| #5 | #80 | Comentário sucinto. A regra está no `CLAUDE.md`; falta cortar o resto. |
| #6 | #67 | Cronômetro: "Parar" com resposta perdida pede um toque a mais. |
| #7 | #66 | Texto da recusa não chega ao navegador em produção. Decisão a tomar (D32). |
| #8 | #52 | Remover o dado de demonstração: `pnpm db:demo:clear` ([`demo-data.md`](demo-data.md)). |
| #9 | #32 | Dashboard analítico. Não construir agora. |
| #10 | #28 | Contraste e alvo de toque em iPhone e Android reais. |

Notificação push está fora do escopo (#31 do arquivo).

Nada público traz nome de pessoa da família, endereço de produção, IP ou token.
Nos exemplos: `admin1`, `admin2`, `kid1`, `kid2`.

## Produção

**No ar desde 23/09/2026, no Coolify**, imagem do `Dockerfile`, volume em
`/data` ([`deploy.md`](deploy.md)). Endereço, uuid e token só nos segredos do
repositório. Mudança que toca dado precisa provar que não altera saldo.

Pela D43, o deploy é pedido pelo `deploy.yml` quando o CI fica verde na `main`.
**Esse workflow nunca teve sucesso:** duas falhas aqui (a última com `401
Unauthenticated` do Coolify), sete no arquivo. Confira
`gh run list --workflow Deploy` antes de supor que um merge foi publicado.

## O que existe

| tela | o que faz |
|---|---|
| `/menino` | Saldo. Maior elemento da tela. |
| `/menino/historico` | Ganhos e gastos, inclusive a recusa com motivo. |
| `/menino/cronometro` | Única escrita do menino: vira entrada pendente. Abaixo da sessão mínima não vira registro (D44). |
| `/menino/calculadora` | Quanto uma atividade vale hoje, conta linha a linha. |
| `/admin` | Saldo dos dois. Tocar abre `/admin/historico/[userId]`. |
| `/admin/fila` | Aprova, corrige ou recusa na ordem canônica (D32). |
| `/admin/lancar` | Atividade sem cronômetro. |
| `/admin/liberar` | Desconta horas liberadas no aparelho. |
| `/admin/estornar` | Devolve horas; motivo padrão "Não usou". |
| `/admin/configuracao` | Categorias e atividades, com assíntota ao vivo. Trava o que precifica entrada pendente (D37). |
| `/conta` | Identidade, aberta pela barra fixa embaixo. |
| `/conta/como-funciona` | Explicação para meninos e para adultos. |

**Desde o retrato anterior (16/09):** nome "Quanto Tempo Vale?"; barra fixa
embaixo com conta; recusa com motivo no histórico; admin abre o histórico pelo
saldo; cronômetro em segundos, arredondado ao minuto (emenda à D17), exibido em
hora e minuto; sessão mínima por atividade (D44); direção visual nova (D42,
[`design.md`](design.md)); tela de regimes removida, tabela mantida (D41); PWA
instalável sem cache de dado (D46); "Como funciona"; taxa por duração de 2 para
1,5 (emenda à D11); sem bônus de retorno na estreia da categoria (D47); pessoas
só no banco (D45); `pnpm db:backup` com `VACUUM INTO`; estados vazios; build sem
segredo em `.next/` (D40).

**Por baixo:** motor com desgaste por categoria (D1–D3), bônus de retorno (D6,
D47), franquia na ordem de congelamento (D34), aritmética exata até a D9 (D39).
Permissão checada no server action. Hook `.claude/hooks/deny-env-access.sh`
bloqueia shell em `.env` existente (D29). CI com dois checks, `lint, typecheck,
test, build` e `docker build and container smoke`, mais o `claude-review`; todos
ignoram `docs/**` e `**/*.md`. 1505 testes, mais matrizes de sabotagem.

**Aceito pela D37, sem issue:** atividade marcada `quality_graded` sem nada
pendente faz a próxima sessão chegar à fila sem valor; o adulto dá a nota na
aprovação.

---

## Como o dono quer trabalhar

- **Não pergunte o que dá para decidir.** "Bora, não pergunte. Só bora."
  Exceção: regra de negócio que o `decisions.md` não decide vai para o PR como
  decisão a tomar.
- **Não pare para descrever o próximo passo.** Faça.
- **Português na conversa**; código, comentários, commits e branches em inglês.
- **Diff mínimo.** Mudança maior vira sugestão no PR.
- **Uma rodada de correção por PR.** O resto vira issue medida.
- **Mostre o app.** Tela funcionando vale mais que relatório.
- **Sem atribuição a IA** em commit ou PR.
- **Dado de demonstração** só fora do `db:seed`, e sai antes do lançamento (#8).

## Como uma tarefa anda

1. Issue citando as decisões.
2. Agente implementa num worktree próprio em `wt/`, a partir de `origin/main`, e
   abre o PR. Não mergeia (D30).
3. Revisão em três mandatos sem sobreposição (D25): correção e teste;
   conformidade com o `decisions.md`; acesso, segurança e alvo de toque. Podem
   rodar em paralelo. No de segurança, o atacante é o adolescente com login
   legítimo. Achados vão como comentário no PR.
4. Uma rodada de correção com todos os achados.
5. Coordenador verifica por conta própria contra o código real.
6. Merge com CI verde. A `main` tem ruleset exigindo os dois checks do
   `ci.yml` (a D26 ainda descreve o repositório privado, sem proteção).

**PR só de documentação fica bloqueado:** não dispara check. É esperado; o dono
mergeia com bypass. Não mexa no filtro do `ci.yml`.

## Regras operacionais aprendidas

- **Nunca leia, copie ou imprima um `.env`** (D23). Para build e teste, crie um
  descartável no seu worktree, como o CI.
- **Um worktree por agente e sub-agente.** Dois na mesma árvore se
  sobrescreveram.
- **Temporário em subdiretório seu, nome único.** Já saiu corpo de PR no PR
  errado.
- **Processo que você abre, você fecha**, com `try/finally`. Confira com
  `pgrep -fl "chrome-headless|Chromium|playwright|next-server|next start"`.
- **Não mate processo que não abriu.** Já derrubamos o MCP do Playwright da
  própria sessão.
- **A porta 3000 é do dono.** `pnpm start -p` ignora a porta: use
  `PORT=3xxx pnpm start`.
- **Merge e limpeza em comandos separados.** Confira `mergedAt` antes de apagar
  branch.
- **Depois de um merge, rebase dos PRs abertos.** `decisions.md` e `CLAUDE.md`
  conflitam.
- **macOS não tem `timeout` nem `setsid`.** Espere com
  `perl -e 'select(undef,undef,undef,N)'`.
- **Mac dormindo mata agente.** Use `caffeinate -s`, não `-i`.
- **Sabotagem precisa de folga:** limite de 3 min por mutação.
- **Suíte inteira sob carga pode estourar o timeout de 5 s** de algum teste do
  motor. Rode o arquivo isolado antes de chamar de falha.
- **Antes de culpar o CI, confira o commit.**
- **Limite de sessão da API derruba agente.** Relance com o mesmo mandato.

## Rodar localmente

```sh
nvm use              # Node 22
pnpm install
pnpm db:migrate
pnpm db:seed         # categorias e atividades; pessoas não (D45)
pnpm db:demo         # opcional; pnpm db:demo:clear remove
PORT=3xxx pnpm dev
```

Precisa de `.env`; num worktree novo, crie um descartável pelo `.env.schema`.
Pessoas se criam com SQL e senha de teste (`pnpm auth:hash`), como em
[`deploy.md`](deploy.md), "Usuários". O `pnpm db:demo` procura `kid1` e `kid2`:

```sh
sqlite3 data/kids.db "INSERT INTO users (username, display_name, role, password_hash) VALUES
  ('admin1', 'Admin1', 'admin', '<hash>'), ('admin2', 'Admin2', 'admin', '<hash>'),
  ('kid1', 'Kid1', 'kid', '<hash>'), ('kid2', 'Kid2', 'kid', '<hash>');"
```
