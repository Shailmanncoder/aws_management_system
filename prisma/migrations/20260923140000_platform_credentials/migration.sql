-- Platform AWS credentials configurable from inside the app.
--
-- Previously the platform identity could only come from deployment environment variables, so
-- switching a deployment to live AWS meant editing env vars and redeploying — and setting
-- AWS_MODE=live without credentials made the app fail at boot. Storing them here lets the app ask
-- for what it needs and configure itself, with the secret encrypted at rest exactly like a
-- customer connection secret.
CREATE TABLE "platform_credentials" (
  "id"                 TEXT NOT NULL,
  "accessKeyIdEnc"     TEXT NOT NULL,
  "secretAccessKeyEnc" TEXT NOT NULL,
  "awsAccountId"       VARCHAR(12) NOT NULL,
  "principalArn"       TEXT NOT NULL,
  "region"             TEXT NOT NULL,
  "verifiedAt"         TIMESTAMP(3) NOT NULL,
  "configuredById"     UUID NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_credentials_pkey" PRIMARY KEY ("id")
);

-- There is one platform identity per deployment; the id is a fixed literal.
ALTER TABLE "platform_credentials" ADD CONSTRAINT "platform_credentials_singleton" CHECK ("id" = 'singleton');
