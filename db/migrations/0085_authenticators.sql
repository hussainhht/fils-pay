-- Authenticator state is deliberately separated between identity planes.
-- Secrets are AES-256-GCM ciphertext; recovery values are hashes only.
CREATE TABLE merchant_authenticators (
  user_id UUID PRIMARY KEY REFERENCES merchant_users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT,
  enabled_at TIMESTAMPTZ,
  last_used_step BIGINT,
  recovery_hashes TEXT[] NOT NULL DEFAULT '{}',
  pending_ciphertext TEXT,
  pending_id UUID,
  pending_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  pending_expires_at TIMESTAMPTZ,
  pending_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pending_attempts BETWEEN 0 AND 5),
  CHECK ((secret_ciphertext IS NULL) = (enabled_at IS NULL))
);

CREATE TABLE admin_authenticators (
  user_id UUID PRIMARY KEY REFERENCES admin_users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT,
  enabled_at TIMESTAMPTZ,
  last_used_step BIGINT,
  recovery_hashes TEXT[] NOT NULL DEFAULT '{}',
  pending_ciphertext TEXT,
  pending_id UUID,
  pending_session_id UUID REFERENCES admin_sessions(id) ON DELETE SET NULL,
  pending_expires_at TIMESTAMPTZ,
  pending_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pending_attempts BETWEEN 0 AND 5),
  CHECK ((secret_ciphertext IS NULL) = (enabled_at IS NULL))
);
