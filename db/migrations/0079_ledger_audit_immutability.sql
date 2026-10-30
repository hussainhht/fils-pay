-- Ledger lines are append-only. The balance trigger in 0007 rejects an
-- unbalanced edit, and a balanced UPDATE or DELETE of a whole group still
-- committed. Corrections are new entries.
--
-- admin_audit_log is append-only except the completion writer in
-- apps/api/src/adminAudit/log.ts (markAdminAuditOutcome), which runs:
--   UPDATE admin_audit_log
--      SET outcome = $2, metadata = metadata || $3::jsonb
--    WHERE id = $1
-- A blanket UPDATE ban would break that writer. Every other column, and
-- every DELETE, stays forbidden.

CREATE FUNCTION reject_ledger_entry_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries are append-only';
END;
$$;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION reject_ledger_entry_mutation();

CREATE FUNCTION reject_admin_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admin_audit_log rows cannot be deleted';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.admin_user_id IS DISTINCT FROM OLD.admin_user_id
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'admin_audit_log only allows outcome and metadata completion updates';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_audit_log_immutable
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION reject_admin_audit_log_mutation();
