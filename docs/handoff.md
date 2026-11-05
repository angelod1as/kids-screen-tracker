# Passagem de bastão

Estado do projeto e como o trabalho anda, para uma sessão nova.

**Retrato de 05/11/2026, `main` em `a0f194c` (PR #132).** Não se atualiza
sozinho: confira com `gh pr list`, `gh issue list` e `git log -5`.

Normativo é o [`decisions.md`](decisions.md) (60 decisões, D1–D60); convenções
no [`CLAUDE.md`](../CLAUDE.md). Se esta página discordar, vale o `decisions.md`.

---

## Repositório

**Público desde 23/09/2026, com histórico reiniciado.** Commits, PRs até o #119
e issues fechadas estão no repositório privado
`angelod1as/kids-screen-tracker-archive` (`gh -R ...`). Número de issue ou PR
citado em documento ou código anterior a 23/09 é de lá.

As issues migradas do arquivo (#3–#10) estão todas fechadas. Abertas hoje, só
duas: #133 (atualizações do Dependabot para `next`, `undici` e `@vitest/mocker`
falham) e #134 (este retrato).

Notificação push existe desde a #25, em dois gatilhos só (D51): pendência nova
avisa os adultos, decisão avisa o menino dono. Sem as chaves VAPID no ambiente,
fica desligada ([`deploy.md`](deploy.md), "Variáveis").

Nada público traz nome de pessoa da família, endereço de produção, IP ou token.
Nos exemplos: `admin1`, `admin2`, `kid1`, `kid2`.

## Produção

**No ar desde 23/09/2026, no Coolify**, imagem do `Dockerfile`, volume em
`/data` ([`deploy.md`](deploy.md)). Endereço, uuid e token só nos segredos do
repositório. Mudança que toca dado precisa provar que não altera saldo.

Pela D43, o deploy é pedido pelo `deploy.yml` quando o CI fica verde na `main`.
Ele passa: as oito últimas execuções terminaram com sucesso, a mais recente
depois do #132. A migração roda no "Post-deployment command" do Coolify (#24).
Confira `gh run list --workflow Deploy` antes de supor que um merge foi
publicado.

## O que existe

| tela | o que faz |
|---|---|
| `/menino` | Saldo. Maior elemento da tela. |
| `/menino/historico` | Extrato em três abas (Geral, Ganhos, Perdas) com totais: ganhos, horas tiradas e dadas, recusa com motivo, horário da ação e observação do menino. Abre nos dois dias mais recentes e revela mais sob demanda. |
| `/menino/cronometro` | As duas escritas do menino, ambas viram entrada pendente: o cronômetro (abaixo da sessão mínima não vira registro, D44) e o pedido sem cronômetro (D49). |
| `/menino/usar` | Pede para gastar horas, que vira pedido pendente (D58); vê os próprios pedidos e cancela o que ainda não foi decidido (D59). |
| `/menino/calculadora` | Quanto uma atividade vale hoje, conta linha a linha. |
| `/admin` | Saldo dos dois. Tocar abre `/admin/historico/[userId]`, com Tirar e Dar lado a lado e Anular discreto (D52). Mostra cronômetro rodando ou pausado, e o adulto pode parar ou cancelar. |
| `/admin/fila` | Aprova, corrige ou recusa na ordem canônica (D32), podendo dizer quanto a entrada vale (D50); nota em quartos, lida em porcentagem (D60). Pedido de gasto se aprova em um toque (D58). |
| `/admin/lancar` | Atividade sem cronômetro. |
| `/admin/tirar` | Tira horas do saldo, para usar no aparelho, com o saldo antes e depois (D53). |
| `/admin/dar` | Dá horas sem atividade; motivo padrão "Não usou". Confirma como o Tirar (D53). |
| `/admin/configuracao` | Em três níveis: categorias, atividades da categoria, formulário da atividade. Assíntota ao vivo, descrição, observação obrigatória com o que explicar (D55). Trava o que precifica entrada pendente (D37). Atividade desativada que nunca foi lançada pode ser apagada (#83). |
| `/admin/numeros` | Números para calibrar a tabela (#9, #54): horas por categoria, desgaste e bônus, saldo no tempo, atividades usadas e sem uso. Aberta pela Conta. |
| `/admin/calculadora` | Calculadora do adulto, com seletor de menino. Aberta pela Conta. |
| `/conta` | Identidade, aberta pela barra fixa embaixo. "Como funciona" em destaque, Sair no pé e em vermelho. |
| `/conta/como-funciona` | Explicação para meninos e para adultos, com índice. |

**Desde o retrato anterior (23/09):** login errado atrasa em vez de trancar
(D48); pedido sem cronômetro, curso com uma hora presumida (D49); adulto diz
quanto a entrada vale (D50); push em dois gatilhos (D51); anular em vez de
apagar (D52); Tirar e Dar com confirmação (D53); APK para side-load por TWA, em
`twa/` (D54); observação obrigatória (D55); bônus de alternância no lugar do de
retorno (D56), desligado em `src/engine/flags.ts` (D57); pedido de gasto (D58,
D59); nota em porcentagem (D60); todo valor negativo em vermelho (emenda à
D42); tempo digitado em hora e minuto; botão desativado que explica o porquê;
404 e tela de erro com saída para o início; auditoria de UI/UX
([`ux-audit-2026-10.md`](ux-audit-2026-10.md)) e as correções dela.

**Por baixo:** motor com desgaste por categoria (D1–D3), bônus de alternância
(D56) desligado pela D57, franquia na ordem de congelamento (D34), aritmética
exata até a D9 (D39). Permissão checada no server action. Hook `.claude/hooks/deny-env-access.sh`
bloqueia shell em `.env` existente (D29). CI com dois checks, `lint, typecheck,
test, build` e `docker build and container smoke`, mais o `claude-review`; todos
ignoram `docs/**` e `**/*.md`. 2149 testes em 111 arquivos, mais matrizes de
sabotagem. `pnpm usage:audit` abre o banco só para leitura e compara o gasto
declarado com o uso do Family Link ([`usage-audit.md`](usage-audit.md), #131);
`pnpm db:audit:activities` lista as atividades desativadas, e a variante
`:delete` apaga as que nada referencia (#83).

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
- **Dado de demonstração** só fora do `db:seed`. Já saiu da produção (#8); o
  `db:demo` fica para ambiente que não é o de casa.

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
- **Sabotagem precisa de folga:** o limite é pelo menos o dobro do pior tempo
  medido no CI, não no Mac, que roda cerca de 2,5× mais rápido. O caso de
  cobertura da fila levou 121,9 s contra 120 s e pulou um deploy (#49). Desde
  então, o caso de cobertura de `src/db` reaproveita os casos por mutação; o
  limite dele (300 s na fila) só pesa quando roda sozinho.
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
