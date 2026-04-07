-- =====================================================================
-- 006_safety_blocks_reports_sanctions.sql
-- User-level safety: blocks, reports, sanctions, and audit log.
-- =====================================================================

CREATE TABLE blocks (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_id),
  CONSTRAINT blocks_unique_pair   UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX idx_blocks_blocker ON blocks (blocker_id);
CREATE INDEX idx_blocks_blocked ON blocks (blocked_id);


-- =====================================================================
-- abuse_reports: user-submitted reports against another user or content.
-- =====================================================================
CREATE TABLE abuse_reports (
  id                  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id         UUID                 NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  reported_user_id    UUID                 REFERENCES users(id) ON DELETE SET NULL,
  -- Optional context links.
  contact_request_id  UUID                 REFERENCES contact_requests(id) ON DELETE SET NULL,
  relay_session_id    UUID                 REFERENCES relay_sessions(id)   ON DELETE SET NULL,
  vehicle_id          UUID                 REFERENCES vehicle_registrations(id) ON DELETE SET NULL,

  kind                abuse_report_kind    NOT NULL,
  description         TEXT,
  -- Snapshots of evidence (e.g. message excerpts) at report time.
  evidence            JSONB                NOT NULL DEFAULT '{}'::JSONB,

  status              abuse_report_status  NOT NULL DEFAULT 'open',
  assigned_to         UUID                 REFERENCES users(id) ON DELETE SET NULL,
  resolution_note     TEXT,
  resolved_at         TIMESTAMPTZ,

  created_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_status   ON abuse_reports (status, created_at DESC);
CREATE INDEX idx_reports_reporter ON abuse_reports (reporter_id);
CREATE INDEX idx_reports_reported ON abuse_reports (reported_user_id);

CREATE TRIGGER trg_abuse_reports_updated_at
  BEFORE UPDATE ON abuse_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- sanctions: enforcement actions taken against users.
-- A user can have multiple sanctions; effective state = union of active.
-- =====================================================================
CREATE TABLE sanctions (
  id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          sanction_kind    NOT NULL,
  status        sanction_status  NOT NULL DEFAULT 'active',
  reason        TEXT             NOT NULL,
  -- Source: which abuse_report or system rule triggered this.
  source        TEXT             NOT NULL,        -- e.g. "report:<uuid>" or "rule:plate_scan_burst"
  source_ref    UUID,
  -- Optional duration; NULL = indefinite.
  starts_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  ends_at       TIMESTAMPTZ,
  issued_by     UUID             REFERENCES users(id) ON DELETE SET NULL,
  lifted_at     TIMESTAMPTZ,
  lifted_by     UUID             REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sanctions_user_active
  ON sanctions (user_id) WHERE status = 'active';
CREATE INDEX idx_sanctions_ends_at
  ON sanctions (ends_at) WHERE status = 'active' AND ends_at IS NOT NULL;

CREATE TRIGGER trg_sanctions_updated_at
  BEFORE UPDATE ON sanctions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- audit_logs: append-only record of every privileged action.
-- This table is the source of truth for compliance / incident response.
-- Partitioned by month in production (see comment below).
-- =====================================================================
CREATE TABLE audit_logs (
  id            BIGSERIAL          PRIMARY KEY,
  actor_kind    audit_actor_kind   NOT NULL,
  actor_id      UUID,
  action        TEXT               NOT NULL,    -- e.g. "vehicle.verify", "user.suspend"
  target_kind   TEXT,                            -- e.g. "user", "vehicle", "contact_request"
  target_id     UUID,
  ip            INET,
  user_agent    TEXT,
  request_id    TEXT,
  metadata      JSONB              NOT NULL DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_action  ON audit_logs (action, created_at DESC);
CREATE INDEX idx_audit_actor   ON audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_audit_target  ON audit_logs (target_kind, target_id, created_at DESC);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);

-- NOTE: in production convert audit_logs to a monthly RANGE partition on
-- created_at. We keep it un-partitioned in MVP for migration simplicity.
