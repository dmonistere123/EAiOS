/** Send already-confined artifact bytes. Supports one byte range for native media seeking. */
export function sendArtifactBytes(
  req: { method?: string; headers?: { range?: string; 'if-range'?: string } },
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: Buffer | string) => unknown },
  data: Buffer,
) {
  res.setHeader('Accept-Ranges', 'bytes');
  let start = 0, end = data.length - 1;
  const range = req.method === 'GET' && !req.headers?.['if-range'] ? req.headers?.range : undefined;
  // Unknown units, malformed syntax and multi-range requests are ignored (full response).
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const left = match[1] ? Number(match[1]) : undefined;
    const right = match[2] ? Number(match[2]) : undefined;
    const invalid = data.length === 0 ||
      (left !== undefined && (!Number.isSafeInteger(left) || left >= data.length)) ||
      (right !== undefined && !Number.isSafeInteger(right)) ||
      (left !== undefined && right !== undefined && left > right) ||
      (left === undefined && right === 0);
    if (invalid) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${data.length}`);
      res.setHeader('Content-Length', '0');
      res.end(''); return;
    }
    start = left ?? Math.max(0, data.length - right!);
    end = left === undefined ? data.length - 1 : Math.min(right ?? data.length - 1, data.length - 1);
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
  } else {
    res.statusCode = 200;
  }
  res.setHeader('Content-Length', String(Math.max(0, end - start + 1)));
  res.end(req.method === 'HEAD' ? '' : data.subarray(start, end + 1));
}
