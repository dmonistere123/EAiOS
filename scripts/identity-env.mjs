import { pathToFileURL } from 'node:url';

/** A single display value that both dotenv and existing shell launchers read literally. */
export function quoteDisplayName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f"\\$`]/.test(name)) {
    throw new Error('Use 1–80 characters without control characters, double quotes, backslashes, dollars or backticks.');
  }
  return `"${name}"`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(quoteDisplayName(process.argv[2])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
