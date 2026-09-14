import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertJiraProjectMembership, assertJiraWritesEnabled, jiraClient, jiraCredentials, jiraDescription, jiraPages } from './jira';

const environment = { JIRA_SITE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'test@example.com', JIRA_API_TOKEN: 'fake-token', JIRA_QA_USER_ID: '2' };

test('Jira writes are blocked by default and require exact explicit enablement', () => {
  for (const value of [undefined, '', 'false', 'TRUE']) {
    assert.throws(() => assertJiraWritesEnabled({ JIRA_ENABLE_WRITES: value }), /deshabilitado/);
  }
  assert.doesNotThrow(() => assertJiraWritesEnabled({ JIRA_ENABLE_WRITES: 'true' }));
});

test('credentials only allow a Jira Cloud origin and support scoped-token gateway', () => {
  for (const site of ['http://example.atlassian.net', 'https://example.atlassian.net.evil.test', 'https://localhost', 'https://user:pass@example.atlassian.net', 'https://example.atlassian.net/path']) {
    assert.throws(() => jiraCredentials({ ...environment, JIRA_SITE_URL: site }));
  }
  assert.equal(jiraCredentials({ ...environment, JIRA_CLOUD_ID: 'cloud-id' })?.apiBase, 'https://api.atlassian.com/ex/jira/cloud-id');
  assert.equal(jiraCredentials({}), null);
});

test('membership role must belong to the project organization', () => {
  const memberships = [
    { isActive: true, organization: { documentId: 'other', status: 'active' }, organizationRole: { code: 'owner' } },
    { isActive: true, organization: { documentId: 'target', status: 'active' }, organizationRole: { code: 'viewer' } },
  ];
  assert.throws(() => assertJiraProjectMembership(memberships, 'target', ['owner', 'qa-lead']));
  assert.doesNotThrow(() => assertJiraProjectMembership(memberships, 'other', ['owner']));
});

test('Jira transport blocks redirects and does not disclose upstream bodies or tokens', async () => {
  const credentials = jiraCredentials(environment)!;
  const client = jiraClient(credentials, (async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ secret: 'private-evidence' }), { status: 403 });
  }) as typeof fetch);
  await assert.rejects(client('/rest/api/3/myself'), error => !String(error).includes('private-evidence') && /permisos/.test(String(error)));
});

test('project discovery follows every page and descriptions remain text', async () => {
  const paths: string[] = [];
  const values = await jiraPages(async resource => {
    paths.push(resource);
    return paths.length === 1 ? { values: [{ id: '1' }], total: 2 } : { values: [{ id: '2' }], isLast: true };
  }, '/rest/api/3/project/search?action=create');
  assert.equal(values.length, 2);
  assert.match(paths[1], /startAt=1/);
  assert.equal(jiraDescription('<button>\nError').content[0].content[0].text, '<button>');
});
