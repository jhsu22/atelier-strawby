export function allowLocalAccess(url: URL, env: { APP_ENV?: string; LOCAL_DEV_AUTH?: string }): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && env.APP_ENV === 'local' && env.LOCAL_DEV_AUTH === 'true';
}
