-- =====================================================================
-- 003_vehicles.sql
-- Vehicle registrations + verification artifacts.
--
-- Plate normalization: plate_normalized = uppercase, no whitespace,
-- no punctuation. Lookups use (state_code, plate_normalized).
-- =====================================================================

CREATE TABLE vehicle_registrations (
  id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID                NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  plate_raw           TEXT                NOT NULL,           -- exact user input
  plate_normalized    TEXT                NOT NULL,           -- canonical form
  state_code          CHAR(2)             NOT NULL,           -- ISO/USPS 2-letter
  country_code        CHAR(2)             NOT NULL DEFAULT 'US',

  make                TEXT,
  model               TEXT,
  year                SMALLINT,
  color               TEXT,
  vin_last_four       CHAR(4),

  status              vehicle_status      NOT NULL DEFAULT 'unverified',
  visibility          vehicle_visibility  NOT NULL DEFAULT 'public',

  -- Reviewer metadata
  verified_at         TIMESTAMPTZ,
  verified_by         UUID                REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason    TEXT,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,

  -- Soft-delete (so we keep audit trail of historical claims).
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT veh_year_range CHECK (year IS NULL OR (year BETWEEN 1900 AND 2100)),
  CONSTRAINT veh_plate_normalized_len CHECK (char_length(plate_normalized) BETWEEN 1 AND 10)
);

-- Only ONE active VERIFIED registration per (state, plate). Multiple users
-- may have UNVERIFIED claims simultaneously, but verification is exclusive.
CREATE UNIQUE INDEX uq_vehicle_active_verified
  ON vehicle_registrations (state_code, plate_normalized)
  WHERE status = 'verified' AND deleted_at IS NULL;

-- Lookup index (used by plate search).
CREATE INDEX idx_vehicle_lookup
  ON vehicle_registrations (state_code, plate_normalized)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_vehicle_user
  ON vehicle_registrations (user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_vehicle_status
  ON vehicle_registrations (status)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_vehicle_registrations_updated_at
  BEFORE UPDATE ON vehicle_registrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- vehicle_verification_artifacts
-- Documents/photos uploaded to S3, referenced here. Files are scanned
-- before being made available to reviewers (clamav / cloud scanner).
-- =====================================================================
CREATE TABLE vehicle_verification_artifacts (
  id                 UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id         UUID             NOT NULL REFERENCES vehicle_registrations(id) ON DELETE CASCADE,
  uploaded_by        UUID             NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  kind               artifact_kind    NOT NULL,
  status             artifact_status  NOT NULL DEFAULT 'uploaded',

  -- Storage details
  storage_key        TEXT             NOT NULL,
  storage_bucket     TEXT             NOT NULL,
  content_type       TEXT             NOT NULL,
  bytes              BIGINT           NOT NULL,
  sha256             BYTEA            NOT NULL,

  -- Scan / review
  scan_provider      TEXT,
  scan_result        TEXT,
  scanned_at         TIMESTAMPTZ,
  reviewer_notes     TEXT,

  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT artifact_bytes_positive CHECK (bytes > 0)
);

CREATE INDEX idx_artifact_vehicle ON vehicle_verification_artifacts (vehicle_id);
CREATE INDEX idx_artifact_status  ON vehicle_verification_artifacts (status);

CREATE TRIGGER trg_vehicle_artifacts_updated_at
  BEFORE UPDATE ON vehicle_verification_artifacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
