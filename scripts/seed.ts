// Demo data for local development. All people and addresses are fictional (.test domain).
import { assertSafeDatabaseUrl } from './_env';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/infra/db/client';
import { ensureUser } from './lib/users';
import { ensureApprovedDemoDog } from './lib/demo-dogs';

export const DEMO = {
  owner: {
    email: 'owner@lunak9club.test',
    name: 'Olivia Owner',
    password: 'demo-owner-password',
    role: 'owner' as const,
  },
  customer: {
    email: 'casey@example.test',
    name: 'Casey Customer',
    password: 'demo-customer-password',
    role: 'customer' as const,
  },
  customer2: {
    email: 'jordan@example.test',
    name: 'Jordan Second',
    password: 'demo-customer-password',
    role: 'customer' as const,
  },
};

const { db, pool } = createDb(assertSafeDatabaseUrl(process.env.DATABASE_URL));
const ownerId = await ensureUser(db, DEMO.owner);
const caseyId = await ensureUser(db, DEMO.customer);
const jordanId = await ensureUser(db, DEMO.customer2);
await ensureApprovedDemoDog(db, caseyId, ownerId, 'Biscuit', 'Cockapoo');
await ensureApprovedDemoDog(db, jordanId, ownerId, 'Rex', 'Labrador');
// Demo business details so invoices can be tried locally. Only fills blanks – never overwrites
// details the Owner has entered. Replace them in Settings → Business before any real invoice.
await db.execute(sql`update business_settings set
  company_number = '00000000',
  registered_office = ${'DEMO ONLY – replace in Settings → Business\nCentral Bedfordshire'},
  contact_email = 'hello@lunak9club.test'
  where id = 1 and company_number = ''`);
await pool.end();
console.log(
  'Seeded demo owner, two customers, an approved demo dog each (Biscuit, Rex) and demo business details. See README for sign-in details.',
);
