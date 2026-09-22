-- Fix: statement-level TRUNCATE triggers ignore the function's return value, so the audit
-- trigger must RAISE explicitly for TRUNCATE (previously only DELETE raised).
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF (NEW.id, NEW."actorType", NEW.action, NEW."targetType", NEW."targetId", NEW."requestId", NEW.outcome,
      NEW.metadata::text, NEW."ipAddress", NEW."userAgent", NEW."createdAt")
     IS DISTINCT FROM
     (OLD.id, OLD."actorType", OLD.action, OLD."targetType", OLD."targetId", OLD."requestId", OLD.outcome,
      OLD.metadata::text, OLD."ipAddress", OLD."userAgent", OLD."createdAt") THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF (NEW."organizationId" IS NOT NULL AND NEW."organizationId" IS DISTINCT FROM OLD."organizationId")
     OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId") THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
