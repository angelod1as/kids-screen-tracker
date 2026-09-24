> **Anexo histórico.** Esta é a especificação original, preservada como registro
> da intenção. Ela contém pontos ambíguos e ao menos uma contradição interna, que
> foram resolvidos em [`decisions.md`](./decisions.md).
>
> **Onde os dois discordarem, `decisions.md` vence.** Em particular:
>
> - o modelo de desgaste descrito abaixo (`full_up_to` / `half_up_to`, faixas em
>   horas de tela, janela semanal) foi substituído por `decay_step_hours` — ver
>   D1, D2 e D4;
> - o app **não rastreia o que está configurado nos aparelhos** — ver D41. A
>   tabela `regimes`, a tela **Regimes**, a lista de regimes ativos na tela do
>   menino, o atalho depois da liberação e o terceiro lugar de cor descritos
>   abaixo não existem mais. Cor carrega significado em **dois** lugares.
> - o desenho não é mais só preto e branco, e o desktop não é mais só a versão
>   mobile centralizada — ver D42 e [`design.md`](./design.md). A paleta, os
>   cantos arredondados e os ícones do menu são a direção escolhida pelo dono.

---

# Prompt original para o Claude Code

Construa uma aplicação web para gerir o tempo de tela de dois adolescentes.

## Contexto

Dois administradores gerenciam o tempo de eletrônicos de dois
meninos. Os meninos ganham horas de tela fazendo atividades fora
da tela. Não existe integração com Family Link, Xbox ou PlayStation: os adultos
leem o saldo no app e configuram os aparelhos na mão. O app é a **fonte única de
verdade do saldo** e nada mais.

O sistema tem atrito por natureza, então a interface precisa ser **rápida e
direta**. Se uma operação comum levar mais de dois toques, o desenho está errado.

## Processo

- Git desde o primeiro commit
- Uma branch por fase, PR para `main`, sem push direto na main
- Deploy a partir das branches para ambiente de teste; `main` é produção
- Conventional commits

## Stack

- **Next.js (App Router) + TypeScript + React**, server actions para mutações
- **SQLite** com **Drizzle ORM** (`better-sqlite3`), arquivo em volume persistente
- **Tailwind CSS**
- **Varlock** para gerenciar `.env.schema` e a validação das variáveis de ambiente
- **Dockerfile** para deploy no **Coolify**. Multi-stage, imagem final enxuta,
  volume declarado para o arquivo do SQLite — o banco não pode morrer no redeploy
- Sem serviços externos, sem fila, sem cache, sem Redis

## Autenticação

Deliberadamente simples. Quatro usuários fixos, senhas em variáveis de ambiente,
declaradas no `.env.schema` do Varlock:

```
AUTH_ADMIN1
AUTH_ADMIN2
AUTH_KID1
AUTH_KID2
SESSION_SECRET
DATABASE_PATH
```

Login com nome de usuário e senha, comparação direta, sessão em cookie httpOnly
assinado com validade longa (30 dias) — ninguém quer relogar toda hora no
celular. Sem cadastro, sem recuperação de senha, sem OAuth.

Dois papéis: `admin` e `kid`. Os usuários existem
no banco para as foreign keys; as senhas ficam só nas env vars.

**Regra de acesso:** kid vê e simula apenas os próprios dados, e nunca vê o saldo
do outro. Kid não altera nada — a única escrita que ele faz é propor um registro
de atividade via cronômetro. Admin vê e altera tudo dos dois.

## Modelo de dados

### `users`

`id`, `username`, `display_name`, `role` ('admin' | 'kid'), `active`

Seed com os quatro.

### `categories`

`id`, `name`, `base_rate` (horas de tela por hora de atividade), `full_up_to`,
`half_up_to`, `return_bonus_pct`, `return_bonus_after_days`, `decay_enabled`,
`sort_order`, `active`

> Substituído — ver D2. `full_up_to`, `half_up_to` e `decay_enabled` deixam de
> existir; entra `decay_step_hours`.

`full_up_to` e `half_up_to` são expressos em **horas de tela geradas pela
categoria naquela semana** — não em horas de atividade. Acima de `half_up_to`, o
valor cai para um quarto.

### `activities`

`id`, `category_id`, `name`, `calc_mode`, `value`, `max_session_minutes`,
`quality_graded` (bool), `repeat_cooldown_days`, `sort_order`, `active`

`calc_mode`:

- `duration` — valor = horas × `value` (onde `value` é a taxa; normalmente igual
  ao `base_rate` da categoria, mas sobrescrevível por atividade, como HQ a 1,5)
- `fixed` — valor = `value`, independente de duração
- `delivery` — valor = `value` × nota de qualidade
- `free` — valor digitado pelo admin no momento do lançamento (curinga)

### `activity_logs`

`id`, `user_id`, `activity_id`, `status` ('pending' | 'approved' | 'rejected'),
`source` ('timer' | 'admin'), `occurred_on` (date), `started_at`, `ended_at`,
`duration_minutes`, `quality` (nullable), `free_value` (nullable),
`computed_hours`, `note`, `created_by`, `reviewed_by`, `created_at`, `reviewed_at`

### `ledger`

`id`, `user_id`, `kind` ('earn' | 'spend' | 'refund'), `hours` (decimal, sempre
positivo), `occurred_on`, `destination` (nullable, texto livre: "WhatsApp",
"Xbox", "TV"), `note`, `activity_log_id` (nullable), `created_by`, `created_at`

Saldo = soma dos `earn` + `refund` menos os `spend`. **Pode ficar negativo, sem
limite.**

### `regimes`

`id`, `user_id`, `label`, `hours_per_day`, `active`, `started_on`, `note`

Puramente informativo — **não debita nada automaticamente**. Existe para o app
mostrar ao menino e ao adulto o que está configurado nos aparelhos agora, para
que ninguém esqueça de desligar.

### `timers`

`id`, `user_id`, `activity_id`, `started_at`, `paused_at`,
`accumulated_seconds`, `status` ('running' | 'paused' | 'stopped' | 'abandoned')

Estado no servidor, não no browser: fechar a aba não pode perder o cronômetro.

## O motor de cálculo

Isole isso numa função pura, sem I/O, e **escreva testes unitários cobrindo cada
caso abaixo**. A mesma função serve o simulador e o lançamento real — nunca
duplique a lógica.

Assinatura conceitual: dado um usuário, uma atividade, uma duração ou nota, uma
data e o histórico aprovado da semana, retorne as horas ganhas **e uma lista de
linhas explicando o cálculo** (a explicação aparece na tela, é parte do produto).

Ordem de aplicação:

1. **Valor base**, conforme o `calc_mode`.
2. **Nota de qualidade**, se `quality_graded`. Valores: 0 · 0,3 · 0,5 · 0,7 · 1,0.
3. **Cooldown de repetição**: se a mesma atividade já foi aprovada para esse
   usuário nos últimos `repeat_cooldown_days`, multiplique por 0,5.
4. **Degrau de desgaste da categoria** — ver D1, D2 e D4; substituído por queda
   geométrica diária indexada por hora de atividade.
5. **Bônus de retorno**: se `return_bonus_pct > 0` e não houver nenhum log
   aprovado dessa categoria para esse usuário nos últimos
   `return_bonus_after_days`, multiplique por (1 + pct). Aplica-se apenas ao
   primeiro lançamento da volta.

**Semana** era fixa, de domingo a sábado, no fuso `America/Sao_Paulo` — janela
removida em D4. O balde passou a ser diário.

**Congelamento:** `computed_hours` é gravado no momento da aprovação e nunca é
recalculado retroativamente. Se um admin editar um log antigo, recalcule só
aquele log, usando o histórico do dia em que ele ocorreu. Lançamentos posteriores
não se movem.

## Telas

### Menino

**Início** — o saldo em número enorme, dominando a tela. Abaixo: regimes ativos
("WhatsApp 2h/dia, ligado desde terça"), com destaque de alerta se houver regime
ativo e saldo zero ou negativo. Botão grande para iniciar cronômetro. Últimos
cinco lançamentos.

**Cronômetro** — escolhe a atividade, começa. Enquanto roda, mostra o tempo
decorrido, um botão de pausar e um de parar. A pausa existe para interrupções
reais (almoço, alguém chamou) e não conta tempo. **Nada interrompe o menino
durante a sessão** — sem confirmação periódica, sem alerta, sem notificação. Ao
parar, ele confirma o que fez e o registro vai para a fila de aprovação como
`pending`. Se o tempo ativo passar de `max_session_minutes`, o cronômetro para
sozinho naquele limite e o registro é criado normalmente, marcado como
auto-parado. Cronômetro pausado por mais de 12 horas vira `abandoned` e não gera
registro.

**Calculadora** — escolhe uma atividade e uma duração, e vê exatamente quanto
ganharia **agora**, com as linhas de explicação. É por aqui que eles aprendem o
sistema.

**Histórico** — lista simples do que foi lançado, ganho e gasto.

### Admin

**Início** — saldo dos dois lado a lado, contador de pendências em destaque, e
atalhos para as três ações do dia a dia.

**Fila de aprovação** — cada item com um toque para aprovar. Editar duração, nota
ou atividade antes de aprovar. Rejeitar com motivo opcional.

**Lançar atividade** — escolhe menino, atividade, duração ou nota, data. Mostra o
valor calculado antes de confirmar. Para atividades `free`, digita o valor.

**Liberar horas** — escolhe menino, quantidade, destino opcional. Confirma e
debita. Depois de confirmar, mostra um lembrete do que fazer nos aparelhos, e um
atalho para registrar isso como regime ativo.

**Estornar** — lança um `refund` com data e motivo.

**Regimes** — ligar, desligar, editar. Mostra há quantos dias cada um está ligado.

**Configuração** — CRUD completo de categorias e atividades, incluindo todas as
taxas, limiares, bônus e cooldowns. Isso é requisito central, não secundário: a
tabela vai mudar muito nos primeiros meses e não pode exigir deploy.

## Design

Mobile-first e pra valer: os administradores usam iPhone e os meninos, Android.
Desktop pode ser só a versão mobile centralizada.

- **Alto contraste.** Preto sobre branco, ou branco sobre preto. Nada de cinza
  sobre cinza.
- **Sem animação decorativa.** Sem fade, sem transição de página, sem
  microinteração. Spinner e skeleton são permitidos e desejáveis onde há espera
  real de carregamento — indicar estado é informação, não enfeite.
- **Tipografia grande.** O saldo é o maior elemento da tela do menino, por larga
  margem.
- **Alvos de toque de no mínimo 48px.**
- Cor só carrega significado em três lugares: pendência, saldo negativo e alerta
  de regime ativo sem saldo.
- Português do Brasil em toda a interface. Identificadores e comentários em
  código, em inglês.

## Fases

Uma branch e um PR por fase.

- **Fase 0 — Fundação.** Repo privado, Project e issues, Dockerfile, Coolify,
  Varlock e `.env.schema`, workflow do Claude copiado do Positiv, CI rodando
  testes no PR.
- **Fase 1 — Núcleo.** Schema Drizzle, migrations, seed, e o motor de cálculo com
  testes. Não avance enquanto os testes não passarem: é a parte do sistema em que
  um erro silencioso destrói a confiança dos meninos, e confiança aqui é o produto
  inteiro.
- **Fase 2 — Auth e shell.** Login, sessão, papéis, guardas de rota, layout base.
- **Fase 3 — Menino.** Início, histórico e calculadora.
- **Fase 4 — Cronômetro e fila.** Cronômetro com pausa e auto-parada, e a fila de
  aprovação do admin.
- **Fase 5 — Admin.** Lançar, liberar, estornar, regimes.
- **Fase 6 — Configuração.** CRUD de categorias e atividades.
- **Fase 7 — Acabamento.** Revisão de contraste e alvos de toque no aparelho real,
  estados vazios, tratamento de erro, e um comando de backup do arquivo SQLite.

## Next steps (não construir agora)

- Notificação push — avisar o admin de pendência na fila e o menino quando um
  registro é aprovado
- Dashboard analítico — horas por categoria ao longo do tempo, evolução do saldo,
  atividades mais e menos usadas, para calibrar a tabela com dado em vez de
  palpite

## Fora de escopo

Não construa: PWA offline, integração com qualquer API de controle parental,
suporte a mais de uma família, recuperação de senha, tema escuro alternável,
internacionalização.

## Seed inicial

Popule o banco com as categorias e atividades abaixo. Os números vão mudar — eles
existem para o app abrir funcionando.

> Os limiares semanais abaixo foram substituídos por `decay_step_hours` diário —
> ver a tabela de calibragem em `decisions.md`.

**Corpo** — taxa 2,0 · cheio até 16h de tela na semana · metade até 24h · bônus de
retorno 50% após 3 dias
Futebol ou outro esporte coletivo · Bicicleta · Corrida ou caminhada · Treino em
casa
*(todas `duration`, sessão máxima de 180 min)*

**Mente** — taxa 2,0 · cheio até 16h · metade até 24h · bônus 50% após 3 dias
Ler livro (2,0) · Ler quadrinhos ou HQ (1,5) · Jogo de tabuleiro, xadrez ou
baralho (2,0) · Curso ou aula extra (2,0)
*(todas `duration`, sessão máxima de 120 min)*

**Criativo** — taxa 2,0 · cheio até 12h · metade até 20h · bônus 50% após 3 dias
Escrever · Praticar instrumento · Desenhar ou pintar · Cozinhar uma refeição ·
Montar, consertar, marcenaria · Quebra-cabeça
*(todas `duration`, sessão máxima de 120 min)*

**Convívio** — cheio até 10h · metade acima · **sem bônus de retorno**
Sair com os amigos (`fixed` 3h) · Passar o dia inteiro fora (`fixed` 5h) · Ir na
casa de um amigo (`fixed` 2h) · Dormir na casa de amigo ou parente (`fixed` 3h) ·
Igreja, servir (`fixed` 3h) · Igreja, culto (`fixed` 1h) · Conexão (`fixed` 2h) ·
Atividade extra na escola (`fixed` 2h)

**Escola** — cheio até 8h · metade acima · sem bônus de retorno
Lição de casa do dia (`delivery` 1h, com nota) · Trabalho entregue antes do prazo
(`fixed` 2h) · Estudo para prova (`duration`, taxa 1,0, sessão máxima 180 min)

**Casa** — cheio até 10h · metade acima · sem bônus de retorno · cooldown de 7
dias em todas
Lavar o carro (`delivery` 3h) · Lavar a garagem (`delivery` 3h) · Ajudar em
mudança ou reforma (`delivery` 3h) · Limpar a churrasqueira (`delivery` 2h) ·
Organizar o quarto a fundo (`delivery` 2h) · Quarto arrumado, verificação semanal
(`delivery` 2h)

**Curinga** — sem desgaste, sem bônus
Atividade avulsa (`free`)
