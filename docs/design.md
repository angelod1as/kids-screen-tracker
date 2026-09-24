# Sistema visual — painel de instrumentos

O desenho do app, como ele está na `main`. Veio da
[issue #74](https://github.com/angelod1as/kids-screen-tracker/issues/74) e é
normativo pela D42: a seção Design do `CLAUDE.md` é o resumo, este documento é o
detalhe e o porquê.

A ideia em uma frase: **a tela não é um documento, é uma face de instrumento.**
Regiões delimitadas por régua, cada uma com o nome gravado numa tarja azul, e
os números alinhados numa coluna. Algo entre o painel de um relógio de ponto e
uma tabela bem desenhada.

Alvo de toque de 48 px, nada se move, alto contraste em todo lugar, e cor
carregando significado em exatamente dois lugares — pendência e saldo negativo.

**Por que não é mais só preto e branco:** o dono achou a primeira versão, preto
e branco, seca demais ("queria que parecesse mais um app"). O app ganhou uma
paleta, cantos arredondados e ícones no menu. A regra de contraste e a regra
dos significados continuam inteiras — o que caiu foi "só preto e branco", que
era meio e não fim.

---

## Tipografia

### Duas famílias, e a divisão é o argumento inteiro

| onde | família | por quê |
|---|---|---|
| palavras | **IBM Plex Sans** | grotesca de engenharia, desenhada para legenda técnica; altura-x alta, letras abertas, boa em 12 px |
| **todo número** | **IBM Plex Mono** | num instrumento as leituras se alinham numa coluna, e as palavras não |

O `histórico` é a prova. São duzentas linhas cujo conteúdo real é o número da
direita. Com dígito proporcional a vírgula decimal cai num lugar diferente em
cada linha e a lista vira "fatos que por acaso são números"; com dígito
tabular ela cai sempre no mesmo lugar e a lista vira tabela — dá para ler
passando o dedo pela borda direita sem ler nenhuma palavra.

O mesmo vale para os dois saldos do admin lado a lado (`17h13` e `−5h30` só
se comparam se os dígitos tiverem a mesma largura) e para o cronômetro, onde os
dígitos mudam a cada segundo e uma fonte proporcional faria o número inteiro
"respirar" para os lados.

### Auto-hospedada, não `next/font/google`

Os quatro arquivos `woff2` (`src/app/fonts/`) são o subconjunto `latin` que o
próprio Google serve, commitados ao lado do código. São 55 kB no total.

O motivo é de build, não de estética: `next/font/google` baixa a fonte em tempo
de build, e o build que importa aqui roda dentro da imagem Docker, na máquina de
outra pessoa. Um host sem acesso a `fonts.googleapis.com` derrubaria o build.
Assim não há rede no build, não há requisição a terceiro em runtime, e os bytes
são os mesmos toda vez. `src/app/fonts/LICENSE.txt` é a SIL Open Font License
1.1, que é o que permite redistribuir desse jeito.

O subconjunto `latin` cobre o português (`ã`, `õ`, `ç`, `é`) e, de propósito,
`U+2212` — o sinal de menos de verdade que o `formatHours` escreve antes de um
saldo negativo. Um subconjunto sem ele faria justamente aquele glifo cair na
fonte do sistema, no único número que a regra de cor existe para proteger.

### Dois pesos, 400 e 700

O desenho tem exatamente duas vozes — uma coisa e o rótulo dela. Um terceiro
peso é um meio-tom de ênfase, que é o mesmo argumento que o projeto já usa
contra um terceiro cinza.

### A escala, inteira

| papel | tamanho | como é escrito |
|---|---|---|
| saldo do menino, cronômetro | 3,75 rem | mono, 700, `leading-none`, centralizado |
| saldo de um menino na tela do admin | 1,5 rem | mono, 700 |
| número numa linha (horas, prévia) | 1,125 rem | mono, 700 |
| rótulo de painel, título, botão | 1 rem | sans, 700, **caixa alta**, `tracking 0.12em` |
| texto corrido, nome numa linha | 1 rem | sans, 400 ou 700 |
| segunda linha de uma linha (tipo · data) | 0,75 rem | sans, 700, **caixa alta**, `tracking 0.08em` |
| rótulo da barra de navegação | 0,75 rem | sans, 700, **caixa baixa** |

**Por que caixa alta nos rótulos.** Versal não tem descendente e tem linha
superior plana, então um rótulo em 12 px continua legível onde 12 px de texto
corrido não estariam. E ele lê como anotação de máquina, não como frase para
parar e ler — que é exatamente o papel de `GANHO · 17/09/2026`. O tracking
existe porque versal sem espacejamento extra fecha demais.

**A navegação é a única exceção.** Versal é ~15% mais largo, e 15% em cima dos
72 px do rótulo mais longo estoura os 75 px que uma célula tem a 320 px de
largura. `CALCULADORA` é palavra única: não quebraria, partiria no meio. O resto
da interface pode pagar a versal porque nada mais está preso a uma célula de
79 px.

### O saldo é o maior elemento, e o teto dele é medido

3,75 rem contra 1 rem de qualquer rótulo na mesma tela — fator 3,75, não um
degrau de escala. `home-screens.test.tsx` mede a relação (e o quadro em volta,
`app-shell.tsx`), então ela não depende de ninguém lembrar.

Não é maior que isso, e o limite é o telefone mais estreito, não gosto. Em mono
cada glifo tem 0,6 em; o saldo mais largo que o app consegue desenhar
(`−102h30`, sete caracteres) dá 252 px nesse tamanho, e a 320 px de viewport o
painel deixa 304. Medido no navegador a 360 e a 390.

---

## Cor

### Seis cores, declaradas num lugar só

Toda cor que o app pode servir é uma constante em `src/ui/style.ts`, e nenhum
outro arquivo tem permissão de escrever uma. `design.test.ts` reprova qualquer
cor com número de tom escrita fora de lá; `scripts/check-served-css.sh` reprova
qualquer cor que chegue à folha de estilo servida sem estar na lista. A guarda
antiga dizia "preto e branco, mais as exceções"; agora diz "estas seis, e mais
nada". É a mesma proteção contra cor que entra por hábito.

A paleta tem duas metades, e confundir as duas é o erro que ela existe para
impedir:

| metade | cor | onde | par |
|---|---|---|---|
| **mobília** | `blue-800` | tarja de painel, controle primário, item atual do menu, opção escolhida | texto branco por cima |
| **mobília** | `slate-100` | o chão em que os painéis pousam | texto preto por cima |
| **significado** | `yellow-300` | pendência | texto preto por cima |
| **significado** | `red-700` | saldo negativo | tinta sobre branco |

Preto e branco completam as seis. O contraste de cada par está medido em
[Contraste, medido](#contraste-medido).

**A mobília é fria e os significados são quentes, de propósito.** Uma tela
inteira de mobília ainda tem exatamente uma coisa quente nela, e essa coisa é
sempre algo que o leitor precisa resolver. Na tela do admin: o `−5h30` do Kid2
e a etiqueta `3 ESPERANDO`, e nada mais. `design.test.ts` chega a testar isso —
nenhuma cor de mobília pode ser vermelha, laranja, âmbar ou rosa.

**A mobília pode crescer; os significados não.** Um teste fixa a metade de
significado em exatamente dois, porque um terceiro significado é uma terceira coisa
que o leitor tem que aprender a enxergar. A mobília é desenho e pode ganhar um
tom novo num diff que alguém lê.

### Um tom só de azul

A primeira versão tinha dois: um mais fundo para a faixa do topo de toda tela,
que precisava se distinguir da tarja do primeiro painel 12 px abaixo. A #70
removeu essa faixa — a identidade de quem está logado foi para a primeira
célula da barra de baixo — e o tom foi junto com ela. Uma cor sem trabalho a
fazer é uma cor que alguém vai usar para outra coisa.

### Nada ficou pálido

Desativado **inverte**, não desbota — e agora funciona melhor do que funcionava
em preto e branco: a cor indo embora *é* o sinal. Dá para ver na fila, no
*Aprovar* da entrada bloqueada pela D32.

O chão `slate-100` mede 19,17:1 sob texto preto. É tinta, não cinza no sentido
que as regras proíbem: nada perde contraste. O que ele compra é a borda — um
painel branco numa página branca só é painel por causa da moldura; numa página
tingida ele já é painel antes de a moldura ser lida.

---

## Ícones

Oito glifos, só na barra de navegação, desenhados à mão em `src/ui/icons.tsx`.

**Nunca emoji.** Emoji é uma fonte que o sistema escolhe: chega colorido, com
forma diferente no Android e no iOS, e num tamanho que ninguém controla. Estes
são oito traçados numa grade de 24, mesmo peso, mesmas terminações.

**`currentColor` em todos.** É o que faz o item atual funcionar: o glifo e o
rótulo invertem juntos porque nenhum dos dois nomeia uma cor. Um glifo com cor
própria sobreviveria à inversão e sumiria no azul.

**Sem pacote de ícones.** Oito traçados não pagam uma dependência, um passo de
build e 40 kB de sprite, e um conjunto desenhado para um briefing é mais
coerente que um conjunto montado a partir de um.

Casa (Início), cronômetro (Cronômetro), calculadora (Calculadora), extrato
(Histórico), bandeja (Fila), mais (Lançar), controles deslizantes (Configuração, que a #70 tirou da barra e
que hoje não é desenhado), e
uma pessoa na célula de identidade que a #70 pôs à esquerda da barra — a única
célula cujo rótulo é um nome em vez de uma palavra, então o glifo é a parte
dela que é igual para as quatro contas, e é o que a torna achável antes de o
nome ser lido. O
ícone é buscado pela rota e não vive no `navigation.ts`: aquele arquivo é dado
puro cuja forma exata `navigation.test.ts` afirma, e a figura de uma rota é
assunto de desenho. Uma rota sem glifo desenha só o rótulo em vez de quebrar.

Todos são `aria-hidden`: o link já diz "Histórico" por escrito, e um leitor de
tela que também anunciasse "figura de uma lista" estaria lendo a decoração duas
vezes.

---

## Espaçamento

### Duas espessuras de régua, e elas significam coisas diferentes

- **2 px** é a borda de uma região: o contorno de um painel, o contorno de um
  controle, a divisória entre dois painéis empilhados, a divisória entre os dois
  meninos no painel de saldos;
- **1 px** é uma divisão dentro de uma região: a linha entre dois lançamentos.

Ninguém precisa que isso seja explicado — é como toda tabela, formulário e
instrumento funciona há dois séculos. Mas para de funcionar no instante em que
aparece uma terceira espessura, então são duas.

### Estrutura desenhada, não implícita

O layout antigo era uma pilha de caixas, cada uma com borda própria, flutuando
numa margem. A diferença desta direção é que o preto agora **desenha** a
estrutura: as linhas de um painel se tocam e são separadas por régua, não por
espaço. Um painel não tem margem interna entre as linhas.

Os cantos são arredondados em dois raios, pelo mesmo motivo que há duas
espessuras de régua: **12 px num painel, 8 px num controle.** Painel é região,
controle é coisa que se aperta, e o leitor que nunca reparar na diferença ainda
assim sente o controle dentro da região em vez de ao lado dela. O canto reto era
escolha do primeiro rascunho e o dono pediu para sair.

A etiqueta de pendência (`pending.tsx`) usa `rounded`, 4 px — um terceiro raio
que os dois acima não descrevem. Está registrado como resíduo da D42 e não foi
mudado: este documento descreve o desenho, não o corrige.

### Os números do espaçamento

| medida | valor | por quê |
|---|---|---|
| respiro da página (`main`) | 12 px no celular, 24 px no desktop | é a moldura da face; no celular cada pixel lateral conta |
| entre painéis | 16 px no celular, 24 px no desktop | suficiente para separar duas regiões, insuficiente para parecer que flutuam |
| dentro de uma linha | 12 px horizontal, 12 px vertical | com uma linha de 1 rem dá 48 px de altura — o alvo de toque que essas linhas precisariam ter se alguma fosse tocável. Nenhuma é hoje; a altura fica assim mesmo, para que virar link depois não exija redesenhar |
| tarja de título | 12 px horizontal, 8 px vertical | é rótulo, não conteúdo |
| altura mínima de qualquer controle | 48 px | `TOUCH_TARGET_CLASS`, sem exceção e sem `className` de fora |

---

## Hierarquia

### O que carrega peso, em ordem

1. **A tarja azul.** Sólida, não matizada — um tom pálido seria cinza. Dá à tela uma
   linha de horizonte a cada 200 px, e é isso que torna uma página densa
   varrível no celular: o olho pousa numa tarja, não num parágrafo.
2. **O número.** Mono, negrito, alinhado à direita, sempre no mesmo lugar da
   linha.
3. **O nome.** Sans negrito, 1 rem, à esquerda.
4. **A anotação.** Versalete de 12 px, embaixo do nome.

### Azul sólido = "faça isso"

Controle primário é branco sobre `blue-800`; secundário é preto sobre branco com
régua. Desativado **inverte**, não desbota — controle acinzentado é exatamente o
cinza sobre cinza que a regra proíbe, e é o estado que o menino tem mais chance
de estar apertando os olhos para ler. Dá para ver isso na fila: o *Aprovar* da
entrada bloqueada pela D32 fica branco enquanto os outros dois ficam azuis.

### Cor, os dois lugares e nada além

| lugar | como |
|---|---|
| pendência | `bg-yellow-300`, preto por cima |
| saldo negativo | `text-red-700` sobre branco |

O vermelho é **tinta sobre branco** no saldo negativo e nunca sobre a tarja nem
sobre preto: o mesmo vermelho sobre preto mede 3,27:1 e seria a única exceção
que quebra a regra de contraste em vez de sobreviver a ela.

Repare no que isso faz na prática: na tela do admin a única coisa colorida da
página é o `−5h30` do Kid2 e a etiqueta `3 ESPERANDO`. São os dois fatos que
exigem ação. Nada mais compete.

### Títulos moram na tarja do painel

O cronômetro não tem mais um `<h1>Cronômetro</h1>` acima de tudo. O nome da tela
depende do que ela está fazendo — o nome da atividade enquanto uma sessão corre,
"Confirme o que você fez" enquanto ele envia — e esse nome fica na tarja do
painel que ele titula. Um título fixo acima seria um segundo cabeçalho dizendo
menos que o primeiro. O mesmo na fila: o título e a contagem do que espera são o
mesmo fato, então ficam na mesma tarja.

---

## Desktop: uma base só

Não há tela duplicada e não há componente condicional. O desktop é o mesmo
markup com utilitários `lg:`.

**A casca** (`app-shell.tsx`) é `flex-col` no celular: sem barra em cima, a
página, e a barra fixa na base da janela, onde está o polegar. Isso é da #70 e
ficou como estava — inclusive o acolchoamento que a coluna dá a si mesma para a
barra `fixed` não cobrir o fim de uma lista de duzentos lançamentos.

O que a #74 muda ali é uma conta: com um glifo acima de cada rótulo a célula
ficou mais alta que o alvo de 48 px que ela garante, então a altura reservada
passou a ser escrita por extenso — 24 do glifo, 4 do vão, 30 de duas linhas de
rótulo, 16 do `py-2`, 2 da régua. São 76, e é o **pior** caso de propósito: a
390, onde nada quebra em duas linhas, sobra um pouco de branco no fim; uma
reserva feita para o 390 esconderia a última linha do histórico a 320, sem
rolagem sobrando para trazê-la de volta. A partir de `lg` o miolo vira `flex-row-reverse`: a
barra vira uma **trilha de 208 px encostada à esquerda** e a página ocupa o
resto. `row-reverse` põe a trilha à esquerda na tela mantendo-a por último no
documento, que também é a ordem em que um teclado deveria encontrá-las.

A trilha não é só gosto: uma barra esticada por 896 px daria a cada célula
180 px de cor para dizer uma palavra.
A contagem de colunas da grade é `style` inline (a barra do celular precisa
dela), então o `lg:grid-cols-1!` leva `!` — utilitário comum não vence estilo
inline.

**As telas** abrem em duas colunas onde a divisão significa alguma coisa:

| tela | esquerda | direita | por quê |
|---|---|---|---|
| saldo do menino | saldo, botão de começar, o que está ligado | lançamentos | à esquerda o estado das coisas e o que dá para fazer; à direita o que aconteceu, que é a única parte que cresce sem limite |
| saldos do admin | saldos, fila | ações do dia, aparelhos | ler à esquerda, agir à direita |
| cronômetro | a sessão | o que espera aprovação | a mesma divisão |
| histórico | uma coluna só, no máximo 672 px | — | duas colunas de lista cronológica obrigariam o leitor a descobrir se ela lê para baixo e depois para baixo, ou de lado |
| fila | uma coluna só, no máximo 768 px | — | a ordem da fila é aritmética (D32), não arrumação |
| conta | uma coluna só, no máximo 448 px | — | são dois controles; esticar não os torna mais fáceis de achar |

A largura máxima da casca sai de `max-w-md` para `max-w-4xl` (896 px). Não mais
que isso: acima de ~900 px uma linha de texto fica mais difícil de ler, não mais
fácil, e uma página ocupando um monitor de 27" inteiro colocaria o saldo e o
botão que o aumenta a meio metro um do outro.

Na fila, os três controles de cada entrada empilham no celular (três lado a lado
ficariam abaixo de 48 px a 320 px) e viram uma linha a partir de `lg`, porque um
*Aprovar* de 600 px de largura é um controle em que ninguém acredita.

---

## Contraste, medido

Razão de contraste da WCAG 2, calculada sobre a cor que o navegador pinta. O
Tailwind 4 declara a paleta em `oklch()` (`node_modules/tailwindcss/theme.css`);
convertida para sRGB, cada uma cai dentro da gama e vira o hex da segunda
coluna. `design.test.ts` refaz a conta a partir do `theme.css` instalado, então
uma atualização do Tailwind que mude um tom reprova o teste em vez de mudar o
número em silêncio.

| par | onde aparece | razão | AA texto normal (4,5:1) | AAA texto normal (7:1) |
|---|---|---|---|---|
| branco sobre `blue-800` (`#193cb8`) | tarja de painel, controle primário, item atual do menu, opção escolhida | **8,82:1** | passa | passa |
| preto sobre `slate-100` (`#f1f5f9`) | texto solto no chão, fora de painel | **19,17:1** | passa | passa |
| preto sobre `yellow-300` (`#ffdf20`) | etiqueta de pendência | **15,83:1** | passa | passa |
| `red-700` (`#c10007`) sobre branco | saldo negativo | **6,42:1** | passa | não passa |
| preto sobre branco | todo o resto | 21:1 | passa | passa |

O saldo negativo é o único par abaixo de 7:1, e está sempre em tamanho grande
(1,5 rem ou mais, negrito) — o limite de AAA para texto grande é 4,5:1, que ele
passa.

Dois pares que o app **não** usa, e por quê: `red-700` sobre preto mede 3,27:1 e
preto sobre `blue-800` mede 2,38:1. É por isso que a tinta vermelha nunca pousa
na tarja nem em fundo preto, e que o texto numa tarja é sempre branco.

---

## O que foi medido na #74, e como

Com o app rodando e dado real (o mesmo banco de demonstração, mais três
propostas na fila e um cronômetro aberto), em Chromium, a 360×740, 390×844 e
1280×900, nos dois papéis, em `/menino`, `/menino/historico`,
`/menino/cronometro`, `/conta`, `/admin`, `/admin/fila` e
`/admin/historico/{id}` — vinte e uma combinações:

- **zero** rolagem horizontal em qualquer delas;
- **zero** alvos de toque abaixo de 48 px (o único `0×0` que aparece é o
  `<input type="hidden">` que o Next gera para server action, que já existia);
- exatamente **seis** cores pintadas nas vinte e uma telas somadas, lidas do
  `getComputedStyle` de cada elemento — as seis declaradas, nenhuma estranha;
- **zero** `transition-duration` diferente de `0s` e **zero** `animation-name`
  diferente de `none`;
- a barra de baixo fica dentro da janela no topo, no meio e no fim da rolagem do
  histórico, a 360 e a 390, sem nada pintado por cima dela;
- `pnpm lint`, `pnpm typecheck`, `pnpm build` e `pnpm check:css` passam.

---

## Onde o sistema mora no código

Quase tudo mora nos primitivos, e uma tela nova herda a direção por eles:

- `src/ui/style.ts` — as fichas do desenho (paleta, painel, tarja, linha,
  leitura, rótulo, raio, face do saldo), e o único arquivo que pode escrever
  uma cor com tom;
- `src/ui/icons.tsx` — os glifos;
- `src/ui/panel.tsx` — a região nomeada da qual as telas são montadas;
- `src/ui/app-shell.tsx`, `nav.tsx`, `button.tsx`, `link-button.tsx`,
  `choice.tsx`, `field.tsx`, `select.tsx`, `entries.tsx`, `pending.tsx`;
- `src/app/fonts.ts` e `src/app/fonts/`.

Quem guarda: `src/ui/design.test.ts` sobre o código-fonte e
`scripts/check-served-css.sh` (`pnpm check:css`) sobre a folha de estilo
construída.

As telas que a #74 não redesenhou — calculadora, lançar, liberar, estornar,
configuração — herdaram a direção pelos primitivos sem serem tocadas. Passar
por elas dando a cada bloco o painel que ele merece é trabalho de desenho que
ainda não foi feito, não uma exceção à regra.
