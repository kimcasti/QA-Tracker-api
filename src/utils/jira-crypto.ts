import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { errors } from '@strapi/utils';

export function encryptionKey(env = process.env) {
  const value = env.JIRA_CREDENTIALS_ENCRYPTION_KEY || '';
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new errors.ApplicationError('El administrador debe configurar la clave de cifrado de las conexiones Jira.');
  return key;
}
export function encryptToken(token: string, userId: number, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(Buffer.from(`jira-account:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
export function decryptToken(value: string, userId: number, env = process.env) {
  const key = encryptionKey(env);
  try {
    const [version, iv, tag, encrypted, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !encrypted || extra) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(`jira-account:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new errors.ApplicationError('No se pudo leer la conexión de Jira. Reemplaza el token o consulta al administrador.'); }
}
