#!/bin/sh
set -eu

chart_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' 0
trap 'exit 1' HUP INT TERM
mkdir "$test_dir/templates"
printf 'apiVersion: v2\nname: enabled-check\nversion: 0.1.0\n' > "$test_dir/Chart.yaml"
cp "$chart_dir/values.yaml" "$test_dir/defaults.yaml"
helm template fairport "$chart_dir" --namespace fairport --show-only templates/helmfile-all.yaml > "$test_dir/rendered.yaml"

cat > "$test_dir/templates/check.yaml" <<'EOF'
{{- $runtime := "" -}}
{{- range splitList "\n---\n" (.Files.Get "rendered.yaml") -}}
{{- $document := fromYaml . -}}
{{- if and (eq $document.kind "ConfigMap") (eq $document.metadata.name "fairport-installer") -}}
{{- $runtime = index $document.data "helmfile.yaml" -}}
{{- end -}}
{{- end -}}
{{- if not $runtime -}}{{ fail "installer Helmfile was not rendered" }}{{- end -}}
{{- if not (regexMatch "(?m)^releases:" $runtime) -}}{{ fail "Helmfile requires a literal top-level releases key" }}{{- end -}}
{{/* Adapt Helmfile-only functions; execute the generated filtering template unchanged. */}}
{{- $runtime = $runtime | replace "readFile \"values.yaml\"" "(.Values.runtimeValues | toYaml)" | replace "env " "print " -}}
{{- $_ := set .Values "runtimeValues" (dict) -}}
{{- $baseline := tpl $runtime . | fromYaml -}}
{{- $expected := tpl ((.Files.Get "defaults.yaml" | fromYaml).helmfile | toYaml | replace "env " "print ") . | fromYaml -}}
{{- if not (deepEqual $baseline $expected) -}}{{ fail "missing enabled flags changed releases" }}{{- end -}}

{{- $_ = set .Values "runtimeValues" (dict "kube-vip" (dict "enabled" false "kube-vip" (dict "enabled" true)) "openebs" (dict "enabled" false)) -}}
{{- $disabled := tpl $runtime . | fromYaml -}}
{{- $byName := dict -}}
{{- range $disabled.releases -}}
{{- $_ := set $byName .name . -}}
{{- range .needs -}}
{{- if has (last (splitList "/" .)) (list "kube-vip" "openebs") -}}{{ fail "disabled release remains in needs" }}{{- end -}}
{{- end -}}
{{- end -}}
{{- if or (hasKey $byName "kube-vip") (hasKey $byName "openebs") -}}{{ fail "outer enabled: false did not omit release" }}{{- end -}}
{{- if ne (len $disabled.releases) (int (sub (len $baseline.releases) 2)) -}}{{ fail "unrelated releases were omitted" }}{{- end -}}
{{- if not (deepEqual (index $byName "kubeai").needs (list "cert-manager/cert-manager" "kueue-system/kueue")) -}}{{ fail "unrelated needs changed" }}{{- end -}}
{{- if ne (index $byName "bifrost").installed false -}}{{ fail "installed: false changed" }}{{- end -}}
{{- if ne (index (index $byName "nvidia-gpu-operator").values 0 "nvidia-gpu-operator" "toolkit" "env" 0 "value") "CONTAINERD_SOCKET" -}}{{ fail "runtime env template was not evaluated" }}{{- end -}}

{{- $_ = set .Values "runtimeValues" (dict "kube-vip" (dict "enabled" true "kube-vip" (dict "enabled" false))) -}}
{{- if not (deepEqual (tpl $runtime . | fromYaml) $baseline) -}}{{ fail "enabled: true did not restore release" }}{{- end -}}
{{- $allDisabled := dict -}}
{{- range $baseline.releases -}}{{- $_ := set $allDisabled .name (dict "enabled" false) -}}{{- end -}}
{{- $_ = set .Values "runtimeValues" $allDisabled -}}
{{- if not (deepEqual (tpl $runtime . | fromYaml).releases (list)) -}}{{ fail "all disabled releases must produce an empty list" }}{{- end -}}
EOF

helm template enabled-check "$test_dir" > /dev/null
printf 'Release enabled checks passed.\n'
