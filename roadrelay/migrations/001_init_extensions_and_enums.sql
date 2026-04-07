-- =====================================================================
-- 001_init_extensions_and_enums.sql
-- Extensions, enum types, and shared helpers.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive text
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fuzzy / partial search

-- ----- enums -----------------------------------------------------------
CREATE TYPE user_status        AS ENUM ('pending', 'active', 'suspended', 'banned', 'deleted');
CREATE TYPE user_role          AS ENUM ('user', 'moderator', 'admin');
CREATE TYPE device_platform    AS ENUM ('ios', 'android', 'web');

CREATE TYPE vehicle_status     AS ENUM (
  'unverified',     -- newly added, no docs submitted
  'pending_review', -- docs submitted, awaiting human review
  'verified',       -- approved
  'rejected',       -- denied verification
  'revoked'         -- previously verified, now revoked
);
CREATE TYPE vehicle_visibility AS ENUM ('public', 'private', 'hidden');

CREATE TYPE artifact_kind      AS ENUM (
  'registration_doc',
  'insurance_card',
  'vehicle_photo_front',
  'vehicle_photo_rear',
  'vehicle_photo_vin',
  'driver_license',
  'other'
);
CREATE TYPE artifact_status    AS ENUM ('uploaded', 'scanning', 'clean', 'rejected', 'expired');

CREATE TYPE contact_request_status AS ENUM (
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
  'blocked'
);

CREATE TYPE relay_session_status AS ENUM ('active', 'closed', 'expired', 'terminated');
CREATE TYPE relay_event_kind     AS ENUM (
  'message_sent',
  'message_blocked',
  'session_opened',
  'session_closed',
  'attachment_blocked',
  'profanity_filtered',
  'pii_filtered'
);

CREATE TYPE abuse_report_kind AS ENUM (
  'harassment',
  'spam',
  'scam',
  'impersonation',
  'threats',
  'sexual_content',
  'illegal_activity',
  'other'
);
CREATE TYPE abuse_report_status AS ENUM ('open', 'triaging', 'actioned', 'dismissed');

CREATE TYPE sanction_kind AS ENUM (
  'warning',
  'rate_limited',
  'feature_locked',
  'shadowbanned',
  'suspended',
  'banned'
);
CREATE TYPE sanction_status AS ENUM ('active', 'expired', 'lifted');

CREATE TYPE audit_actor_kind AS ENUM ('user', 'admin', 'system', 'job');

-- ----- updated_at trigger function ------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
