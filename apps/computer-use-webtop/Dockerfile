FROM lscr.io/linuxserver/webtop:ubuntu-mate-23f1282f-ls286 AS base

ENV LLAMA_BASE_URL="http://localhost:1234/v1"

FROM base AS build
RUN curl -fsSL https://pi.dev/install.sh -o /tmp/install-pi.sh \
    && printf 'y\nn\nn\n' | TERM=dumb script -qec 'sh /tmp/install-pi.sh' /dev/null \
    && rm -f /tmp/install-pi.sh
COPY models.json .pi/agent/models.json
COPY AGENTS.md AGENTS.md
COPY use-computer /usr/local/bin/use-computer

FROM build AS test
RUN echo Pass
