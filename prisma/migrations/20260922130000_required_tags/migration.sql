-- Per-workspace required tag keys for the "missing required tags" optimisation rule.
ALTER TABLE "organizations" ADD COLUMN "requiredTagKeys" TEXT[] DEFAULT ARRAY['env', 'team']::TEXT[];
