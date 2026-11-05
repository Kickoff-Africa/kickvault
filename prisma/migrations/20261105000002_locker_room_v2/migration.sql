-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('LOGIN', 'API_KEY', 'SSH_KEY', 'SOFTWARE_LICENSE', 'TOKEN', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "InsuranceStatus" AS ENUM ('INSURED', 'UNINSURED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE');

-- CreateEnum
CREATE TYPE "WipeMethod" AS ENUM ('NIST_SP_800_88', 'DOD_5220_22_M', 'PHYSICAL_DESTRUCTION', 'FACTORY_RESET', 'DEGAUSSING');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('ASSET_ACCESS', 'CREDENTIAL_ACCESS', 'PURCHASE');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "FontSizePreference" AS ENUM ('SMALL', 'DEFAULT', 'LARGE');

-- CreateEnum
CREATE TYPE "SidebarPreference" AS ENUM ('EXPANDED', 'COLLAPSED');

-- CreateEnum
CREATE TYPE "SecretMaskPreference" AS ENUM ('BULLETS', 'ASTERISKS', 'DASHES');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('SLACK', 'TEAMS');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totp_secret" TEXT;

-- AlterTable
ALTER TABLE "credentials" ADD COLUMN     "cred_type" "CredentialType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "current_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "policy_ref" TEXT;

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "assignee_id" TEXT,
ADD COLUMN     "category_id" TEXT,
ADD COLUMN     "certificate_hash" TEXT,
ADD COLUMN     "certificate_ref" TEXT,
ADD COLUMN     "department_id" TEXT,
ADD COLUMN     "depreciation_method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
ADD COLUMN     "disposal_notes" TEXT,
ADD COLUMN     "disposed_at" TIMESTAMP(3),
ADD COLUMN     "disposed_by_id" TEXT,
ADD COLUMN     "insurance_status" "InsuranceStatus",
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "policy_ref" TEXT,
ADD COLUMN     "purchase_cost" DECIMAL(14,2),
ADD COLUMN     "purchase_date" DATE,
ADD COLUMN     "recovery_requested_at" TIMESTAMP(3),
ADD COLUMN     "serial_number" TEXT,
ADD COLUMN     "specification" TEXT,
ADD COLUMN     "useful_life_years" INTEGER,
ADD COLUMN     "vendor" TEXT,
ADD COLUMN     "warranty_expiry" DATE,
ADD COLUMN     "wipe_method" "WipeMethod",
ADD COLUMN     "wiped_by" TEXT;

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_checkouts" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "assignee_id" TEXT NOT NULL,
    "checked_out_by_id" TEXT NOT NULL,
    "checked_out_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE NOT NULL,
    "returned_at" TIMESTAMP(3),
    "auto_returned" BOOLEAN NOT NULL DEFAULT false,
    "access_granted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "asset_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_service_records" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "service_date" DATE NOT NULL,
    "technician" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_service_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_attachments" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL DEFAULT 'raw',
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_versions" (
    "id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","user_id")
);

-- CreateTable
CREATE TABLE "team_assets" (
    "team_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "permission" "PermissionLevel" NOT NULL DEFAULT 'VIEW',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_assets_pkey" PRIMARY KEY ("team_id","asset_id")
);

-- CreateTable
CREATE TABLE "team_credentials" (
    "team_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "permission" "PermissionLevel" NOT NULL DEFAULT 'VIEW',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_credentials_pkey" PRIMARY KEY ("team_id","credential_id")
);

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "type" "RequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "requester_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "credential_id" TEXT,
    "reason" TEXT,
    "item_description" TEXT,
    "purchase_cost" DECIMAL(14,2),
    "category_id" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "granted_permission" "PermissionLevel",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL,
    "transaction_alerts" BOOLEAN NOT NULL DEFAULT true,
    "credential_reveal_events" BOOLEAN NOT NULL DEFAULT true,
    "expiry_warnings" BOOLEAN NOT NULL DEFAULT true,
    "critical_events_only" BOOLEAN NOT NULL DEFAULT false,
    "email_digest" BOOLEAN NOT NULL DEFAULT true,
    "weekly_digest" BOOLEAN NOT NULL DEFAULT true,
    "slack_webhook_url" TEXT,
    "theme" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "font_size" "FontSizePreference" NOT NULL DEFAULT 'DEFAULT',
    "sidebar_default" "SidebarPreference" NOT NULL DEFAULT 'EXPANDED',
    "secret_mask" "SecretMaskPreference" NOT NULL DEFAULT 'BULLETS',
    "reduce_motion" BOOLEAN NOT NULL DEFAULT false,
    "login_notifications" BOOLEAN NOT NULL DEFAULT true,
    "require_reauth_for_reveals" BOOLEAN NOT NULL DEFAULT false,
    "session_timeout_min" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_name" TEXT,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "ApiKeyScope" NOT NULL DEFAULT 'READ_ONLY',
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "last_four" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "user_id" TEXT,
    "count" INTEGER NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_delivery_at" TIMESTAMP(3),
    "last_delivery_code" INTEGER,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "webhook_url_enc" TEXT NOT NULL,
    "connected_by_id" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE INDEX "asset_checkouts_asset_id_idx" ON "asset_checkouts"("asset_id");

-- CreateIndex
CREATE INDEX "asset_checkouts_assignee_id_idx" ON "asset_checkouts"("assignee_id");

-- CreateIndex
CREATE INDEX "asset_checkouts_returned_at_due_date_idx" ON "asset_checkouts"("returned_at", "due_date");

-- CreateIndex
CREATE INDEX "asset_service_records_asset_id_idx" ON "asset_service_records"("asset_id");

-- CreateIndex
CREATE INDEX "asset_attachments_asset_id_idx" ON "asset_attachments"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "credential_versions_credential_id_version_key" ON "credential_versions"("credential_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE INDEX "team_members_user_id_idx" ON "team_members"("user_id");

-- CreateIndex
CREATE INDEX "team_assets_asset_id_idx" ON "team_assets"("asset_id");

-- CreateIndex
CREATE INDEX "team_credentials_credential_id_idx" ON "team_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "access_requests_status_idx" ON "access_requests"("status");

-- CreateIndex
CREATE INDEX "access_requests_requester_id_idx" ON "access_requests"("requester_id");

-- CreateIndex
CREATE INDEX "access_requests_type_idx" ON "access_requests"("type");

-- CreateIndex
CREATE INDEX "login_events_user_id_created_at_idx" ON "login_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "alert_rules_action_type_enabled_idx" ON "alert_rules"("action_type", "enabled");

-- CreateIndex
CREATE INDEX "alert_events_rule_id_user_id_triggered_at_idx" ON "alert_events"("rule_id", "user_id", "triggered_at");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_provider_key" ON "integrations"("provider");

-- CreateIndex
CREATE INDEX "credentials_cred_type_idx" ON "credentials"("cred_type");

-- CreateIndex
CREATE UNIQUE INDEX "assets_certificate_ref_key" ON "assets"("certificate_ref");

-- CreateIndex
CREATE INDEX "assets_category_id_idx" ON "assets"("category_id");

-- CreateIndex
CREATE INDEX "assets_assignee_id_idx" ON "assets"("assignee_id");

-- CreateIndex
CREATE INDEX "assets_department_id_idx" ON "assets"("department_id");

-- ─── Data migration ──────────────────────────────────────────────────────────

-- Seed the four built-in categories and map every existing asset onto one of them.
INSERT INTO "categories" ("id", "name", "prefix") VALUES
  ('cat_hardware',   'Hardware',   'HW'),
  ('cat_software',   'Software',   'SW'),
  ('cat_digital',    'Digital',    'DG'),
  ('cat_intangible', 'Intangible', 'IG');

UPDATE "assets" SET "category_id" = CASE "category"::text
  WHEN 'HARDWARE' THEN 'cat_hardware'
  WHEN 'SOFTWARE' THEN 'cat_software'
  WHEN 'DIGITAL'  THEN 'cat_digital'
  ELSE 'cat_intangible'
END;

ALTER TABLE "assets" ALTER COLUMN "category_id" SET NOT NULL;
DROP INDEX "assets_category_idx";
ALTER TABLE "assets" DROP COLUMN "category";
DROP TYPE "AssetCategory";

-- Every existing credential gets version 1 = its current secret.
INSERT INTO "credential_versions" ("id", "credential_id", "version", "encrypted_value", "iv", "auth_tag", "key_version", "created_by_id", "created_at")
SELECT 'cv_' || "id", "id", 1, "encrypted_value", "iv", "auth_tag", "key_version", "created_by_id", "created_at"
FROM "credentials" WHERE "deleted_at" IS NULL;

-- Before this release VIEW access allowed revealing the secret. VIEW is now "view only"
-- and COPY is the level that may reveal, so existing grantees are moved to COPY to keep their access.
UPDATE "credential_access" SET "permission" = 'COPY' WHERE "permission" = 'VIEW';


-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_checkouts" ADD CONSTRAINT "asset_checkouts_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_service_records" ADD CONSTRAINT "asset_service_records_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_versions" ADD CONSTRAINT "credential_versions_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_assets" ADD CONSTRAINT "team_assets_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_assets" ADD CONSTRAINT "team_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_credentials" ADD CONSTRAINT "team_credentials_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_credentials" ADD CONSTRAINT "team_credentials_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

