FROM lscr.io/linuxserver/webtop:ubuntu-mate-23f1282f-ls286 AS base

ENV LLAMA_BASE_URL="http://localhost:1234/v1"

USER root
RUN chown -R abc:abc /config
USER abc

FROM base AS build
RUN whoami && curl -fsSL https://pi.dev/install.sh -o /tmp/install-pi.sh \
    && printf 'y\ny\nn\n' | TERM=dumb script -qec 'sh /tmp/install-pi.sh' /dev/null \
    && rm -f /tmp/install-pi.sh

USER root
RUN install -Dm644 /usr/share/applications/mate-terminal.desktop \
    /etc/xdg/autostart/mate-terminal.desktop

COPY --chown=abc:abc models.json /config/.pi/agent/models.json
COPY --chown=abc:abc AGENTS.md /config/AGENTS.md
COPY bot /usr/local/bin/bot

USER root

FROM build AS test
RUN echo Pass
