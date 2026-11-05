-- The audit_logs trigger blocked every DELETE, including the ON DELETE CASCADE from users
-- (added in 20260805000003). Permanently deleting any user who had an audit entry therefore failed.
--
-- Allow a DELETE only when it is fired by the foreign-key cascade of deleting the owning user
-- (the cascade runs inside an RI trigger, so pg_trigger_depth() > 1). A direct
-- `DELETE FROM audit_logs ...` (depth 1) and every UPDATE are still rejected.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs table is append-only: % operations are forbidden', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
