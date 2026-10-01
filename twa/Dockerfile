# D54: everything the APK build needs, so the owner's machine only needs Docker.
# linux/amd64 because the Android build tools ship no Linux arm64 binaries.
FROM --platform=linux/amd64 node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip \
  && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android-sdk
RUN curl -fsSL -o /tmp/tools.zip \
    https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
  && unzip -q /tmp/tools.zip -d /tmp \
  && mkdir -p "$ANDROID_HOME" \
  && mv /tmp/cmdline-tools/* "$ANDROID_HOME"/ \
  && rm -rf /tmp/tools.zip /tmp/cmdline-tools \
  && yes | "$ANDROID_HOME/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null \
  && "$ANDROID_HOME/bin/sdkmanager" --sdk_root="$ANDROID_HOME" \
    "platform-tools" "platforms;android-36" "build-tools;36.1.0"

# Pinned with the template it reads; the config keeps Bubblewrap from asking
# to download its own JDK and SDK.
RUN npm install -g @bubblewrap/cli@1.25.0 \
  && mkdir -p /root/.bubblewrap \
  && jdk="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")" \
  && printf '{"jdkPath":"%s","androidSdkPath":"%s"}\n' "$jdk" "$ANDROID_HOME" \
    > /root/.bubblewrap/config.json

WORKDIR /work
