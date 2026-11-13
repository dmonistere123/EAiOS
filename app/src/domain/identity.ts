/** Display identity only. Profile IDs, chat roles and vendor branding stay stable. */
export function displayName(value: unknown, fallback = 'AI Assistant'): string {
  // Reject line breaks and control characters in public labels and generated prompts.
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' && value.trim().length <= 80 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim() || fallback : fallback;
}
