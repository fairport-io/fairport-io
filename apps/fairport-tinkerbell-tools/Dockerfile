FROM ubuntu:24.04 AS build
RUN apt update && \
    apt install -y -qq wget curl gzip util-linux e2fsprogs xfsprogs cloud-guest-utils gdisk parted udev qemu-utils ca-certificates python3 python3-pip jq
RUN pip3 install gunicorn --break-system-packages

FROM build AS test
RUN echo "pass"
