/** Per-box identity comes only from the private, gitignored app/.env.local. */
function localValue(name: string, fallback: string): string {
  const value = (import.meta.env[name] as string | undefined)?.trim();
  return value || fallback;
}

export const AGENT_NAME = localValue('VITE_AGENT_NAME', 'Ally');
export const EXECUTIVE_NAME = localValue('VITE_EXECUTIVE_NAME', 'Executive');

const telegramTarget = (import.meta.env.VITE_TELEGRAM_HOME_DELIVERY as string | undefined)?.trim() ?? '';
export const TELEGRAM_HOME_DELIVERY = /^telegram:-?\d+$/.test(telegramTarget) ? telegramTarget : '';
