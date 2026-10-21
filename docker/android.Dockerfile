# Toolchain for local APK builds (scripts/apk-local.sh: expo prebuild + Gradle): JDK 17, Android SDK +
# NDK, Node, pnpm. Versions match React Native 0.86 (node_modules/react-native/gradle/libs.versions.toml).
# The CI build (.github/workflows/build-apk.yml) uses the runner's preinstalled SDK instead: when the SDK
# platform, build-tools or NDK below change, check that workflow too, so local and CI APKs stay comparable.
FROM eclipse-temurin:17-jdk-jammy

# Node and pnpm come from the repository: scripts/apk-local.sh passes the root .nvmrc and the root
# package.json's packageManager. The defaults only serve a plain `docker build`; keep them equal.
ARG NODE_VERSION=22.23.2
ARG PACKAGE_MANAGER=pnpm@11.13.1
ARG CMDLINE_TOOLS=13114758
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_OPTS="-Dorg.gradle.daemon=false -Dorg.gradle.jvmargs=-Xmx4g" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip curl xz-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm through Node's corepack: the shim runs the packageManager version of the mounted repository.
RUN curl -fsSL https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz \
    | tar -xJ -C /usr/local --strip-components=1 \
 && corepack enable pnpm \
 && corepack prepare $PACKAGE_MANAGER --activate

RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/tools.zip \
 && yes | sdkmanager --licenses > /dev/null \
 && sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" > /dev/null

# The repo is mounted from the host with another owner.
RUN git config --global --add safe.directory '*'
