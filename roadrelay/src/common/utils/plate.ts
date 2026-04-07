/**
 * Plate normalization. Converts user input to a canonical, comparable form.
 *
 *  - Uppercase
 *  - Strip whitespace and punctuation (- · . ' )
 *  - Strip diacritics
 *  - Reject empty / overly long results
 */
export function normalizePlate(raw: string): string {
  if (!raw) throw new Error('plate is empty');
  const stripped = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s\-·.'`]/g, '');
  if (stripped.length === 0 || stripped.length > 10) {
    throw new Error('plate normalization produced an invalid value');
  }
  if (!/^[A-Z0-9]+$/.test(stripped)) {
    throw new Error('plate contains unsupported characters');
  }
  return stripped;
}

/**
 * Normalises (state, plate) into the canonical key used for hashing
 * and exact-match lookup.
 */
export function plateLookupKey(stateCode: string, plate: string): string {
  if (!/^[A-Z]{2}$/.test(stateCode)) {
    throw new Error(`invalid state code: ${stateCode}`);
  }
  return `${stateCode}:${normalizePlate(plate)}`;
}
