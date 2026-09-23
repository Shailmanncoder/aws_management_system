-- Records whether an account's stored data came from a fixture-mode sync.
--
-- The "synthetic data" banner previously keyed off the AWS_MODE environment variable, which
-- describes the running process, not the data. After restoring a real database into a deployment
-- configured for fixtures, that banner declared genuine data to be fake. Existing rows default to
-- false: every sync that produced them ran against a real AWS account.
ALTER TABLE "aws_accounts" ADD COLUMN "syntheticData" BOOLEAN NOT NULL DEFAULT false;
