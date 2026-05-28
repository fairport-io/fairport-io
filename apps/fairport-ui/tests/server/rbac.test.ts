import { describe, it, expect } from 'vitest';

function hasPermission(user: any, db: any, verb: string, resource: string, resourceName: string): boolean {
  const userRoleIds = new Set<string>();

  db.groups.forEach((group: any) => {
    group.members.forEach((member: any) => {
      if (member.ids.includes(user.id) || member.ids.includes('*')) {
        member.role_ids.forEach((rid: string) => userRoleIds.add(rid));
      }
    });
  });

  for (const roleId of userRoleIds) {
    const role = db.roles.find((r: any) => r.id === roleId);
    if (!role) continue;

    for (const perm of role.permissions) {
      const verbMatch = perm.verbs.includes('*') || perm.verbs.includes(verb);
      const resourceMatch = perm.resources.includes('*') || perm.resources.includes(resource);
      const nameMatch = perm.resource_names_regex.some((regex: string) => new RegExp(regex).test(resourceName));

      if (verbMatch && resourceMatch && nameMatch) return true;
    }
  }

  return false;
}

function makeDb(overrides: any = {}) {
  return {
    users: [{ id: 'user-1', name: 'test@example.com' }],
    roles: [
      { id: 'role-default', name: 'Default', permissions: [{ verbs: ['use'], resources: ['models', 'providers'], resource_names_regex: ['.*'] }] },
      { id: 'role-admin', name: 'Admin', permissions: [{ verbs: ['*'], resources: ['*'], resource_names_regex: ['.*'] }] },
    ],
    groups: [
      { id: 'default', name: 'default', members: [{ ids: ['*'], role_ids: ['role-default'] }] },
      { id: 'admin-group', name: 'admins', members: [{ ids: ['user-1'], role_ids: ['role-admin'] }] },
    ],
    ...overrides,
  };
}

describe('hasPermission', () => {
  it('grants permission when role matches verb, resource, and name', () => {
    const db = makeDb();
    const user = { id: 'user-1' };

    expect(hasPermission(user, db, 'use', 'models', 'llama3')).toBe(true);
    expect(hasPermission(user, db, 'use', 'providers', 'ollama')).toBe(true);
  });

  it('denies permission when verb not in role', () => {
    const db = {
      users: [{ id: 'user-only-default' }],
      roles: [
        { id: 'role-default', name: 'Default', permissions: [{ verbs: ['use'], resources: ['models', 'providers'], resource_names_regex: ['.*'] }] },
      ],
      groups: [
        { id: 'default', name: 'default', members: [{ ids: ['user-only-default'], role_ids: ['role-default'] }] },
      ],
    };
    const user = { id: 'user-only-default' };

    // Default role only has 'use', not 'delete'
    expect(hasPermission(user, db, 'delete', 'models', 'llama3')).toBe(false);
  });

  it('grants wildcard verb permission to admin', () => {
    const db = makeDb({
      groups: [
        { id: 'default', name: 'default', members: [{ ids: ['*'], role_ids: ['role-default'] }] },
        { id: 'admin-group', name: 'admins', members: [{ ids: ['user-1'], role_ids: ['role-admin'] }] },
      ],
    });
    const user = { id: 'user-1' };

    expect(hasPermission(user, db, 'delete', 'users', 'anyone')).toBe(true);
    expect(hasPermission(user, db, 'create', 'groups', 'new-group')).toBe(true);
  });

  it('grants wildcard resource permission', () => {
    const db = {
      users: [{ id: 'user-1' }],
      roles: [{ id: 'r1', permissions: [{ verbs: ['use'], resources: ['*'], resource_names_regex: ['.*'] }] }],
      groups: [{ id: 'g1', members: [{ ids: ['user-1'], role_ids: ['r1'] }] }],
    };

    expect(hasPermission({ id: 'user-1' }, db, 'use', 'anything', 'any-name')).toBe(true);
  });

  it('matches resource_names_regex', () => {
    const db = {
      users: [{ id: 'user-1' }],
      roles: [{ id: 'r1', permissions: [{ verbs: ['use'], resources: ['models'], resource_names_regex: ['^llama.*'] }] }],
      groups: [{ id: 'g1', members: [{ ids: ['user-1'], role_ids: ['r1'] }] }],
    };

    expect(hasPermission({ id: 'user-1' }, db, 'use', 'models', 'llama3')).toBe(true);
    expect(hasPermission({ id: 'user-1' }, db, 'use', 'models', 'mistral')).toBe(false);
  });

  it('wildcard member ids ["*"] matches all users', () => {
    const db = {
      users: [{ id: 'user-999' }, { id: 'user-1' }],
      roles: [{ id: 'r1', permissions: [{ verbs: ['use'], resources: ['models'], resource_names_regex: ['.*'] }] }],
      groups: [{ id: 'g1', members: [{ ids: ['*'], role_ids: ['r1'] }] }],
    };

    expect(hasPermission({ id: 'user-999' }, db, 'use', 'models', 'any')).toBe(true);
  });

  it('denies user not in any group', () => {
    const db = {
      users: [{ id: 'user-ghost' }],
      roles: [{ id: 'r1', permissions: [{ verbs: ['use'], resources: ['models'], resource_names_regex: ['.*'] }] }],
      groups: [{ id: 'g1', members: [{ ids: ['user-1'], role_ids: ['r1'] }] }],
    };

    expect(hasPermission({ id: 'user-ghost' }, db, 'use', 'models', 'llama3')).toBe(false);
  });
});
