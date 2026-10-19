# Toolchain for local APK builds (scripts/apk-local.sh: expo prebuild + Gradle): JDK 17, Android SDK +
# NDK, Node, pnpm. Versions match React Native 0.86 (node_modules/react-native/gradle/libs.versions.toml)
# and the root package.json's packageManager.
FROM eclipse-temurin:17-jdk-jammy

ARG NODE_VERSION=22.20.0
ARG PNPM_VERSION=11.13.1
ARG CMDLINE_TOOLS=13114758
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_OPTS="-Dorg.gradle.daemon=false -Dorg.gradle.jvmargs=-Xmx4g"
ENV PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip curl xz-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz \
    | tar -xJ -C /usr/local --strip-components=1 \
 && npm install -g pnpm@$PNPM_VERSION

RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/tools.zip \
 && yes | sdkmanager --licenses > /dev/null \
 && sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" > /dev/null

# The repo is mounted from the host with another owner.
RUN git config --global --add safe.directory '*'
