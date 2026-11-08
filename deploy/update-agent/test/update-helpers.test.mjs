import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as io from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { persistEnvValues, signatureVerificationArgs, redactErrorMessage } from '../update-helpers.mjs';

const directories = [];
const temporaryEnv = async () => {
  const directory = await io.mkdtemp(join(tmpdir(), 'veriqorn-updater-test-'));
  directories.push(directory);
  const file = join(directory, '.env.enterprise');
  await io.writeFile(file, 'PLATFORM_VERSION=v0.2.33\nPRESERVED=unchanged\n');
  return file;
};
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('veriqorn-updater-test-'));
    await io.rm(target, { recursive: true, force: true });
  }
});

const signatureOptions = {
  cosignImage: 'cosign:test',
  cosignIdentity: 'https://github.com/Veriqorn/veriqorn-enterprise/.github/workflows/release-enterprise.yml@refs/tags/enterprise-v*',
  image: 'ghcr.io/veriqorn/veriqorn-enterprise-backend@sha256:1234',
};

test('public verification keeps the OIDC issuer and workflow identity checks', () => {
  const args = signatureVerificationArgs(signatureOptions);
  assert.equal(args[args.indexOf('--certificate-oidc-issuer') + 1], 'https://token.actions.githubusercontent.com');
  const identity = new RegExp(args[args.indexOf('--certificate-identity-regexp') + 1]);
  assert.ok(identity.test(signatureOptions.cosignIdentity.replace('*', '0.2.34')));
  assert.ok(!identity.test(signatureOptions.cosignIdentity.replace('github.com', 'githubXcom').replace('*', '0.2.34')));
  assert.ok(!identity.test('https://untrusted.example/workflow'));
  assert.ok(!args.includes('--registry-password'));
  assert.equal(args.at(-1), signatureOptions.image);
});

test('private verification receives registry auth without dropping identity verification', () => {
  const args = signatureVerificationArgs({ ...signatureOptions, registryUsername: 'operator', registryToken: 'registry-fixture-secret' });
  assert.equal(args[args.indexOf('--registry-username') + 1], 'operator');
  assert.equal(args[args.indexOf('--registry-password') + 1], 'registry-fixture-secret');
  assert.ok(args.includes('--certificate-identity-regexp'));
  assert.ok(args.includes('--certificate-oidc-issuer'));
});

test('update errors redact both deployment secrets and authorization headers', () => {
  const message = redactErrorMessage(new Error('registry-fixture-secret agent-fixture-secret Bearer abcdef Basic encodedcredentials'), ['registry-fixture-secret', 'agent-fixture-secret']);
  for (const secret of ['registry-fixture-secret', 'agent-fixture-secret', 'abcdef', 'encodedcredentials']) assert.ok(!message.includes(secret));
  assert.equal(redactErrorMessage('x'.repeat(2000)).length, 1000);
});

test('normal env persistence updates the version and digest but retains other keys', async () => {
  const file = await temporaryEnv();
  await persistEnvValues(file, { PLATFORM_VERSION: 'v0.2.34', ENTERPRISE_BACKEND_IMAGE: 'image@sha256:1234' });
  assert.equal(await io.readFile(file, 'utf8'), 'PLATFORM_VERSION=v0.2.34\nPRESERVED=unchanged\nENTERPRISE_BACKEND_IMAGE=image@sha256:1234\n');
  await assert.rejects(io.access(file + '.next'), { code: 'ENOENT' });
});

for (const code of ['EBUSY', 'EXDEV']) {
  test('bind-mounted env persistence falls back safely after ' + code, async () => {
    const file = await temporaryEnv();
    const mountedIo = { ...io, rename: async () => { throw Object.assign(new Error('Mounted file'), { code }); } };
    await persistEnvValues(file, { PLATFORM_VERSION: 'v0.2.34' }, mountedIo);
    assert.equal(await io.readFile(file, 'utf8'), 'PLATFORM_VERSION=v0.2.34\nPRESERVED=unchanged\n');
    await assert.rejects(io.access(file + '.next'), { code: 'ENOENT' });
  });
}

test('unexpected permission errors are surfaced without overwriting the original file', async () => {
  const file = await temporaryEnv();
  const deniedIo = { ...io, rename: async () => { throw Object.assign(new Error('Denied'), { code: 'EACCES' }); } };
  await assert.rejects(persistEnvValues(file, { PLATFORM_VERSION: 'v0.2.34' }, deniedIo), { code: 'EACCES' });
  assert.ok((await io.readFile(file, 'utf8')).includes('v0.2.33'));
});
