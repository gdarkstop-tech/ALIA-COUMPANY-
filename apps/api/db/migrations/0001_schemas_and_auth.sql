-- 0001 — Schemas and Better Auth tables
--
-- Role model (created by scripts/db-bootstrap.sh):
--   ghayarly_owner : owns every object here; used only by migrations/seed.
--   ghayarly_auth  : Better Auth. Full access to the `auth` schema only.
--   ghayarly_app   : domain API. Never owner, NOBYPASSRLS. Sees only a minimal column set of
--                    auth."user" through RLS; never password hashes, tokens or 2FA secrets.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO ghayarly_auth, ghayarly_app;
GRANT USAGE ON SCHEMA app TO ghayarly_app;

-- Generated from the Better Auth 1.7.7 configuration (see apps/api/src/auth/auth.ts) and
-- committed as explicit SQL so schema changes are reviewed like any other migration.
CREATE TABLE auth."user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "phoneNumber" text UNIQUE,
  "phoneNumberVerified" boolean,
  "twoFactorEnabled" boolean
);

CREATE TABLE auth."session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE
);

CREATE TABLE auth."account" (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE auth."verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE auth."twoFactor" (
  "id" text NOT NULL PRIMARY KEY,
  "secret" text NOT NULL,
  "backupCodes" text NOT NULL,
  "userId" text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  "verified" boolean,
  "failedVerificationCount" integer,
  "lockedUntil" timestamptz
);

CREATE TABLE auth."rateLimit" (
  "id" text NOT NULL PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

CREATE INDEX "session_userId_idx" ON auth."session" ("userId");
CREATE INDEX "account_userId_idx" ON auth."account" ("userId");
CREATE INDEX "verification_identifier_idx" ON auth."verification" ("identifier");
CREATE INDEX "twoFactor_secret_idx" ON auth."twoFactor" ("secret");
CREATE INDEX "twoFactor_userId_idx" ON auth."twoFactor" ("userId");

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO ghayarly_auth;

-- The domain role may read only non-secret identity columns of users.
GRANT SELECT ("id", "name", "email", "emailVerified", "phoneNumber", "phoneNumberVerified", "twoFactorEnabled", "createdAt")
  ON auth."user" TO ghayarly_app;
