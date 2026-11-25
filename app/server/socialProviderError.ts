import { SocialError } from './socialStore.ts';

/** Read a bounded error envelope; never expose upstream messages, prompts or arbitrary codes. */
export async function generationProviderError(response: Response): Promise<SocialError> {
  let code = '', type = '', param = '';
  const reader = response.body?.getReader();
  if (reader) {
    try {
      const parts: Uint8Array[] = []; let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 16384) throw new Error('Error body limit');
        parts.push(next.value);
      }
      const value = JSON.parse(Buffer.concat(parts).toString())?.error;
      if (value && typeof value === 'object') {
        code = typeof value.code === 'string' ? value.code : '';
        type = typeof value.type === 'string' ? value.type : '';
        param = typeof value.param === 'string' ? value.param : '';
      }
    } catch { /* Malformed, oversized and interrupted responses remain generic. */ }
    finally { await reader.cancel().catch(() => {}); }
  }
  let category = 'unknown', explanation = 'Check the provider configuration.';
  if (['model_not_found','model_not_available','model_deprecated'].includes(code)) {
    category = 'model'; explanation = 'The configured generation model is unavailable. Check the model setting and account access.';
  } else if (['content_policy_violation','moderation_blocked','safety_violation'].includes(code)) {
    category = 'content'; explanation = 'The provider rejected this content. Review the image description or brief.';
  } else if (['insufficient_quota','billing_hard_limit_reached','billing_not_active'].includes(code)) {
    category = 'billing'; explanation = 'Check the provider account billing and quota.';
  } else if (response.status === 401 || code === 'invalid_api_key') {
    category = 'authentication'; explanation = 'Check the configured provider API key.';
  } else if (response.status === 403 || ['permission_denied','organization_verification_required'].includes(code)) {
    category = 'access'; explanation = 'Check the provider account permissions and verification.';
  } else if (response.status === 429) {
    category = 'rate_limit'; explanation = 'The provider rate limit was reached. Wait before submitting a new request.';
  } else if (['invalid_parameter','unsupported_parameter','invalid_value'].includes(code) || type === 'invalid_request_error') {
    category = 'request'; explanation = param === 'model' ? 'The provider rejected the model setting. Check the configured model.' : 'The provider rejected a request option. Check the generation settings.';
  }
  const header = response.headers.get('x-request-id');
  const requestId = header && /^req_[a-zA-Z0-9_-]{1,120}$/.test(header) ? header : undefined;
  const error = new SocialError(502, `Generation provider returned HTTP ${response.status}. ${explanation} No automatic retry was made.${requestId ? ` Reference: ${requestId}.` : ''}`);
  error.provider = { status: response.status, category, ...(requestId ? { requestId } : {}) };
  return error;
}
