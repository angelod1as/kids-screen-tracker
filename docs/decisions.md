# Decisões — Quanto Tempo Vale?

Vinte e cinco ambiguidades da spec, resolvidas e justificadas antes da primeira
linha de código, mais as que cada fase mediu depois. Hoje são cinquenta e
duas, D1–D52, mais dez emendas e as duas declarações da Fase 4, uma delas
revogada.

**Onde este documento e `spec.md` discordarem, este documento vence.**

Cada issue do repositório cita os números das decisões que a governa. O round 2
de revisão de PR confere o diff contra estes números.

---

## O desgaste, em uma frase

A cada `decay_step_hours` **horas de atividade** acumuladas na categoria no dia,
a hora seguinte vale metade da anterior. Para sempre, sem piso e sem teto.

Mente, leitura a 1,5, passo de 1h:

| hora lida | multiplicador | ganha | acumulado |
|---|---|---|---|
| 1ª | ×1 | 1,5h | 1,5h |
| 2ª | ×0,5 | 0,75h | 2,25h |
| 3ª | ×0,25 | 0,375h | 2,63h |
| 4ª | ×0,125 | 0,19h | 2,81h |
| 5ª | ×0,0625 | 0,09h | 2,91h |
| 6ª | ×0,031 | 0,05h | **2,95h** |

Ler 6 horas é permitido — só rende quase nada a mais do que ler 4. O limite
existe como **assíntota, não como porta fechada**.

```
assíntota = taxa × decay_step_hours × 2
```

Por isso o número que se calibra é quanto a categoria pode render num dia; o
passo sai dele.

| categoria | taxa | rende no máximo / dia | `decay_step_hours` |
|---|---|---|---|
| Corpo | 1,5 | ~6h | 2h |
| Mente | 1,5 | ~3h | 1h |
| Criativo | 1,5 | ~3h | 1h |
| Escola — estudo pra prova | 1,0 | ~4h | 2h |
| Convívio · Casa · Curinga | — | sem desgaste | nulo |

Corpo tem passo dobrado de propósito: partida de futebol dura 2h e paga cheia.
Desestimular a atividade que mais custa sair de casa pra fazer seria o incentivo
invertido.

---

## Motor de cálculo

### D1 — O desgaste é indexado por hora de atividade, não por hora de tela

A spec definia `full_up_to` e `half_up_to` em horas de tela geradas. Isso torna o
mesmo limiar consumido em velocidades diferentes conforme a atividade escolhida,
e é impossível de calcular de cabeça — que era o requisito declarado.

**Decisão.** O contador é **tempo de atividade**. "Leu uma hora, ganhou duas; leu
mais uma, ganhou uma; leu mais uma, ganhou meia."

**Por quê.** É o único enunciado que um adolescente calcula sem papel: ele sabe
quanto tempo sentou, não quanto de tela gerou. E o incentivo passa a mirar o
comportamento certo — parar de fazer a mesma coisa —, não o saldo.

### D2 — Sem teto: a torneira fecha, a porta não

As três faixas fixas da spec (cheio, metade, um quarto) davam um piso — a partir
de certo ponto todas as horas valiam igual, o que na prática vira um limite.

**Decisão.** Queda geométrica sem fim: um único campo `decay_step_hours` por
categoria substitui `full_up_to` e `half_up_to`. Nulo desliga o desgaste.

**Por quê.** Em dia de chuva sobra pouca coisa pra fazer, e ninguém pode ser
barrado por já ter lido demais. A soma converge sozinha — o comportamento de teto
aparece sem nunca ser imposto, e o menino nunca ouve "não vale mais nada".

### D3 — O balde é por categoria e zera todo dia

**Decisão.** O acumulado é de horas de atividade da **categoria**, no dia
corrente, e volta a zero à meia-noite. Sessões somam: parou e voltou duas horas
depois, continua de onde a torneira estava.

**Refinada pela D37 (Fase 6):** a categoria do balde é a que foi **carimbada no
log** ao congelar, não a que a atividade tem hoje, e a pertinência sai dos minutos
da própria linha em vez do `calc_mode` vivo.

**Por quê.** Ser por categoria é o que faz livro → HQ → xadrez dividirem o mesmo
balde: alternar tem que significar trocar de categoria, não trocar de livro.
Zerar diário é o que impede que um sábado ruim contamine o domingo.

### D4 — O desgaste semanal sai do modelo

> **Corte na spec.**

**Decisão.** A janela semanal domingo–sábado deixa de existir para o cálculo. Só
a diária permanece.

**Por quê.** O desgaste semanal existia para impedir a maratona que a torneira
diária já resolve. Manter os dois obrigaria a tela do menino a explicar duas
coisas ao mesmo tempo — "metade porque hoje" *e* "metade porque essa semana" —
que é a explicação que ninguém lê. O bônus de retorno continua sendo o que puxa
variedade entre dias.

### D5 — Atividades `fixed` e `delivery` não desgastam

**Decisão.** Sem duração, não há hora de atividade para acumular. Convívio e Casa
ficam com `decay_step_hours` nulo; em Escola, o desgaste vale só para "Estudo
para prova".

**Emendada na Fase 6** — ver "Emenda à D5 e à D12", no fim: a tela de
Configuração deixa dar desgaste a estas categorias, e diz o motivo desta decisão
quando alguém edita uma delas.

**Por quê.** A realidade já limita esses itens — dá pra dormir na casa de um amigo
uma vez por noite. E Casa mantém o cooldown de 7 dias que a spec já previa, que é
o freio adequado ali.

### D6 — A janela do cooldown e do bônus de retorno

"Nos últimos N dias" não diz se conta o próprio dia nem se a fronteira é aberta.

**Decisão.** Janela `[occurred_on − N dias, occurred_on]`, considerando apenas
logs anteriores na ordenação. O mesmo dia conta.

**Refinada pela D47 (#113):** janela vazia não basta para o bônus de retorno;
ele exige também um registro da categoria anterior à janela.

**Por quê.** Incluir o próprio dia é o que faz o cooldown funcionar: sem isso,
lavar o carro duas vezes na mesma tarde pagaria cheio nas duas.

**Emenda (Fase 1).** `repeat_cooldown_days = 0` significa **cooldown
desligado**, não janela de zero dias. Lida ao pé da letra, a janela
`[occurred_on − 0, occurred_on]` puniria a segunda leitura do mesmo dia com
×0,5 — mas o desgaste (D1–D3) já é o mecanismo para repetição no mesmo dia, e
cobrar duas vezes contraria a intenção. A justificativa original desta decisão
fala de "lavar o carro duas vezes na mesma tarde": atividade que **tem**
cooldown configurado. O seed usa 0 em 26 das 32 atividades, exatamente com o
sentido de "não se aplica".

### D7 — O bônus de retorno incide sobre o valor já degradado

**Decisão.** Ordem: valor base → nota de qualidade → cooldown → desgaste → bônus
de retorno. O bônus multiplica o resultado, não o valor base.

**Por quê.** É a ordem da spec, e vale registrar porque muda o número. Como está,
voltar a uma categoria e emendar quatro horas nela não fura a torneira — o bônus
premia a volta, não a maratona.

### D8 — Qual histórico vale ao recalcular um log antigo

**Decisão.** Ordenação canônica `(occurred_on, created_at, id)`. O balde de um log
considera só os logs aprovados estritamente anteriores a ele nessa ordem, no
mesmo dia.

**Por quê.** Dá resultado determinístico: reeditar o mesmo log duas vezes devolve
o mesmo número, e nenhum lançamento posterior se move — que é a garantia de
congelamento que a spec pede.

### D9 — Arredondamento só no fim

**Decisão.** `computed_hours` arredonda para 2 casas (0,01h = 36s), uma única vez,
no valor final. As linhas de explicação mostram os números já arredondados e a
soma tem que fechar.

**Por quê.** Com queda geométrica, arredondar em cada faixa acumula erro rápido. E
se a conta não fecha à vista na tela, a confiança no sistema vai junto.

### D10 — Nota zero numa atividade `delivery`

**Decisão.** Vira log aprovado com `computed_hours = 0`, sem linha no ledger.

**Por quê.** O log precisa existir — conta para o cooldown e mostra no histórico
que a tarefa foi avaliada. Uma linha de 0h no ledger seria ruído num extrato que
deve ser legível de relance.

---

## Dados e seed

### D11 — As categorias que não declaram taxa

Convívio, Casa e Curinga não têm `base_rate` no seed — só atividades `fixed` e
`delivery`, que ignoram taxa.

**Decisão.** `base_rate` vira nulo e passa a ser só o valor sugerido ao criar uma
atividade `duration` na tela de Configuração. O `value` da atividade é sempre
explícito e é quem manda.

**Por quê.** Corpo, Mente e Criativo ficam com 2,0; Escola com 1,0. Nenhum número
fantasma entra numa conta por engano, e a tela de Configuração ainda tem um
padrão útil pra preencher.

**Emenda (#110).** Depois de ver o app em uso, o dono e o irmão acharam a taxa
generosa: Corpo, Mente e Criativo passam de 2,0 para **1,5**, e cada atividade
`duration` delas acompanha. O passo não muda, então a assíntota cai junto (Corpo
~6h, Mente e Criativo ~3h). Atividades `fixed` ficam como estão: são prêmio por
acontecer, não por durar. Pela D15, nada já aprovado é recalculado.

### D12 — Curinga não desgasta nem bonifica

**Decisão.** `decay_step_hours` nulo e `return_bonus_pct = 0`.

**Emendada na Fase 6** — ver "Emenda à D5 e à D12", no fim.

**Por quê.** É a válvula de escape do admin para o caso que a tabela não previu. Se
degradasse, deixaria de servir ao único motivo de existir.

### D13 — Datas são texto, nunca timestamp

**Decisão.** `occurred_on` é `TEXT` no formato `YYYY-MM-DD`, em
`America/Sao_Paulo`. O balde diário sai da própria data, sem conversão de fuso.

**Por quê.** Guardar como instante é a origem clássica do bug em que um lançamento
de sábado à noite migra para o dia seguinte. Só `started_at`, `ended_at` e os
carimbos de auditoria são instantes de verdade.

### D14 — Excluir em Configuração desativa, não apaga

**Decisão.** Categorias e atividades usam `active = false`. Nada some do banco.

**Por quê.** As chaves estrangeiras dos logs dependem delas, e o congelamento exige
que um log de três meses atrás ainda saiba de que atividade veio. Item inativo
some das listas de lançamento e continua legível no histórico.

**Estendida pela D52 (#31):** uma entrada lançada por engano também não se
apaga. Ela é anulada: sai do saldo e do motor, e fica no histórico.

### D15 — Mexer nas taxas não reescreve o passado

**Decisão.** Editar categoria ou atividade não dispara recálculo nenhum. Vale só
para lançamentos futuros.

**Por quê.** A tabela vai mudar muito nos primeiros meses. Se cada ajuste mexesse
em saldo já creditado, os meninos veriam o número mudar sozinho — exatamente o
que destrói a confiança no sistema.

---

## Cronômetro e fila

### D16 — Auto-parada e abandono sem nada rodando

A spec pede que o cronômetro pare sozinho em `max_session_minutes` e que uma pausa
de 12h vire `abandoned` — mas também proíbe fila e serviço externo. Não há nada
para disparar isso.

**Decisão.** Verificação preguiçosa: toda leitura de um timer reconcilia o estado
antes de responder. Passou do limite, `ended_at` é fixado em **início da etapa atual + o que resta
da franquia**, e o registro nasce marcado como auto-parado; pausado há mais de
12h, vira `abandoned` sem gerar registro.

**Por quê.** O corte é calculado a partir dos carimbos, não do momento da leitura —
então o resultado independe de quando alguém abriu o app.

**Emenda (Fase 4) — onde o corte cai quando houve pausa.** `started_at + max` é o
caso particular da sessão que nunca pausou. O limite é medido em tempo **ativo**
(D17), então a pausa não gasta franquia. Medido: a diferença entre os dois
enunciados chega a **seis horas** num caso de teste.

**Emenda (Fase 4) — o instante do corte.** O corte fecha no próprio instante
(`<=`): a leitura feita exatamente no limite já encontra a sessão parada, e a
pausa que completa doze horas exatas já está abandonada. O registro produzido é
idêntico dos dois lados da fronteira; o que a escolha decide é qual de duas
leituras separadas por um milissegundo vê o corte.

**Emenda (Fase 4) — o que `auto_stopped` significa.** Marca a sessão que terminou
**sozinha**: o limite ou a virada do dia (D31). A tela diz "parou sozinha". O
abandono continua sem gerar registro nenhum.

Desde a emenda da D17 (Fase 7, #71), a parada sozinha também pode não gerar
registro: a sessão cujo tempo ativo não chega à sessão mínima da atividade
(D44; 30 s antes dela) é descartada, com aviso na tela, em vez de virar linha no
banco.

### D17 — Duração descontando pausa

**Decisão.** `duration_minutes` é o total de segundos ativos arredondado ao minuto,
com piso de 1. Tempo em pausa nunca entra.

**Por quê.** Piso de 1 evita a sessão de zero minuto, que não descreve nada real e
entraria como ruído no balde do dia.

**Emenda (Fase 7, #71) — a duração é guardada em segundos, e o piso saiu do
arredondamento.** A sessão é gravada em `duration_seconds`, o total de segundos
ativos como foi medido. `duration_minutes` continua existindo, continua sendo o
que o motor lê, e passa a ser esse número **arredondado ao minuto mais próximo,
sem piso**: 10 s viram 0 min, 29 s viram 0 min, 30 s viram 1 min, 90 s viram
2 min. Tempo em pausa continua fora dos dois.

**E a sessão que arredonda para zero não vira registro** (decisão do dono,
17/09/2026). Zero é um resultado possível do *arredondamento*, nunca uma linha no
banco: o `CHECK` da coluna continua exigindo `duration_minutes > 0`, e o
cronômetro recusa antes de gravar. A sessão é encerrada assim mesmo — o menino
pediu para encerrar — e a tela diz o que aconteceu e qual é o limiar.

**Por quê o piso saiu.** Ele foi medido mentindo. O dono rodou o cronômetro por
**dez segundos** e a fila recebeu uma sessão de **um minuto**. Um piso que
multiplica a duração por seis não protege o balde do dia contra ruído: ele é o
ruído, e é ruído que o adulto não tem como distinguir de uma sessão real de um
minuto.

O arredondamento ao mais próximo é a metade da D17 que sobrevive intacta: vinte e
nove segundos a menos que uma hora é uma hora para todo mundo menos para um
truncamento.

**O arredondamento também infla, e isso é aceito.** Trinta segundos viram um
minuto cheio, que é o dobro — a mesma forma do defeito do piso, numa escala
menor. A diferença que faz isso ser aceitável é que o erro do arredondamento é
**simétrico e limitado a 30 s**: 89 s viram 1 min e perdem 29 s, 90 s viram 2 min
e ganham 30 s, e ao longo de várias sessões os dois lados se cancelam. O piso não
tinha nenhuma das duas propriedades: só errava para cima, e sem limite — quanto
mais curta a sessão, maior o fator, sem fundo. Dez segundos viravam seis vezes
mais; um segundo viraria sessenta.

**Por quê o registro de zero também não fica.** O argumento original da D17 —
"a sessão de zero minuto não descreve nada real e entraria como ruído no balde do
dia" — continua valendo para o *registro*, e só não valia para o arredondamento.
Uma entrada de 0 h na fila é um toque do adulto para decidir sobre nada. O que a
emenda muda é de onde o ruído é cortado: antes ele era arredondado para cima e
virava uma hora de leitura que ninguém fez; agora ele é recusado e o menino é
avisado.

**Aritmética.** O arredondamento é feito em inteiros — `floor((s + 30) / 60)`
sobre segundos já truncados — e não com `Math.round` sobre um quociente. A D39
proíbe introduzir float novo na cadeia; esta conta acontece **antes** do motor, e
o motor continua recebendo minutos inteiros e arredondando uma única vez no fim
(D9). O motor também continua recusando `durationMinutes` não-positivo: como
nenhum registro de zero existe, um zero chegando lá é bug de quem chamou.

**O que a migration fez.** `duration_seconds` nasceu preenchida com
`duration_minutes * 60`, que é o único valor honesto disponível para linha antiga
— os segundos originais não foram guardados, que é exatamente o defeito que a
emenda corrige daqui para a frente. `round(m * 60 / 60) = m`, então nenhuma linha
antiga muda de minuto, e `computed_hours` é congelada (D15) e foi copiada
intacta. Medido no banco de desenvolvimento com 13 registros e 20 linhas de
ledger: contagens iguais, saldos iguais (kid1 17,21 h; kid2 −5,50 h), e as 19
colunas pré-existentes das 13 linhas idênticas byte a byte antes e depois.

**Resíduo aceito, 1 — a virada do dia também descarta.** A D16 diz que a virada
do dia produz registro. Uma sessão começada às 23:59:50 tem dez segundos quando
chega a meia-noite, e esse registro não pode existir: ela é descartada como a
pausa de doze horas, com aviso na tela. O limite de sessão nunca cai aqui, porque
`max_session_minutes` é no mínimo um minuto. Antes desta emenda esse caso batia no
`CHECK` e derrubava a tela inteira do menino com um nome de constraint.

**Resíduo aceito, 2 — o menino perde a sessão curta.** Encerrar em vez de deixar
correr é escolha deliberada: *Enviar* que não envia e não encerra é um toque sem
efeito visível. O que se perde vale zero hora, e é a mesma troca que a D16 já faz
no abandono.

**Resíduo aceito, 3 — correção do adulto reescreve os segundos.** A correção é
digitada em minutos, então corrigir a duração grava `duration_seconds` como
`minutos × 60`: a linha passa a dizer uma coisa só, e o que o cronômetro mediu
deixa de valer para aquele registro. O lançamento avulso do admin (D18) e o dado
de demonstração seguem a mesma regra. O limite de edição do adulto continua em
1 minuto (decisão do dono): a #71 mudou o que o cronômetro grava, não o que o
adulto pode digitar.

**Emenda (Fase 7, #92) — o limiar deixou de ser o arredondamento.** Onde esta
emenda diz "a sessão que arredonda para zero não vira registro", o limiar agora
é a **sessão mínima da atividade** (D44), padrão 5 minutos. Os 30 s continuam
valendo só para a sessão que já estava aberta quando a D44 entrou. O
arredondamento ao minuto mais próximo, o `CHECK > 0` e os três resíduos acima
ficam como estão; o resíduo 2 cresce de "menos de meio minuto" para "menos que
o piso", e a tela passa a avisar antes do toque (#86).

### D18 — O lançamento do admin não passa pela fila

**Decisão.** Log criado pelo admin nasce `approved`, com `reviewed_by` preenchido,
e a linha do ledger é gravada na mesma transação.

**Por quê.** A fila existe para o admin revisar o menino. Fazer o admin aprovar a
si mesmo seria um toque a mais numa das três ações do dia a dia, e a spec diz que
mais de dois toques é desenho errado.

### D19 — Rejeitar não cria nada

**Decisão.** Log rejeitado fica com `status = 'rejected'`, sem linha no ledger, e
não conta para cooldown nem para o balde do dia.

**Por quê.** Só o que foi aprovado gerou hora de tela. Deixar o rejeitado empurrar
a torneira puniria o menino por uma tentativa que o adulto recusou.

---

## Stack e processo

### D20 — pnpm e Node 22 LTS

**Decisão.** pnpm como gerenciador, Node 22 LTS travado em `.nvmrc` e no
Dockerfile.

**Por quê.** O hook de setup do Orca já roda `pnpm install` em todo worktree novo.
Travar o Node importa porque `better-sqlite3` é binário nativo e quebra em troca
de major.

### D21 — Vitest, com o motor isolado

**Decisão.** Vitest. O motor de cálculo vive num módulo sem I/O, com uma tabela de
casos cobrindo cada regra deste documento — incluindo o lançamento que atravessa
faixas e o recálculo retroativo.

**Por quê.** A spec não nomeia runner. A Fase 1 não avança enquanto esses testes
não passarem: é a parte onde um erro silencioso destrói a confiança dos meninos.

### D22 — Runtime Node, não edge

**Decisão.** `output: "standalone"` e runtime Node em todas as rotas.

**Por quê.** `better-sqlite3` é módulo nativo e não roda em edge. Explícito desde o
primeiro commit para não descobrir no deploy.

### D23 — Os segredos são do dono do repo, e não são lidos por agentes

**Decisão.** `.env.schema` do Varlock é versionado e declara as seis variáveis;
`.env` fica ignorado pelo git, preenchido à mão. Nenhum `.env` de outro projeto é
lido.

**Por quê.** Efeito prático: nenhum worker sobe a app com login real. Os agentes
trabalham com valores de teste próprios, e o hook do Orca propaga o arquivo do
`wt/main` para cada worktree novo.

### D24 — Coolify fica bloqueado

**Decisão.** Dockerfile multi-stage e volume do SQLite entregues e testados
localmente. A issue de deploy nasce aberta e marcada como bloqueada, sem travar as
outras fases.

**Por quê.** Não há URL nem token da instância. Como o resto não depende do deploy,
isolar a issue mantém a esteira andando.

### D25 — Três rounds de revisão, três mandatos diferentes

**Decisão.** Round 1 correção e cobertura de teste; round 2 conformidade com este
documento, lendo decisão e diff lado a lado; round 3 acesso, segurança e alvo de
toque. O portão de verdade é CI verde, não consenso de agente.

**Por quê.** Três revisores com o mesmo mandato convergem para "está bom" no
segundo round. Mandatos distintos fazem cada um procurar o que os outros não
procuram, e o CI impede que concordância entre agentes vire aprovação.

---

## Decisões que vieram da Fase 0

As cinco abaixo não estavam na spec. Emergiram das revisões de PR e estão aqui
porque são exatamente o tipo de conhecimento que se perde entre uma sessão e a
seguinte.

### D26 — O portão de CI vale por convenção, não por proteção de branch

O repositório é privado num plano que não oferece proteção de branch:

```
$ gh api repos/angelod1as/kids-screen-tracker/branches/main/protection
403 — Upgrade to GitHub Pro or make this repository public to enable this feature.
```

**Decisão.** Nenhum check pode ser marcado como obrigatório hoje. A regra "CI
verde antes do merge" (D25) é cumprida por quem mergeia, não imposta pela
plataforma.

**Por quê.** Não é pendência que alguém possa fechar — é limitação de plano.
Registrar evita que o próximo tente configurar e conclua que está quebrado. Se um
dia o repo virar público ou o plano mudar, o primeiro check a tornar obrigatório
é `lint, typecheck, test, build`. **Não** torne `Claude Code Review` obrigatório:
ele sai verde sem executar quando o arquivo do workflow difere da branch default,
o que acontece em todo PR que toca `.github/`.

### D27 — Biome, não ESLint

**Decisão.** O linter é o Biome. TypeScript fica na 7.x.

**Por quê.** `typescript-eslint` recusa TS 7.0 (`does not support TS 7.0`),
`eslint-config-next` depende dele, e o Next 16 removeu o `next lint` — não existe
caminho de ESLint com a versão de TypeScript deste projeto. A alternativa seria
baixar a linguagem para agradar um plugin de linter. O Biome tem parser próprio e
nenhum acoplamento com a versão do TypeScript, e foi verificado emitindo erro real
(não no-op) antes da escolha. O `pnpm lint` usa `--error-on-warnings`: sem a flag,
warning não reprova e a etapa vira meia-etapa.

### D28 — Configuração do pnpm mora no `pnpm-workspace.yaml`

**Decisão.** `engineStrict` e `allowBuilds` ficam no `pnpm-workspace.yaml`. O
`.npmrc` não é usado.

**Por quê.** O pnpm 11 não lê essas chaves do `.npmrc` nem do `package.json` —
verificado com `node_modules` zerado, o install passava com exit 0 e só um
`[WARN] Unsupported engine`. No `pnpm-workspace.yaml`, instalar com Node fora do
22 falha com `ERR_PNPM_UNSUPPORTED_ENGINE` e exit 1, que é o que a D20 exige. Um
`.npmrc` que o gerenciador ignora seria trava de mentira.

Consequência prática: todo pacote com script de instalação precisa entrar em
`allowBuilds` explicitamente. Hoje lá estão `better-sqlite3` e `esbuild`.

### D29 — Segredo se protege com hook, não com regra de permissão

**Decisão.** O acesso ao `.env` é barrado por `.claude/hooks/deny-env-access.sh`,
um hook `PreToolUse` que sai com código 2. As regras de permissão de Bash não são
tratadas como barreira.

**Por quê.** Regra de Bash sem `*` no fim é match exato: `Bash(head .env)` no deny
não cobre `head -n 5 .env`, que cai no allow `Bash(head:*)` e é auto-aprovado. O
mesmo valia para `grep`, `sed`, `awk`, `cp`, `tee`, `python3` e `node` — o bloco
de deny original protegia menos do que aparentava. Hook que sai com 2 é avaliado
**antes** das regras de permissão e roda lógica, então cobre invocação indireta
(`pnpm dlx varlock reveal`) e estado (`git push` estando na `main`, inclusive via
`git -C <path>`), que nenhum matcher literal alcança.

A mensagem de bloqueio cita a regra que motivou o bloqueio. Quem esbarrar precisa
entender, não contornar.

**Emenda (Fase 1).** O critério do hook é **existência do arquivo**, não intenção
do comando. Um `.env` que existe pode ser o do dono: lê-lo vaza, sobrescrevê-lo
destrói as senhas digitadas à mão, e apagá-lo idem. Um `.env` que não existe não
tem o que vazar nem o que perder — a única coisa que um comando pode fazer com ele
é criá-lo, que é exatamente o que o CI faz antes do `pnpm build`.

A primeira versão bloqueava qualquer menção a `.env`, e isso impedia um fluxo
legítimo: um revisor não conseguiu rodar `pnpm db:seed` porque não podia criar o
arquivo descartável que o próprio workflow cria.

O critério tem duas etapas, nesta ordem. **Primeiro o irresolvível:** se a
referência carrega algo que o shell expande e o hook não — `~`, `$VAR`, crase,
chave, glob — não dá para saber qual arquivo o comando toca, então recusa. Falhar
fechado aí é o ponto: uma versão anterior resolvia `~/.env` como o caminho
absoluto `/.env`, não achava nada, e liberava a leitura do arquivo real do dono.
**Depois a existência**, para caminho literal. E payload que não parseia também
recusa, se mencionar um `.env`: erro de parse não pode virar porta de entrada.

Extrair intenção de texto de shell é frágil; existência não é. E o critério
aplica a D23 com mais força do que uma instrução conseguiria: no instante em que
um agente escreve o `.env` descartável, o arquivo passa a existir, e o agente
deixa de conseguir lê-lo. "Use valores de teste que você não lê" deixa de ser
pedido e vira fato.

### D30 — Agente não mergeia o próprio PR

**Decisão.** `gh pr merge` e `gh pr close` estão fora do allow e dentro do deny. O
merge é feito por quem coordena, depois da revisão.

**Por quê.** Um worker com `Bash(gh pr:*)` mergeia o próprio trabalho e pula os
rounds de revisão inteiros — o processo deixa de existir sem que ninguém perceba.
O allow estreito é a proteção real; o deny é redundância.

---

## Decisões que vieram da Fase 4

As três abaixo saíram de exploits medidos numa revisão que atacou o cronômetro
como um adolescente motivado atacaria: não forjando dado, mas escolhendo a ordem
em que o adulto aprova e o dia em que a hora cai.

### D31 — A sessão não atravessa o dia

**Decisão.** Uma sessão de cronômetro termina, no mais tarde, na virada do dia em
São Paulo do dia em que começou. O corte vale para sessão rodando e para sessão
pausada, com limite e sem. O registro é creditado ao dia em que a sessão começou
(D13) e nasce marcado como parado sozinho.

**Por quê.** O balde que decide quanto vale uma hora é diário (D3) e o dia do
registro é o dia em que a sessão começou, então uma sessão aberta depois da
meia-noite despeja horas num dia que acabou. Medido: começar e pausar às 23:55 e
retomar na tarde seguinte fazia as mesmas duas horas de leitura valerem **5,03h
em vez de 4,00h**, repetível toda noite, e a sessão sobrevivia 44h pausando de
novo a cada menos de doze.

**Consequência aceita.** Sessão legítima das 23:30 à 00:30 é cortada à meia-noite
e creditada ao dia em que começou; o menino recomeça.

**Exceção ao registro, desde a emenda da D17 (Fase 7, #71) e a D44 (#92).** A
virada do dia gera registro só quando o tempo ativo alcança a sessão mínima da
atividade. A sessão começada às 23:57 tem três minutos à meia-noite e, com o
piso de 5, é descartada como o abandono, com aviso na tela.

**Consequência sobre o abandono.** Vence a regra que dispara primeiro no tempo,
então o abandono de doze horas (D16) só alcança pausa que começa antes do
meio-dia. Depois disso a virada do dia chega antes e gera registro do tempo ativo
que o menino de fato fez — mais honesto que descartá-lo, porque numa sessão
pausada o tempo já está congelado.

### D32 — Aprovar respeita a ordem canônica

**Decisão.** Uma entrada não pode ser congelada enquanto existir entrada
**pendente** anterior a ela na ordenação `(occurred_on, created_at, id)` dentro da
janela de histórico que o cálculo dela lê (`historyWindowStart`). A aprovação é
recusada com mensagem que nomeia a entrada anterior; recusar a anterior também
libera (D19).

**Por quê.** A D8 conta só o que já está **aprovado** antes, e a D15 congela.
Aprovando o mais novo primeiro, os dois leem balde vazio. Medido: 2×1h de "Ler
livro" no mesmo dia pagavam **6h em vez de 4h**, e duas lavagens de carro em dias
seguidos pagavam **6h em vez de 4,5h** — o cooldown de sete dias evaporava.

A janela é a do cálculo, não o dia: o caso do cooldown atravessa dias, e uma
regra por dia deixaria esse pela metade.

A fila já lista do mais antigo para o mais novo, então o caminho normal não
encosta na regra.

**Estendida pela D47 (#113):** a estreia pendente de uma categoria bloqueia
também fora da janela, enquanto nada aprovado vier antes dela.

**Emenda (#7): a frase chega ao navegador.** Lançada, a recusa virava um
`digest` no build de produção do Next, e o adulto só lia o motivo porque a tela
relia o estado depois. Esta recusa e a da D37 são `RefusalError`, em português,
e a action que pode dá-las devolve `{ refused }` em vez de lançar. Só elas: a
guarda de acesso roda antes e continua lançando uma frase fixa, que não explica
nada a quem forjou o pedido, e qualquer outra falha continua lançada. A frase
nomeia a entrada — número, atividade, data — e nunca o menino, e só um adulto
chega às actions que a devolvem.

### D33 — A guarda de item inativo vale no endpoint

**Decisão.** Item inativo some das listas **e é recusado pelo servidor**:
`startTimer` recusa atividade ou categoria inativa, e `approveLog` recusa mover
uma entrada para atividade inexistente, inativa ou incompatível com a origem do
registro (sessão de cronômetro é `duration`).

**Por quê.** A D14 estava cumprida só no `<select>`. Medido: uma sessão
cronometrada de um minuto foi aprovada como "Sair com os amigos" — `fixed`, 3h,
duração ignorada — e como atividade desativada. Dois revisores acharam isso
independentemente, o que é sinal de que a lista da tela parecia garantia
suficiente.

### Duas declarações da Fase 4 (uma revogada)

**~~`max_session_minutes` é lido ao vivo.~~ — revogada pela D38 (Fase 6).** ~~O
limite não é congelado no timer quando a sessão começa: o admin que encurtar o
limite em Configuração muda onde aquela sessão para. Uma sessão aberta não tem
nada creditado, então não é a D15 sendo violada; é o presente sendo informado de
quanto vale.~~

O argumento acima foi escrito sobre *encurtar*, e encurtar de fato só antecipa um
corte; *levantar* anda para trás no tempo e ressuscita sessão que já tinha parado
sozinha, o que a D16 proíbe. O limite passou a ser carimbado na linha do timer
quando a sessão abre — **ver D38**. Fica riscado em vez de apagado porque a
metade certa dele — uma sessão aberta não tem nada creditado — é o que sustentava
o resíduo aceito da **D37**, até a própria D37 mover a linha para o `startTimer`.

**O campo `note`.** Aprovar com correção **sobrescreve** a nota; recusar **anexa**
o motivo. As duas disciplinas são deliberadas: a correção é o adulto dizendo o que
aconteceu, com o menino do lado; a recusa é uma segunda voz sobre a mesma entrada,
e apagar o que o menino escreveu para caber o que o adulto escreveu seria o adulto
decidindo o que o menino disse.

---

## A decisão que veio da Fase 5

### D34 — A franquia é consumida na ordem de congelamento

A janela de um cálculo continua cronológica: o balde é do dia (D3), e o cooldown
e o bônus de retorno se medem em dias a partir do `occurred_on` da entrada (D6).
O que muda é **quem conta dentro dela**.

**Decisão.** Uma entrada considera as entradas da sua janela que foram
**congeladas antes dela**, em vez das "estritamente anteriores na ordenação
canônica" (D8). Quem congela primeiro paga cheio; quem congela depois lê o que a
janela já gastou.

Como a janela se mede em dias a partir do `occurred_on`, e não em ordem de
congelamento, ela tem **dois lados**: uma entrada lançada em segunda lê uma
lavagem de terça que já estava congelada. O balde diário não tem lado — a D3 é
por dia.

**Por quê.** Uma regra fecha os dois caminhos que a Fase 5 mediu:

| | antes | depois |
|---|---|---|
| lavagem de segunda lançada depois da de terça | 3h + 3h = **6h** | 3h + 1,5h = **4,5h** |
| sessão da meia-noite (D31) aprovada depois da de hoje | 3h + 3h = **6h** | 3h + 2h = **5h** |

O segundo é o furo que a revisão da Fase 5 achou na fila: a D31 fecha a sessão
que atravessou a meia-noite no dia em que ela começou, então um log pendente
carrega o `occurred_on` de ontem e pode ser aprovado depois que o de hoje já
congelou. Sob a D8 os dois liam janela vazia.

O exploit não exige forjar nada. É uma frase: "pai, você esqueceu de lançar o
carro de segunda".

**Não muda o caminho normal.** Com a D32 valendo, pendências só são aprovadas em
ordem canônica, então ordem de congelamento e ordem canônica coincidem. A fila
não muda de comportamento; muda o que ela lê quando alguma coisa a tirou dessa
ordem.

**O determinismo da D8 melhora.** O conjunto "congelado antes desta" fica fixo no
instante em que a entrada congela e nunca mais muda. A ordenação canônica muda se
alguém editar um `occurred_on`.

**A D15 fica intacta.** Nada congelado se move, e o menino nunca vê um número
creditado mudar — que é o dano que a D15 nomeia.

**A D32 fica como está.** Ela decide *quando* um adulto pode aprovar; a D34
decide *o que* a aprovação lê. As duas são disjuntas.

**Resíduo aceito.** Uma entrada congelada antes pode carregar uma explicação que
uma entrada retroativa posterior torna historicamente imprecisa: o domingo de
quatro horas de Mente que congelou dizendo "+50%, faz mais de 3 dias que você não
faz Mente" continua dizendo isso depois que uma quinta é lançada. **O número não
muda; só a frase envelhece.** É a mesma classe de desatualização que a D15 já
aceita quando o admin edita uma taxa. Há teste fixando isso, para ninguém
"consertar" recalculando — que é o que a D15 proíbe.

**A recusa foi considerada e caiu.** A primeira implementação recusava o
lançamento retroativo que mudaria uma entrada congelada. O round 2 da revisão
argumentou contra a implementação do próprio PR, e os três pontos dele são o
motivo de a decisão ser esta:

1. a D15 já institui valores congelados que as regras não produzem mais — toda
   edição de taxa cria esse estado;
2. o remédio da D32 é uma **espera** ("recusar a anterior também libera"); a
   recusa era um **veto**, sem ação nenhuma que a liberasse;
3. o critério de desempate deste projeto é a confiança no número, e recusar fazia
   um sábado real de leitura valer **zero para sempre**.

O adulto esquecer de lançar é o caso cotidiano, não o ataque — e o exploit morre
de qualquer jeito, porque segunda passa a pagar reduzido.

**Consequência de implementação.** A janela ganhou uma ponta de lá: `historyTo` é
declarado ao lado de `historyFrom` e o motor recusa um histórico que pare antes
dele. Sem isso, um caller que buscasse só até o dia da própria entrada não
acharia cooldown nenhum e pagaria cheio — em silêncio e sempre a favor do menino,
que é exatamente a falha sobre a qual o `historyFrom` foi escrito.

---

## Decisões que vieram da Fase 6

As cinco abaixo saíram da tela de Configuração — o primeiro lugar onde um número
digitado à mão chega ao motor — e de três revisões que a atacaram como um
adolescente ataca: não forjando dado, mas pedindo ao adulto uma coisa razoável na
hora certa.

### D35 — O passo do desgaste tem piso de 0,25h, e o piso não é sobre ponto flutuante

A D2 diz que `decay_step_hours` nulo desliga o desgaste e não põe piso em nada. A
tela de Configuração (#26) é o único lugar onde um número digitado à mão chega ao
motor, e a D15 faz o que se digita aqui governar todo lançamento daí em diante.

**Decisão.** `decay_step_hours` é nulo ou vale ao menos **0,25h**. Valor abaixo
do piso é recusado pelo servidor (D33) e a tela explica antes do toque, do mesmo
predicado (`src/engine/limits.ts`).

**Por quê — e o motivo mudou no meio do caminho.** O piso nasceu de uma medição
de monotonicidade: abaixo de um quarto de hora as faixas ficavam perto do épsilon
do double e mais tempo de atividade rendia **menos** hora de tela. Uma revisão
mostrou que o piso **não resolvia isso**: a 0,25h ainda há 6.466 inversões em 267
das 300 taxas legais quando a duração passa de 771 min. Pior, mostrou que
**nenhum piso resolve** — 0,5h inverte a partir de 1.587 min, 1h a partir de
3.107 min, 2h a partir de 6.275 min. A inversão aparece sempre por volta de 53
halvings, que é onde o erro relativo do double alcança a distância até a fronteira
de meio centavo. Para segurar por piso seria preciso `passo > duração_máxima/53`,
e a duração máxima da coluna é 1.000.000 min: um piso de **314 horas**.

Então a aritmética foi consertada em vez do piso: o motor calcula em racionais
exatos até o arredondamento único da D9 (D39). A monotonicidade passou a ser
estrutural — a integral de um integrando positivo é crescente, e arredondar é
monótono —, e não uma propriedade empírica de uma grade.

**O piso continua, e o motivo é a forma da tabela, não a do double.** A assíntota
de uma categoria é `taxa × passo × 2`, então um piso de 0,25h no passo é, em
linha reta, um piso na assíntota: nenhuma categoria pode ser calibrada para
render menos de **`taxa × 0,5` por dia**. Na taxa 2,0 — a que Corpo, Mente e
Criativo usam, três das quatro categorias do seed que declaram taxa — isso é
exatamente **uma hora por dia**, que é o número que um adulto confere de cabeça
sem saber o que é um double. Categoria mais estreita que isso é categoria
efetivamente desligada, e desligar categoria é o que o `active` faz (D14), não o
que um passo de 0,05 deve significar por acidente. A #26 pede o piso com todas as
letras; o que esta decisão corrige é a justificativa.

Desde a emenda à D11 (#110) a taxa dessas três categorias é 1,5, e o piso nelas
rende **0,75h por dia**. O argumento não muda: é a mesma régua `taxa × 0,5`.

**E o que o piso não é.** Ele mora no passo, e a régua acima mora em
`taxa × passo`; as duas só coincidem numa taxa. Na Escola, a 1,0, o piso deixa a
assíntota em 0,5h/dia — pela régua, já desligada, e permitida. Uma categoria a
10,0 com passo 0,05 renderia a mesma hora por dia e é recusada. Um piso sobre a
**assíntota** seria mais fiel ao argumento, e foi descartado porque `base_rate` é
**nulo** em três das sete categorias e, pela **D11**, é só sugestão: não há
assíntota em que pisar em metade da tabela, e pisar numa sugestão seria dar poder
de regra a um número que a D11 tirou da conta. O piso no passo é a aproximação
que existe em toda linha. A folga está escrita aqui para não ser redescoberta
como bug.

**Resíduo aceito.** Uma categoria que renda menos de `taxa × 0,5` por dia deixa de
ser configurável. Ela é a categoria que se desliga.

### D36 — Bônus de retorno exige limiar de ao menos um dia

**Decisão.** Se `return_bonus_pct > 0`, então `return_bonus_after_days` é ao
menos **1**. O par (bônus > 0, limiar 0) é recusado com a frase que diz o que
fazer. `return_bonus_pct = 0` continua sendo como se escreve "sem bônus" — é como
o seed escreve em quatro das sete categorias — e aí o limiar pode ficar em zero.

**Por quê.** A janela da D6 inclui o próprio dia. Em limiar zero a janela é o dia,
o primeiro lançamento da categoria em **qualquer** dia não acha nada nela, e o
bônus de retorno vira bônus permanente disfarçado. Medido: categoria a +50% com
limiar 0 paga **3h** por algo que também foi feito ontem, contra 2h nos três dias
do seed — todo dia, para sempre, e a linha de explicação escreve "faz 1 dia que
você não faz Mente" sobre coisa feita ontem. Um bônus que sempre incide não é
bônus, é a taxa.

**Considerado e descartado.** Ler `after_days = 0` como "sem bônus", espelhando a
emenda da D6 para o cooldown. É mais elegante, mas mudaria o que o motor faz com
um valor que o seed **já guarda** — e isso é decisão deste documento, não regra de
tela de CRUD. Recusar o par não muda nada que o motor faça: só impede o par de
ser escrito.

**Resíduo aceito.** Continuam existindo duas maneiras de escrever "sem bônus", e
só uma delas é canônica no seed.

### D37 — O que precifica uma entrada não muda debaixo dela

A tela de Configuração deixa mudar taxa, modo, nota, cooldown e categoria sem
deploy, que é o ponto da fase. Mas uma entrada só é congelada na aprovação, e até
lá o valor dela é lido da tabela **viva**. Medido, banco semeado, só com esta
tela e sem tocar na entrada:

| edição feita com a pendência na fila | pagou |
|---|---|
| nada (uma hora de "Ler livro") | 3,00 h |
| `value` 2 → 10 | **15,00 h** |
| `return_bonus_pct` 0,5 → 5 | **12,00 h** |
| `value` 2 → 180, numa sessão de um minuto | **4,50 h** |
| quatro sessões de 1h paradas na fila, depois `value` 2 → 3 | 9,00 h → **13,50 h** |

O menino controla os dois lados do último sem tocar em nada: ele não pede
aprovação e pede aumento.

**Decisão, em duas metades.**

**Primeira: nada que decida o preço de uma entrada pendente pode mudar enquanto
ela espera.** `calc_mode`, `value`, `quality_graded`, `repeat_cooldown_days` e a
categoria da atividade; `decay_step_hours`, `return_bonus_pct` e
`return_bonus_after_days` da categoria; e desativar qualquer uma das duas. A
recusa **nomeia a entrada**, exatamente como a D32 já faz, e diz para decidir
aquela primeiro. Nome, ordem, `base_rate` e limite de sessão não são disso: não
há como mudarem o valor de uma entrada cujos minutos já estão na linha.

**Segunda: o balde que uma entrada congelada consumiu fica fixo no
congelamento.** (Para as linhas que já existiam quando a coluna nasceu, o
carimbo é o da **migração**, não o do congelamento: `0002` preenche
`category_id` a partir da categoria que a atividade tinha naquele momento,
porque até ali esse join *era* a regra. Inócuo antes do lançamento, e escrito
aqui para não ser redescoberto como incoerência.) `activity_logs.category_id` é escrito na aprovação e nunca mais
relido de `activities`, e a pertinência ao balde diário (D3) passa a sair dos
minutos da própria linha em vez do `calc_mode` vivo da atividade.

**Por quê a segunda metade também é necessária.** A primeira fecha a janela da
fila; ela não fecha o passado. Com a fila vazia: menino lê 2h de "Ler livro"
(Mente), aprovado a **4,50h**; o adulto move "Ler livro" para Corpo; qualquer
lançamento de Mente naquele mesmo dia passa a ler um balde vazio e paga cheio de
novo. Medido: Mente fechou o dia em **7,88h** contra assíntota calibrada de
4,00h, com o bônus de retorno concedido **duas vezes na mesma tarde**. Trocar o
`calc_mode` para `fixed` faz o mesmo sem mover nada: **6,75h**.

É a forma exata da falha que a D32 mediu — 6h em vez de 4h — por outra porta.

**Considerado e descartado: carimbar o preço na entrada quando ela nasce.** Era a
proposta simétrica e mais absoluta, e caiu por duas razões medidas. A primeira
basta sozinha: **o caminho de correção que ela pressupõe não existe.** `LogEdits`
é `{activityId, durationMinutes, note}` — não há como corrigir um **valor** na
aprovação. Um adulto que digitasse 20 no lugar de 2 com dez sessões esperando só
poderia recusar as dez ou movê-las para alguma atividade que por acaso estivesse
precificada certo, e quem perderia dez tardes reais seria o menino, pelo erro de
digitação do adulto. A segunda é que carimbar exige oito colunas de configuração
copiadas para `activity_logs` — uma segunda cópia da tabela, que é a forma que
este projeto já viu apodrecer.

Recusar a edição chega à mesma garantia tornando a premissa verdadeira: se a
configuração não pode mudar enquanto a entrada espera, então a entrada **é**
precificada pela configuração sob a qual foi registrada. Uma consulta, nenhuma
duplicação, e a mesma frase que a D32 já diz.

**Onde a linha fica: no `startTimer`, não no `stopTimer`.** A primeira versão
desta decisão amarrava a intangibilidade à **linha na fila**, e declarava como
resíduo aceito que uma sessão ainda aberta continuava reprecificável. Medido, o
resíduo não era resíduo: era o mesmo dano por uma porta a mais.

| feito com o cronômetro **aberto**, 120 min de "Ler livro" (assíntota 4,00h) | pagava |
|---|---|
| nada | 4,50 h |
| `value` 2 → 3 | **6,75 h** |
| `value` 10, passo 8, bônus 500% — três campos, uma tela | **120,00 h** |
| `value` 1e6, numa sessão de **30 min** | **750.000,00 h** |

Sem proração: levantar a taxa no minuto 119 de 120 pagava as duas horas na taxa
nova, o que não é "daqui pra frente", é retroativo até o `started_at`. Um dia
inteiro de sessões comuns com um "dobra a taxa" por sessão ia de 24,15 h para
**48,29 h**, repetível. E o preço passava a depender de **quando alguém abriu o
app**: a reconciliação é preguiçosa, então a mesma sessão, com os mesmos
carimbos e a mesma edição, pagava 4,50 h se alguém tinha aberto o app às 11:30 e
**6,75 h** se ninguém tinha — exatamente a frase que a D16 proíbe e que a D38
cita duas decisões adiante para justificar o carimbo do limite.

**Decisão.** A linha é *"existe tempo de atividade já cravado num carimbo"*, e
isso começa no `startTimer`: `started_at` e `accumulated_seconds` são carimbos, e
o menino já leu. `refuseWhileWaiting` enxerga sessão **aberta** (`running` ou
`paused`) além da entrada pendente, e diz qual das duas é. Depois disso os quatro
números acima são recusados, o dia volta a 24,15 h, e o preço deixa de depender
de quem abriu o app.

**Resíduo aceito, e agora é outro.** Uma atividade que ganha `quality_graded`
enquanto **nada** está aberto nem esperando é uma edição legítima, e a próxima
sessão do menino chega impagável: o cronômetro mede tempo e não dá nota. Isso não
é reprecificação — é uma entrada que a configuração de agora não sabe calcular —
e a saída não pode ser recusar a tarde do menino. A **nota passou a ser corrigível
na aprovação** (`LogEdits.quality`), que é onde a D32 e a D33 já deixam o adulto
dizer o que a entrada realmente foi. Com isso **toda** entrada impagável tem
conserto, e a fila continua mostrando a linha com o motivo em vez de cair (D19).

**Considerado e descartado: carimbar o preço na entrada quando ela nasce.** Era a
proposta simétrica e mais absoluta, e caiu por duas razões medidas. A primeira
basta sozinha: **o caminho de correção que ela pressupõe não existia.**
`LogEdits` era `{activityId, durationMinutes, note}` — não havia como corrigir um
**valor** na aprovação. Um adulto que digitasse 20 no lugar de 2 com dez sessões
esperando só poderia recusar as dez, e quem perderia dez tardes reais seria o
menino. A segunda é que carimbar exige oito colunas de configuração copiadas para
`activity_logs` — a segunda cópia da tabela que este projeto já viu apodrecer.

Recusar chega à mesma garantia tornando a premissa verdadeira: se a configuração
não pode mudar enquanto há tempo cravado, a entrada **é** precificada pela
configuração sob a qual foi corrida. E o custo medido é estreito — um censo de 78
controles de calibração recusa **4** com uma pendência viva e **16** numa tarde em
quatro categorias; não tranca a tela. O que era caro era uma segunda recusa sobre
as categorias que um movimento atravessa, que **não protegia nada** depois do
carimbo de `category_id` e recusava **96 de 192** movimentos legais; foi apagada.

**Emendada pela #7:** a recusa chega ao navegador com a frase exata; ver a
emenda na D32.

### D38 — O limite da sessão é um carimbo, não uma leitura

> Substitui a declaração da Fase 4 que dizia o contrário. A declaração está
> preservada abaixo, porque metade dela continua certa.

A Fase 4 declarou que `max_session_minutes` é **lido ao vivo**: "o admin que
encurtar o limite em Configuração muda onde aquela sessão para… é o presente
sendo informado de quanto vale". O argumento foi escrito sobre **encurtar**.

**Decisão.** O limite é copiado para a linha do timer quando a sessão abre, e a
reconciliação lê o carimbo. Mudar o limite da atividade não alcança sessão já
aberta, em nenhuma direção.

**Por quê.** A reconciliação é preguiçosa (D16): nada liquida uma sessão até
alguém ler. Com o limite lido ao vivo, **levantar** o limite antes de alguém
abrir o app ressuscita uma sessão que já tinha parado sozinha horas antes.
Medido: sessão aberta às 09:00 sob limite de 120 min, não lida até as 19:00,
registrou 120 min e pagou 4,50h; com o limite levantado para 600 no meio,
registrou 600 min e pagou **8,99h**. Com a taxa levantada junto — as duas coisas
que cabem numa frase só ("pai, o limite tá curto, e leitura devia valer 3") — a
tarde dobra, com o menino apertando um botão o dia inteiro.

A D16 diz, com todas as letras: *"o corte é calculado a partir dos carimbos, não
do momento da leitura — então o resultado independe de quando alguém abriu o
app."* Um limite que pode se mexer entre os carimbos e a leitura é um limite que
torna essa frase falsa. Então ele é um carimbo também.

**Considerado e descartado.** Manter a leitura viva e recusar só o aumento.
Precisaria do histórico do limite, que não existe, e deixaria "encurtar" com uma
semântica que depende de quando o app foi aberto — que é exatamente o que a D16
proíbe.

**Resíduo aceito.** Encurtar o limite também deixa de alcançar sessão aberta.
Metade da declaração da Fase 4 morre com isso, e é o preço de a outra metade não
poder viver: o adulto que quer encurtar agora espera a sessão terminar.

### D39 — O motor calcula em aritmética exata até o arredondamento da D9

**Decisão.** A cadeia inteira do cálculo — valor base, nota, cooldown, faixas de
desgaste e bônus de retorno — é feita em racionais exatos, e o único
arredondamento é o da D9, uma vez, no fim.

**Por quê.** Em ponto flutuante a queda geométrica não é monótona: mais tempo de
atividade pode render menos hora de tela, que é a única coisa que este motor
nunca pode fazer. Medido com árbitro racional exato sobre 3.456.000 pontos por
passo (300 taxas × 8 baldes × 1..1440 min): **6.466 inversões a passo 0,25**, e
0,5 / 1 / 2 só parecem limpos porque a grade parava em 1440 min — esticada, 0,5
inverte a partir de 1.587 min e 2 a partir de 6.275 min. A causa é sempre a
mesma: por volta de 53 halvings o erro relativo do double alcança a distância até
a fronteira de meio centavo.

Em exato a propriedade deixa de ser empírica e passa a ser estrutural: o valor é
a integral de um integrando estritamente positivo, logo é crescente na duração, e
arredondar meio-para-cima é monótono. **0 inversões** nos mesmos 3.456.000 pontos
por passo, e 0 em 57.596.000 pontos de uma varredura mais larga.

A prova vale para a integral; o que o motor roda é a forma fechada com um
**limite de cauda em 8.192 faixas**, e esse limite já quebrou a propriedade duas
vezes. Da primeira, parear resto verdadeiro com expoente congelado fez o termo
subtraído oscilar (72 passos não-monótonos a passo 0,001h). Da segunda, o clamp
era um degrau sobre o índice da faixa em vez de um `min` sobre o valor, e caía
uma vez por passo — a 0,25h, que é o piso desta tela, entre 122.894 e 122.895
minutos. Nenhuma das duas moveu um centavo; as duas tornaram falsa a frase que o
módulo existe para sustentar. Quem mexer no limite refaz o argumento **e** o
caso de teste que atravessa a faixa onde ele morde.

**O que custa.** Uma `Fraction` reduz com um gcd a cada operação, então a entrada
que cruza **poucas** faixas ficou **2 a 3 vezes mais lenta** que o laço em float,
e a que cruza muitas ficou mais rápida, porque a forma fechada não conta faixa.
Medido no motor real: a chamada comum (2h, passo 1h) **6,0 µs** contra 2,1 µs; o
pior caso **legal** de hoje (1440 min a passo 0,25h) **24,1 µs** contra 9,9 µs; e
só **abaixo do piso** o exato ganha — 1440 min a passo 0,05h, 26,3 µs contra
34,0 µs, num passo que a D35 proíbe. Vinte e três vezes abaixo de um
milissegundo no pior caso legal, então uma fila de cinquenta pendências é cerca
de 1 ms de motor, e isto não é problema. Está escrito porque também não é de
graça: a exatidão foi **comprada**, não achada, e o preço está no `exact.ts` com
a receita de como reduzi-lo se um dia precisar.

**Considerado e descartado — e são dois, não um.**

*Subir o piso da D35.* Nenhum piso alcançável segura (ver D35), e um piso alto
proíbe calibração legítima para consertar um empate de arredondamento.

*Reformular a soma, continuando em ponto flutuante.* É a simplificação que
alguém vai propor primeiro — "BigInt é exagero, soma melhor" — e ela foi medida
antes de o BigInt entrar: **quatro formulações** da soma; a melhor derrubou as
violações de 62 para 21, e a compensação de **Kahan piorou, para 85**. O resíduo
não está na ordem das parcelas: está na largura das faixas e no último bit do
double, e somar melhor não o alcança. Quem quiser tirar o `exact.ts` daqui tem
que bater esse número, não argumentar que BigInt é exagero.

**Resíduo aceito.** Alguns valores mudam em um centavo, sempre num empate exato
de meio centavo onde o float caía para baixo e o arredondamento verdadeiro sobe.
Nos passos do seed isso alcança 0,045% a 0,2% da grade, sempre a favor do menino.

### Emenda à D5 e à D12 (Fase 6) — a tabela é editável, o motivo continua valendo

A tela de Configuração deixa dar a Convívio, Casa ou Curinga um
`decay_step_hours` e um `return_bonus_pct`. Medido: aceito, sem recusa e sem
aviso. E, porque a mesma tela deixa mudar o `calc_mode`, uma atividade de Convívio
pode virar `duration` e passar a encher um balde.

**Decisão.** As duas continuam **normativas para o seed**, e a tela **não** as
impõe: "sem deploy" é o ponto da fase, e um adulto que decida que Curinga passou
a precisar de desgaste é o adulto decidindo. Mas a tela **diz o motivo** quando se
edita uma das três, com a frase da própria decisão.

**Por quê.** A D12 não descreve dado: ela dá uma razão funcional — *"é a válvula
de escape do admin para o caso que a tabela não previu. Se degradasse, deixaria
de servir ao único motivo de existir."* A D5 dá uma razão mecânica que esta mesma
tela pode invalidar. Deixar as duas sem enforcement é defensável e é o que a fase
pede; deixá-las **sem menção** é reinterpretar em silêncio, que é o que o
`CLAUDE.md` proíbe.

**Considerado e descartado.** Recusar. Recusar transformaria a D5 numa invariante
que ela nunca disse ser, e travaria o adulto na única tela feita para destravá-lo.

**Resíduo aceito.** Nada impede a configuração absurda; o que se garante é que
quem a fizer leu por que ela era absurda. O casamento é **por nome**: renomear
Curinga tira a frase, e uma categoria nova chamada Curinga a herda — a frase
pertence à decisão sobre aquela categoria, não à linha que por acaso tem aquele
id.

---

## A decisão que veio da #60

### D40 — O artefato de build não carrega segredo nem o grafo de ambiente

**Decisão.** Nada que sai do build — `.next/` e a imagem Docker, camadas e
histórico — contém o grafo de ambiente resolvido pelo varlock nem o valor real
de uma variável `@sensitive`. O servidor só inicia via `varlock run`, que resolve
as seis variáveis a cada start. O build nunca roda com os valores reais, e no
Coolify as seis variáveis ficam com "Available at Buildtime" desmarcado.

Quem segura, em quatro lugares:

- `scripts/strip-build-env.mjs`, segunda metade do `pnpm build`: tira de `.next/`
  o fallback que a integração do varlock injeta em todo `[turbopack]_runtime.js`
  e o `.env` que o `output: "standalone"` copia, e reprova o build se sobrar uma
  atribuição literal a `__VARLOCK_ENV`. O cache persistente do Turbopack no build
  fica desligado em `next.config.base.ts`.
- `pnpm check:secrets`, no CI: reprova se o valor de qualquer item `@sensitive`
  aparecer em qualquer arquivo sob `.next/`.
- `scripts/assert-no-build-secrets.sh`, no começo de cada estágio do
  `Dockerfile`: reprova o build se um dos seis nomes estiver no ambiente com
  valor diferente do que o próprio `Dockerfile` escreve.
- `docker-smoke.sh`, passos 12 a 14: nada do ambiente do build em `/app/.next`,
  nada além dos placeholders no histórico da imagem, e um build com `ARG`
  injetado depois de cada `FROM` é recusado.

**Por quê.** O `@sensitive` foi lido como a garantia, e ele só controla o `ENV.X`
inlinado no bundle. Medido na #60: as senhas e o `SESSION_SECRET` em texto puro
em quatro arquivos de `.next/` e no cache do Turbopack, por três caminhos que a
marcação não alcança. Na revisão do PR, uma simulação do "Available at
Buildtime" do Coolify deixou `.next/` limpo e os quatro `AUTH_*` e o `SESSION_SECRET`
no `docker history --no-trunc` da imagem final — outro caminho, que nenhuma
verificação sobre arquivos vê. Com o `SESSION_SECRET` dá para forjar cookie de
admin.

O fallback removido existe para servidor iniciado sem varlock, e este app não
inicia assim: sem `varlock run` o servidor não valida nada e serviria o valor do
build (ver o `CMD` do `Dockerfile`). Remover o literal só tira de uso o caminho
que já era proibido.

**Resíduo aceito.** As verificações sobre arquivos procuram o valor literal. Um
valor comprimido ou recodificado passaria por elas, e é por isso que a regra de
nunca buildar com valor real continua, mesmo com o artefato limpo. A limpeza
casa o formato que o `@varlock/nextjs-integration` 1.2.2 escreve; uma atualização
que mude o formato reprova o build em vez de passar em silêncio, e quem a fizer
ajusta o script.

---

## A decisão que veio da #83

### D41 — O app não rastreia o que está configurado nos aparelhos

**Decisão.** O app guarda o saldo e mais nada. Ele não mantém registro do que
está ligado em cada aparelho, de quanto cada um permite por dia nem de desde
quando. A tela "Ligado nos aparelhos" (`/admin/regimes`), o atalho que a tela de
Liberar horas oferecia para ela, a lista na tela do menino e os server actions
de regime saem. A tabela `regimes` **fica no schema, com as linhas intactas e
sem migration de remoção**: ela dorme, nada lê e nada escreve nela, e voltar
atrás é um revert e não uma migração.

Cai junto o terceiro lugar em que cor carregava significado. A regra do
`CLAUDE.md` passa a ser **dois**: pendência e saldo negativo.

**Por quê.** O dono usou a tela e mediu o custo: *"na real essa tela não faz
sentido. Não quero ter que trackear em DOIS lugares."* O limite já está
configurado no aparelho, e anotá-lo aqui é uma segunda cópia que alguém tem que
manter em dia à mão — e ninguém mantém. Uma anotação desatualizada é pior que
anotação nenhuma, porque o adulto acredita nela.

O campo "horas por dia" só descreve metade dos aparelhos. No Xbox e no
PlayStation o próprio aparelho cumpre o limite, então o número é verdade sem
ninguém fazer nada. No celular e na TV não existe limite que se cumpra sozinho:
o adulto desliga na mão, numa hora certa, e "2h por dia" não descreve isso. Um
campo que é verdade em dois aparelhos e ficção em dois outros não é dado.

**Isto contradiz a `spec.md`, e a `spec.md` é anexo histórico.** A spec pede a
tabela `regimes`, a tela **Regimes** na Fase 5, a lista de regimes ativos na tela
do menino, o atalho depois da liberação e os três lugares de cor. Esta decisão
revoga tudo isso. Pela regra da casa, **onde os dois discordarem, este documento
vence** — a spec fica como está, registrando a intenção original.

**Considerado e descartado.** Renomear a tela, que era a #81: trocar a palavra
não muda o fato de serem dois lugares para manter o mesmo dado. A #81 foi
fechada por esta.

**Considerado e descartado.** Apagar a tabela numa migration. O dono disse *"se
precisar dela a gente retorna"*, e uma migration de remoção transforma o retorno
em escrever tudo de novo, com as linhas já perdidas. Uma tabela dormente custa
zero em runtime.

**Resíduo aceito.** A tela de Liberar horas continua lembrando o adulto de
ajustar o aparelho à mão depois de liberar, e agora é só um lembrete: o app não
sabe se ele fez. Isso é o ponto — o aparelho é a fonte de verdade sobre o
aparelho, e o app é a fonte de verdade sobre o saldo.

---

## A decisão que veio da #74

### D42 — A direção visual é o painel de instrumentos, com paleta

**Decisão.** O desenho do app é o da #74, mergeado no PR #78, e
[`design.md`](design.md) é o documento dele. O que é normativo:

- **A paleta é fechada em seis cores**: preto, branco, `blue-800`, `slate-100`,
  `yellow-300` e `red-700`. Toda cor com tom mora em `src/ui/style.ts` e em
  nenhum outro arquivo. Uma sétima é um diff que alguém revisa, nos dois
  guardas: `design.test.ts` e `scripts/check-served-css.sh`.
- **A paleta tem duas metades.** A mobília — `blue-800` na tarja de painel, no
  controle primário, no item atual do menu e na opção escolhida, `slate-100` no
  chão da página — não diz nada sobre o dado. O significado continua em
  **exatamente dois lugares**: `yellow-300` na pendência e `red-700`, como
  tinta, no saldo negativo (D41). A mobília é fria e o significado é quente, e
  nenhuma cor de mobília pode ser vermelha, amarela, laranja, âmbar ou rosa.
- **Todo par de texto mede pelo menos 4,5:1** (WCAG 2, AA). Os pares de hoje
  estão medidos em `design.md`; o mais baixo é o vermelho sobre branco, 6,42:1.
  Nada desbota: sem `opacity`, sem cinza sobre cinza, sem tom pálido de fundo.
  Desativado inverte.
- **Canto arredondado em dois raios**: 12 px num painel, 8 px num controle.
- **Desktop é a mesma base**, não uma segunda tela: a partir de `lg` a barra
  vira uma trilha à esquerda e as telas abrem em duas colunas onde a divisão
  significa alguma coisa. A casca para em `max-w-4xl`.
- **Ícone só na barra de navegação**, desenhado em `src/ui/icons.tsx`, em
  `currentColor` e `aria-hidden`. Nunca emoji, nunca pacote de ícones.
- **Continua valendo**, sem mudança: alvo de toque de 48 px, nenhuma animação
  decorativa, o saldo como o maior elemento da tela do menino, e dois toques no
  máximo para uma operação comum.

**Por quê.** O dono abriu a primeira versão, preto e branco, e achou seca demais:
*"queria que parecesse mais um app"*, *"falta cor"*. O PR #78 trouxe a paleta, os
cantos e os ícones, e o `CLAUDE.md` continuou dizendo "preto sobre branco ou
branco sobre preto". Uma regra normativa que o código não cumpre faz o próximo
agente tratar a tarja azul como bug.

O que o "preto e branco" protegia era o contraste e a cor que entra por hábito,
não o preto e branco em si. As duas proteções ficaram: o contraste medido de
cada par, e a lista fechada que os dois guardas conferem.

**Isto contradiz a `spec.md`**, que pede preto sobre branco ou branco sobre
preto e aceita o desktop como a versão mobile centralizada. A spec é anexo
histórico e fica como está.

**Considerado e descartado.** Voltar ao preto e branco para cumprir a regra
antiga. O dono decidiu o contrário ao ver as duas versões, e a regra existe
para descrever o app, não o contrário.

**Resíduo aceito.** A etiqueta de pendência usa `rounded` (4 px), um terceiro
raio que a regra dos dois não descreve. Ficou como estava: esta decisão
registra o desenho, não o muda.

---

### D43 — Produção só recebe o que passou pelo CI

**Decisão.** O deploy automático do Coolify fica desligado. Quem pede o deploy é
o workflow `deploy.yml`, disparado quando o CI termina verde na `main`. A
aplicação é construída pelo `Dockerfile` do repositório, com volume persistente
em `/data`.

Endereço da instância, uuid da aplicação e token de API ficam nos segredos do
repositório (`COOLIFY_URL`, `COOLIFY_APP_UUID`, `COOLIFY_TOKEN`). O repositório
não diz para onde publica.

**Por quê.** O Coolify escutando o GitHub publica todo push na `main`, inclusive
o merge cujo teste quebrou. O portão deste projeto é CI verde (D25), e ele só
existe por convenção, porque o plano do GitHub não oferece proteção de branch
(D26). Pendurar o deploy no resultado do CI é o que torna o portão executável em
vez de combinado.

O custo são três variáveis secretas no repositório e um segundo lugar onde o CI
roda: a `main`, além do PR.

**Resíduo aceito.** Um deploy ainda pode ser pedido à mão pelo painel do
Coolify, e o painel não pergunta pelo CI. A decisão descreve o caminho
automático, não tranca o manual.

**Emenda (#23) — a migration roda no "Post-deployment command".** O Coolify
roda `db-migrate.mjs` sozinho, no container novo, depois de ele ficar saudável.
O `db-migrate` termina imprimindo as migrations do banco e as da imagem, e o
log do deploy mostra que o banco está em dia sem outro comando.

O "Pre-deployment command" fica vazio. No Coolify 4.3.21 ele roda com
`docker exec` no container que está servindo, antes de a imagem nova ser
construída: a pasta `drizzle/` é a da imagem anterior, a migration nova não é
vista e o `db-migrate` sai com 0 sem aplicar nada.

**Por quê.** Esquecer o comando manual quebrou a tela ao menos uma vez. O preço
do post-deploy é o código novo servir contra o schema velho por alguns
segundos, e uma migration que falha deixar o deploy verde, com o erro no log e
as telas novas quebradas até alguém agir. O dono aceitou (25/09/2026): o app é
caseiro e ficar fora um minuto não é problema. Continua valendo o que
`deploy.md` recusa: a migration não roda no start do container, e não há
crash-loop, porque o post-deploy roda uma vez por deploy. Evidência, com trechos
e links, em `deploy.md`, "No Coolify" e "Por que não pelo Pre-deployment
command".

---

## A decisão que veio da #92

### D44 — Sessão mínima por atividade, padrão 5 minutos

**Decisão.** Cada atividade tem `min_session_minutes`, inteiro de 1 em diante,
padrão **5**, editável na Configuração ao lado do limite de sessão. Uma sessão
de cronômetro cujo tempo ativo, em segundos inteiros, fica abaixo de
`min_session_minutes × 60` **não vira registro**: 4min59s é recusada, 5min
exatos e 5min01s entram. A regra vale igual para o *Enviar*, para o limite e
para a virada do dia (D16, D31): a sessão é encerrada, nada vai para a fila, a
tela diz qual é o piso, e o menino pode começar outra na hora.

- **A recusa é do servidor (D33).** `stopTimer` e a reconciliação decidem; a
  tela só avisa antes do toque (#86): abaixo do piso o botão vira *Encerrar sem
  enviar*, com o piso escrito ao lado, e *Voltar* devolve a sessão.
- **O piso é um carimbo, como o limite (D38).** Copiado para `timers` quando a
  sessão abre; mudar o piso não alcança sessão aberta, em nenhuma direção.
  Sessão aberta antes desta decisão tem piso 0 e segue a regra dos 30 s.
- **Não é campo que precifica (D37).** O piso decide se uma sessão vira
  registro, nunca quanto vale uma que virou. A entrada na fila já tem os seus
  minutos, então mudar o piso com pendência esperando é permitido e não mexe
  nela.
- **O limite não fica abaixo do piso.** A Configuração recusa
  `min_session_minutes > max_session_minutes`, e um `CHECK` no banco também: um
  limite menor que o piso faria toda sessão cortada pelo limite ser descartada.
- **O adulto não é preso ao piso (D18).** O lançamento avulso e a correção de
  duração na fila continuam aceitando a partir de 1 minuto, como o resíduo 3 da
  D17 já dizia. O piso protege a fila contra o toque do menino; o adulto que
  lança uma sessão curta está dizendo que ela aconteceu.

**Por quê.** Decisão do dono (22/09/2026): *"a sessão mínima é de 5 minutos E
anotar isso em algum lugar."* O arredondamento de 30 s era farmável — 60 sessões
de 30 s valiam 1,82 h contra 1,50 h de meia hora corrida (#85). Com piso de 5
minutos o ganho máximo do arredondamento por sessão cai para 30 s sobre 5 min,
10%, e cada sessão custa um toque do menino e uma aprovação do adulto. A #85 fica
resolvida por aqui: o resíduo do arredondamento é aceito, e a defesa é o piso.

**Por quê por atividade.** Uma leitura de 5 minutos e um treino de 5 minutos não
precisam do mesmo mínimo, e o dono muda sem deploy.

**A migration não move saldo.** `0004` reconstrói `activities` e `timers`
copiando todas as colunas que existiam, preenche o piso das atividades com 5 —
ou com o próprio limite, onde ele é menor que 5 — e o dos cronômetros
existentes com 0, e não toca em `activity_logs` nem em `ledger`.
Medido num banco construído com o código anterior (seed, dado de demonstração,
uma pendência e um cronômetro aberto): saldos iguais (kid1 33,20 h; kid2
8,50 h), contagens iguais nas seis tabelas, `activity_logs`, `ledger` e as
colunas antigas de `activities` e `timers` idênticas por hash, prévia da
pendência idêntica. O cronômetro aberto, parado com 40 s depois da migration,
virou registro de 1 minuto, como antes dela. Uma atividade com limite de 3
minutos ficou com piso 3, e a sessão cortada por esse limite virou registro.

**Resíduo aceito.** O menino perde a sessão curta inteira, até 4min59s de
atividade real, onde antes perdia menos de 30 s. É o custo que o dono escolheu,
e a tela avisa antes do toque.

---

## A decisão que veio de abrir o repositório

### D45 — As pessoas moram só no banco, e o app nunca escreve nelas

**Decisão.** Os usuários e as senhas vivem só na tabela `users`, que se edita
**apenas com SQL direto no arquivo do SQLite**. Nenhuma rota, server action,
tela, endpoint, seed ou script do app escreve nela. O código não carrega nome,
senha nem nada que identifique as pessoas.

- **Senha só como hash.** `users.password_hash` guarda
  `scrypt$N$r$p$salt$hash`: scrypt do `node:crypto`, salt de 16 bytes por hash,
  chave de 32 bytes, custo N=2^14, r=8, p=5 (faixa da OWASP, 16 MiB por
  derivação). O custo vai junto com o hash, então subir o custo depois não
  invalida as senhas antigas.
- **O login só lê.** Uma linha ativa pelo `username` normalizado (minúsculas,
  sem espaço nas pontas). Conta desconhecida, inativa (D14) ou sem hash faz a
  mesma derivação contra um hash de fachada e devolve o mesmo `null`. Senha
  vazia nunca autentica. Hash malformado não confere e não derruba o login.
- **Falha fechado.** `password_hash` nulo é conta em que ninguém entra. Não
  existe senha padrão.
- **O hash nasce fora do app.** `pnpm auth:hash` lê a senha do stdin, sem eco,
  e imprime o hash. Não abre banco. O dono roda o `UPDATE`/`INSERT` à mão no
  volume ([`deploy.md`](deploy.md), "Usuários").
- **O seed não cria pessoas.** Testes criam as suas numa fixture
  (`src/db/test-users.ts`), com identificadores neutros (`admin1`, `admin2`,
  `kid1`, `kid2`) nos mesmos ids 1 a 4.
- **As variáveis `AUTH_*` saem.** O `.env.schema` passa a declarar duas
  variáveis, `DATABASE_PATH` e `SESSION_SECRET`. Onde a D23 e a D40 dizem
  "seis", leia "duas".

**Por quê.** Decisão do dono (23/09/2026), ao tornar o repositório público: o
código público não pode identificar as pessoas, e credencial não pode morar em
lugar que um deploy, um log de build ou um clone alcance. O banco de produção
já é o único lugar com dado real, e é o único que não vira público.

**A migration não move saldo.** `0005` só adiciona a coluna nula
(`ALTER TABLE users ADD password_hash text`): não reconstrói tabela, não muda
id, não apaga ninguém. Medido num banco construído com o código anterior (seed e
dado de demonstração): saldos iguais (id 3: 18,20 h; id 4: −5,50 h), contagens
iguais nas sete tabelas, e `users` (sem a coluna nova), `ledger` e
`activity_logs` idênticos por hash.

**Resíduo aceito.** A primeira falha de login depois de o servidor subir custa
duas derivações, porque o hash de fachada nasce na primeira vez que é pedido.
Cookie emitido antes continua valendo até expirar: a sessão carrega só o
`username`, e a troca de senha não a derruba (ver `endSession`).

---

## A decisão que veio da #95

### D46 — Instalável sim, offline não

**Decisão.** O app se instala no telefone: `manifest.webmanifest` servido pelo
App Router, `display: standalone`, ícones 192 e 512, um `maskable` com margem e
o `apple-touch-icon` de 180. O service worker (`public/sw.js`) existe e **não
escuta `fetch`**: toda requisição, navegação e server action incluídas, vai à
rede como iria sem ele. Ele não abre o Cache API. `pwa.test.ts` reprova um
service worker que passe a escutar `fetch` ou a citar cache.

**Por quê.** O dono quer o app na tela inicial dos meninos. Mas o app é a fonte
única de verdade do saldo, e saldo velho em cache é pior que esperar carregar:
o menino abre, vê 12 h que não existem mais, e a confiança morre ali. O service
worker só está lá porque o Chrome no Android pede um antes de oferecer a
instalação.

**O ícone é arte, não mobília.** O laranja e o amarelo do relógio não entram na
paleta da D42, e a regra "ícone só na barra de navegação" continua falando da
interface. O fundo das variantes com margem é `blue-800`, e `theme_color` e
`background_color` do manifest vêm de `src/ui/style.ts`, com um teste que
confere o hex contra o tom instalado do Tailwind.

**Considerado e descartado.** Guardar ícone, fonte e CSS versionados pelo build.
A issue permitia, mas ninguém mediu espera por causa deles, e um service
worker sem `fetch` é o único que se prova incapaz de servir dado velho.

**Resíduo aceito.** A tela de abertura que o Android desenha ao abrir o app
instalado (ícone sobre `background_color`) é do sistema, não do app: não há
splash nem "app shell" nosso mostrando tela antes do dado.

---

## A decisão que veio da #113

### D47 — Bônus de retorno exige ter estado lá antes

O código concedia o bônus quando **nenhum** registro da categoria caía na janela
da D6, e isso incluía o caso em que nunca houve registro nenhum: a primeira vez
na vida contava como retorno. A D6 define a janela e a D7 diz sobre o que o
bônus incide; nenhuma das duas falava da estreia. Com o banco de produção
recém-criado, tudo era primeira vez e todo registro saía com 50% a mais.
Medido na primeira sessão de Mente do Kid2, 7 minutos: **0,35 h** a 2,0 com
bônus, 0,26 h a 1,5 com bônus, **0,18 h** a 1,5 sem ele.

**Decisão.** O bônus de retorno exige, além da janela vazia da D6, um registro
aprovado da **mesma categoria** com `occurred_on` **anterior à janela**. Sem
histórico, sem bônus. Ninguém volta de onde nunca esteve.

- **A categoria é a carimbada no registro (D37),** não a que a atividade tem
  hoje.
- **"Anterior" é no calendário.** Um registro de um dia **posterior**, mesmo
  congelado antes (D34), não faz de uma entrada lançada num dia passado um
  retorno: nada daquela categoria tinha acontecido antes dela.
- **O motor não enxerga o que está fora da janela,** então quem chama informa
  o primeiro dia da categoria (`categoryFirstDay`), lido dos registros
  aprovados. Todo aprovado foi congelado antes do que está sendo precificado
  agora.
- **Estende a D32.** Uma pendência da mesma categoria anterior à janela,
  enquanto não houver registro aprovado anterior a ela, muda o preço: decidida
  primeiro, faz da entrada de hoje um retorno. Por isso ela bloqueia a
  aprovação e o lançamento, e a recusa a nomeia como a D32 já faz. Decididas
  em ordem, a estreia paga 1,5 h e o retorno 2,25 h. Na ordem inversa, as duas
  pagariam 1,5 h. Havendo um aprovado anterior à janela, a pendência antiga não
  muda nada e não bloqueia, como antes.

**Resíduo aceito.** Enquanto a estreia de uma categoria espera na fila, nenhuma
entrada posterior daquela categoria pode ser decidida. A fila já lista da mais
antiga para a mais nova, então o caminho normal não encosta nisso.

---

## A decisão que veio da #3

### D48 — Login errado atrasa, não tranca

O `/entrar` não limitava tentativa. Com o repositório público, a URL e o
formulário são conhecidos, e o único freio era o custo de uma derivação scrypt:
cerca de 4 palpites por segundo num navegador, 100 senhas erradas seguidas em
26,2 s, e a certa aceita logo depois.

**Decisão.** Um limitador em memória, por nome de usuário, que atrasa e nunca
tranca (`src/auth/login-throttle.ts`).

- **Cinco tentativas livres.** Depois, cada tentativa que passa abre uma espera
  que dobra a partir de 1 s, com teto de **15 minutos**. Chave sem tentativa
  por 24 h recomeça; login certo zera a chave.
- **Tentativa dentro da espera é recusada sem checar a senha,** com a mesma
  mensagem de sempre (#12), e não alonga a espera. Não gasta scrypt.
- **A tentativa é cobrada antes de checar,** de forma síncrona. Requisições em
  paralelo não passam juntas pela mesma janela aberta.
- **A chave é o nome digitado, normalizado,** exista a conta ou não. Nome
  inventado e nome real atrasam igual, então o atraso não conta quem existe.
- **Cookie de dispositivo.** Login certo grava `kst_device` (httpOnly, `lax`,
  um ano), assinado com uma chave derivada do `SESSION_SECRET` diferente da da
  sessão, e que sobrevive ao logout. A tentativa de um navegador que carrega o
  cookie **do mesmo nome digitado** conta numa chave separada. Ela também é
  limitada, com o mesmo teto.
- **Sem IP e sem serviço externo.** O estado mora na memória do processo, que
  é um container só, e some no restart.

**Por quê.** São quatro contas numa família. Trancar a conta depois de N erros
dá ao irmão uma arma: ele erra de propósito e o outro não entra. Um atraso por
nome sozinho tem o mesmo defeito, mais brando: o menino que erra a senha do
adulto no próprio celular atrasa o login do adulto. O cookie de dispositivo
separa os dois. O adulto entra do próprio aparelho sem esperar, e o menino só
atrasa a tentativa que vem de aparelho sem o cookie do adulto. IP não separa
ninguém: em casa todos saem pelo mesmo endereço, e o `x-forwarded-for` só vale
atrás do proxy.

**Medido** num `next start` local, banco descartável com as quatro contas de
teste, postando o formulário sem JavaScript como um script faria:

| cenário | antes (#3) | depois |
|---|---|---|
| senhas erradas seguidas, um cliente, mesma conta | 100 checadas em 26,2 s | 40 tentativas em 3,8 s, **6 checadas** (5 livres e 1 depois de 1 s); as outras recusadas em 6–66 ms, sem scrypt |
| senha certa logo depois | aceita | recusada, com a mesma mensagem |
| 30 logins certos em paralelo, cliente sem cookie | — | **5 aceitos**, 25 recusados |
| 50 erros na conta de um admin, cliente sem cookie; depois o admin do próprio aparelho | — | cliente sem cookie recusado; admin com cookie **aceito**; o outro admin, intocado |
| nome inexistente e nome real, 6ª tentativa | — | mesma mensagem, mesmo status, 10 ms e 12 ms |

Em regime, uma chave aceita cerca de 110 palpites no primeiro dia e 96 por dia
depois, contra ~345 mil por dia antes. Com 50 mil chaves, o mapa ocupa 8,7 MiB
(183 bytes por chave) e uma chave nova com o mapa cheio custa 0,7 ms.

**Considerado e descartado.**

- *Trancar a conta.* É a arma do irmão.
- *Chave por IP.* Em casa, o IP do menino é o do adulto.
- *Guardar no SQLite.* Sobreviveria ao restart, mas faria o login, que hoje só
  lê, escrever no banco de produção a cada tentativa, e pediria uma migration
  para um estado que vale minutos.
- *Mensagem própria para "espere".* Ajudaria quem erra a própria senha, mas a
  #12 pede uma mensagem para toda falha.

**Resíduos aceitos.**

- **Restart esquece tudo,** inclusive a espera em curso. Cada deploy dá cinco
  palpites livres por nome.
- **Quem entra de aparelho novo durante um ataque espera até 15 minutos,** e
  nesse tempo a senha certa recebe "Usuário ou senha incorretos.".
- **O cookie de dispositivo só nasce no próximo login.** Quem já está logado
  hoje não tem um até a sessão expirar ou sair e entrar.
- **Um cookie por navegador:** o último nome que entrou nele.
- **Nenhum teto global.** Nomes inventados em rodízio custam um scrypt cada, e
  o CPU do container é o limite. Para expulsar uma chave do mapa cheio, é
  preciso criar 50 mil chaves novas, que custam cerca de duas horas de CPU e
  rendem cinco palpites. Um limite no proxy fecharia isso, fora do
  repositório.
- **Quem tem o celular do adulto na mão** usa a chave com cookie do adulto, que
  é limitada do mesmo jeito.

---

## A decisão que veio da #17 e da #18

### D49 — O menino também pede, sem cronômetro

Até aqui a única escrita do menino era propor um registro pelo cronômetro.
Culto, academia e sair com os amigos não se cronometram, então só existiam se o
adulto lançasse (D18).

**Decisão.** Existe uma segunda escrita do menino: o **pedido**. Ele escolhe a
atividade, o dia e, se a atividade for `duration`, quantos minutos. A entrada
nasce `pending`, com `source = 'request'`, na mesma fila do cronômetro, e o
adulto aprova, corrige ou recusa com motivo como já faz (D19, D32, D33). A fila
mostra a origem ("pedido sem cronômetro").

Decisões do dono (24/09/2026):

- **Qualquer dia.** Sem limite para trás nem para frente no servidor: *"a gente
  conversa"*. A data continua `TEXT` `YYYY-MM-DD` em `America/Sao_Paulo` (D13),
  e só uma data que não existe é recusada. O preço de uma entrada num dia
  passado segue a D8 e a D34 como qualquer outra: quem congela depois lê o que
  a janela já gastou, e nada congelado se move (D15).
- **Todas as atividades ativas aparecem**, as de duração inclusive, com o
  menino digitando os minutos. *"Tudo passa por aprovação de qualquer jeito."*
  O menino nunca manda valor nem nota: `delivery` chega sem nota e o adulto dá
  a nota na aprovação (D37); `free` chega sem valor e o adulto digita o valor
  na aprovação (`LogEdits.freeValue`), que é o que a D12 já dizia do Curinga.
  Minutos mandados para atividade que não é `duration` são descartados.
- **Nenhum limite de pedidos.** Sem contador, cota nem espera.
- **O servidor só recusa o que a D33 recusa:** pedido em nome de outra pessoa
  (a guarda `requestLog` só deixa o menino pedir para si), atividade inexistente
  ou desativada, categoria desativada, menino desativado, e corpo mal formado —
  data que não existe, minutos que não são inteiros de 1 a 1.000.000, nota
  acima de 500 caracteres. A recusa sai como as outras hoje (#7).

**Consequência que o dono precisa ler.** A D32 não deixa aprovar uma entrada
enquanto houver pendência anterior na janela dela, e a D47 estende isso à
estreia de uma categoria. Vinte pedidos empilhados viram **vinte decisões antes
de qualquer entrada posterior** que caia na janela deles: a sessão de hoje fica
atrás deles na fila até cada um ser aprovado ou recusado. Recusar libera, como
sempre (D19). Medido em teste: vinte pedidos de Mente num domingo, depois uma
sessão cronometrada hoje — as vinte e uma chegam à fila, vinte com "Aprove
antes", e a de hoje só fica livre depois de o adulto decidir as vinte.

**Duração presumida (#18).** `activities.presumed_minutes`, nulo ou inteiro de
1 em diante, editável na Configuração só para `duration`. É de onde o campo de
minutos do pedido parte; se o menino não manda minutos, a entrada nasce com
ela. "Curso ou aula extra" tem 60: o pedido chega valendo uma hora pela taxa da
categoria — não vira prêmio fixo — e o adulto corrige a duração na aprovação,
o que reprecifica (D8, D15). **Não é campo que precifica (D37):** a entrada já
tem os seus minutos na linha, então mudar a duração presumida com pedido na
fila é permitido e não mexe nele. **A sessão mínima (D44) não vale para o
pedido:** ela protege a fila contra o toque do cronômetro; um pedido é uma
afirmação que o adulto confere.

**Seed: "Treino em casa" vira "Academia", 1 h fixa** (decisão do dono, mesmo
dia). A linha de id 4 de Corpo é renomeada e passa a `fixed` com valor 1 — a
mesma linha, nunca desativada e recriada (D14), para o histórico ficar no mesmo
id. O seed só vale para banco novo; em produção o dono já fez a mesma mudança
na Configuração.

**A migration não move saldo.** `0006` reconstrói `activity_logs` (a lista de
`source` ganha `request`) e `activities` (coluna nova) copiando todas as colunas,
derruba e recria verbatim os três gatilhos da `0001`, e preenche
`presumed_minutes` com 60 só na atividade de id 8, identidade do seed para
"Curso ou aula extra", se ela ainda for `duration`. Medido num banco construído
com o código anterior (seed, dado de demonstração, uma pendência e um
cronômetro aberto): saldos iguais (id 3: 10,83 h; id 4: −6,25 h), contagens
iguais nas sete tabelas, `users`, `categories`, `activity_logs`, `ledger`,
`timers` e as colunas antigas de `activities` idênticos por hash, prévia da
pendência idêntica, `foreign_key_check` vazio. O cronômetro aberto, parado
depois da migration, virou registro como antes.

**Resíduos aceitos.**

- O menino pode pedir o mesmo culto duas vezes, ou um dia que ainda não
  aconteceu. É o adulto quem decide, com o menino do lado.
- Uma entrada futura aprovada congela hoje; o que for lançado depois num dia
  anterior lê a janela dela pela D34, e ela não se move.
- O menino digita os minutos de uma atividade `duration`, e o número chega à
  fila como ele digitou. A conferência é a aprovação.

---

## A decisão que veio da #21

### D50 — O adulto pode dizer quanto a entrada vale

Aprovar tinha um caminho só: corrigir o relato (atividade, duração, nota) e
deixar o motor recalcular. Uma atividade `fixed` não tinha conserto nenhum: a
visita à casa de um amigo que durou pouco entrava com as 3 h da tabela ou era
recusada.

**Decisão.** A aprovação tem dois caminhos, que se combinam:

- **Corrigir o relato**, como antes: o motor recalcula com taxa, desgaste,
  repetição e bônus (D7, D8, D34).
- **Arbitrar o valor**: o adulto digita o valor final em horas
  (`LogEdits.overrideHours`), em qualquer modo de cálculo, `fixed` inclusive.
  De 0 a 1.000.000, com duas casas (D9). O motor não é consultado, então
  nenhuma linha de explicação é produzida para essa entrada, e uma entrada que
  a regra não sabe precificar (`free` sem valor, nota que falta) também pode ser
  arbitrada.

O que o valor arbitrado carrega:

- **A marca.** `activity_logs.overridden` fica verdadeiro; quem arbitrou é o
  `reviewed_by`, gravado na mesma escrita. `computed_hours` guarda o número do
  adulto e congela como qualquer outro (D15): nenhum caminho recalcula.
- **O que a regra daria.** `rule_hours` guarda o valor que a regra pagaria no
  instante da aprovação, ou nulo quando ela não sabe precificar a entrada. Só o
  total: os passos não são guardados nem mostrados.
- **O motivo é opcional** (decisão do dono, 24/09/2026). `override_reason`, até
  500 caracteres, só ao lado de um valor arbitrado. Fica numa coluna própria,
  não anexado ao `note` como o da recusa.
- **O histórico do menino diz** "valor decidido por um adulto" na linha, e,
  quando existem, "Pela regra: 3h" e "Motivo: …". Um número que não bate com a
  tabela não é lido como erro do app.
- **Zero é valor.** A entrada é aprovada com 0 h e sem linha no ledger (D10), e
  o histórico a mostra, lida do registro como a recusa (#72). Vale para todo
  zero aprovado, inclusive o da regra (a nota zero), que é o que a D10 já
  pedia: "mostra no histórico que a tarefa foi avaliada".
- **A ordem continua (D32, D47).** A arbitrada espera a entrada anterior como
  qualquer outra: ela ocupa o balde e a janela de quem vem depois.

**O balde do dia (D3), a repetição (D6) e o bônus de retorno (D47) contam a
atividade, não o valor.** O balde soma os minutos da linha — os corrigidos, se
o adulto corrigiu também —, a repetição e o bônus a contam como feita. É o que
o motor já lia; nada nele mudou.

Medido, 2 h de "Ler livro" (Mente, 1,5, passo 1 h) arbitradas em 0,5 h, e mais
1 h no mesmo dia:

| o balde, depois do valor arbitrado | a hora seguinte | o dia |
|---|---|---|
| conta as 2 h de atividade (**esta decisão**) | 0,38 h | 0,88 h |
| fica vazio | 1,50 h | 2,00 h |
| sem arbitrar, pela regra | 0,38 h | 2,63 h |

**Por quê.** Com o balde vazio, baixar o valor **reabre a torneira**: o adulto
que achou a leitura valer menos daria a hora seguinte pagando cheio, e o
menino ganharia mais lendo depois de ter sido cortado — o incentivo invertido.
E a explicação da hora seguinte continua verdadeira: "você já fez 2h de Mente
hoje" é o que aconteceu. O mesmo vale para cima: arbitrar 3 h numa hora de
leitura não alarga o dia, a hora seguinte desgasta a partir de 1 h.

**Considerado e descartado.** Encher o balde com o valor convertido em tempo
(valor ÷ taxa). Não existe conversão para `fixed`, `delivery` nem `free`, que
não têm taxa, e a hora seguinte diria "você já fez 0,33h de Mente hoje" sobre
duas horas de leitura: um passado que não aconteceu.

**A migration não move saldo.** `0007` só adiciona três colunas — `overridden`,
com padrão falso, e `rule_hours` e `override_reason`, nulas —, com
`ALTER TABLE`: não reconstrói tabela e não toca em `ledger`. Medido num banco construído com o
código anterior (seed, dado de demonstração, uma pendência e um cronômetro
aberto): saldos iguais (id 3: 10,83 h; id 4: −6,25 h), contagens iguais nas
sete tabelas, as colunas antigas de `activity_logs` e as tabelas `ledger`,
`users`, `categories`, `activities` e `timers` idênticas por hash, prévia da
pendência idêntica, `integrity_check` ok e `foreign_key_check` vazio. O
cronômetro aberto, parado depois da migration, virou registro como antes, e a
pendência arbitrada em 1 h creditou 1 h, com `rule_hours` 3 e o motivo gravado.

**Resíduos aceitos.**

- Nenhum `CHECK` amarra `overridden` a `status = 'approved'`: pôr um exigiria
  reconstruir `activity_logs` em produção, e só `approveLog` escreve a coluna.
- `rule_hours` é o que a regra daria **na aprovação**, lendo o que estava
  congelado então (D34). Não recalcula depois, como o resto (D15).
- Os zeros aprovados antes desta decisão passam a aparecer no histórico. Nenhum
  saldo muda: eles nunca tiveram linha no ledger.

---

## A decisão que veio da #25

### D51 — Aviso push em dois gatilhos, e em nenhum outro

Ninguém ficava sabendo de nada sem abrir o app: o adulto não via pendência nova
na fila, e o menino não sabia que o registro dele tinha sido decidido.

**Decisão.** Web Push com VAPID, pela biblioteca `web-push`. Sem Firebase, sem
conta na Apple, sem serviço de terceiros além dos servidores de push dos
próprios navegadores. Exatamente dois gatilhos:

1. **Nasce uma entrada pendente do menino** → aviso para os **dois adultos**
   ativos. Os caminhos são os que já existem: o *Enviar* do cronômetro, a
   sessão que parou sozinha pelo limite ou pela virada do dia (D16, D31), e o
   pedido sem cronômetro (D49). Sessão descartada pelo piso (D44) e abandono não
   avisam: não viram entrada.
2. **O adulto decide uma pendência**, aprovando, com ou sem valor arbitrado
   (D50), ou recusando → aviso **só para o menino dono da entrada**.

Nada mais dispara push: nem o lançamento do adulto (D18), nem liberar, estornar,
editar ou configurar.

- **O texto é curto e fala só da entrada.** "Para aprovar" / "Kid1: Ler livro"
  para o adulto; "Aprovado" / "Ler livro: 1h30" ou "Recusado" / "Ler livro"
  para o menino. Nunca saldo, nunca nada do irmão, e nunca o motivo da recusa,
  que fica no histórico. O toque abre `/admin/fila` para o adulto e `/menino`
  para o menino, focando o app se ele já estiver aberto.
- **O envio não segura a ação.** O server action chama o envio e não espera por
  ele, e a função nunca rejeita: falha no push não derruba nem desfaz nada, e é
  descartada em silêncio (não há `console` em `src/`). O registro é a verdade; o
  aviso é lembrete. Um servidor de push que não responde é cortado em 10 s.
- **A assinatura é do usuário da sessão (D33).** `push_subscriptions` guarda
  usuário, `endpoint`, `p256dh`, `auth` e data, uma linha por `endpoint`, e um
  usuário pode ter várias. O servidor salva para quem está logado; nenhum id vem
  do navegador. O mesmo aparelho salvo por outro login muda de dono. O
  `endpoint` só é aceito em `https`, sem porta, num servidor de push conhecido
  (Google, Apple, Mozilla, Microsoft): o servidor faz POST nele a cada gatilho,
  e sem essa lista um menino logado apontaria esse POST para dentro da rede.
- **Assinatura morta é apagada, e a D14 não se aplica.** Quando o servidor de
  push responde 404 ou 410, a linha sai do banco. A D14 protege linhas para as
  quais o histórico aponta — um registro de três meses atrás precisa saber de
  que atividade veio. Nenhuma tabela aponta para uma assinatura, e um endpoint
  que nunca mais vai funcionar não conta nada a ninguém. Qualquer outra falha
  (429, 5xx, tempo esgotado) mantém a linha.
- **Ativação por toque.** Em `/conta`, o painel "Avisos" mostra o estado deste
  aparelho — ativado, não ativado, bloqueado no aparelho, navegador sem suporte
  (Safari fora do app instalado), servidor sem chave — e o botão "Ativar
  avisos", sem ícone (D42). Nada pede permissão ao carregar: o iOS só aceita o
  pedido a partir de um toque. Com o aviso já ativado, abrir `/conta` salva a
  assinatura de novo para quem está logado.
- **O service worker ganha `push` e `notificationclick`, e continua sem
  `fetch` e sem Cache API.** A D46 fica intacta, e `pwa.test.ts` continua
  reprovando um service worker que escute `fetch`.
- **O ícone do aviso é arte do sistema**, o `icon-192.png` da instalação (D46),
  não ícone de interface. A regra "ícone só na barra de navegação" continua
  falando da interface.
- **Duas variáveis novas, opcionais e sensíveis:** `VAPID_PRIVATE_KEY` e
  `VAPID_SUBJECT` (`mailto:`). Sem elas o app funciona igual e não manda aviso.
  São opcionais porque o deploy é automático (D43): obrigatórias, o merge
  derrubaria a produção até alguém pôr as chaves no Coolify.
  `assert-no-build-secrets.sh` recusa as duas no ambiente do build (D40). Onde
  a D23, a D40 e a D45 dizem "duas variáveis", leia "duas obrigatórias e duas
  opcionais".
- **A chave pública não é variável.** O servidor a calcula da privada
  (`publicKeyOf`). Uma variável à parte podia discordar da privada; e não há
  marcação que sirva a ela: não sensível, o varlock a embute no build (o
  comentário de `DATABASE_PATH` no schema de variáveis mediu isso), e sensível,
  a detecção de vazamento do varlock a barra ao chegar ao navegador.

**Por quê.** Os quatro já têm o app na tela inicial (D46), e o aviso é o que
faltava para a fila andar sem alguém lembrar de abrir. Dois gatilhos porque são
os dois momentos em que alguém está esperando outra pessoa. Tudo o que o adulto
faz sozinho, ele já sabe que fez.

**Considerado e descartado.**

- *Esperar o envio dentro da action.* Um servidor de push lento seguraria o
  toque de *Aprovar* e o *Enviar* do cronômetro.
- *Desativar a assinatura morta em vez de apagar,* por analogia à D14. Uma
  linha inativa que nunca mais pode ser usada é só lixo com data.
- *Avisar a sessão que parou sozinha no instante do corte.* Nada roda sem
  leitura (D16); o aviso sai quando a próxima leitura a registra.

**A migration não move saldo.** `0008` só cria `push_subscriptions` e dois
índices; não reconstrói nem altera outra tabela. Medido num banco construído
com o código anterior (seed, dado de demonstração, uma pendência e um
cronômetro aberto): saldos iguais (id 3: 10,83 h; id 4: −6,25 h), contagens
iguais e as sete tabelas antigas idênticas por hash, `integrity_check` ok e
`foreign_key_check` vazio.

**Resíduos aceitos.**

- Push não é garantia de entrega: modo Foco, bateria, assinatura expirada.
  Nada no app depende de o aviso ter chegado.
- A sessão que parou sozinha avisa quando alguém abre o cronômetro do menino,
  que pode ser horas depois do corte.
- Sair não apaga a assinatura. Num aparelho usado por duas contas, o aviso vai
  para a última que o ativou ou abriu `/conta` nele.
- Falha de envio não deixa rastro: nem log, nem contador.

---

## A decisão que veio da #31

### D52 — Entrada lançada por engano se anula, não se apaga

O dono lançou 3 h para o menino errado, tentou desfazer com um estorno e
estornou do outro. Desfazer era compensar com lançamento novo, e cada erro
virava duas linhas no histórico de dois meninos.

**Decisão.** O adulto **anula** uma entrada. Ela deixa de contar e continua no
banco e no histórico, com quem anulou e quando. Nada é apagado (D14).

- **O que se anula.** Registro aprovado — lançamento do adulto (D18), entrada
  da fila, zero aprovado (D10) — e liberação e estorno. Pendência se decide na
  fila; recusa não moveu nada (D19). Anular de novo é recusado com a frase.
- **Onde mora.** `voided_at` e `voided_by`, nulos, em `activity_logs` e em
  `ledger`. A atividade se anula **no registro**, que é o que o motor lê; a
  liberação e o estorno, que não têm registro, na própria linha do ledger. Uma
  linha de ledger que credita registro, quando pedida, anula o registro. Cada
  fato fica num lugar só.
- **O saldo** soma só o ledger que não está anulado nem credita registro
  anulado. Volta exatamente ao que era antes da entrada.
- **O motor não vê o anulado.** Ele sai do balde do dia (D3), da repetição (D6)
  e da estreia da categoria (D47): o que não aconteceu não gasta torneira do
  que vem depois. Vale para o lançamento, a fila e a calculadora.
- **O passado congelado não se move (D15).** Quem congelou com o anulado dentro
  do balde fica com o valor que tinha.
- **Só o adulto (D33).** A guarda é `requireAdmin` no server action, e o menino
  é lido da entrada, nunca do pedido.
- **Dois toques.** "Anular" embaixo da linha, no histórico do menino aberto
  pelo adulto; a confirmação mostra o saldo antes e depois, os dois do
  servidor, e "Confirmar anulação" escreve.
- **O menino vê a linha no lugar,** com as horas riscadas e "Anulado por
  Admin1 em 25/09/2026. Não conta no saldo." Sem cor (D42): a frase diz, o
  risco reforça.
- **Sem aviso push (D51).**

**Medido,** Mente a 1,5 com passo de 1 h, tudo no mesmo dia
(`src/app/actions/void.test.ts`):

| | 2 h por engano | 1 h real | anula | próxima 1 h real |
|---|---|---|---|---|
| anulando (**esta decisão**) | 2,25 h | 0,38 h | 0,38 h fica | **0,75 h** |
| sem o engano | — | 1,50 h | — | 0,75 h |
| o engano continuando no balde | 2,25 h | 0,38 h | — | 0,19 h |

A hora congelada com o engano dentro perde 1,12 h e não é recalculada. Se o
adulto quiser devolver, é um estorno, com motivo.

**Considerado e descartado.**

- *Apagar a linha.* O ledger é o que sustenta o saldo; sem a linha ninguém
  reconstrói por que ele mudou.
- *Um `status` novo, `voided`.* Exigiria reconstruir `activity_logs` em
  produção e derrubar o gatilho que não deixa registro creditado sair de
  `approved` (`0001`).
- *Manter o anulado no balde, como o valor arbitrado da D50.* A D50 conta a
  atividade porque ela aconteceu. A anulada não aconteceu: contar puniria a
  hora real seguinte do menino, 0,19 h em vez de 0,75 h.
- *Recalcular o que congelou depois.* É o que a D15 proíbe.

**A migration não move saldo.** `0009` só adiciona as quatro colunas nulas,
com `ALTER TABLE`: não reconstrói tabela nem toca em linha. Medido num banco
construído com o código anterior (seed, dado de demonstração, uma pendência e
um cronômetro aberto): saldos iguais (id 3: 10,83 h; id 4: −6,25 h) pela
consulta antiga e pela nova, contagens iguais nas oito tabelas, colunas
antigas idênticas por hash, prévia da pendência idêntica, `integrity_check` ok
e `foreign_key_check` vazio.

**Resíduos aceitos.**

- Anular não se desfaz. Anulou errado, lança de novo.
- Sem janela de tempo: dá para anular entrada de qualquer dia. O saldo muda
  hoje, inclusive para baixo de zero.
- A linha anulada fica na data em que a entrada aconteceu. Anular algo de
  semanas atrás muda o saldo de hoje por uma linha que o menino pode não ver
  sem rolar.
- A hora congelada com o engano no balde fica paga a menos (tabela acima).
- Nenhum `CHECK` amarra `voided_at` a `voided_by`, nem proíbe anular no ledger
  uma linha que credita registro: seria reconstruir as duas tabelas, e só
  `voidEntry` escreve as colunas.
