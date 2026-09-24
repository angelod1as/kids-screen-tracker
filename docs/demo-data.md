# Dados de demonstração

> **Temporário. Remover antes do lançamento.**
> Um comando basta: `pnpm db:demo:clear`.

As telas do menino (#15, #16, #17) foram entregues na Fase 3, mas nada escreve
no ledger antes da Fase 4 (cronômetro) e da Fase 5 (lançamento do admin). Num
banco recém-semeado o saldo é `0,00 h` e o histórico está vazio — que é **o
estado real do primeiro dia de uso** e é o que os estados vazios entregam.

Só que tela vazia não demonstra tela. A ordenação do histórico, os cinco
lançamentos que "os últimos cinco" escolhe entre dezoito e a cor do saldo
negativo são invisíveis sem linha nenhuma.
Este comando escreve uma semana plausível do Kid1 e do Kid2 para que dê para
olhar.

## Comandos

| comando | o que faz |
|---|---|
| `pnpm db:seed` | os quatro usuários, sete categorias e trinta e duas atividades. Idempotente, roda em produção. **Não escreve dado de demonstração.** |
| `pnpm db:demo` | escreve a semana de demonstração: logs aprovados e linhas de ledger. **Idempotente:** apaga o que uma execução anterior escreveu antes de escrever |
| `pnpm db:demo:clear` | **remove tudo que o `db:demo` escreveu**, e nada mais |

## No container publicado

O `db:bundle` leva o comando para dentro da imagem, ao lado do migrate e do
seed, porque uma tela vazia no telefone não prova que a tela funciona. Lá dentro
não há `tsx` nem `src/`:

```sh
# escreve a semana de demonstração
node node_modules/varlock/bin/cli.js run -- node dist/db/db-demo.mjs

# tira tudo que ela escreveu
node node_modules/varlock/bin/cli.js run -- node dist/db/db-demo.mjs --clear
```

O seed precisa ter rodado antes: sem as quatro pessoas, o comando não tem a
quem dar horas e sai com erro.

Isso é temporário e está preso à #52, que remove o caminho inteiro antes de o
app virar a fonte de verdade do saldo dos meninos.

**Rodar `pnpm db:demo` duas vezes deixa uma semana, não duas.** O `seedDemoData`
apaga as linhas marcadas de qualquer execução anterior antes de escrever, na
mesma transação — o mesmo critério do `db:demo:clear`, e por isso é exato. Até a
revisão do PR #53 não era assim: a segunda execução media `22 logs / 36 ledger`,
com o saldo do Kid1 dobrado, e o único aviso era uma frase num docstring — não
neste arquivo, que é o que alguém abre.

Depois do `db:demo:clear` o banco volta exatamente ao estado do `db:seed`:
`users 4`, `categories 7`, `activities 32`, e `activity_logs`, `ledger`,
`regimes` e `timers` em zero — a `regimes` dorme desde a #83 (D41) e nada
escreve nela. Verificado rodando, e coberto por
`src/db/demo.test.ts` ("returns the database to exactly the state db:seed leaves
it in").

## Como a remoção é segura

Toda linha escrita pelo `db:demo` carrega `DEMO_NOTE` na coluna `note` — as três
tabelas já tinham essa coluna. O `db:demo:clear` apaga **por essa marca**, na
ordem das chaves estrangeiras (`ledger` antes de `activity_logs`, que ela
referencia com `on delete restrict`).

Isso quer dizer que rodar a limpeza depois que a Fase 4 e a Fase 5 escreverem
linhas de verdade é seguro: as linhas de verdade não têm a marca e ficam onde
estão. Quem for remover a demonstração antes do lançamento não vai ter o
contexto de quem a escreveu, então a remoção não pode depender de contexto.

## O que a semana contém

- **Kid1** — sete dias de atividade e cinco movimentos de gasto e estorno,
  terminando com um sábado: duas horas de futebol que pagam cheio *e* levam o
  bônus de retorno (D7), uma hora de livro cheia e uma hora de HQ já degradada
  (D1–D3). Saldo positivo.
- **Kid2** — uma atividade e dois gastos maiores que ela. Saldo negativo, que é
  a outra tinta da tela do menino e a única coisa dela que não dá para olhar sem
  dado.

Os `computed_hours` **não são digitados**: cada log é calculado por
`calculateEarnedHours`, sobre o histórico construído até ali, exatamente como a
aprovação do admin vai calcular na Fase 5. Um número plausível digitado à mão
produziria um ledger que discorda da calculadora na aba ao lado.

## Isto não é o seed

`src/db/seed.ts` continua sendo só usuários, categorias e atividades. Ele é
idempotente, roda em produção e não sabe que `src/db/demo.ts` existe. O caminho
de demonstração é um script separado (`scripts/db-demo.ts`) que nada mais chama.

Os dois são idempotentes, mas por motivos diferentes: o `db:seed` porque roda em
produção toda vez que o container sobe; o `db:demo` porque está ao lado dele na
tabela acima e ninguém lê uma nota de rodapé antes de repetir um comando.
