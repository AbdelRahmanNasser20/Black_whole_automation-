-- =====================================================================
-- 005_contact_requests_and_relay.sql
-- Contact requests + masked communication sessions.
-- =====================================================================

CREATE TABLE contact_requests (
  id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sender (driver who scanned the plate)
  sender_id           UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Recipient (registered owner of the vehicle)
  recipient_id        UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id          UUID                     NOT NULL REFERENCES vehicle_registrations(id) ON DELETE CASCADE,

  -- Short message (always shown to recipient before they decide).
  -- Length-capped, profanity/PII filtered before write.
  message             TEXT                     NOT NULL,
  -- One of a fixed set of "intent" categories to reduce abuse surface.
  -- e.g. "lights_on", "tire_flat", "blocked_in", "left_item", "kind_note", "other"
  intent              TEXT                     NOT NULL,

  status              contact_request_status   NOT NULL DEFAULT 'pending',

  -- Auto-expire if recipient doesn't act within window.
  expires_at          TIMESTAMPTZ              NOT NULL,
  responded_at        TIMESTAMPTZ,
  -- Cooldown bookkeeping: this many declines start blocking the sender.
  decline_count_at_send INTEGER                NOT NULL DEFAULT 0,

  -- Anti-spam scoring at time of creation.
  abuse_score         SMALLINT                 NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ              NOT NULL DEFAULT NOW(),

  CONSTRAINT cr_no_self_contact CHECK (sender_id <> recipient_id),
  CONSTRAINT cr_message_length  CHECK (char_length(message) BETWEEN 1 AND 280)
);

-- Only ONE pending contact request per (sender, vehicle) at a time.
CREATE UNIQUE INDEX uq_pending_contact_request
  ON contact_requests (sender_id, vehicle_id)
  WHERE status = 'pending';

CREATE INDEX idx_cr_recipient_status ON contact_requests (recipient_id, status, created_at DESC);
CREATE INDEX idx_cr_sender_status    ON contact_requests (sender_id, status, created_at DESC);
CREATE INDEX idx_cr_expires          ON contact_requests (expires_at) WHERE status = 'pending';

CREATE TRIGGER trg_contact_requests_updated_at
  BEFORE UPDATE ON contact_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- relay_sessions: opened only after a contact_request is accepted.
-- A session has two participant aliases (NEVER phone numbers).
-- =====================================================================
CREATE TABLE relay_sessions (
  id                  UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_request_id  UUID                  NOT NULL UNIQUE
                                            REFERENCES contact_requests(id) ON DELETE CASCADE,
  participant_a_id    UUID                  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_b_id    UUID                  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Aliases shown in the chat. Never phone numbers.
  participant_a_alias TEXT                  NOT NULL,
  participant_b_alias TEXT                  NOT NULL,

  status              relay_session_status  NOT NULL DEFAULT 'active',
  -- Pluggable provider identifier (internal | twilio_proxy | bandwidth | sinch).
  provider            TEXT                  NOT NULL DEFAULT 'internal',
  -- Opaque external session id from the provider, if any.
  provider_session_id TEXT,

  expires_at          TIMESTAMPTZ           NOT NULL,
  closed_at           TIMESTAMPTZ,
  closed_reason       TEXT,

  created_at          TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  CONSTRAINT relay_no_self CHECK (participant_a_id <> participant_b_id)
);

CREATE INDEX idx_relay_participant_a ON relay_sessions (participant_a_id, status);
CREATE INDEX idx_relay_participant_b ON relay_sessions (participant_b_id, status);
CREATE INDEX idx_relay_expires       ON relay_sessions (expires_at) WHERE status = 'active';

CREATE TRIGGER trg_relay_sessions_updated_at
  BEFORE UPDATE ON relay_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- relay_events: append-only ledger of everything that happens in a
-- session. Used for moderation, reporting, and trust scoring.
--
-- Message *content* itself is stored encrypted (envelope) in `payload_ct`,
-- so a leak of this table does not directly leak conversations.
-- =====================================================================
CREATE TABLE relay_events (
  id              BIGSERIAL          PRIMARY KEY,
  session_id      UUID               NOT NULL REFERENCES relay_sessions(id) ON DELETE CASCADE,
  actor_id        UUID               REFERENCES users(id) ON DELETE SET NULL,
  kind            relay_event_kind   NOT NULL,
  -- Encrypted blob (AES-GCM) of message body, if any.
  payload_ct      BYTEA,
  payload_key_id  TEXT,
  -- Tags from PII / profanity / spam filters.
  filter_tags     TEXT[],
  metadata        JSONB              NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_relay_events_session ON relay_events (session_id, created_at);
CREATE INDEX idx_relay_events_kind    ON relay_events (kind);
CREATE INDEX idx_relay_events_tags    ON relay_events USING GIN (filter_tags);
