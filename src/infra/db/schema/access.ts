import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './auth';

/**
 * Role catalogue. Permissions per role live in code (src/server/policy/permissions.ts)
 * so adding Manager/Staff later is a seed row + permission map, not a schema change (D13).
 */
export const roles = pgTable('roles', {
  key: text().primaryKey(),
  label: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleKey: text()
      .notNull()
      .references(() => roles.key, { onDelete: 'restrict' }),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    grantedBy: text().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleKey] })],
);
