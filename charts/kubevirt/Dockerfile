FROM alpine/helm:3.20 AS build
COPY . .
ARG VERSION
RUN sed -i "s|^version: .*|version: $VERSION|g" Chart.yaml && \
    echo "./*.tgz" >> .helmignore && \
    echo "./Makefile" >> .helmignore && \
    echo "./.helmignore" >> .helmignore && \
    echo "./.dockerignore" >> .helmignore && \
    helm package .

FROM build AS test
RUN helm template kubevirt . --namespace kubevirt > /dev/null
# Every image must follow kubevirt.registry, or an air-gapped mirror misses some
RUN ! helm template kubevirt . --namespace kubevirt --set kubevirt.registry=mirror.example/kubevirt | grep quay.io
