# D54: everything the APK build needs, so the owner's machine only needs Docker.
# apk.sh builds it as linux/amd64: the Android build tools ship no Linux arm64
# binaries.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip \
  && rm -rf /var/lib/apt/lists/*

# The tools go in tools/, not the SDK root: a root with their source.properties
# is read as one package, and Gradle then finds no platform under it.
ENV ANDROID_HOME=/opt/android-sdk
RUN curl -fsSL -o /tmp/tools.zip \
    https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
  && unzip -q /tmp/tools.zip -d /tmp \
  && mkdir -p "$ANDROID_HOME" \
  && mv /tmp/cmdline-tools "$ANDROID_HOME/tools" \
  && rm /tmp/tools.zip \
  && yes | "$ANDROID_HOME/tools/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null \
  && "$ANDROID_HOME/tools/bin/sdkmanager" --sdk_root="$ANDROID_HOME" \
    "platform-tools" "platforms;android-36" "build-tools;36.1.0"

# Pinned with the template it reads; the config keeps Bubblewrap from asking
# to download its own JDK and SDK.
RUN npm install -g @bubblewrap/cli@1.25.0 \
  && mkdir -p /root/.bubblewrap \
  && jdk="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")" \
  && printf '{"jdkPath":"%s","androidSdkPath":"%s"}\n' "$jdk" "$ANDROID_HOME" \
    > /root/.bubblewrap/config.json

WORKDIR /work
