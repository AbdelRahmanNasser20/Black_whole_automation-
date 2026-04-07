import { Injectable, Logger } from '@nestjs/common';

export interface FilterResult {
  cleaned: string;
  tags: string[];
  blocked: boolean;
}

// IMPORTANT: do NOT use /g with .test() — `lastIndex` is shared state
// across calls and will produce intermittent false negatives. We do the
// replace and compare lengths instead of testing first.
const PHONE_REGEX = /(\+?\d[\d\s().-]{6,}\d)/g;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL_REGEX = /\b((https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,})\b/gi;

const HARD_BAN = [
  /\bkill\s+yourself\b/i,
  /\bdie\b/i,
  /\bn[i1]gg(er|a)\b/i,
  /\bf[a@]g/i,
];

/**
 * Lightweight content filter for contact request bodies & relay messages.
 *
 *  - Strips PII (phone, email, URLs) and tags the message accordingly.
 *  - Hard-bans messages that match the slur/violence list.
 *  - Returns a cleaned version + a tag list that gets persisted.
 *
 * The MVP intentionally ships a static rule set; the interface is shaped
 * so we can replace it with a model-backed classifier later without
 * touching call sites.
 */
@Injectable()
export class ContentFilterService {
  private readonly logger = new Logger(ContentFilterService.name);

  filter(text: string): FilterResult {
    const tags: string[] = [];
    let cleaned = text.trim();

    if (!cleaned) {
      return { cleaned: '', tags: ['empty'], blocked: true };
    }

    for (const pattern of HARD_BAN) {
      if (pattern.test(cleaned)) {
        return { cleaned: '', tags: ['hate_or_threats'], blocked: true };
      }
    }

    // String#replace with a /g regex creates a fresh iterator on each
    // call, so it's safe to call repeatedly. Detect a match by comparing
    // before/after instead of running .test() first (which would mutate
    // the regex `lastIndex`).
    {
      const next = cleaned.replace(PHONE_REGEX, '[redacted]');
      if (next !== cleaned) {
        tags.push('pii_phone');
        cleaned = next;
      }
    }
    {
      const next = cleaned.replace(EMAIL_REGEX, '[redacted]');
      if (next !== cleaned) {
        tags.push('pii_email');
        cleaned = next;
      }
    }
    {
      const next = cleaned.replace(URL_REGEX, '[link]');
      if (next !== cleaned) {
        tags.push('contains_url');
        cleaned = next;
      }
    }

    if (cleaned.length > 280) cleaned = cleaned.slice(0, 280);

    return { cleaned, tags, blocked: false };
  }
}
