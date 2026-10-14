# SPDX-License-Identifier: GPL-3.0-only
# Build: docker build --platform linux/amd64 -f docker/Dockerfile -t tvbox-core:local .
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS node
FROM eclipse-temurin:17-jdk-noble@sha256:fb79620c3f6ee8f1c7530a8dc4fd49e3b410bcef037694ad4858a1553bac4170 AS build
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64
RUN apt-get update && apt-get install -y --no-install-recommends clang unzip ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /opt/tvbox
# Stable provisioning layer: source-only changes reuse verified dependency jars.
COPY backend/config-core/runtime.json backend/config-core/runtime.json
COPY backend/spider-runtime/runtime.json backend/spider-runtime/runtime.json
COPY backend/spider-runtime/native-bridge/runtime.json backend/spider-runtime/native-bridge/runtime.json
COPY backend/spider-runtime/native-bridge/fetch-runtime.mjs backend/spider-runtime/native-bridge/fetch-runtime.mjs
COPY backend/spider-runtime/dex/toolchain.json backend/spider-runtime/dex/toolchain.json
COPY scripts/container/fetch-tools.mjs scripts/container/fetch-tools.mjs
RUN node scripts/container/fetch-tools.mjs
COPY backend/ backend/
COPY resources/js-lib/ resources/js-lib/
COPY resources/jvm/native-bridge/ resources/jvm/native-bridge/
COPY resources/jvm/stubs-src/ resources/jvm/stubs-src/
COPY resources/jvm/tools/JarRewriter.java resources/jvm/tools/JarRewriter.java
COPY scripts/container/ scripts/container/
COPY scripts/compat/native-source-probe.mjs scripts/compat/native-source-probe.mjs
COPY docker/ docker/
COPY LICENSE ./LICENSE
RUN node scripts/container/build.mjs && chmod -R a+rX /opt/tvbox
RUN --network=none node scripts/container/doctor.mjs

FROM eclipse-temurin:17-jre-noble@sha256:900322f4cc1b9da9d730ae4bb56d8a1dabbaa9cfa32809fc8b542b600370a045 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 tvbox && useradd --uid 10001 --gid 10001 --no-create-home tvbox \
    && mkdir -p /data && chown 10001:10001 /data
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/LICENSE /usr/share/doc/tvbox-node-LICENSE
COPY --from=build /opt/tvbox /opt/tvbox
ENV TVBOX_PREBUILT_ONLY=1 TVBOX_EXPECT_PLATFORM=linux-x64 TVBOX_DATA_DIR=/data
WORKDIR /opt/tvbox
USER 10001:10001
RUN --network=none node scripts/container/doctor.mjs
ENTRYPOINT ["node", "/opt/tvbox/docker/cli.mjs"]
CMD ["doctor"]
