# Passagem de bastão

Estado do projeto e como o trabalho é conduzido, para quem abrir uma sessão nova
sem o histórico da conversa que construiu as fases 0 a 6.

**Retrato de 16/09/2026, até o PR #61.** Esta página não se atualiza sozinha.
Antes de confiar nela, rode `gh pr list`, `gh issue list` e `git log -5`.

Leia também: [`CLAUDE.md`](../CLAUDE.md) (convenções) e
[`decisions.md`](decisions.md) (normativo, 47 decisões). Se esta página
discordar do `decisions.md`, vale o `decisions.md`.

---

## O que existe

23 PRs mergeados até o #61. Fases 0 a 6 completas.

**Menino**

| tela | o que faz |
|---|---|
| Seu saldo (`/menino`) | Saldo de horas. É o maior elemento da tela. |
| Histórico (`/menino/historico`) | O que ele ganhou e gastou, do mais recente para o mais antigo. |
| Cronômetro (`/menino/cronometro`) | Mede uma atividade. Ao parar, vira uma entrada pendente na fila do admin. É a única escrita que o menino faz. |
| Calculadora (`/menino/calculadora`) | Simula quanto uma atividade vale hoje, com a conta explicada linha a linha. |

**Admin**

| tela | o que faz |
|---|---|
| Saldos (`/admin`) | Saldo dos dois meninos. |
| Fila de aprovação (`/admin/fila`) | Aprova ou recusa o que o cronômetro gerou, respeitando a ordem canônica (D32). Na aprovação dá para corrigir atividade, duração e nota. |
| Lançar atividade (`/admin/lancar`) | Registra uma atividade que não passou pelo cronômetro. |
| Liberar horas (`/admin/liberar`) | Desconta do saldo as horas que o adulto liberou no aparelho. |
| Estornar horas (`/admin/estornar`) | Devolve horas ao saldo. |
| Configuração (`/admin/configuracao`) | Cria, edita e desativa categorias e atividades, e mostra a assíntota ao vivo. Recusa mudar o que define o valor de uma entrada enquanto ela espera na fila ou tem cronômetro aberto (D37). |

**Por baixo**

- Motor de cálculo: desgaste geométrico por categoria (D1–D3), cooldown e bônus
  de retorno (D6), consumo da franquia na ordem de congelamento (D34).
  Aritmética racional exata até o arredondamento único da D9 (D39).
- Login dos quatro. A checagem de permissão fica no server action, não na
  navegação.
- Dockerfile multi-stage, testado por um smoke test no CI (ver
  [`deploy.md`](deploy.md)).
- Varlock para as variáveis de ambiente.
- Proteção do `.env`: um hook bloqueia comandos de shell que tocam um `.env`
  existente, e regras de permissão bloqueiam a ferramenta de leitura (D29).
- CI com três jobs: `lint, typecheck, test, build`, `docker build and container
  smoke` e `claude-review`. Cerca de 1400 testes, além de matrizes de sabotagem
  que quebram o código de propósito e exigem que algum teste reprove.

## O que falta para o MVP

| issue | o quê | quem | observação |
|---|---|---|---|
| #30 | Backup do SQLite | agente | Usar `VACUUM INTO`, nunca `cp`: copiar um SQLite enquanto ele é escrito gera um arquivo corrompido. |
| #29 | Estados vazios e tratamento de erro | agente | Nenhuma tela pode ficar em branco. |
| #60 | Segredos em texto puro dentro de `.next/` | agente | A imagem Docker já é construída com valores falsos no lugar dos segredos, e o passo 9 do smoke confere isso ([`deploy.md`](deploy.md)). O vazamento medido acontece num build **fora** do Docker feito com o `.env` real. O mínimo aceitável é uma verificação no CI. Resolver antes da #7. |
| #7 | Deploy no Coolify | agente, com acesso do dono | Bloqueada pela D24 por falta de URL e token da instância. Um MCP do Coolify apareceu no ambiente; confira se ele já está autenticado na instância antes de pedir URL e token ao dono. Regra fixa: **o build nunca roda com os valores reais.** |
| #28 | Contraste e alvo de toque em aparelho real | dono testa, agente corrige | Pré-auditoria automatizada feita (PR do #28): todo alvo de toque de todas as rotas dos dois papéis, em 360×740 e 390×844, mede ≥48px; nenhuma cor fora preto/branco/vermelho-700/amarelo-300; sem scroll horizontal; sem transição/animação. Nada para corrigir no código. Dois itens ficaram como decisão do dono, registrados no PR. Ainda falta o teste em iPhone e Android reais. |
| #52 | Remover o dado de demonstração | agente | Último passo antes do lançamento: `pnpm db:demo:clear` ([`demo-data.md`](demo-data.md)). |

Fora do MVP, por decisão do dono: #31 (notificação push) e #32 (dashboard
analítico).

**Caso aceito pela D37, sem issue:** se o adulto marcar uma atividade como "com
nota" (`quality_graded`) quando não há nada esperando nem cronômetro aberto, a
próxima sessão dessa atividade chega à fila sem valor calculável, porque o
cronômetro não dá nota. O adulto resolve dando a nota na aprovação, e a fila
mostra o motivo.

---

## Como o dono quer trabalhar

- **Mínimo de interação.** Não pergunte o que dá para decidir. Decida, execute e
  relate. Nas palavras do dono: "Bora, não pergunte. Só bora."
  A exceção está no `CLAUDE.md`: uma regra de negócio ambígua que o
  `decisions.md` não decide não é escolha do agente. Pergunte, ou registre a
  dúvida no PR como decisão a tomar. Na Fase 6, um agente reinterpretou a D12 por
  conta própria e isso bloqueou o merge.
- **Não pare para descrever o próximo passo.** Se ele está claro, faça.
- **Converse em português.** Código, comentários, commits e branches em inglês
  (`CLAUDE.md`).
- **MVP primeiro, ajuste depois.** Depois da Fase 6 o dono pediu para não travar
  em revisão. O combinado ficou assim: uma rodada de correção por PR, e o que
  sobrar vira issue com o problema medido e descrito.
- **Mostre o app.** Tela funcionando vale mais que relatório.
- **Commits e PRs sem atribuição a IA.** Nada de `Co-Authored-By`, link de
  sessão ou "Generated with". É regra global do dono.
- **Dado de demonstração é permitido para testar**, desde que fique fora do
  `db:seed` e saia antes do lançamento (#52).

## Como uma tarefa anda

1. **Issue** citando as decisões que a governam.
2. **Um agente implementa** num worktree próprio em `wt/`, criado a partir de
   `origin/main`, e abre o PR. O agente não mergeia o próprio PR (D30).
3. **Revisão em três mandatos (D25).** A D25 define três rounds em sequência:
   - round 1: correção e cobertura de teste
   - round 2: conformidade com o `decisions.md`, lendo decisão e diff lado a lado
   - round 3: acesso, segurança e alvo de toque

   Na Fase 6 os três mandatos rodaram **em paralelo**, cada revisor no seu
   worktree, e isso se repetiu depois da primeira correção. O que a D25 exige é
   que os mandatos não se sobreponham. No mandato de segurança, o atacante a
   considerar é um adolescente com login legítimo que pede algo razoável ao
   adulto na hora certa. Os exploits mais graves do projeto vieram daí.
4. **Uma rodada de correção** com todos os achados juntos.
5. **O coordenador verifica por conta própria**: roda a suíte e um roteiro
   próprio contra o código real, sem depender só do relatório do agente.
6. **Merge com CI verde.** CI verde é o portão (D25). Como o plano do GitHub não
   tem proteção de branch, quem mergeia é quem garante isso (D26). O dono
   autorizou o coordenador a mergear.

Os revisores deixam os achados como comentário no PR, e não só no relatório ao
coordenador. Assim eles sobrevivem se o agente morrer no meio.

## Regras operacionais aprendidas

Cada uma custou algo concreto.

- **Nunca leia, copie ou imprima um `.env`**, deste projeto ou de outro (D23).
  Para rodar build ou testes, crie num worktree seu um `.env` descartável com
  valores inventados. Rodar o app, que lê o `.env` sozinho, é permitido. Abrir o
  arquivo não é.
- **Cada agente e cada sub-agente trabalha no seu próprio worktree.** Dois
  agentes na mesma árvore sobrescreveram arquivos um do outro e apagaram o
  rascunho do outro no meio de uma medição.
- **Arquivo temporário fica num subdiretório seu, com nome único.** Já houve
  corpo de PR publicado no PR errado por colisão de nome.
- **Todo processo que você abre, você fecha**: `next dev`, `next start`,
  navegador, container. Use `try/finally` e confirme no fim com
  `pgrep -fl "chrome-headless|Chromium|playwright|next-server|next start"`.
- **Não mate processo que você não abriu.** Um servidor MCP com data de início
  antiga pode ser da própria sessão, ou de outro projeto do dono. Já derrubamos
  o MCP do Playwright da sessão por achar que era sobra.
- **Merge e limpeza em comandos separados.** Confira `mergedAt` antes de apagar
  branch ou worktree. Uma limpeza encadeada a um merge que tinha falhado fechou
  um PR.
- **Depois de mergear um PR, faça rebase dos outros abertos.** PRs que mexem no
  `decisions.md` ou no `CLAUDE.md` conflitam entre si.
- **O macOS não tem `timeout` nem `setsid`.** Um "command not found" já foi lido
  como Docker travado. Para esperar algo, use um laço com
  `perl -e 'select(undef,undef,undef,N)'`.
- **Mac dormindo mata agente.** `caffeinate -i` não segura o Mac com a tampa
  fechada. `caffeinate -s` segura.
- **Dê folga ao timeout dos testes de sabotagem.** Uma mutação levou 53,7 s
  contra um limite de 60 s. Hoje o limite é 3 min por mutação.
- **Antes de dizer que algo falhou no CI, confira o commit.** A falha pode ser de
  um commit que o agente já corrigiu.
- **O limite de sessão da API derruba agentes no meio do trabalho.** Relance com
  o mesmo mandato e conte o que o anterior chegou a achar.

## Rodar localmente

```sh
cd wt/main
nvm use              # Node 22
pnpm install
pnpm db:migrate
pnpm db:seed         # categorias e atividades; pessoas não (D45)
pnpm db:demo         # opcional; pnpm db:demo:clear remove
pnpm dev             # http://localhost:3000
```

Os comandos de banco e o `pnpm dev` precisam de um `.env` preenchido. Um
worktree novo não tem `.env`. Nele, o agente cria um descartável seguindo o
`.env.schema`.

O seed não cria pessoas (D45). Num banco local, crie-as com SQL, com senha de
teste sua (`pnpm auth:hash`), como em [`deploy.md`](deploy.md), "Usuários". O
`pnpm db:demo` procura `kid1` e `kid2`:

```sh
sqlite3 data/kids.db "INSERT INTO users (username, display_name, role, password_hash) VALUES
  ('admin1', 'Admin1', 'admin', '<hash>'), ('admin2', 'Admin2', 'admin', '<hash>'),
  ('kid1', 'Kid1', 'kid', '<hash>'), ('kid2', 'Kid2', 'kid', '<hash>');"
```

Feche o servidor ao terminar, porque o dono usa a porta 3000.
