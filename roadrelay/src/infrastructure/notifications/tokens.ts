export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface SmsPayload {
  toPhoneE164: string;
  body: string;
  /** Optional opaque correlation id used by the provider for deduping. */
  correlationId?: string;
}

export interface INotificationProvider {
  send(payload: PushPayload): Promise<void>;
}

export interface ISmsProvider {
  send(payload: SmsPayload): Promise<void>;
}
