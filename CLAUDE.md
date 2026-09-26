# Quanto Tempo Vale?

App para gerir o tempo de tela de dois adolescentes. Dois admins
e dois kids. Os meninos ganham horas de tela fazendo atividades
fora da tela; os adultos leem o saldo aqui e configuram os aparelhos na mão.

**Quanto Tempo Vale?** é o nome que o usuário vê. Repositório, pacote, imagem
Docker, volume e identificadores continuam `kids-screen-tracker` — nada disso é
renomeado.

O app é a **fonte única de verdade do saldo** e nada mais. Não há integração com
Family Link, Xbox ou PlayStation.

## Fonte de verdade

| documento | papel |
|---|---|
| [`docs/decisions.md`](docs/decisions.md) | **Normativo.** 53 decisões, D1–D53. |
| [`docs/spec.md`](docs/spec.md) | Anexo histórico. A intenção original. |
| [`docs/handoff.md`](docs/handoff.md) | **Retrato datado.** Estado do projeto, o que falta para o MVP e como o trabalho é conduzido. Comece por aqui numa sessão nova. |
| [`docs/design.md`](docs/design.md) | **Sistema visual.** Paleta, contraste medido, tipografia, raios, ícones e o porquê de cada um. Normativo pela D42. |
| [`docs/demo-data.md`](docs/demo-data.md) | **Temporário.** Dado de demonstração das telas do menino, e como removê-lo (`pnpm db:demo:clear`). Sai antes do lançamento. |

**Onde os dois discordarem, `decisions.md` vence.** Ele existe justamente porque
a spec tem ambiguidades e ao menos uma contradição interna.

Antes de mexer no motor de cálculo, no schema ou no seed, leia `decisions.md`
inteiro. Não reinterprete a spec por conta própria: se algo parecer ambíguo e não
estiver decidido, pergunte em vez de escolher.

Toda issue cita os números das decisões que a governam. O round 2 de revisão de
PR confere o diff contra esses números.

## O modelo de desgaste, em uma frase

A cada `decay_step_hours` **horas de atividade** acumuladas na categoria no dia, a
hora seguinte vale metade da anterior. Sem piso, sem teto — o limite é assíntota,
não porta fechada.

```
assíntota = taxa × decay_step_hours × 2
```

Não existem `full_up_to`, `half_up_to` nem `decay_enabled`. Não existe janela
semanal. Se você encontrar esses nomes em algum lugar que não seja `spec.md`,
é bug.

## Stack

- Next.js App Router, TypeScript `strict`, React, server actions para mutações
- SQLite via Drizzle ORM com `better-sqlite3` — **runtime Node, nunca edge**
- Tailwind CSS
- Varlock para `.env.schema` e validação das variáveis
- Vitest
- pnpm, Node 22 LTS
- Docker multi-stage, volume persistente para o arquivo do banco

Sem serviços externos, sem fila, sem cache, sem Redis.

## Convenções

- **Idioma:** interface em português do Brasil; identificadores, comentários,
  nomes de branch e mensagens de commit em inglês.
- **Commits:** Conventional Commits.
- **Branches:** uma por issue, PR para `main`. Nunca push direto na `main`.
- **Datas:** `occurred_on` é `TEXT` no formato `YYYY-MM-DD`, fuso
  `America/Sao_Paulo`. Nunca timestamp. (D13)
- **Segredos:** `.env` é ignorado pelo git e preenchido à mão pelo dono do repo.
  Nunca leia, copie ou imprima o conteúdo dele. Para trabalhar, use valores de
  teste próprios. (D23)
- **Exclusão:** categorias e atividades usam `active = false`. Nada é apagado do
  banco. (D14)
- **Merge:** você abre o PR; quem coordena revisa e mergeia. `gh pr merge` e
  `gh pr close` estão fora das suas permissões de propósito. (D30)
- **Guarda no servidor:** lista de tela não é garantia. Item inativo ou
  incompatível é recusado pelo endpoint, não só escondido do `<select>`. (D33)
- **Lint:** Biome, nunca ESLint — `typescript-eslint` não suporta a versão de
  TypeScript deste projeto. (D27)
- **pnpm:** configuração fica em `pnpm-workspace.yaml`, não em `.npmrc`, que o
  pnpm 11 ignora. Pacote com script de instalação precisa entrar em
  `allowBuilds`. (D28)
- **Arquivo temporário:** escreva num subdiretório só seu, nomeado com algo que
  ninguém mais escolheria. Vários agentes trabalham em paralelo neste projeto e
  compartilham o mesmo diretório de rascunho: `pr-body.md`, `after.txt` e
  `backup.txt` já colidiram, e um corpo de PR chegou a ser publicado no PR
  errado por causa disso.
- **Processo que você abre, você fecha:** navegador do Playwright, `next start`,
  `next dev`, container. Use `try/finally` para que o caminho de erro também
  feche, e confirme no fim com
  `pgrep -fl "chrome-headless|Chromium|playwright|next-server|next start"`.
  Um `next start` órfão faz a medição do próximo agente responder do build
  velho — ele mede uma tela que não é a do PR e não tem como saber.

## Design

Mobile-first de verdade — admins em iPhone, meninos em Android. O desktop é a
mesma base com utilitários `lg:`, nunca uma segunda tela. Detalhe e medidas em
[`docs/design.md`](docs/design.md); a regra é a D42.

- **Paleta fechada em seis cores:** preto, branco, `blue-800`, `slate-100`,
  `yellow-300`, `red-700`. Toda cor com tom mora em `src/ui/style.ts` e em
  nenhum outro arquivo. Cor nova é diff revisado, nunca hábito.
- **Mobília, sem significado:** `blue-800` com texto branco na tarja de painel,
  no controle primário, no item atual do menu e na opção escolhida;
  `slate-100` no chão da página. É azul e cinza-azulado frio de propósito.
- **Cor carrega significado em exatamente dois lugares:** pendência
  (`yellow-300`, preto por cima) e saldo negativo (`red-700`, tinta sobre
  branco). Nada mais é vermelho ou amarelo, e nenhuma mobília é quente.
- **Alto contraste:** todo par de texto mede pelo menos 4,5:1, e cada par tem a
  medida escrita em `docs/design.md`. Nada de cinza sobre cinza, `opacity` ou
  tom pálido. Desativado inverte, não desbota.
- **Cantos arredondados em dois raios:** 12 px no painel, 8 px no controle. A
  etiqueta de pendência tem 4 px, resíduo registrado na D42.
- **Ícone só na barra de navegação**, desenhado em `src/ui/icons.tsx`, em
  `currentColor`. Nunca emoji, nunca pacote de ícones. O ícone de instalação
  em `public/` é arte, não interface (D46).
- Alvos de toque com no mínimo 48px.
- **Sem animação decorativa.** Sem fade, sem transição de página, sem
  microinteração. Spinner e skeleton são permitidos onde há espera real.
- O saldo é o maior elemento da tela do menino, por larga margem.
- Se uma operação comum leva mais de dois toques, o desenho está errado.

## Regra de acesso

Kid vê e simula **apenas** os próprios dados, e nunca o saldo do outro. Um kid
escreve de dois jeitos, e só para si: propor um registro via cronômetro, ou
pedir uma atividade sem cronômetro (D49). Os dois nascem pendentes na mesma
fila. Admin vê e altera tudo dos dois.

A guarda vive no server action, não só na navegação.

## Comentários

Comentário sucinto. Ele diz **por que** o código é assim, nunca **o que** ele
faz: se o comentário repete a linha de baixo, apague-o. (#80)

- **Porquê que veio de decisão cabe numa linha que cita a decisão.** A história,
  a medição e o contraexemplo ficam no `decisions.md`, que é normativo, e não se
  recontam no código.
- **Nada de narrar investigação, tentativa anterior ou histórico de PR.** "Uma
  versão anterior deste comentário dizia..." é corpo de PR e git, não código.
- **Bloco acima de função: três linhas no máximo.** Se precisou de mais, o
  porquê mora no `decisions.md`.
- **Sai** o que repete nome de variável, o que só marca seção
  (`// --- #18: ...`) e o que só diz que algo é importante.
- **Fica** o porquê real, o aviso de armadilha, a referência a decisão e o
  comentário que uma ferramenta exige (`biome-ignore` e `ts-expect-error`, com
  o motivo).
- **Teste segue a mesma regra.** O nome do caso descreve o caso; o comentário
  só entra para o porquê que o nome não carrega.

Exemplos deste repositório:

```ts
// Antes: seis linhas em src/ui/style.ts. Depois, o mesmo porquê:
// `[48px]`, not `min-h-12`: the 12 is 48 px only at the default scale and font size.
export const TOUCH_TARGET_CLASS = "min-h-[48px] min-w-[48px]";

// Antes: 25 linhas acima de MIN_DECAY_STEP_HOURS, recontando a D35 e a D39 e
// narrando "an earlier version of this comment said...". Depois:
/** Narrowest halving band (D35). Not a float floor: exactness is D39's job. */
export const MIN_DECAY_STEP_HOURS = 0.25;

// Fica como está: a ferramenta exige, e o motivo cabe na linha.
// biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax under test
```

**Armadilha ao cortar:** os testes de sabotagem (`*.sabotage.test.ts`)
localizam cada mutação pelo texto exato do fonte, às vezes em várias linhas.
Um `find` que cobria o comentário, ou a linha em branco ao lado dele, deixa de
casar quando o corte sai. Rode a suíte inteira depois de cada corte.

## Fora de escopo

PWA offline, integração com API de controle parental, suporte a mais de uma
família, recuperação de senha, tema escuro alternável, internacionalização.
Instalar o app na tela inicial é suportado; guardar dado para uso offline não
(D46).
