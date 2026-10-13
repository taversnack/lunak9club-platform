import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { approvalRequests } from '@/infra/db/schema';
import { createMyBookings } from '@/server/services/bookings';
import { rejectApprovalRequest } from '@/server/services/approvals';
import { exportMyData } from '@/server/services/privacy';
import { isoWeekday } from '@/domain/booking/rules';
import { addDays, londonDate } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer } from '../support/onboard';

const db = () => getDb();
let owner: TestUser;
let cara: TestUser;
let dog: string;

beforeAll(async () => {
  setEmailProvider(new MemoryEmailProvider());
  owner = await makeUser(db(), 'owner', 'Ola Owner');
  cara = await makeUser(db(), 'customer', 'Cara Export');
  await readyCustomer(db(), cara);
  dog = await approvedDog(db(), owner, cara, 'Clover');
});
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

describe('data export: approval requests', () => {
  it('includes the customer’s requests with the Owner’s note, and nothing staff-only', async () => {
    let date = addDays(londonDate(new Date()), 63);
    while (isoWeekday(date) > 5) date = addDays(date, 1);
    const r = await createMyBookings(db(), cara, { dogIds: [dog], dates: [date], session: 'full', taxi: false });
    expect(r.requestId).toBeTruthy();
    await rejectApprovalRequest(db(), owner, r.requestId!, { reason: 'We are closed for training that day.' });
    await db()
      .update(approvalRequests)
      .set({ lastError: 'internal: day full', lastErrorAt: new Date() })
      .where(eq(approvalRequests.id, r.requestId!));

    const data = await exportMyData(db(), cara);
    expect(data.approvalRequests).toHaveLength(1);
    const req = data.approvalRequests[0]!;
    expect(req).toMatchObject({
      id: r.requestId,
      status: 'rejected',
      statusReason: 'We are closed for training that day.',
    });
    expect(req.decidedAt).toBeTruthy();
    const json = JSON.stringify(data);
    expect(json).not.toContain('internal: day full');
    expect(req).not.toHaveProperty('decidedBy');
    expect(req).not.toHaveProperty('lastError');
    expect(json).not.toContain(owner.userId);
  });
});
