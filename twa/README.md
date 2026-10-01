# APK para side-load

O "Quanto Tempo Vale?" como aplicativo Android próprio, para o Family Link
listar o app separado do Chrome. É um **TWA** (Trusted Web Activity) gerado
com o [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap), do Google,
e instalado por side-load: nada passa pela Play Store. Decisão: D54.

**O APK é uma casca.** Ele abre o site publicado, então deploy novo não pede
APK novo nem reinstalação. Instala uma vez.

## Rodar

Precisa só do **Docker Desktop aberto**. Nada é instalado no computador.

```sh
./twa/apk.sh
```

Na primeira vez, ele pergunta o domínio do app e o nome do pacote (aceite o
padrão), e baixa **uns 2–3 GB** para a imagem: JDK, Android SDK e Gradle. Use
Wi-Fi. Da segunda vez em diante, reaproveita tudo.

No fim, ele imprime o que fazer, passo a passo, com os valores prontos para
colar no Coolify. Em resumo:

1. guardar a pasta `~/qtv-apk` fora do computador;
2. colar `TWA_PACKAGE_ID` e `TWA_SHA256_FINGERPRINTS` no Coolify e reiniciar;
3. conferir `https://SEU-DOMINIO/.well-known/assetlinks.json`;
4. instalar `~/qtv-apk/quanto-tempo-vale.apk` no telefone;
5. abrir e ver se está em tela cheia, sem barra de endereço;
6. fazer o teste do Family Link (abaixo).

O site precisa estar no ar: o Bubblewrap baixa dele o ícone e o maskable, os
mesmos de `public/` (D46).

## O que fica onde

| onde | o quê |
|---|---|
| `~/qtv-apk/qtv.keystore` | A chave de assinatura. **Sem ela, o app instalado nunca mais atualiza.** |
| `~/qtv-apk/password` | A senha da chave, gerada sozinha. |
| `~/qtv-apk/config` | Domínio e pacote que você respondeu. Apague para perguntar de novo. |
| `~/qtv-apk/quanto-tempo-vale.apk` | O arquivo para instalar. |
| este diretório | Imagem, modelo e script. Nada de domínio, pacote ou chave: o repositório é público. |

Outra pasta: `QTV_DIR=/outro/lugar ./twa/apk.sh`.

## Gerar de novo só quando

- mudar o domínio, o pacote, o nome visível ou o ícone;
- o `.apk` se perder e outro telefone precisar dele.

Para atualizar um app já instalado, use a mesma pasta `~/qtv-apk` (mesma chave)
e uma versão maior: `TWA_VERSION=2 ./twa/apk.sh`. Com chave diferente, o
Android recusa: desinstale e instale de novo. Ao trocar de chave, ponha as
duas impressões digitais em `TWA_SHA256_FINGERPRINTS`, separadas por vírgula.

## Instalar no telefone

Mande o `.apk` para o telefone (cabo, Drive, e-mail) e abra pelo app de
arquivos. O Android pede para permitir "instalar apps desconhecidos" para
aquele app: permita, instale e desligue a permissão de novo. Se a supervisão
do Family Link impedir a instalação, anote o que apareceu: é medição para a
D54.

Se o app abrir **com barra de endereço**, o `assetlinks.json` não bate com o
pacote ou com a chave. Confira as duas variáveis no Coolify. O
[verificador do Google](https://developers.google.com/digital-asset-links/tools/generator)
lê o mesmo arquivo público e diz o que não bate.

## O teste do Family Link

TWA usa o Chrome por baixo. **O risco é o app morrer junto se o Family Link
bloquear o Chrome.**

1. Com o app instalado e funcionando, bloqueie o Chrome no Family Link.
2. Feche o app de vez e abra de novo.
3. Anote: abriu normal, abriu com barra, não abriu, ou mostrou aviso do
   Family Link.

O resultado vai na D54. Se o app morrer junto, o caminho é um wrapper com
WebView, que não depende do app Chrome mas perde o aviso push (D51). Isso é
issue nova, não ajuste neste APK.

## Limpar depois

```sh
docker image rm qtv-twa && docker volume rm qtv-twa-gradle
```

Não apague `~/qtv-apk`.
