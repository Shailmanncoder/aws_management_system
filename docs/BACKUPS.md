# Backups and disaster recovery

## What must be protected

| Data | Source of truth | Loss impact |
|---|---|---|
| Users, workspaces, memberships, invitations | PostgreSQL only | High — cannot be recreated |
| AWS connections (role ARNs, **encrypted ExternalIds**) | PostgreSQL + KMS | High — customers would need to redeploy roles |
| Audit log | PostgreSQL only | High — compliance record |
| Findings state (suppressions, dismissals), alert rules | PostgreSQL only | Medium |
| Inventory, cost records, metric summaries | Re-derivable from AWS | Low — rebuilt by the next sync |

The **KMS key is part of every backup**: without it, ExternalIds (and optional access keys) cannot be
decrypted. Never schedule the key for deletion while backups encrypted under it exist.

## Policy

- **RDS automated backups:** enabled, retention **14–35 days**, point-in-time recovery (PITR).
- **Snapshots:** daily automated + a monthly manual snapshot kept 12 months; copy snapshots to a
  second region (encrypted with a key in that region) for regional DR.
- **Encryption:** storage and snapshots encrypted with KMS; snapshots are never shared publicly.
- **Access:** restore permissions limited to a break-glass role; restores are audited via CloudTrail.

## Targets

| | Target | How |
|---|---|---|
| RPO | ≤ 5 minutes | RDS PITR (transaction logs every 5 min) |
| RTO (AZ failure) | ≤ 5 minutes | Multi-AZ automatic failover |
| RTO (region / data corruption) | ≤ 4 hours | Restore snapshot/PITR in DR region, redeploy ECS, point DNS |

Inventory/cost data older than the restore point is rebuilt automatically by the next scheduled sync.

## Restore testing (required)

A backup strategy is incomplete until restoration is tested. **Quarterly:**

1. Restore the latest snapshot (or PITR to "now − 1h") into an isolated VPC/account.
2. Run `npx prisma migrate status` — schema must be current.
3. Start a web + worker task against it with a non-production `APP_URL`.
4. Verify: sign-in works, row counts for users/organisations/audit logs match expectations, the
   audit trigger rejects `UPDATE audit_logs`, and an AWS connection **re-validates** (proves the KMS
   key decrypts restored ExternalIds).
5. Record duration (actual RTO) and data age (actual RPO); file issues for any gap; destroy the
   restored environment.

## Local development

`docker compose` uses a named volume (`pgdata`). `docker compose down -v` deletes it. For a local
backup: `docker compose exec postgres pg_dump -U stratus stratus > backup.sql` (contains encrypted
secrets only; keep it private anyway).
