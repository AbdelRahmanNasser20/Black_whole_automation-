-- =====================================================================
-- 004_plate_search_logs.sql
-- Every plate lookup is logged for abuse detection. Note: we record the
-- HASH of the plate, not the raw value, to limit the blast radius if
-- this table is ever leaked.
-- =====================================================================

CREATE TABLE plate_search_logs (
  id                  BIGSERIAL    PRIMARY KEY,
  user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id           UUID         REFERENCES devices(id) ON DELETE SET NULL,
  -- HMAC(server_secret, state_code || ':' || plate_normalized)
  plate_query_hash    BYTEA        NOT NULL,
  state_code          CHAR(2)      NOT NULL,
  -- Did we find a registered vehicle?
  matched             BOOLEAN      NOT NULL,
  -- If matched, which vehicle (nullable; vehicle may be deleted later).
  matched_vehicle_id  UUID         REFERENCES vehicle_registrations(id) ON DELETE SET NULL,

  ip                  INET,
  user_agent          TEXT,
  -- Geo coarsened to city / region (never full lat/lon).
  geo_region          TEXT,

  -- For anomaly detection: how this lookup scored on the trust pipeline.
  abuse_score         SMALLINT     NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_psl_user_created  ON plate_search_logs (user_id, created_at DESC);
CREATE INDEX idx_psl_device_created ON plate_search_logs (device_id, created_at DESC);
CREATE INDEX idx_psl_plate_hash    ON plate_search_logs (plate_query_hash, created_at DESC);
CREATE INDEX idx_psl_ip_created    ON plate_search_logs (ip, created_at DESC);
CREATE INDEX idx_psl_created       ON plate_search_logs (created_at DESC);
