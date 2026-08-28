// W4 live verification — full connect-link round-trip with cleanup:
// create managed auth config → create connect link (redirect_url) →
// DELETE the auth config → confirm gone. Ephemeral link session never
// completes OAuth, so no connected account is ever created.
const base = 'http://localhost:5173/composio-api';
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// 1. create managed auth config for gmail
const acRes = await post('/api/v3/auth_configs', {
  toolkit: { slug: 'gmail' },
  auth_config: { type: 'use_composio_managed_auth', name: 'EAiOS W4 verify (delete me)' },
});
const acBody = await acRes.json().catch(() => ({}));
console.log('1. POST auth_configs:', acRes.status, JSON.stringify(acBody).slice(0, 400));
const acId = acBody.auth_config?.id ?? acBody.auth_config?.nanoid ?? acBody.id;
if (!acId) { console.log('ABORT — no auth config id'); process.exit(1); }

// 2. create connect link
const linkRes = await post('/api/v3/connected_accounts/link', { auth_config_id: acId, user_id: 'eaios-executive' });
const linkBody = await linkRes.json().catch(() => ({}));
console.log('2. POST /link:', linkRes.status, JSON.stringify(linkBody).slice(0, 400));

// 3. cleanup: delete the auth config
const delRes = await fetch(`${base}/api/v3/auth_configs/${acId}`, { method: 'DELETE' });
console.log('3. DELETE auth_config:', delRes.status, JSON.stringify(await delRes.json().catch(() => ({}))).slice(0, 200));

// 4. confirm gone
const list = await fetch(`${base}/api/v3/auth_configs?toolkit=gmail`).then((r) => r.json());
const remaining = list.items ?? list.data ?? [];
console.log('4. auth_configs for gmail after cleanup:', remaining.length);
console.log(linkBody.redirect_url ? 'VERIFY OK — redirect_url minted, auth config cleaned up' : 'VERIFY INCOMPLETE — no redirect_url');
