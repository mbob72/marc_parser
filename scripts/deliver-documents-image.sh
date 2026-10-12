#!/usr/bin/env bash
# Одноразовый SSH-сеанс: получает job token через stdin, скачивает digest и пишет квитанцию.
# DOC-PREVIEW:/docs/documents-deployment.md#ssh-delivery
set -euo pipefail
umask 077
image=${1:?image required}
digest=${2:?digest required}
revision=${3:?revision required}
registry_user=${4:?registry user required}
[[ "$image" =~ ^ghcr\.io/[a-z0-9_-]+/[a-z0-9_.-]+$ ]]
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
[[ "$registry_user" =~ ^[a-zA-Z0-9_-]+(\[bot\])?$ ]]

delivery_dir="${DOCUMENTS_DELIVERY_DIR:-$HOME/marc-documents-work/delivery}"
mkdir -p "$delivery_dir"
# Блокировка защищает квитанцию от параллельного ручного запуска того же сценария.
exec 9>"$delivery_dir/delivery.lock"
flock -w 30 9
auth_dir=$(mktemp -d)
receipt=''
cleanup() {
  # Глобальный Docker login пользователя не меняется; временный token удаляется при выходе.
  rm -rf -- "$auth_dir"
  if [[ -n "$receipt" ]]; then rm -f -- "$receipt"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
docker --config "$auth_dir" login ghcr.io --username "$registry_user" --password-stdin >/dev/null 2>&1
docker --config "$auth_dir" pull "$image@$digest"
actual_revision=$(docker image inspect "$image@$digest" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$actual_revision" == "$revision" ]] || { echo 'Image revision mismatch' >&2; exit 1; }
image_id=$(docker image inspect "$image@$digest" --format '{{.Id}}')
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
docker tag "$image@$digest" "$image:documents-$revision"
receipt=$(mktemp "$delivery_dir/.latest.XXXXXX")
printf '{"image":"%s","digest":"%s","revision":"%s","imageId":"%s","deliveredAt":"%s"}\n' \
  "$image" "$digest" "$revision" "$image_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$receipt"
mv -- "$receipt" "$delivery_dir/latest.json"
receipt=''
cat "$delivery_dir/latest.json"
