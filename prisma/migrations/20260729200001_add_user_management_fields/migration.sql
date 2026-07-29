ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "invite_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "invite_token_expiry" TIMESTAMP(3);
