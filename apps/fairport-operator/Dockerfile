FROM python:3.13-alpine AS build
RUN apk update && apk add kubectl openssh  jq
RUN pip3 install kubernetes kopf
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY ./src/app .
RUN chown -R appuser:appgroup /app
USER appuser
ENTRYPOINT [ "python3", "-u", "app.py" ]

FROM build AS test
RUN echo pass
