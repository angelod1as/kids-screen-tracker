#!/usr/bin/env bash
#
# D54: one command for the side-load APK. Needs only Docker. The key, its
# password and the APK live in QTV_DIR, outside the (public) repository.

set -euo pipefail

QTV_DIR="${QTV_DIR:-$HOME/qtv-apk}"
TWA_VERSION="${TWA_VERSION:-1}"
IMAGE=qtv-twa
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! docker info >/dev/null 2>&1; then
  echo "O Docker não está rodando. Abra o Docker Desktop e rode de novo." >&2
  exit 1
fi

mkdir -p "$QTV_DIR"
chmod 700 "$QTV_DIR"

if [ ! -f "$QTV_DIR/config" ]; then
  echo "Primeira vez. Duas perguntas, guardadas em $QTV_DIR/config."
  read -r -p "Domínio do app, sem https:// (ex.: app.exemplo.com): " host
  read -r -p "Nome do pacote [app.quantotempovale.twa]: " package
  printf 'TWA_HOST=%q\nTWA_PACKAGE_ID=%q\n' \
    "$host" "${package:-app.quantotempovale.twa}" >"$QTV_DIR/config"
fi
# shellcheck source=/dev/null
. "$QTV_DIR/config"

echo "==> Montando a imagem (a primeira vez baixa uns 2-3 GB)"
docker build --platform linux/amd64 --tag "$IMAGE" "$here"

run() {
  docker run --rm --platform linux/amd64 \
    --volume "$QTV_DIR:/key" \
    --volume "$here:/twa:ro" \
    --volume qtv-twa-gradle:/root/.gradle \
    --env BUBBLEWRAP_KEYSTORE_PASSWORD \
    "$IMAGE" "$@"
}

if [ ! -f "$QTV_DIR/qtv.keystore" ]; then
  echo "==> Criando a chave de assinatura"
  (umask 077 && openssl rand -hex 24 >"$QTV_DIR/password")
fi
BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat "$QTV_DIR/password")"
export BUBBLEWRAP_KEYSTORE_PASSWORD

if [ ! -f "$QTV_DIR/qtv.keystore" ]; then
  # PKCS12 has a single password for the store and the key.
  run sh -c 'keytool -genkeypair -noprompt -storetype PKCS12 \
    -keystore /key/qtv.keystore -alias qtv -keyalg RSA -keysize 2048 \
    -validity 10000 -dname "CN=Quanto Tempo Vale" \
    -storepass "$BUBBLEWRAP_KEYSTORE_PASSWORD"'
fi

echo "==> Gerando o APK"
run env TWA_HOST="$TWA_HOST" TWA_PACKAGE_ID="$TWA_PACKAGE_ID" \
  TWA_VERSION="$TWA_VERSION" /twa/in-container.sh

fingerprint="$(run sh -c 'keytool -list -v -keystore /key/qtv.keystore \
  -alias qtv -storepass "$BUBBLEWRAP_KEYSTORE_PASSWORD"' |
  sed -n 's/^[[:space:]]*SHA256: *//p')"

cat <<DONE

==================================================================
Pronto. O que fazer agora:

1. GUARDE A PASTA $QTV_DIR
   Ela tem a chave (qtv.keystore) e a senha (password). Copie as duas
   para o gerenciador de senhas ou outro lugar fora deste computador.
   Sem elas, o app instalado nunca mais recebe atualização.

2. NO COOLIFY, nas variáveis da aplicação, cole:

   TWA_PACKAGE_ID=$TWA_PACKAGE_ID
   TWA_SHA256_FINGERPRINTS=$fingerprint

   e reinicie a aplicação (ou faça um redeploy).

3. CONFIRA que o servidor publicou:

   curl https://$TWA_HOST/.well-known/assetlinks.json

   Tem que aparecer o pacote e a impressão digital acima.

4. INSTALE no telefone o arquivo:

   $QTV_DIR/quanto-tempo-vale.apk

   Mande para o telefone (cabo, Drive, e-mail), abra pelo app de
   arquivos e permita "instalar apps desconhecidos" quando pedir.

5. ABRA o app: tem que abrir em tela cheia, sem barra de endereço.
   Se aparecer a barra, o passo 3 não bateu.

6. TESTE o Family Link: bloqueie o Chrome, feche o app de vez,
   abra de novo e anote o que aconteceu.
==================================================================
DONE
