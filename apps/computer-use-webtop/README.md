# computer-use-webtop

A container with Webtop (https://docs.linuxserver.io/images/docker-webtop/), pi (https://pi.dev/), and some basic rules to help pi use the desktop.

## Usage

1. Start the container (Set your backend with `LLAMA_BASE_URL` and `LLAMA_BASE_MODEL`):
```
docker run \     
    -d \        
    --name computer-use-webtop \
    --restart unless-stopped \
    --shm-size=1gb \
    -e SELKIES_MANUAL_WIDTH=1000 \
    -e SELKIES_MANUAL_HEIGHT=1000 \
    -e LLAMA_BASE_URL=http://localhost:1234/v1 \
    -e LLABA_BASE_MODEL=qwen3.8-27b \
    -p 3001:3001 \
    ghcr.io/fairport-io/apps/computer-use-webtop:0.0.1
```
2. Navigate to https://localhost:3001 in your web browser
3. Run commands in the MATE Terminal with the `bot` bot: `use-computer "Open chromium for me on my desktop"`
