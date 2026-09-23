#!/usr/bin/env bash
#
# Copies the LOCAL Stratus database into a remote one (Neon, RDS, Supabase...), so a deployment
# keeps the workspaces, AWS connections, inventory, cost history and audit trail already collected.
#
#   ./scripts/migrate-data-to-remote.sh "postgresql://user:pass@host/db?sslmode=require"
#
# Uses the postgres client from Docker, so no local pg_dump installation is needed. The dump is
# written to a temporary file that is deleted on exit, including on failure.
#
# IMPORTANT — encryption keys. AWS ExternalIds and any stored access keys are encrypted with
# LOCAL_MASTER_KEY (or KMS). The target deployment MUST use the SAME key, or every connection
# becomes permanently undecryptable and has to be re-created from scratch. This script refuses to
# run unless it can see a local LOCAL_MASTER_KEY to remind you to check.
#
# The audit_logs table has append-only triggers; a restore runs as the table owner, which is
# allowed. Ordinary application roles still cannot delete from it.
set -euo pipefail

TARGET_URL="${1:-}"
if [ -z "$TARGET_URL" ]; then
  echo "usage: $0 <target-postgres-url>" >&2
  exit 1
fi
case "$TARGET_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "error: target must be a postgres:// or postgresql:// URL" >&2; exit 1 ;;
esac

cd "$(dirname "$0")/.."

SOURCE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)"
if [ -z "$SOURCE_URL" ]; then
  echo "error: no DATABASE_URL in .env — nothing to copy from" >&2
  exit 1
fi
if ! grep -q '^LOCAL_MASTER_KEY=.\+' .env; then
  echo "error: no LOCAL_MASTER_KEY in .env." >&2
  echo "       Encrypted connection secrets would be unreadable at the destination." >&2
  exit 1
fi

# Docker cannot reach the host's 127.0.0.1; rewrite it to the host gateway alias.
DOCKER_SOURCE_URL="${SOURCE_URL//127.0.0.1/host.docker.internal}"
DOCKER_SOURCE_URL="${DOCKER_SOURCE_URL//localhost/host.docker.internal}"

IMAGE="postgres:17-alpine"
DUMP_DIR="$(mktemp -d)"
trap 'rm -rf "$DUMP_DIR"' EXIT
DUMP_FILE="$DUMP_DIR/stratus.dump"

echo "==> Pulling $IMAGE (first run only)"
docker pull -q "$IMAGE" >/dev/null

echo "==> Dumping local database"
docker run --rm -i \
  -e PGSSLMODE=disable \
  -v "$DUMP_DIR:/dump" \
  "$IMAGE" \
  pg_dump --format=custom --no-owner --no-privileges --file=/dump/stratus.dump "$DOCKER_SOURCE_URL"

echo "==> Dump complete ($(du -h "$DUMP_FILE" | cut -f1))"

echo "==> Restoring into the target database"
# --clean --if-exists makes the restore repeatable: a half-finished attempt can simply be re-run.
docker run --rm -i \
  -v "$DUMP_DIR:/dump" \
  "$IMAGE" \
  pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error \
    --dbname="$TARGET_URL" /dump/stratus.dump

echo "==> Done. Row counts at the destination:"
# The URL holds a password, so it is passed to the container rather than printed.
docker run --rm -e TARGET="$TARGET_URL" "$IMAGE" \
  psql "$TARGET_URL" -At -c \
  "select 'organizations=' || (select count(*) from organizations)
       || ' accounts='      || (select count(*) from aws_accounts)
       || ' resources='     || (select count(*) from aws_resources)
       || ' cost_rows='     || (select count(*) from cost_records)
       || ' audit_rows='    || (select count(*) from audit_logs);" 2>/dev/null || echo "    (count query skipped)"
echo
echo "Reminder: the deployment must use the SAME LOCAL_MASTER_KEY as this machine,"
echo "otherwise the restored AWS connections cannot be decrypted."
