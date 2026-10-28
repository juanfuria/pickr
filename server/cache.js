// nginx's cache purge module (libnginx-mod-http-cache-purge) answers PURGE on a loopback listener and treats a key
// ending in '*' as a prefix, so one request removes every rendered variant of a file.
export async function purgeVariants(purgeUrl, id, ext, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`${purgeUrl}/_render/${id}.${ext}*`, { method: 'PURGE' });
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}
