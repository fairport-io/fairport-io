#!/bin/sh
set -eu

chart_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' 0
trap 'exit 1' HUP INT TERM

helm template provisioning "$chart_dir" --namespace provisioning-check > "$test_dir/default.yaml"
grep -q 'image: ghcr.io/tinkerbell/tinkerbell:v0.26.0$' "$test_dir/default.yaml"
test "$(grep -c '^            name: zzz-default$' "$test_dir/default.yaml")" -eq 2
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
- name: zzz-default
  mac_addresses: ["*"]
  image_url: http://$HOST_IP:7173/ubuntu-2404.img
- name: server-2404
  mac_addresses: ["00:11:22:33:44:55"]
  image_url: http://$HOST_IP:7173/server.img
EOF
helm template provisioning "$chart_dir" --namespace provisioning-check \
    -f "$test_dir/values.yaml" > "$test_dir/multiple.yaml"
helm template provisioning "$chart_dir" --namespace provisioning-check \
    --set-json 'workflows=[]' > "$test_dir/empty.yaml"

for config in multiple empty; do
    awk '
        /^kind: Job$/ { job = 1 }
        job && /^  name: tinkerbell-object-installer$/ { installer = 1 }
        installer && /^        - \|$/ { command = 1; next }
        command && /^---$/ { exit }
        command { sub(/^          /, ""); print }
    ' "$test_dir/$config.yaml" > "$test_dir/$config.sh"
    test -s "$test_dir/$config.sh"
    sh -n "$test_dir/$config.sh"
done

mkdir "$test_dir/bin"
cat > "$test_dir/bin/kubectl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$STATE/calls"
case "$*" in
    'apply --server-side --force-conflicts -f -')
        cat > "$STATE/payload"
        applies=$(grep -c '^apply ' "$STATE/calls")
        [ "${FAIL_AT:-}" != "apply-$applies" ] || exit 1
        cat "$STATE/payload" >> "$CAPTURE_FILE"
        name=$(awk '/^kind: WorkflowRuleSet$/ { ruleset = 1 } ruleset && /^  name:/ { print $2; exit }' "$STATE/payload")
        if ! grep -Fxq "$name" "$STATE/managed"; then
            printf '%s\n' "$name" >> "$STATE/managed"
        fi
        ;;
    '-n provisioning-check get workflowrulesets -l fairport.io/managed-by=tinkerbell-object-installer -o jsonpath={.items[*].metadata.name}')
        [ "${FAIL_AT:-}" != list ] || exit 1
        tr '\n' ' ' < "$STATE/managed"
        ;;
    '-n provisioning-check delete workflowruleset '*)
        [ "$#" -eq 7 ]
        [ "$6" = --cascade=orphan ]
        [ "$7" = --ignore-not-found ]
        [ "${FAIL_AT:-}" != delete ] || exit 1
        grep -Fxq "$5" "$STATE/managed"
        grep -Fxv "$5" "$STATE/managed" > "$STATE/remaining" || [ "$?" -eq 1 ]
        mv "$STATE/remaining" "$STATE/managed"
        ;;
    *)
        echo "Unexpected kubectl command: $*" >&2
        touch "$CAPTURE_FILE.unexpected"
        exit 1
        ;;
esac
EOF
printf '#!/bin/sh\nexit 0\n' > "$test_dir/bin/sleep"
chmod +x "$test_dir/bin/kubectl" "$test_dir/bin/sleep"
export PATH="$test_dir/bin:$PATH"
export STATE="$test_dir/state"
mkdir "$STATE"
printf '%s\n' default server-2404 server-2404-custom-network default-extra > "$STATE/initial"
printf '%s\n' manual-wrs > "$STATE/unmanaged"
cp "$STATE/initial" "$STATE/managed"

# Run the rendered installer twice; only stale, managed rule sets may be deleted.
expected_deletes=3
for run in 1 2; do
    export CAPTURE_FILE="$test_dir/run-$run.yaml"
    : > "$STATE/calls"
    sh "$test_dir/multiple.sh"
    test ! -e "$CAPTURE_FILE.unexpected"
    test "$(head -n2 "$STATE/calls" | grep -c '^apply ')" -eq 2
    test "$(grep -c ' delete workflowruleset ' "$STATE/calls")" -eq "$expected_deletes"
    expected_deletes=0
    test "$(sort "$STATE/managed")" = "$(printf '%s\n' server-2404 zzz-default)"
    test "$(cat "$STATE/unmanaged")" = manual-wrs
    test "$(grep -c '^kind: WorkflowRuleSet$' "$CAPTURE_FILE")" -eq 2
    test "$(grep -c '^kind: Template$' "$CAPTURE_FILE")" -eq 2
    test "$(grep -c '^  namespace: provisioning-check$' "$CAPTURE_FILE")" -eq 4
    for name in zzz-default server-2404; do
        test "$(grep -c "^  name: $name$" "$CAPTURE_FILE")" -eq 2
        grep -q "^      ref: $name$" "$CAPTURE_FILE"
    done
    test "$(grep -c '^  name: default$' "$CAPTURE_FILE")" -eq 0
    grep -Fq 'http://$HOST_IP:7173/' "$CAPTURE_FILE"
done
cmp "$test_dir/run-1.yaml" "$test_dir/run-2.yaml"
grep -Fq '{"wildcard" :"*"}' "$test_dir/run-1.yaml"
grep -Fq '"00:11:22:33:44:55"' "$test_dir/run-1.yaml"

# Failed applies/listing must never reach pruning; failed deletes must fail the Job.
for failure in apply-1 apply-2 list delete; do
    export FAIL_AT="$failure"
    export CAPTURE_FILE="$test_dir/$failure.yaml"
    cp "$STATE/initial" "$STATE/managed"
    : > "$STATE/calls"
    if sh "$test_dir/multiple.sh"; then
        echo "Installer should fail on $failure" >&2
        exit 1
    fi
    test ! -e "$CAPTURE_FILE.unexpected"
    while IFS= read -r name; do
        grep -Fxq "$name" "$STATE/managed"
    done < "$STATE/initial"
    if [ "$failure" != delete ]; then
        test "$(grep -c ' delete workflowruleset ' "$STATE/calls")" -eq 0
    fi
done
unset FAIL_AT

# Empty configuration still prunes all managed rules, and is safe to repeat.
cp "$STATE/initial" "$STATE/managed"
printf '%s\n' zzz-default >> "$STATE/managed"
expected_deletes=5
for run in 1 2; do
    export CAPTURE_FILE="$test_dir/empty-$run.yaml"
    : > "$STATE/calls"
    sh "$test_dir/empty.sh"
    test ! -e "$CAPTURE_FILE.unexpected"
    test ! -e "$CAPTURE_FILE"
    test ! -s "$STATE/managed"
    test "$(grep -c ' delete workflowruleset ' "$STATE/calls")" -eq "$expected_deletes"
    expected_deletes=0
    test "$(cat "$STATE/unmanaged")" = manual-wrs
done
printf 'Upstream compatibility, repeated installation, and stale rule-set pruning checks passed.\n'
