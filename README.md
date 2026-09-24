# Quanto Tempo Vale?

Um app de família para gerir tempo de tela de dois adolescentes. Eles ganham
horas de tela fazendo coisas longe da tela — esporte, leitura, instrumento,
lição — e os adultos leem o saldo aqui e configuram os aparelhos na mão. O app é
a fonte única de verdade do saldo, e nada além disso: não fala com Family Link,
Xbox nem PlayStation.

A regra que o torna diferente de um contador de pontos é o desgaste. A cada
faixa de horas acumuladas numa categoria no mesmo dia, a hora seguinte vale
metade da anterior. Não há teto: a soma tende a um limite
(`taxa × passo × 2`) sem nunca fechar a porta. Uma tarde inteira de futebol
continua valendo mais que meia hora, só que cada vez menos — e voltar a uma
categoria depois de alguns dias parado paga um bônus. O menino propõe o
registro por um cronômetro; o adulto aprova, corrige ou recusa com motivo.

Next.js com App Router e server actions, SQLite via Drizzle com
`better-sqlite3`, Tailwind, Vitest, tudo em TypeScript `strict`. Roda numa
imagem Docker multi-stage com um volume para o arquivo do banco. Sem serviço
externo, sem fila, sem cache.

```sh
nvm use && pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev
```

As variáveis vão num `.env` seguindo o `.env.schema`, validadas pelo Varlock. O
`pnpm db:demo` escreve uma semana de dado de demonstração para olhar as telas
com algo dentro, e `pnpm db:demo:clear` remove.

O documento que manda aqui é [`docs/decisions.md`](docs/decisions.md): cada
ambiguidade do modelo foi decidida e justificada antes do código, e é ele que
vence quando algo discordar. [`docs/design.md`](docs/design.md) fixa o sistema
visual, [`docs/deploy.md`](docs/deploy.md) explica a imagem, o volume e o
backup, e [`docs/handoff.md`](docs/handoff.md) conta em que pé o projeto está.
O [`CLAUDE.md`](CLAUDE.md) é a leitura obrigatória de quem vai mexer no código,
humano ou agente.

O código é aberto porque as decisões podem ser úteis para quem estiver
resolvendo um problema parecido em casa. Ele foi escrito para uma família só —
não há suporte a várias famílias, e não é objetivo que haja.
