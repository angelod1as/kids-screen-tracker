# Auditoria de UI/UX — outubro de 2026

Retrato datado de 30/10/2026, feito sobre a `main` em `6c63ab4` (#115). Só
aponta: nada aqui foi corrigido, e cada correção vira ticket (lista no fim).

**Resultado em uma frase:** o sistema visual está de pé (nenhuma cor, contraste,
alvo de toque ou animação fora da regra em 169 capturas), e o que falta é
fluxo: três operações comuns passam de dois toques (começar outra atividade,
encerrar a sessão ao abrir o app, lançar), a fila de uso destoa da fila de ganho,
e a barra do menino parte palavras no meio em quase todo celular.

| severidade | achados | o que quer dizer |
|---|---|---|
| **blocker** | 0 | impede uma tarefa ou perde dado |
| **major** | 17 | fere regra normativa ou atrasa uma operação comum |
| **minor** | 37 | polimento, consistência, cópia |

## Como foi medido

- **App:** build de produção (`pnpm build`, `pnpm check:css` verde), servidor
  `standalone`, banco local descartável com seed, `db:demo` e contas de teste.
- **Estados:** criados por uso real da interface e por linhas no banco
  descartável: fila com bloqueio da D32, pedido sem cronômetro, nota pendente,
  atividade `free`, cronômetro rodando, pausado, abaixo do piso, parado sozinho,
  entrada anulada, recusada e com valor arbitrado, os quatro status de pedido de
  uso, primeiro dia sem dado, texto de 500 caracteres e saldo de `−98h15`.
- **Larguras:** 320, 360 (Android), 390 (iPhone) e 1280 (`lg:`).
- **Medição automática em cada captura**, por `getComputedStyle`: cores
  pintadas, raios, espessura de borda, fontes, `opacity`, transição, animação,
  contraste de cada texto contra o fundo real, alvo de toque e rolagem
  horizontal.
- **Contagem de toques:** a partir da tela inicial do papel.

**Screenshots:** fora do repositório, para manter este PR só com o doc, na pasta
`kst-ux-audit-2026-10` do dono. Cada achado cita o arquivo; `--360` é a largura.
Nas capturas de página inteira a barra `fixed` aparece no meio da imagem: é
efeito da captura, não defeito.

**O que esta auditoria não cobre:** Chromium headless não é Safari de iPhone nem
Chrome de Android de verdade (teclado virtual e seletor de data não foram
vistos); leitor de tela e navegação só por teclado não foram percorridos; os
avisos push ficaram sem chave neste ambiente, então o painel *Avisos* só foi
visto no estado "não configurado"; as telas `error.tsx` e `global-error.tsx`
foram lidas no código, não forçadas.

## O que passou

| regra | medido |
|---|---|
| Paleta fechada (D42) | exatamente as seis cores nas 169 capturas, zero fora da lista (ressalva do foco em G6) |
| Contraste ≥ 4,5:1 | nenhum par abaixo |
| Alvo de toque ≥ 48 px | nenhum abaixo, a 320 inclusive |
| Sem animação decorativa | nenhuma transição ou animação |
| Sem `opacity` | nenhum uso |
| Rolagem horizontal | nenhuma, com texto de 500 caracteres e a 320 |
| Duas espessuras de régua | só 1 e 2 px, mais 2 px tracejada no desativado |
| Desativado (emenda #86) | `slate-100` com borda tracejada em controle e linha de Configuração |
| Vermelho e amarelo | só pendência, valor negativo (#105) e *Sair* |
| Saldo é o maior elemento | 60 px contra 18 px na home; `−98h15` cabe a 320 |
| Literal de cor fora de `style.ts` | nenhum (guardas verdes) |
| Confirmação de Tirar e Dar (D53) | menino em 48 px, *Confirmar* no alto, *Cancelar* no pé |

## Fluxos comuns: dá em dois toques?

Regra do `CLAUDE.md`: mais de dois toques numa operação comum é desenho errado.

| papel | operação | toques | veredito |
|---|---|---|---|
| menino | ver o saldo | 0 | ok |
| menino | começar a atividade **padrão** (Futebol) | 2 | ok, mas só para a primeira da lista |
| menino | começar **outra** atividade | 4 | **fere** — C1 |
| menino | abrir o app e encerrar a sessão em curso | 3 | **fere** — K2 |
| menino | pedir pra usar | 3 + digitar | fere de leve; o destino é obrigatório (D58) |
| menino | cancelar pedido de uso | 2 | ok |
| adulto | aprovar ganho comum | 2 (1 vindo do push) | ok |
| adulto | aprovar ganho com nota | 3 | aceitável; a nota é decisão |
| adulto | aprovar pedido de uso | 2 | ok (emenda #107) |
| adulto | recusar ganho | 3 | ok; recusar custa de propósito |
| adulto | lançar atividade, padrões da tela | 3 | **fere** — L1 |
| adulto | lançar atividade real, com outra atividade | 6 | **fere** — L1 |
| adulto | tirar ou dar | 3 | aceito pela D53 |
| adulto | anular entrada | 3 | ok; a D52 conta dois dentro do histórico |

## Achados por tela

### Em toda tela

**G1 — major — Rótulo da barra do menino parte no meio da palavra.**
"Calculadora" quebra em todo celular até 430 px e "Cronômetro" até 412; a 320
sobra um `o` sozinho em "Históric/o". A barra do menino tem seis células, não
cinco: a #70 somou a de identidade, que leva 60 px, e as outras ficam com 51 a
73 px. `design.md` promete o contrário (célula de 75 px, "não quebraria") e o
comentário em `src/ui/navigation.ts:13` ainda fala em cinco.
*Regra:* `design.md`, Tipografia. *Telas:* `kid1-home--320.png`,
`kid1-home--360.png`.

**G2 — major — Número em fonte proporcional.** O valor de 48 px da calculadora,
as linhas da conta, o saldo depois de Tirar e Dar e o "Saldo:" da anulação não
têm `font-mono`: `src/ui/explanation.tsx:43,58,66`,
`src/app/(app)/admin/tirar/release-form.tsx:145`, o trecho igual em
`refund-form.tsx:139` e `void-control.tsx:69`. A coluna de `+45 min` da conta não
alinha.
*Regra:* `design.md`, "todo número" em Plex Mono. *Telas:*
`kid1-calculadora--360.png`, `fluxo-tirar-pronto--390.png`,
`fluxo-anular-confirma--390.png`.

**G3 — major — Caixa de canto reto, um raio zero que a D42 não prevê.** A
medição de raios não pega, porque 0 px não é raio declarado, mas são ao menos
quinze usos de `BORDER_CLASS` sem raio, entre eles a conta (`explanation.tsx:43,48`), o resultado de
Tirar, Dar e Lançar (`release-form.tsx:113`, `refund-form.tsx:108`,
`launch-form.tsx:172`), o aviso da Configuração (`category-list.tsx:332`), o
*Pedido enviado* (`spend-request-form.tsx:81`) e as telas de erro e 404. Dentro
de um painel arredondado, o aviso quadrado fica ainda mais à vista.
*Regra:* D42, dois raios. *Telas:* `admin-config--390.png`,
`admin-config-atividade--390.png`, `kid1-calculadora--360.png`.

**G4 — major — Botão desativado sem dizer por quê.** *Pedir*, *Pedir pra usar* e
*Dar* nascem desativados, e nada diz o que falta. O caso de observação
obrigatória (D55) já explica; os outros não. No *Dar* parece defeito: o
formulário abre sem valor, ao contrário do *Tirar* (T1).
*Regra:* D55 como padrão, "a tela avisa antes do toque". *Telas:*
`kid1-cronometro--360.png`, `usar-pedidos-4-status--360.png`,
`admin-dar--390.png`.

**G5 — major — 404 e erro são beco sem saída no app instalado.** A página não
tem link nem barra; manda "voltar pelo botão do navegador ou pelo menu no rodapé
da tela anterior". No iPhone instalado (D46) não há botão do navegador.
*Regra:* não há decisão escrita; achado de uso. *Telas:* `404-admin--360.png`,
`404-anon--1280.png`.

**G6 — minor — Anel de foco é o azul do navegador.** `rgb(0, 95, 204)`, `1px`,
fora das seis cores e invisível aos dois guardas, porque nenhuma folha o declara.
Tela: `fluxo-fila-recusar--390.png`.

**G7 — minor — Títulos fora da tarja.** Lançar, Tirar, Dar, Calculadora e
Configuração abrem com título solto sobre o chão, o resto do app com tarja.
`design.md` já registra como trabalho pendente. Telas: `admin-lancar--390.png`,
`admin-tirar--390.png`.

**G8 — minor — Escala fora da tabela.** `design.md` diz "a escala, inteira", e
aparecem 18 px em `LinkButton` contra 16 px em `Button` (a mesma tela mistura
botões de 72 e 52 px), 18 px em texto corrido, 30 px no título de entrada e
erro, 14 px na tabela do guia.
Telas: `admin-conta--390.png`, `kid1-calculadora--360.png`.

**G9 — minor — Tarja em duas linhas.** Título e nota dividem a tarja, e os longos
quebram lado a lado: "HISTÓRICO DE KID1 / 7 LANÇAMENTOS", "CONFIRME O QUE VOCÊ
FEZ / PARA APROVAÇÃO", "FILA DE APROVAÇÃO / NADA ESPERANDO" a 390.
Telas: `admin-historico-kid1--390.png`, `timer-abaixo-minimo--360.png`,
`fluxo-pedido-aprovado--390.png`.

**G10 — minor — Palavra do menino em versalete de 12 px.** A observação do
menino sai em `META_CLASS` no histórico e nos pedidos de uso, e em 16 px normal
na fila de ganho. Texto livre de até 500 caracteres em caixa alta se lê como
grito; `design.md` reserva versalete a anotação de máquina.
Telas: `admin-fila--390.png`, `historico-estados--360.png`.

**G11 — minor — "ERRO" numa orientação.** `ErrorNote` estampa ERRO em quem só
ainda não preencheu a observação. Nada deu errado.
Tela: `timer-nota-obrigatoria--360.png`.

**G12 — minor — Todas as telas com o mesmo `<title>`.** Só `/entrar` tem título
próprio. Histórico do navegador e leitor de tela não distinguem as páginas.

### Menino: início

**K1 — major — Nada do que espera aprovação aparece na home.** O menino envia uma
sessão e a tela que ele abre não diz nada: pendência de ganho mora em Cronômetro,
de uso em Usar. É a tela do saldo, e a pergunta seguinte ao saldo é "e o que
ainda vai entrar?".
*Regra:* amarelo é pendência (D42), e aqui ela some. *Tela:*
`kid1-home--360.png`.

**K2 — major — Home ignora o cronômetro aberto.** Com sessão rodando, o botão
continua *Começar atividade* e nada indica que o tempo corre
(`src/app/(app)/menino/page.tsx` não lê timer). Encerrar custa três toques, e a
sessão esquecida vira corte no limite ou descarte. O adulto vê "Cronômetro
rodando"; o dono do cronômetro, não.
*Regra:* dois toques. Verificado no código. *Tela de comparação:*
`admin-home-cronometro--390.png`.

### Menino: cronômetro

**C1 — major — Escolher atividade custa quatro toques.** Início, abrir o
`<select>`, escolher entre as atividades, *Começar*. O seletor sempre abre em
Futebol e não lembra a última escolha, embora o menino repita poucas atividades.
*Regra:* dois toques. *Tela:* `kid1-cronometro--360.png`.

**C2 — major — Abaixo do piso, o caminho que perde a sessão é o azul.** *Encerrar
sem enviar* é primário e *Voltar*, que a própria frase recomenda, é secundário.
Azul sólido é "faça isso", e o que se faz aqui joga fora até 4min59 (D44).
*Regra:* `design.md`, "Azul sólido = faça isso". *Tela:*
`timer-abaixo-minimo--360.png`.

**C3 — minor — Campo de observação morto.** Abaixo do piso nada é enviado e o
campo "Quer contar alguma coisa?" continua ali. Tela:
`timer-abaixo-minimo--360.png`.

**C4 — minor — Duas tarefas na mesma coluna.** *Pedir sem cronômetro* tem o formulário
inteiro aberto sob *Começar*, e empurra *Esperando aprovação* para perto de
1.000 px. Tela: `kid1-cronometro--360.png`.

### Menino: usar e meus pedidos

**U1 — major — "Pedido" quer dizer duas coisas.** *Pedir sem cronômetro* ganha
hora, *Pedir pra usar* gasta. *Meus pedidos* lista só o gasto, e o pedido de
ganho aparece em *Esperando aprovação*, noutra aba. Na fila, "pedido sem
cronômetro" e "Pedidos de uso". Quem ganha e quem gasta usam a mesma palavra e
moram em lugares diferentes.
*Regra:* cópia pt-BR consistente; D49, D58. *Telas:*
`kid1-cronometro--360.png`, `usar-pedidos-4-status--360.png`.

**U2 — minor — Número grande é o pedido, não o aprovado.** Aprovado com correção
mostra `2h` em 24 px e `APROVADO · 1H` em 12 px, e o que saiu do saldo foi 1 h.
Tela: `usar-pedidos-4-status--360.png`.

**U3 — minor — Leitura fora de padrão.** Horas em 24 px aqui, 18 px em toda outra
lista (`READOUT_CLASS`), e o *Cancelar pedido* perde largura para a coluna do
número. Tela: `usar-pedidos-4-status--360.png`.

**U4 — minor — Recusado sem motivo.** O motivo que o adulto escreveu não aparece
em *Meus pedidos*, só no histórico. Verificado no código de `my-requests.tsx`.

**U5 — minor — Dois ritmos de formulário.** `gap-6` em Usar e Tirar, `gap-3` nos
painéis do cronômetro. Telas: `kid1-usar--360.png`, `kid1-cronometro--360.png`.

### Menino: histórico

**H1 — major — "Total" parece contradizer o saldo.** A tela abre com `TOTAL
+2h45` enquanto a home diz `9h23`. É a soma da janela aberta, dois dias, e nada
diz isso; o menino que confere a conta acha que ela não fecha. Num app cujo
critério é a confiança no número, é o rótulo mais caro do histórico.
*Regra:* D9, "se a conta não fecha à vista"; #78. *Tela:*
`kid1-historico--360.png`.

**H2 — minor — Pedido de uso recusado cai em Ganhos.** Medido: aparece em *Ganhos*
e não em *Perdas*. A regra de `entries.tsx:314` é de 07/10, anterior à D58, e diz
que recusa é "ganho cancelado". Pedido de gasto não é ganho.
Tela: `historico-estados--360.png`.

**H3 — minor — Recusa de gasto mostra `0 min` sem dizer quanto foi pedido.** O
ganho recusado traz a duração; o gasto, não. Tela:
`historico-estados--360.png`.

**H4 — minor — Duas recusas seguidas viram um bloco preto.** A régua da linha é
preta sobre preto. Tela: `historico-estados--360.png`.

**H5 — minor — Tirar sem destino vira "Sem descrição".** Como o destino é opcional
(D53), o menino lê uma linha sem nome. Tela: `historico-estados--360.png`.

**H6 — minor — Repetição.** "TIRADO · …" e "TIRADO POR ADMIN1" em linhas seguidas,
e o ano inteiro em cada data. Tela: `kid1-historico--360.png`.

### Menino: calculadora

**CA1 — minor — A calculadora termina em lugar nenhum.** Depois de ver quanto vale,
não há como começar a atividade dali. Tela: `calculadora-nota--360.png`.

**CA2 — minor — Botões de nota quebram.** "0% (0 min)" em duas linhas nas três
colunas, deixando um buraco na segunda fileira, também no desktop. Telas:
`calculadora-nota--360.png`, `admin-fila--1280.png`.

### Adulto: início

**AH1 — major — A única coisa que pede ação é a menos pesada.** *Fila de
aprovação* é secundária, e os três botões azuis de *Do dia a dia* vêm com o mesmo
peso. A etiqueta amarela salva o olhar, mas o azul aponta para o lado errado.
*Regra:* `design.md`, "Azul sólido = faça isso". *Tela:* `admin-home--390.png`.

### Adulto: fila

**F1 — major — Dois números para a mesma fila.** A home diz `8 ESPERANDO`, a tarja
da fila `6 ESPERANDO`, e *Pedidos de uso* mostra um `2` sem amarelo. Uma pendência
de uso não usa a cor de pendência.
*Regra:* D42, amarelo em pendência; D58, mesma fila. *Telas:*
`admin-home--390.png`, `admin-fila--390.png`.

**F2 — major — Pedidos de uso desenhados de outro jeito.** Correção e motivo vêm
sempre abertos, e cada pedido ocupa cerca de 400 px contra 250 de um ganho, que
esconde os dois atrás de *Corrigir* e *Recusar*. No desktop o painel ignora o
teto de 768 px da fila. A coluna do número encolhe o formulário, então a largura
dos campos muda de pedido para pedido (`−2h` e `−1h30`).
*Regra:* `design.md`, Desktop. *Telas:* `admin-fila--1280.png`,
`fluxo-pedido-aprovado--390.png`.

**F3 — major — Pedido de uso fica no fim.** O menino que pede uso está esperando
agora, e com seis ganhos o painel começa a cerca de 2.400 px do topo, a 390.
*Regra:* dois toques, na prática. *Tela:* `admin-fila--390.png`.

**F4 — minor — Instruções opostas no mesmo cartão.** "Escolha a nota e aprove" logo
acima de "Aprove antes: …" e de um *Aprovar* desativado. E "Aprove antes" esconde
que recusar também libera (D32). Tela: `admin-fila--390.png`.

**F5 — minor — Motivo digitado e *Aprovar* descarta o motivo em silêncio.** No
pedido de uso o campo fica sempre ao lado do *Aprovar*; no ganho, com a recusa
aberta, *Aprovar* continua azul e no topo. Tela:
`fluxo-fila-recusar--390.png`.

**F6 — minor — Recusar custa diferente.** Dois toques no ganho, um no pedido de
uso, sem confirmação. Tela: `admin-fila--390.png`.

**F7 — minor — Botões empilhados alongam a fila.** Três de 48 px por cartão, quatro
com a recusa aberta. *Aprovar* inteiro e *Corrigir* e *Recusar* lado a lado
caberiam a 320 e cortariam uma linha por cartão. Tela: `admin-fila--390.png`.

**F8 — minor — Lembrete sem sujeito.** "Pronto. Agora ligue o aparelho." não diz de
quem nem quanto, e fica na tela até recarregar. Tela:
`fluxo-pedido-aprovado--390.png`.

**F9 — minor — Destino sem quebra é cortado.** `META_CLASS` sem `break-words` em
`spend-request-list.tsx:128,132`: a linha some na borda do painel. Só com palavra
muito longa. Tela: `estresse-fila--320.png`.

### Adulto: lançar

**L1 — major — Lançar passa de dois toques, e a D18 existe para isso.** Com os
padrões são três; lançando outra atividade, seis: menino, abrir seletor, opção,
duração, *Ver quanto vale*, *Confirmar lançamento*. A prévia surge embaixo, sem
rolar até ela, e o *Confirmar* fica atrás da barra, a 390.
*Regra:* dois toques; D18. *Telas:* `admin-lancar--390.png`,
`fluxo-lancar-previa--390.png`.

**L2 — minor — Kid1 vem marcado.** O engano que originou a D53 foi de menino, e
Lançar, Tirar e Dar abrem com o primeiro já escolhido. A confirmação segura Tirar
e Dar; a de Lançar não dá ao nome o mesmo peso. Tela:
`fluxo-lancar-previa--390.png`.

### Adulto: tirar e dar

**T1 — minor — Formulários irmãos, formas diferentes.** Tirar tem seis atalhos e
1 h de partida; Dar só tem dois campos vazios. Telas: `admin-tirar--390.png`,
`admin-dar--390.png`.

**T2 — minor — Formulário continua preenchido depois de gravar.** Mesmos menino e
horas embaixo de "Tirado 1h de Kid1". Tela: `fluxo-tirar-pronto--390.png`.

**T3 — minor — Mesma coisa, dois nomes.** "Destino" em Tirar, "Para quê" em Usar e
na confirmação. Telas: `admin-tirar--390.png`, `kid1-usar--360.png`.

### Adulto: histórico do menino

**HA1 — minor — *Anular* em cada linha.** Um botão de 48 px por entrada dobra a
altura da lista e dá a uma ação rara o peso de uma permanente. Tela:
`fluxo-anular-confirma--390.png`.

**HA2 — minor — *Tirar horas* no alto, *Dar* não.** Só um dos dois atalhos existe,
como primário, numa tela de leitura. Tela: `admin-historico-kid1--390.png`.

### Adulto: números

**N1 — minor — "30 min" quebra em duas linhas,** também a 1280, porque a coluna do
valor em `FlowBars` é estreita. Telas: `admin-numeros--390.png`,
`admin-numeros--1280.png`.

**N2 — minor — Hora em caixa alta na tarja.** `9H23` e `−20H15`: a nota herda
`uppercase` de `HEADING_CLASS`, e o formato do app é `9h23`.
Tela: `admin-numeros--1280.png`.

### Adulto: configuração

**CF1 — major — *Desativar* é o botão azul da categoria.** O primário da tela é a
ação de maior consequência, e *Editar números*, o que se veio fazer, é secundário.
Na atividade é o inverso, e certo.
*Regra:* `design.md`, "Azul sólido = faça isso". *Tela:*
`admin-config-categoria-desativada--390.png`.

**CF2 — minor — Tempo em decimal.** "até 6,00 h por dia" e "Rende no máximo 3,00 h"
convivem com `1h` na mesma tela, e a taxa sai como `1,50 h`, embora não seja
tempo (D9, emenda #48). Telas: `admin-config--390.png`,
`admin-config-categoria-desativada--390.png`.

**CF3 — minor — Calculadora do adulto a três toques.** Conta, Configuração,
Calculadora, para uma ferramenta de conferência da fila. Tela:
`admin-config--390.png`.

### Conta e guia

**GU1 — minor — Guia sem índice.** 5.959 px para o menino, 7.574 para o adulto, e a
lista de atividades repete a mesma frase. Tela:
`kid1-como-funciona--360.png`.

## Conhecido e aceito: não reabrir

| item | onde foi aceito |
|---|---|
| Etiqueta de pendência em 4 px | D42, resíduo |
| Toque a mais em Tirar e Dar | D53 |
| Aprovar pedido de uso sem prévia do saldo | D58, emenda #107 |
| Sessão curta perdida inteira | D44 (o aviso é C2, não a regra) |
| Fila ordenada por aritmética, não por menino | D32 |
| Ícone de instalação laranja | D46 |

## Tickets propostos, em ordem de prioridade

Governados por D42 e `docs/design.md`, além do que cada linha cita. Agrupam
achados que se resolvem com o mesmo diff.

| # | título | achados | custo |
|---|---|---|---|
| 1 | Barra do menino: rótulos sem partir palavra até 320 px | G1 | P |
| 2 | Atividades recentes no cronômetro: começar a de sempre em dois toques | C1 | M |
| 3 | Home do menino: mostrar sessão em curso e o que espera aprovação | K1, K2 | M |
| 4 | Fila: pedidos de uso no topo, com a contagem e o amarelo da fila | F1, F3 | P |
| 5 | Fila: pedido de uso na forma do cartão de ganho e dentro de 768 px | F2, F5, F6, F9 | M |
| 6 | Lançar em dois toques: recentes, prévia à vista e confirmação sem rolar | L1, L2 | M |
| 7 | Histórico: nomear a janela do Total ("nestes 2 dias") | H1 | P |
| 8 | Hierarquia de botões: azul no que se deve fazer (Fila, Voltar, Editar números) | AH1, C2, CF1 | P |
| 9 | Botão desativado sempre diz o que falta | G4, T1 | P |
| 10 | Vocabulário: separar pedir para ganhar de pedir para usar | U1, T3 | M, com decisão do dono |
| 11 | Todo número em Plex Mono: conta, resultado e anulação | G2, N1, N2 | P |
| 12 | Primitivo de caixa com raio de 8 px no lugar de `BORDER_CLASS` solto | G3 | P |
| 13 | 404 e erro com saída para a tela inicial | G5 | P |
| 14 | Painel com tarja em Lançar, Tirar, Dar, Calculadora e Configuração | G7, G9, U5 | M |
| 15 | Histórico: pedido de uso recusado em Perdas, com o valor pedido | H2, H3, H4 | P, com decisão do dono |
| 16 | Meus pedidos: destacar o aprovado e mostrar o motivo | U2, U3, U4 | P |
| 17 | Fila de ganho: frase única no cartão bloqueado e botões mais baixos | F4, F7, F8 | P |
| 18 | Histórico do adulto: Anular menos presente, Dar ao lado de Tirar | HA1, HA2 | P |
| 19 | Configuração: tempo em `6h`, taxa sem `h`, Calculadora mais perto | CF2, CF3 | P |
| 20 | Observação do menino em texto normal, e "ERRO" só em erro | G10, G11, C3 | P |
| 21 | Fechamentos do fluxo: limpar o Tirar e levar a calculadora ao cronômetro | T2, CA1, CA2, C4 | P |
| 22 | Sistema: foco na paleta, escala tipográfica na tabela e `<title>` por tela | G6, G8, G12 | P |
| 23 | Limpar o histórico do menino e dar índice ao guia | H5, H6, GU1 | P |
| 24 | Atualizar docs: células da barra, comentário de `navigation.ts`, D1–D60 no `CLAUDE.md` | G1 | P |

P é um PR pequeno, M pede desenho antes. Os tickets 10 e 15 mudam palavra ou
regra escrita (D58, #78), então pedem decisão do dono antes do código.
