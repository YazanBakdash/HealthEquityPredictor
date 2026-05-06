/** Canonical census tract id for Map keys and lookups (matches geo + CSV). */
export function normalizeTractId(value: unknown): string {
  return String(value ?? '').trim().replace(/\.0+$/, '');
}
