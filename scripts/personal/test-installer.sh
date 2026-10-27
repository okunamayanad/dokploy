#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(mktemp -d)
export DOCKER_TEST_LOG="$TEST_DIR/commands"
cat > "$TEST_DIR/docker" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_TEST_LOG"
if [ "${FAIL_PULL:-false}" = true ] && [ "$1" = pull ]; then exit 1; fi
SH
chmod +x "$TEST_DIR/docker"
export PATH="$TEST_DIR:$PATH"
DOKPLOY_VERSION=v1.2.3.4 bash scripts/personal/install.sh update
grep -Fx 'pull ghcr.io/okunamayanad/dokploy:v1.2.3.4' "$DOCKER_TEST_LOG"
grep -Fx 'service update --env-add RELEASE_TAG=personal --image ghcr.io/okunamayanad/dokploy:v1.2.3.4 dokploy' "$DOCKER_TEST_LOG"
[ "$(wc -l < "$DOCKER_TEST_LOG")" -eq 2 ]
: > "$DOCKER_TEST_LOG"
if FAIL_PULL=true DOKPLOY_VERSION=v1.2.3.4 bash scripts/personal/install.sh update; then
  echo 'Installer ignored a failed image pull'; exit 1
fi
[ "$(wc -l < "$DOCKER_TEST_LOG")" -eq 1 ]
: > "$DOCKER_TEST_LOG"
for VERSION in latest v1.2.3 'v1.2.3.4;id'; do
  if DOKPLOY_VERSION="$VERSION" bash scripts/personal/install.sh update; then exit 1; fi
done
[ ! -s "$DOCKER_TEST_LOG" ]
echo 'Installer command routing and failure handling passed (Docker is simulated).'
