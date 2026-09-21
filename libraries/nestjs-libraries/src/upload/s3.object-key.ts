/** Keep S3-compatible storage inside its configured namespace. */
export function s3ObjectKey(key: string): string {
  const prefix = (process.env.S3_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '');
  if (!prefix || key.startsWith(`${prefix}/`)) {
    return key;
  }
  return `${prefix}/${key.replace(/^\/+/, '')}`;
}
