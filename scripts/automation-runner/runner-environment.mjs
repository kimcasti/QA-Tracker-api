const environments = ['local', 'test'];

export function runnerEnvironments(source = process.env) {
  const defaultEnvironment = (source.PLAYWRIGHT_ENV || 'local').trim().toLowerCase();
  if (!environments.includes(defaultEnvironment)) throw new Error('PLAYWRIGHT_ENV debe ser local o test.');
  const urls = {};
  for (const environment of environments) {
    // A general override applies only to the startup environment. It must not
    // silently redirect a Test job to the Local application (or vice versa).
    const baseURL = source[`PLAYWRIGHT_${environment.toUpperCase()}_BASE_URL`] ||
      (environment === defaultEnvironment ? source.PLAYWRIGHT_BASE_URL : undefined);
    if (!baseURL) continue;
    let url;
    try { url = new URL(baseURL); } catch { throw new Error(`La URL del ambiente ${environment} no es válida.`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`La URL del ambiente ${environment} debe usar HTTP o HTTPS.`);
    urls[environment] = baseURL;
  }
  const available = Object.keys(urls);
  if (!available.length) throw new Error('Configura PLAYWRIGHT_LOCAL_BASE_URL o PLAYWRIGHT_TEST_BASE_URL en .env.');
  return {
    available,
    defaultEnvironment: urls[defaultEnvironment] ? defaultEnvironment : available[0],
    forJob(environment) {
      if (!environments.includes(environment) || !urls[environment]) throw new Error('El ambiente solicitado no está configurado en este ejecutor.');
      return { PLAYWRIGHT_ENV: environment, PLAYWRIGHT_BASE_URL: urls[environment], QA_TRACKER_ENVIRONMENT: environment };
    },
  };
}
