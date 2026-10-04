/**
 * Role → permission map. The single source of truth for what each role may do.
 * Server code checks permissions (never role names) so new roles slot in here (D13).
 */
export const PERMISSIONS = [
  // Owner / staff
  'admin.access',
  'audit.read',
  'users.read',
  'users.manage',
  'settings.manage',
  'customers.read',
  'dogs.read',
  'dogs.read_sensitive',
  'dogs.approve',
  'documents.read_any',
  'compliance.review',
  'assessments.manage',
  'requirements.manage',
  'policies.manage',
  'bookings.manage',
  'attendance.manage',
  'availability.manage',
  'exports.read',
  'pricing.manage',
  'memberships.manage',
  'invoices.manage',
  'refunds.manage',
  'jobs.run',
  // Customer (self-scoped: always checked against the record's owner)
  'account.access',
  'customer.self.read',
  'customer.self.update',
  'dogs.self.manage',
  'documents.self.upload',
  'documents.self.read',
  'policies.self.accept',
  'bookings.self.manage',
  'memberships.self.manage',
  'invoices.self.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = ['owner', 'customer'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  owner: [
    'admin.access',
    'audit.read',
    'users.read',
    'users.manage',
    'settings.manage',
    'customers.read',
    'dogs.read',
    'dogs.read_sensitive',
    'dogs.approve',
    'documents.read_any',
    'compliance.review',
    'assessments.manage',
    'requirements.manage',
    'policies.manage',
    'bookings.manage',
    'attendance.manage',
    'availability.manage',
    'exports.read',
    'pricing.manage',
    'memberships.manage',
    'invoices.manage',
    'refunds.manage',
    'jobs.run',
  ],
  customer: [
    'account.access',
    'customer.self.read',
    'customer.self.update',
    'dogs.self.manage',
    'documents.self.upload',
    'documents.self.read',
    'policies.self.accept',
    'bookings.self.manage',
    'memberships.self.manage',
    'invoices.self.read',
  ],
};

/** Permissions that only ever apply to the caller's own records. */
export const SELF_SCOPED_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'customer.self.read',
  'customer.self.update',
  'dogs.self.manage',
  'documents.self.upload',
  'documents.self.read',
  'policies.self.accept',
  'bookings.self.manage',
  'memberships.self.manage',
  'invoices.self.read',
]);

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) {
    if (!isRoleKey(role)) continue; // unknown roles grant nothing
    for (const p of ROLE_PERMISSIONS[role]) out.add(p);
  }
  return out;
}
