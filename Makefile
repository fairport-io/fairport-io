REGISTRY_ADDRESS   ?= gcr.io/fairport-io
SHELL              := /bin/bash
REGISTRY_USERNAME  ?=
REGISTRY_PASSWORD  ?=
REPO_ROOT          ?= $(shell git rev-parse --show-toplevel)
REPO_BRANCH        ?= $(if $(CI_COMMIT_REF_NAME),$(CI_COMMIT_REF_NAME),$(shell git rev-parse --abbrev-ref HEAD))
SAFE_BRANCH        ?= $(shell echo "$(REPO_BRANCH)" | tr '/' '-')
REPO_COMMIT        ?= $(shell git rev-parse --short HEAD)
WORKDIR            ?= $(shell pwd)
TARGET_APP_NAME    ?= $(patsubst $(REPO_ROOT)/%,%,$(WORKDIR))
VERSION            ?= $(shell cat VERSION)
ARTIFACT           ?= $(REGISTRY_ADDRESS)/$(TARGET_APP_NAME):$(VERSION)
SYSTEM_ARCH        ?= $(shell uname -m)
TARGET_PF          ?= linux/amd64
CACHE_REF          ?= $(REGISTRY_ADDRESS)/cache/$(TARGET_APP_NAME)
DOCKERFILE         ?= Dockerfile
CI_API_V4_URL      ?=
CI_PROJECT_ID      ?=
CI_JOB_TOKEN       ?=
OVERWRITE_ARTIFACT ?=

.PHONY: all build test deploy clean scaffold

all: build test deploy

define SETUP_FUNCTIONS
	info() { echo "\n[$$(date +%s)] [INFO    ] [$(MAKECMDGOALS)] [$${FUNCNAME[1]}] $$*"; }; \
	warn() { echo "\n[$$(date +%s)] [WARNING ] [$(MAKECMDGOALS)] [$${FUNCNAME[1]}] $$*"; }; \
	crit() { echo "\n[$$(date +%s)] [CRITICAL] [$(MAKECMDGOALS)] [$${FUNCNAME[1]}] $$*" >&2; exit 1; }; \
	run_cmd() { \
		if [ -n "$$REGISTRY_PASSWORD" ]; then \
			info "Running: $$*" | sed "s|$$REGISTRY_PASSWORD|****|g"; \
		else \
			info "Running: $$*"; \
		fi; \
		eval "$$*"; \
	}; \
	authenticate_with_registry() { \
		info "Testing registry authentication"; \
		[ -z "$(REGISTRY_USERNAME)" ] && warn "REGISTRY_USERNAME is not set (Example: export REGISTRY_USERNAME=<username>)" && SKIP=true; \
		[ -z "$(REGISTRY_PASSWORD)" ] && warn "REGISTRY_PASSWORD is not set (Example: read -s REGISTRY_PASSWORD && export REGISTRY_PASSWORD)" && SKIP=true; \
		[ "$(REGISTRY_PASSWORD)" ] && run_cmd "echo $(REGISTRY_PASSWORD) | docker login -u $(REGISTRY_USERNAME) --password-stdin $(REGISTRY_ADDRESS)"; \
		[ $$? -eq 0 ] && return 0 || return 1; \
	}; \
	fail_if_artifact_exists() { \
		if docker manifest inspect $$ARTIFACT > /dev/null 2>&1 && ! echo $(OVERWRITE_ARTIFACT) | grep -q "true"; then \
			crit "Artifact $$ARTIFACT already exists in the registry"; \
		fi; \
	}; \
	require_docker() { \
		command -v docker 2>&1 > /dev/null || crit "Docker is required to continue"; \
	}; \
	setup_buildx() { \
		if ! docker buildx inspect | grep -q "Driver:.*docker-container"; then \
			info "Setting up docker-container driver for buildx to support cache exports"; \
			docker buildx create --use --driver docker-container > /dev/null 2>&1 || true; \
		fi; \
	}; \
	skip_root_dir() { \
		[ "$(WORKDIR)" = "$(REPO_ROOT)" ] && info "Nothing to build here" && exit 0; \
	}; \
	setup_dockerignore() { \
		[ -f .dockerignore ] || printf "Makefile\n$(DOCKERFILE)\ntests/\nnode_modules\n.git\n" > .dockerignore; \
	}; \
	run_subtargets() { \
		SUB_TARGETS=$$(find . -mindepth 2 -name "Makefile" -exec dirname {} \;); \
		if [ "$$SUB_TARGETS" ]; then \
			info "Found sub-targets: $$SUB_TARGETS\n"; \
			echo "$$SUB_TARGETS" | xargs -P 1 -I {} sh -c 'echo Target={}; make -C "{}" $(MAKECMDGOALS) || exit 255'; \
		fi; \
	}; \
	version_check() { \
		[ -z "$(VERSION)" ] && crit "Ensure $(TARGET_APP_NAME)/VERSION exists."; \
		echo "$(VERSION)" | grep -q "[0-9]\+\.[0-9]\+\.[0-9]\+" || crit "Invalid version format: $(VERSION), must be X.Y.Z"; \
	}; \
	makefile_check() { \
		[ -L Makefile ] || crit "$(TARGET_APP_NAME)/Makefile is not a symlink, it must be symlinked to the root Makefile: ln -s ../Makefile Makefile"; \
		[ ! -f $(DOCKERFILE) ] && warn "$(TARGET_APP_NAME)/$(DOCKERFILE) does not exist, skipping $(MAKECMDGOALS)" && exit 0; \
	}; \
	set_artifact_version() { \
		if [ "$(REPO_BRANCH)" = "main" ]; then \
			export ARTIFACT=$(ARTIFACT); \
			export VERSION=$(VERSION); \
		else \
			export ARTIFACT=$(ARTIFACT)-$(REPO_COMMIT); \
			export VERSION=$(VERSION)-$(REPO_COMMIT); \
		fi; \
	}; \
	set_platform() { \
		if echo $(SYSTEM_ARCH) | grep -qE "aarch64|arm64"; then \
			export BUILD_PF=linux/arm64; \
		else \
			export BUILD_PF=linux/amd64; \
		fi; \
	}; \
	add_arg() { \
		[ -n "$$1" ] && DOCKER_ARGS="$$DOCKER_ARGS $$@"; \
	}; \
	set_args() { \
		[ "$(DOCKERFILE)" ] && add_arg "-f $(DOCKERFILE)"; \
		[ "$$VERSION" ] && add_arg "--build-arg VERSION=$$VERSION"; \
		[ "$(TARGET_APP_NAME)" ] && add_arg "--build-arg APP=$(TARGET_APP_NAME)"; \
		[ "$(TARGET_PF)" ] && add_arg "--build-arg TARGET_PF=$(TARGET_PF)"; \
		[ "$$BUILD_PF" ] && add_arg "--build-arg BUILD_PF=$$BUILD_PF"; \
		[ "$(REPO_BRANCH)" ] && add_arg "--build-arg REPO_BRANCH=$(REPO_BRANCH)"; \
		[ "$(CI_API_V4_URL)" ] && add_arg "--secret id=CI_API_V4_URL,env=CI_API_V4_URL"; \
		[ "$(CI_PROJECT_ID)" ] && add_arg "--secret id=CI_PROJECT_ID,env=CI_PROJECT_ID"; \
		[ "$(CI_JOB_TOKEN)" ]  && add_arg "--secret id=CI_JOB_TOKEN,env=CI_JOB_TOKEN"; \
		true; \
	}
endef

define SETUP_ENV
	require_docker; \
	setup_buildx; \
	skip_root_dir; \
	setup_dockerignore; \
	run_subtargets; \
	version_check; \
	makefile_check; \
	set_artifact_version; \
	set_platform; \
	set_args
endef

build:
	@$(SETUP_FUNCTIONS); $(SETUP_ENV); set -e; \
	if authenticate_with_registry; then \
		add_arg "--cache-from type=registry,ref=$(CACHE_REF):$(SAFE_BRANCH)"; \
		add_arg "--cache-from type=registry,ref=$(CACHE_REF):main"; \
		add_arg "--cache-to   type=registry,ref=$(CACHE_REF):$(SAFE_BRANCH),mode=max"; \
	else \
		warn "Remote caching disabled, set REGISTRY_USERNAME and REGISTRY_PASSWORD environment variables to enable remote caching."; \
		sleep 3; \
	fi; \
	run_cmd "docker buildx build --load $$DOCKER_ARGS --target build -t $$ARTIFACT ."

test:
	@$(SETUP_FUNCTIONS); $(SETUP_ENV); set -e; \
	run_cmd "docker buildx build $$DOCKER_ARGS --target test --output type=cacheonly ."

deploy:
	@$(SETUP_FUNCTIONS); $(SETUP_ENV); set -e; \
	! authenticate_with_registry && crit "REGISTRY_USERNAME and REGISTRY_PASSWORD environment variables are required to deploy artifacts."; \
	add_arg "--cache-from type=registry,ref=$(CACHE_REF):$(SAFE_BRANCH)"; \
	add_arg "--cache-from type=registry,ref=$(CACHE_REF):main"; \
	add_arg "--platform $(TARGET_PF)"; \
	fail_if_artifact_exists; \
	if [ -f "Chart.yaml" ]; then \
		RUN_CMD_IN_CONTAINER="echo $(REGISTRY_PASSWORD) | helm registry login -u $(REGISTRY_USERNAME) --password-stdin $(REGISTRY_ADDRESS)"; \
		RUN_CMD_IN_CONTAINER="$$RUN_CMD_IN_CONTAINER && helm push *.tgz oci://$(REGISTRY_ADDRESS)/charts"; \
		run_cmd "docker run --rm --entrypoint=/bin/sh $$ARTIFACT -c \"$$RUN_CMD_IN_CONTAINER\""; \
		exit 0; \
	fi; \
	run_cmd "docker buildx build --load $$DOCKER_ARGS --target build -t $$ARTIFACT --push ."; \
	if grep "FROM .* AS deploy" $(DOCKERFILE) > /dev/null 2>&1; then \
		run_cmd "docker buildx build --target deploy --output type=cacheonly ."; \
	fi

clean:
	@$(SETUP_FUNCTIONS); $(SETUP_ENV); set -e; \
	run_cmd "docker rmi -f $$ARTIFACT"

scaffold:
	@set -e; \
	docker --version > /dev/null 2>&1 && docker buildx version > /dev/null 2>&1 && echo "Scaffold complete" && exit 0; \
	if grep -Eiq "ubuntu|debian" /etc/os-release 2>/dev/null; then \
		echo "Run apt-get update? (y/n)"; read -r RESPONSE; \
		echo $$RESPONSE | grep -iq "y" && sudo apt-get update; \
		echo "Run apt-get install -y docker.io? (y/n)"; read -r RESPONSE; \
		echo $$RESPONSE | grep -iq "y" && sudo apt-get install -y docker.io; \
		echo "Run apt-get install -y buildx? (y/n)"; read -r RESPONSE; \
		echo $$RESPONSE | grep -iq "y" && sudo apt-get install -y docker-buildx; \
	elif uname -s | grep -iq "darwin"; then \
		command -v "brew" > /dev/null 2>&1 && echo "Install homebrew? (y/n)" && read -r RESPONSE; \
		echo $$RESPONSE | grep -iq "y" && /bin/bash -c "$$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; \
		command -v "lima" > /dev/null 2>&1; \
		echo "Run apt-get update? (y/n)"; read -r RESPONSE; \
		echo $$RESPONSE | grep -iq "y" && brew install lima; \
		echo "Create Lima instance? (y/n)"; read -r RESPONSE; \
		echo $$RESPONSE | grep -iq "y" && limactl start --cpus=2 --memory=4 --vm-type=vz --rosetta --mount-writable --name=docker template://ubuntu-lts; \
		echo "Install docker and buildx in Lima instance? (y/n)"; read -r RESPONSE; \
		if echo $$RESPONSE | grep -iq "y"; then \
			limactl shell docker -- /bin/sh -c "apt update && apt install -y docker.io docker-buildx"; \
			echo "#!/bin/sh\nlimactl shell docker -- /bin/sh -c \"docker \$@\"" > /usr/local/bin/docker; \
		fi; \
	else \
		echo "Unsupported Linux distribution, please install docker and buildx manually" && exit 1; \
	fi
