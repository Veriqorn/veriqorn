import { readFile, writeFile, rename, rm } from 'node:fs/promises';

const fileSystem = { readFile, writeFile, rename, rm };

export const persistEnvValues = async (envFile, values, io = fileSystem) => {
  const current = await io.readFile(envFile, 'utf8');
  let next = current;
  for (const [key, value] of Object.entries(values)) {
    const line = key + '=' + value;
    const escapedKey = key.replace(/[.*+?^$()|{}[\]\\]/g, '\\$&');
    const pattern = new RegExp('^' + escapedKey + '=.*$', 'm');
    next = pattern.test(next) ? next.replace(pattern, line) : next.replace(/\s*$/, '\n') + line + '\n';
  }
  const temporaryFile = envFile + '.next';
  await io.writeFile(temporaryFile, next, { mode: 0o600 });
  try {
    await io.rename(temporaryFile, envFile);
  } catch (error) {
    // Docker bind-mounted files cannot be replaced by rename. Keep the same
    // mounted file so both the host and the running agent observe the update.
    if (error?.code !== 'EBUSY' && error?.code !== 'EXDEV') throw error;
    await io.writeFile(envFile, next, { mode: 0o600 });
    await io.rm(temporaryFile, { force: true });
  }
};

export const signatureVerificationArgs = ({ cosignImage, cosignIdentity, image, registryUsername, registryToken }) => {
  const escapedIdentity = cosignIdentity.replace(/[.*+?^$()|{}[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  return [
    'run', '--rm', cosignImage, 'verify',
    '--certificate-identity-regexp', '^' + escapedIdentity + '$',
    '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
    ...(registryUsername && registryToken
      ? ['--registry-username', registryUsername, '--registry-password', registryToken]
      : []),
    image,
  ];
};

export const redactErrorMessage = (error, secrets = []) => {
  let message = String(error instanceof Error ? error.message : error);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message.replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]').slice(0, 1000);
};
