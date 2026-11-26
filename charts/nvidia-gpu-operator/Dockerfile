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
RUN helm template nvidia-gpu-operator . --namespace nvidia-gpu-operator \
    --api-versions resource.k8s.io/v1/DeviceClass > /tmp/dra.yaml && \
    grep -qx 'kind: GPUCluster' /tmp/dra.yaml && \
    grep -qx '  extendedResourceName: nvidia.com/gpu' /tmp/dra.yaml && \
    helm template nvidia-gpu-operator . --namespace nvidia-gpu-operator \
    --set nvidia-gpu-operator.clusterPolicy.deployCR=true \
    --set nvidia-gpu-operator.gpuCluster.deployCR=false \
    --set nvidia-gpu-operator.devicePlugin.enabled=true \
    --set nvidia-gpu-operator.driver.nvidiaDriverCRD.enabled=false > /tmp/device-plugin.yaml && \
    grep -qx 'kind: ClusterPolicy' /tmp/device-plugin.yaml && \
    grep -A 1 '^  devicePlugin:' /tmp/device-plugin.yaml | grep -qx '    enabled: true' && \
    ! grep -qx '  extendedResourceName: nvidia.com/gpu' /tmp/device-plugin.yaml
