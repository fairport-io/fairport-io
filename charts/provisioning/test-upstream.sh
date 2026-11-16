#!/bin/sh
set -eu

chart_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' 0
trap 'exit 1' HUP INT TERM

helm template provisioning "$chart_dir" --namespace provisioning-check > "$test_dir/default.yaml"
grep -q 'image: ghcr.io/tinkerbell/tinkerbell:v0.26.0$' "$test_dir/default.yaml"
for pair in \
    TINKERBELL_IPXE_HTTP_SCRIPT_KERNEL_NAME=vmlinuz \
    TINKERBELL_IPXE_HTTP_SCRIPT_INITRD_NAME=initramfs \
    TINKERBELL_HTTP_PORT_V4=7171 \
    TINKERBELL_DHCP_MODE_V4=auto-proxy \
    TINKERBELL_TINK_SERVER_AUTO_ENROLLMENT_ENABLED=true; do
    grep -A1 "name: ${pair%%=*}$" "$test_dir/default.yaml" | grep -q "value: \"${pair#*=}\"$"
done
if grep -Eq '^  name: (hookos|osie)$' "$test_dir/default.yaml"; then
    echo 'Upstream artifact server should be disabled' >&2
    exit 1
fi

cat > "$test_dir/values.yaml" <<'EOF'
workflows:
- name: default
  mac_addresses: ["*"]
  image_url: http://$HOST_IP:7173/ubuntu-2404.img
- name: 00-server
  mac_addresses: ["00:11:22:33:44:55"]
  image_url: http://$HOST_IP:7173/server.img
EOF
helm template provisioning "$chart_dir" --namespace provisioning-check \
    -f "$test_dir/values.yaml" > "$test_dir/multiple.yaml"

mkdir "$test_dir/bin"
cat > "$test_dir/bin/kubectl" <<'EOF'
#!/bin/sh
set -eu
[ "$*" = 'apply --server-side --force-conflicts -f -' ] || {
    echo "Unexpected kubectl command: $*" >&2
    touch "$CAPTURE_FILE.unexpected"
    exit 1
}
cat > "$CAPTURE_FILE"
EOF
printf '#!/bin/sh\nexit 0\n' > "$test_dir/bin/sleep"
chmod +x "$test_dir/bin/kubectl" "$test_dir/bin/sleep"
export PATH="$test_dir/bin:$PATH"

for name in default 00-server; do
    awk -v name="$name" '
        $0 == "  name: tinkerbell-object-installer-" name { installer = 1 }
        installer && /^        - \|$/ { command = 1; next }
        command && /^---$/ { exit }
        command { sub(/^          /, ""); print }
    ' "$test_dir/multiple.yaml" > "$test_dir/installer.sh"
    test -s "$test_dir/installer.sh"
    sh -n "$test_dir/installer.sh"
    # Run the rendered installer twice; the stub rejects deletes and unused lookups.
    for run in 1 2; do
        export CAPTURE_FILE="$test_dir/$name-$run.yaml"
        sh "$test_dir/installer.sh"
        test ! -e "$CAPTURE_FILE.unexpected"
        grep -q '^kind: WorkflowRuleSet$' "$CAPTURE_FILE"
        grep -q '^kind: Template$' "$CAPTURE_FILE"
        test "$(grep -c "^  name: $name$" "$CAPTURE_FILE")" -eq 2
        test "$(grep -c '^  namespace: provisioning-check$' "$CAPTURE_FILE")" -eq 2
        grep -q "^      ref: $name$" "$CAPTURE_FILE"
        grep -Fq 'http://$HOST_IP:7173/' "$CAPTURE_FILE"
    done
    cmp "$test_dir/$name-1.yaml" "$test_dir/$name-2.yaml"
done
grep -Fq '{"wildcard" :"*"}' "$test_dir/default-1.yaml"
grep -Fq '"00:11:22:33:44:55"' "$test_dir/00-server-1.yaml"
printf 'Upstream compatibility and repeated installer checks passed.\n'
