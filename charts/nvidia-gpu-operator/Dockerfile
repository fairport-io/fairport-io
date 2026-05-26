FROM alpine/helm:3.20 AS build
COPY . .
ARG VERSION
RUN helm dependency update && \
    sed -i "s|^version: .*|version: $VERSION|g" Chart.yaml && \
    echo "./*.tgz" >> .helmignore && \
    echo "./Makefile" >> .helmignore && \
    echo "./.helmignore" >> .helmignore && \
    echo "./.dockerignore" >> .helmignore && \
    helm package .

FROM build AS test
RUN helm template nvidia-gpu-operator . --namespace nvidia-gpu-operator > /dev/null
