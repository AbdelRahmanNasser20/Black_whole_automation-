export const RELAY_PROVIDER = Symbol('RELAY_PROVIDER');

export interface RelayParticipant {
  userId: string;
  alias: string;
}

export interface OpenRelaySessionInput {
  contactRequestId: string;
  participantA: RelayParticipant;
  participantB: RelayParticipant;
  ttlSeconds: number;
}

export interface OpenRelaySessionResult {
  providerSessionId: string;
  /** Provider-specific metadata; never includes raw PII. */
  metadata: Record<string, string>;
}

export interface CloseRelaySessionInput {
  providerSessionId: string;
  reason: string;
}

export interface IRelayProvider {
  /** Open a new masked session. Must be idempotent on contactRequestId. */
  open(input: OpenRelaySessionInput): Promise<OpenRelaySessionResult>;

  /** Close a session. Idempotent. */
  close(input: CloseRelaySessionInput): Promise<void>;
}
