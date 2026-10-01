# APK para side-load

O "Quanto Tempo Vale?" como aplicativo Android próprio, para o Family Link
listar o app separado do Chrome. É um **TWA** (Trusted Web Activity) gerado
com o [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap), o CLI do
Google, e instalado por side-load: nada passa pela Play Store. Decisão: D54.

**O APK é uma casca.** Ele abre o site publicado, então deploy novo não pede
APK novo nem reinstalação. Instala uma vez.

O repositório é público: domínio, nome do pacote, chave e senhas vêm do
ambiente da sua máquina e do Coolify, nunca daqui.

| arquivo | papel |
|---|---|
| `twa-manifest.template.json` | Nome, cores, ícones. Sem domínio, pacote nem chave. |
| `build.sh` | Preenche o modelo e roda o Bubblewrap. Saída em `twa/build/`, ignorada pelo git. |

## Gerar de novo só quando

- mudar o domínio, o nome do pacote, o nome visível ou o ícone;
- trocar a chave;
- o arquivo `.apk` se perder e outro telefone precisar dele.

Para atualizar um app já instalado, use **a mesma chave** e um `TWA_VERSION`
maior que o anterior. Com chave diferente, o Android recusa: desinstale e
instale de novo.

## 1. Criar a chave (uma vez)

Precisa do `keytool`, que vem com qualquer JDK. Se ainda não tiver um, faça o
passo 4 primeiro até o Bubblewrap instalar o JDK, e use o `keytool` de lá.

```sh
mkdir -p ~/qtv-apk
keytool -genkeypair -v \
  -keystore ~/qtv-apk/qtv.keystore \
  -alias qtv \
  -keyalg RSA -keysize 2048 -validity 10000
```

O `keytool` pede duas senhas (a do arquivo e a da chave) e um nome. **Guarde o
arquivo e as duas senhas num gerenciador de senhas**, com cópia fora deste
computador. Sem a chave, o app instalado não recebe atualização: só
desinstalando.

Nunca coloque a chave dentro do repositório. O `.gitignore` recusa `*.keystore`,
`*.jks` e `*.apk` por segurança, mas a regra é não pôr.

## 2. Escolher o nome do pacote

Um identificador no formato `a.b.c`, que nunca mais muda, por exemplo
`app.quantotempovale.twa`. Não use nome de pessoa nem o domínio.

## 3. Avisar o servidor (Coolify)

Tire a impressão digital da chave:

```sh
keytool -list -v -keystore ~/qtv-apk/qtv.keystore -alias qtv | grep SHA256:
```

No Coolify, nas variáveis da aplicação:

| variável | valor |
|---|---|
| `TWA_PACKAGE_ID` | o nome do pacote do passo 2 |
| `TWA_SHA256_FINGERPRINTS` | o `AA:BB:...` depois de `SHA256:`. Mais de uma, separe por vírgula. |

Faça um redeploy, ou só reinicie a aplicação: as variáveis são lidas no start.
Sem elas, o app funciona igual e `/.well-known/assetlinks.json` responde `[]`.

Confira:

```sh
curl https://SEU-DOMINIO/.well-known/assetlinks.json
```

Depois, no [verificador do Google](https://developers.google.com/digital-asset-links/tools/generator),
preencha domínio, pacote e impressão digital e toque em "Test statement". Ele
só lê o arquivo público do servidor; nada é enviado.

## 4. Gerar o APK

Precisa de Node 22. Na primeira vez, o Bubblewrap pergunta se pode baixar o
JDK 17 e o Android SDK (alguns GB): responda que sim. Depois ele aceita as
licenças do SDK e segue.

```sh
TWA_HOST=seu-dominio.com \
TWA_PACKAGE_ID=app.quantotempovale.twa \
TWA_KEYSTORE=~/qtv-apk/qtv.keystore \
./twa/build.sh
```

Opcionais: `TWA_KEY_ALIAS` (padrão `qtv`) e `TWA_VERSION` (padrão `1`).

O Bubblewrap baixa o ícone de `https://SEU-DOMINIO/icon-512.png` e o maskable,
os mesmos do app instalável (D46). Por isso o site precisa estar no ar. Ele
pede as duas senhas da chave e termina com:

- `twa/build/app-release-signed.apk`, o arquivo para instalar;
- a impressão digital, que precisa ser a mesma do passo 3.

## 5. Instalar no telefone

1. Copie o `app-release-signed.apk` para o telefone (cabo, Drive ou e-mail para
   você mesmo).
2. Abra o arquivo pelo app de arquivos. O Android pede para permitir
   "instalar apps desconhecidos" para aquele app: permita, instale e depois
   desligue a permissão de novo.
3. Se a supervisão do Family Link impedir a instalação, anote o que apareceu na
   tela: é medição para a D54.

## 6. Conferir

- O app abre **em tela cheia, sem barra de endereço**. Se aparecer a barra,
  o `assetlinks.json` não bate com o pacote ou com a chave: volte ao passo 3.
- Login, saldo e "Ativar avisos" funcionam como no navegador. No Android 13 ou
  mais novo, o sistema pede permissão de notificação para o app.

## 7. O teste do Family Link

TWA usa o Chrome por baixo. **O risco é o app morrer junto se o Family Link
bloquear o Chrome.**

1. Com o app instalado e funcionando, bloqueie o Chrome no Family Link.
2. Feche o app de vez e abra de novo.
3. Anote o que aconteceu: abriu normal, abriu sem tela cheia, não abriu, ou
   mostrou aviso do Family Link.

O resultado vai na D54. Se o app morrer junto, o caminho é um wrapper com
WebView, que não depende do app Chrome mas perde o aviso push (D51). Isso é
issue nova, não ajuste neste APK.
