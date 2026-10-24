import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('imported sprints may omit dates without defaults while retaining required identity and scope', () => {
  const schema = JSON.parse(readFileSync(join(__dirname, 'schema.json'), 'utf8'));

  for (const field of ['startDate', 'endDate']) {
    const attribute = schema.attributes[field];
    assert.equal(attribute.type, 'date', `${field} must retain date validation when supplied`);
    assert.notEqual(attribute.required, true, `${field} must allow imported sprints without dates`);
    assert.equal(Object.hasOwn(attribute, 'default'), false, `${field} must not invent a date`);
  }

  for (const field of ['name', 'project', 'organization']) {
    assert.equal(schema.attributes[field].required, true, `${field} must remain required`);
  }
  assert.equal(schema.attributes.project.target, 'api::project.project');
  assert.equal(schema.attributes.organization.target, 'api::organization.organization');
});
