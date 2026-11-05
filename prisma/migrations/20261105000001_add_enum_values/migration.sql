-- Adds enum values in their own migration: Postgres cannot use a newly added enum
-- value inside the same transaction, and the next migration backfills with 'COPY'.

-- AlterEnum
ALTER TYPE "AssetStatus" ADD VALUE 'DISPOSED';

-- AlterEnum
ALTER TYPE "PermissionLevel" ADD VALUE 'COPY';
