// W4 probe — the two NEW Composio surfaces: /auth_configs shape and the
// /connected_accounts/link connect-link flow (safe: a link session is
// ephemeral; no connected account exists until OAuth completes in the
// hosted page — we never complete it). Also re-checks toolkit catalog
// size + deprecated-field prevalence to decide filtering.
const base = 'http://localhost:5173/composio-api';
const j = (r) => r.json();

const kits = await fetch(`${base}/api/v3/toolkits?limit=100`).then(j);
const items = kits.items ?? kits.data ?? [];
console.log('toolkits: total_items', items.length, 'total?', kits.total_items ?? kits.total ?? '?');
console.log('deprecated non-null:', items.filter((t) => t.deprecated).length);
console.log('no_auth true:', items.filter((t) => t.no_auth).length);
console.log('sample slugs:', items.slice(0, 12).map((t) => t.slug).join(', '));

const ac = await fetch(`${base}/api/v3/auth_configs?toolkit=gmail`).then(j);
const configs = ac.items ?? ac.data ?? (Array.isArray(ac) ? ac : []);
console.log('\nauth_configs for gmail:', configs.length);
console.log('config[0] fields:', configs[0] ? Object.keys(configs[0]).join(', ') : '(none)');
console.log('config[0]:', JSON.stringify(configs[0]).slice(0, 700));

const managed = configs.find((c) => c.is_composio_managed || c.type === 'default' || c.is_default);
console.log('\nmanaged config picked:', managed ? managed.id ?? managed.nanoid : '(none found)');
if (managed) {
  const res = await fetch(`${base}/api/v3/connected_accounts/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_config_id: managed.id ?? managed.nanoid, user_id: 'eaios-executive' }),
  });
  const body = await res.json().catch(() => ({}));
  console.log('POST /link status:', res.status);
  console.log('link response fields:', Object.keys(body).join(', '));
  console.log('link response:', JSON.stringify(body).slice(0, 500));
}
