-- =====================================================================
-- 002_users_and_devices.sql
-- Identity, devices, and OTP verification.
--
-- PII strategy:
--   - phone_number_e164 is stored ENCRYPTED at the application layer.
--   - phone_number_hash is a deterministic HMAC-SHA256 used for lookups.
--   - Never log raw phone numbers; only display_name + masked tail.
-- =====================================================================

CREATE TABLE users (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- HMAC(server_secret, e164) - deterministic, indexable, irreversible.
  phone_number_hash        BYTEA        NOT NULL,
  -- AES-GCM ciphertext (envelope-encrypted with KMS key id).
  phone_number_ciphertext  BYTEA        NOT NULL,
  phone_key_id             TEXT         NOT NULL,
  phone_last_four          CHAR(4)      NOT NULL,
  display_name             TEXT,
  avatar_url               TEXT,
  status                   user_status  NOT NULL DEFAULT 'pending',
  role                     user_role    NOT NULL DEFAULT 'user',
  -- 0..1000, see trust scoring docs
  trust_score              INTEGER      NOT NULL DEFAULT 500,
  failed_otp_attempts      INTEGER      NOT NULL DEFAULT 0,
  last_login_at            TIMESTAMPTZ,
  phone_verified_at        TIMESTAMPTZ,
  terms_accepted_at        TIMESTAMPTZ,
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT users_phone_hash_unique UNIQUE (phone_number_hash),
  CONSTRAINT users_trust_score_range CHECK (trust_score BETWEEN 0 AND 1000)
);

CREATE INDEX idx_users_status      ON users (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role        ON users (role)   WHERE deleted_at IS NULL;
CREATE INDEX idx_users_created_at  ON users (created_at DESC);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- devices: each install of the mobile app
-- Used for push notifications, device-binding, and abuse tracking.
-- =====================================================================
CREATE TABLE devices (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        device_platform NOT NULL,
  -- App-generated stable id (keychain / keystore backed).
  install_id      TEXT            NOT NULL,
  -- Push token (FCM / APNs); rotated frequently.
  push_token      TEXT,
  app_version     TEXT,
  os_version      TEXT,
  model           TEXT,
  ip_last_seen    INET,
  user_agent      TEXT,
  -- Device fingerprint (hash of stable signals); used by anomaly detection.
  fingerprint     BYTEA,
  is_trusted      BOOLEAN         NOT NULL DEFAULT FALSE,
  revoked_at      TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT devices_install_unique UNIQUE (user_id, install_id)
);

CREATE INDEX idx_devices_user        ON devices (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_devices_fingerprint ON devices (fingerprint) WHERE revoked_at IS NULL;
CREATE INDEX idx_devices_last_seen   ON devices (last_seen_at DESC);

CREATE TRIGGER trg_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- otp_challenges: OTP verification ledger.
-- Stored as Argon2 hash, never plaintext. TTL enforced in app + cleanup job.
-- =====================================================================
CREATE TABLE otp_challenges (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_hash   BYTEA        NOT NULL,
  code_hash           TEXT         NOT NULL,
  purpose             TEXT         NOT NULL,        -- signup | login | rebind
  attempts            INTEGER      NOT NULL DEFAULT 0,
  max_attempts        INTEGER      NOT NULL DEFAULT 5,
  ip                  INET,
  user_agent          TEXT,
  consumed_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ  NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_phone_active
  ON otp_challenges (phone_number_hash)
  WHERE consumed_at IS NULL;

CREATE INDEX idx_otp_expires_at
  ON otp_challenges (expires_at)
  WHERE consumed_at IS NULL;
