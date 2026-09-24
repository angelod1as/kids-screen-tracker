# Deploy

Como a imagem é construída, como o banco é criado e como uma migration nova é
aplicada num container que já está no ar.

O deploy em si (Coolify) está bloqueado pela **D24** — não há URL nem token da
instância. O que este documento descreve funciona em qualquer máquina com
Docker, e é exatamente o que a issue #7 vai amarrar no painel quando destravar.

## Build

```sh
docker build --tag kids-screen-tracker .
```

Sem `--build-arg`, sem segredo, sem login em registry. O `next build` roda
dentro da imagem contra os valores de placeholder escritos no próprio
`Dockerfile`, e isso **continua sendo regra**, não detalhe de conveniência.

Até a #60, o grafo de ambiente resolvido era gravado em texto puro dentro de
`.next/`, com as senhas junto, apesar do `@sensitive`. Eram três caminhos:

- a integração do varlock com o Next prefixa todo `[turbopack]_runtime.js` com
  `process.env.__VARLOCK_ENV = process.env.__VARLOCK_ENV || "<grafo>"`, um
  fallback para servidor iniciado sem varlock (o `@sensitive` só controla o
  `ENV.X` inlinado, não isso);
- o `output: "standalone"` copia o `.env` para `.next/standalone/.env`;
- o cache persistente do Turbopack no build (`.next/cache/turbopack`) guardava
  o ambiente do processo.

Hoje o `pnpm build` roda `scripts/strip-build-env.mjs` depois do `next build`,
que tira a linha do fallback e apaga o `.env` copiado, e o cache do Turbopack no
build está desligado em `next.config.base.ts`. Nada disso muda o runtime: o
`CMD` roda `varlock run`, que define `__VARLOCK_ENV` antes de o servidor
carregar, então o fallback nunca é usado.

O `strip-build-env.mjs` também reprova o build se, depois de limpar, algum `.js`
ainda atribuir um literal a `__VARLOCK_ENV`, ou se não houver nenhum
`[turbopack]_runtime.js` para limpar — é assim que uma mudança de formato numa
atualização do varlock aparece, em vez de passar em silêncio.

O que segura isso (D40):

- **CI:** `pnpm check:secrets` reprova o job de build se o valor de qualquer
  item `@sensitive` aparecer em qualquer arquivo sob `.next/`, e também se
  `.next/` estiver vazio. Imprime só arquivo e nome da variável.
- **Dockerfile:** `scripts/assert-no-build-secrets.sh` roda no começo de cada
  estágio, antes de qualquer outro `RUN`, e reprova o build se
  `SESSION_SECRET` ou `DATABASE_PATH` estiverem no ambiente do build
  com qualquer valor que não seja o do próprio `Dockerfile`. Imprime só o nome.
- **Smoke, passo 12:** o placeholder do build não está em lugar nenhum de
  `/app/.next` dentro da imagem.
- **Smoke, passo 13:** `docker history --no-trunc` e `docker image inspect` só
  atribuem às duas variáveis valores escritos no próprio `Dockerfile`.
- **Smoke, passo 14:** uma cópia do `Dockerfile` com `ARG` depois de cada
  `FROM`, como o Coolify faz, é recusada pela guarda, sem imprimir valor e sem
  deixar imagem.

Mesmo assim, o build não roda com os valores reais: a verificação do `.next`
procura o valor literal, e um valor comprimido ou codificado de outro jeito
passaria por ela; e o histórico de uma imagem registra o ambiente de cada `RUN`.
O `.dockerignore` mantém o `.env` do dono fora do contexto (D23).

### Coolify

No padrão, o Coolify marca toda variável como **"Available at Buildtime"** e
insere `ARG NOME=valor` depois de **cada** `FROM` do `Dockerfile`, inclusive o
do estágio `runner`. O `.next` continua limpo, mas cada `RUN` seguinte grava o
valor no histórico da imagem final, e `docker history --no-trunc` lê as senhas e
o `SESSION_SECRET` de volta. Medido numa simulação dessa injeção sobre o
`Dockerfile` anterior à #60: `SESSION_SECRET` e os quatro `AUTH_*` em quatro
entradas do histórico cada um.

Por isso:

- As duas variáveis ficam com **"Available at Buildtime" desmarcado** — só
  runtime. A imagem não precisa de nenhuma delas no build: os placeholders estão
  no `Dockerfile`.
- Esquecer o checkbox não gera imagem: a guarda recusa o build no primeiro `RUN`
  e o log do deploy nomeia a variável, sem o valor.
- Depois do primeiro deploy, confira no host:

  ```sh
  docker history --no-trunc <imagem> \
    | grep -oE '(SESSION_SECRET|DATABASE_PATH)=[^ ]*' | sort -u
  ```

  Só podem aparecer `SESSION_SECRET=docker-build-placeholder-never-a-real-secret`,
  `DATABASE_PATH=/data/kids.db` e
  `DATABASE_PATH=/tmp/build-check/kids.db`. É o mesmo teste do passo 13 do
  smoke. Rode o comando num terminal seu: se algo diferente aparecer, a saída
  mostra o valor.

Nenhum valor do build sobrevive ao runtime: o `CMD` roda `varlock run`, que
resolve as duas variáveis de novo a cada start.

## Variáveis

As duas de `.env.schema`, ambas obrigatórias. Senha não é variável: mora na
tabela `users` (D45, ver "Usuários" abaixo).

| variável | observação |
|---|---|
| `DATABASE_PATH` | a imagem já define `/data/kids.db`. Só mude junto com o volume. |
| `SESSION_SECRET` | `openssl rand -base64 48` |

Faltando qualquer uma, o container **não sobe**: `varlock run` nomeia o item que
está vazio e sai com 1. É proposital, e o CI testa esse caso.

## Volume

O arquivo do SQLite mora em `/data`, declarado como `VOLUME` no `Dockerfile`. O
banco é a fonte única de verdade do saldo — se ele estiver numa camada da
imagem, o próximo deploy apaga tudo.

```sh
docker volume create kids-screen-tracker-data
```

## Subir

```sh
docker run --detach --name kids-screen-tracker \
  --restart unless-stopped \
  --publish 3000:3000 \
  --volume kids-screen-tracker-data:/data \
  --env SESSION_SECRET=... \
  kids-screen-tracker
```

O `--restart unless-stopped` é o par do `HEALTHCHECK`: um `ENV.` lido de um
arquivo `"use client"` só quebra na primeira requisição, e ali o varlock derruba
o processo inteiro. O healthcheck vê isso, o restart transforma numa piscada.

## Migration e seed

Os dois comandos existem **dentro da imagem publicada**, sem `tsx`, sem `src/`,
sem toolchain:

```sh
# aplica as migrations pendentes
docker exec kids-screen-tracker \
  node node_modules/varlock/bin/cli.js run -- node dist/db/db-migrate.mjs

# migra e depois escreve o que faltar do seed
docker exec kids-screen-tracker \
  node node_modules/varlock/bin/cli.js run -- node dist/db/db-seed.mjs
```

Os dois são idempotentes. `db-migrate` lê `__drizzle_migrations` e aplica só o
que falta; `db-seed` migra primeiro e insere só as linhas do seed que ainda não
existem. Rodar de novo num banco já pronto não muda nada — verificado no smoke.

**Primeiro deploy:** rode só `db-seed.mjs`. Ele cria o schema do zero e insere as
sete categorias e as trinta e duas atividades. As pessoas não: veja "Usuários".

**Todo deploy depois:** rode `db-migrate.mjs` depois de subir a imagem nova.

> O caminho do banco aparece mascarado na saída (`/d▒▒▒▒▒`). Não é erro:
> `DATABASE_PATH` é `@sensitive` no `.env.schema` e o varlock censura valores
> sensíveis no console. Ver `.env.schema` para o porquê da marcação.

### Sem um container de pé

Se a app não sobe — por exemplo, uma migration precisa rodar antes de a primeira
rota funcionar — dá para rodar o CLI num container descartável, no mesmo volume:

```sh
docker run --rm \
  --volume kids-screen-tracker-data:/data \
  --env SESSION_SECRET=... \
  kids-screen-tracker \
  node node_modules/varlock/bin/cli.js run -- node dist/db/db-seed.mjs
```

O `varlock run` valida as duas mesmo quando só o banco é tocado, então elas
precisam estar presentes aqui também.

## Usuários

A tabela `users` só se edita à mão, com SQL no arquivo do banco (D45). Nenhuma
tela, rota ou script do app escreve nela. Sem `password_hash`, ninguém entra.

**1. Gere o hash no seu computador**, num clone do repositório. Nada é gravado e
nenhum banco é aberto; a senha digitada não aparece na tela:

```sh
pnpm auth:hash
# Senha:
# De novo:
# scrypt$16384$8$5$<salt>$<hash>
```

**2. Rode o SQL no container**, pelo `better-sqlite3` da própria imagem (a
imagem não tem o CLI `sqlite3`). O SQL vai pelo stdin:

```sh
docker exec -i kids-screen-tracker node -e '
  const Database = require("/app/node_modules/better-sqlite3");
  new Database(process.env.DATABASE_PATH).exec(require("node:fs").readFileSync(0, "utf8"));
' <<'SQL'
UPDATE users SET password_hash = 'scrypt$16384$8$5$...' WHERE id = 1;
SQL
```

O smoke do CI roda este mesmo comando. No terminal do container no Coolify, rode
só o `node -e '…' <<'SQL'`, sem o `docker exec -i kids-screen-tracker`.

Exemplos:

```sql
-- quem existe e quem já tem senha
SELECT id, username, display_name, role, active, password_hash IS NOT NULL AS tem_senha FROM users;

-- trocar a senha de alguém; o id nunca muda, o ledger aponta para ele
UPDATE users SET password_hash = 'scrypt$...' WHERE id = 3;

-- pessoa nova; username em minúsculas (o login ignora maiúsculas, não acentos), de preferência sem acento
INSERT INTO users (username, display_name, role, password_hash)
VALUES ('nome', 'Nome', 'kid', 'scrypt$...');

-- tirar o acesso sem apagar (D14)
UPDATE users SET active = 0 WHERE id = 3;
```

`role` é `admin` ou `kid`. Nunca `DELETE`: o ledger e os registros apontam para
o `id`.

### Por que não roda sozinho no start

Foi a terceira opção listada na issue #44 e ficou de fora de propósito. Com
`--restart unless-stopped`, uma migration que falha vira crash-loop: o container
morre, o Docker sobe outro, a migration falha de novo, e o que aparece no painel
é um serviço reiniciando sem nada legível. Separado, uma migration que falha
falha uma vez, com a mensagem inteira, e a app continua servindo a versão velha
do schema enquanto alguém olha.

O custo é ter que lembrar de rodar. É um comando por deploy, num app de quatro
usuários, e está escrito aqui.

## Rodar o smoke localmente

O mesmo script que o CI roda em todo pull request:

```sh
docker build --tag kids-screen-tracker:ci .
./scripts/docker-smoke.sh kids-screen-tracker:ci
```

Ele sobe containers e cria um volume próprios, e apaga os dois no fim. Numa
máquina que já tem outros containers rodando, `SMOKE_PREFIX` renomeia tudo que
ele cria e `SMOKE_PORT` muda a porta publicada:

```sh
SMOKE_PREFIX=meu-smoke SMOKE_PORT=41337 ./scripts/docker-smoke.sh kids-screen-tracker:ci
```

Nenhum valor real entra nele. Os que ele usa estão escritos no próprio arquivo.

## Backup e restauração

O banco roda em `journal_mode = WAL` (`src/db/client.ts`), o que é exatamente o
que torna `cp` do arquivo perigoso: o estado do banco fica dividido entre
`kids.db` e o `kids.db-wal` enquanto uma escrita não é sincronizada de volta
("checkpoint"), e copiar só o primeiro arquivo com o container no ar pode
produzir um `.db` que não abre. `pnpm db:backup` nunca copia o arquivo — ele
roda `VACUUM INTO` dentro do próprio SQLite, que lê um instantâneo consistente
através do MVCC do banco e escreve um arquivo novo e independente, mesmo com
outra conexão no meio de uma transação de escrita. É por isso que o comando
funciona com a app no ar.

```sh
# dentro do container: grava em qualquer caminho de /data, o mesmo volume
# persistente do banco (a saída mascara DATABASE_PATH — ver o aviso em
# "Migration e seed" acima)
docker exec kids-screen-tracker \
  node node_modules/varlock/bin/cli.js run -- node dist/db/db-backup.mjs /data/backup-2026-09-16.db

# copia o arquivo do container para a máquina que está fazendo o backup, e
# apaga a cópia que ficou dentro do volume — ela não precisa continuar lá
docker cp kids-screen-tracker:/data/backup-2026-09-16.db ./backup-2026-09-16.db
docker exec kids-screen-tracker rm -f /data/backup-2026-09-16.db
```

`db-backup.mjs` se recusa a rodar se o destino já existir — um caminho digitado
errado nunca sobrescreve um backup anterior. O arquivo gerado é um `.db` comum,
sem `-wal`/`-shm` ao lado: `VACUUM INTO` sempre escreve um banco novo e
autocontido, então não há arquivo auxiliar para copiar junto.

**Onde guardar a cópia.** O arquivo não carrega senha nem sessão — isso vive só
no ambiente e no cookie assinado (D23) — mas carrega o histórico e o saldo dos
dois meninos, legível em qualquer leitor de SQLite. Guarde-o fora do alcance
das contas do Kid1 e do Kid2, nunca numa pasta que os aparelhos deles
sincronizam.

### Restauração

Antes de restaurar, tire um backup do estado atual com o comando acima:
restaurar descarta, sem deixar rastro no `ledger`, tudo que aconteceu depois do
momento do backup que está voltando — inclusive uma penalidade ou uma
reprovação que alguém prefira desfazer de outro jeito.

```sh
# 1. derruba o container
docker stop kids-screen-tracker

# 2. com o container parado, um container descartável no mesmo volume troca o
# banco e limpa o que sobrar do WAL antigo — rodando como o mesmo usuário
# `node` que a app usa, porque um `docker cp` direto para dentro do container
# parado gravaria o arquivo com o dono do host, e a app não conseguiria
# escrever nele depois de subir (USER node no Dockerfile)
docker run --rm --user node \
  --volume kids-screen-tracker-data:/data \
  --volume "$(pwd)/backup-2026-09-16.db:/restore.db:ro" \
  kids-screen-tracker \
  sh -c 'rm -f /data/kids.db-wal /data/kids.db-shm && cp /restore.db /data/kids.db'

# 3. sobe de novo
docker start kids-screen-tracker
```

`docker exec` não serve para o passo 2: o container já está parado pelo passo
1, e `docker exec` só funciona em container em execução. Por isso o passo 2 usa
um container descartável no mesmo volume nomeado, o mesmo padrão de "Sem um
container de pé" mais acima — só que aqui ele também troca o arquivo, não só
roda um CLI.

**Sobre o WAL na restauração.** Um `kids.db-wal` deixado pelo banco antigo
guarda páginas escritas relativas *àquele* arquivo `kids.db` — trocar o
`kids.db` por baixo sem apagar o `-wal` faz a próxima conexão reaplicar páginas
do banco errado por cima do banco restaurado, em silêncio: sem erro, sem
`integrity_check` reprovando, só o saldo de antes da restauração de volta. O
backup em si nunca tem esse problema, porque `VACUUM INTO` não produz
`-wal`/`-shm`; o risco é só o do banco que está sendo substituído. Rodar a
limpeza com o container já parado, como no passo 2, dispensa checkpoint — não
há conexão viva para sincronizar nada, e apagar os dois arquivos é sempre
seguro nesse ponto.
