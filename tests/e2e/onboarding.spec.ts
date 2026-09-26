import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DEMO_CUSTOMER, DEMO_CUSTOMER_2, DEMO_OWNER, signIn, signOut } from './helpers';

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// One serial journey per viewport: a customer onboards a dog, the Owner reviews and approves it.
test.describe.configure({ mode: 'serial' });

let dogUrl = '';
let documentHref = '';
let dogName = '';
test.beforeAll(({}, info) => {
  dogName = `Pepper ${info.project.name} ${Date.now().toString().slice(-4)}`;
});

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function asCustomer(page: Page) {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
}

test('customer completes profile, contacts and terms', async ({ page }) => {
  await asCustomer(page);
  await page.getByRole('link', { name: 'Your details' }).click();
  await page.getByLabel('Mobile phone number').fill('123');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Error: Enter a UK phone number, like 07700 900123')).toBeVisible();
  await page.getByLabel('Mobile phone number').fill('07700 900123');
  await page.getByLabel('Address line 1').fill('1 Test Street');
  await page.getByLabel('Town or city').fill('Guildford');
  await page.getByLabel('Postcode').fill('gu1 4ab');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Your details are saved.')).toBeVisible();

  await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Contacts' }).click();
  await page.getByLabel('Full name').fill('Sam Neighbour');
  await page.getByLabel('Phone number').fill('07700 900456');
  await page.getByLabel(/Emergency contact/).check();
  await page.getByRole('button', { name: 'Add contact' }).click();
  await expect(page.getByText('Contact added.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Sam Neighbour' }).first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Terms' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('terms');
  if ((await page.getByText(/You accepted this version/).count()) === 0) {
    await page.getByLabel('I have read and accept these terms').check();
    await page.getByRole('button', { name: 'Accept terms' }).click();
  }
  await expect(page.getByText(/You accepted this version/)).toBeVisible();
});

test('customer adds a dog, vet, onboarding form and vaccination record', async ({ page }) => {
  await asCustomer(page);
  await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Add a dog' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Error: Enter your dog’s name')).toBeVisible();
  await axe(page);
  await page.getByLabel('Dog’s name').fill(dogName);
  await page.getByLabel('Breed').fill('Border collie');
  await page.getByRole('radio', { name: 'Female' }).check();
  await page.getByLabel('Date of birth').fill('2021-05-01');
  await page.getByLabel('Weight in kg').fill('16.5');
  await page.getByLabel('Microchip number').fill('826000000000123');
  await page
    .getByRole('group', { name: /neutered/ })
    .getByRole('radio', { name: 'Yes' })
    .check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: dogName, level: 1 })).toBeVisible();
  dogUrl = new URL(page.url()).pathname;
  await expect(page.getByText('In progress', { exact: true })).toBeVisible();
  await axe(page);

  await page.getByRole('link', { name: 'Add your vet’s details.' }).click();
  await expect(page).toHaveURL(/\/vet$/);
  await page.getByLabel('Practice name').fill('Riverside Vets');
  await page.getByLabel('Practice phone number').fill('01483 111222');
  await page.getByRole('button', { name: 'Save vet details' }).click();
  await expect(page.getByText('Vet details saved.')).toBeVisible();

  await page.getByRole('link', { name: 'Complete and send the onboarding form.' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Flea and worming treatment').fill('Monthly tablet, last given 1st');
  await page.getByLabel('What is your dog like with people and other dogs?').fill('Very friendly, loves fetch');
  await page
    .getByRole('group', { name: /bitten/ })
    .getByRole('radio', { name: 'No' })
    .check();
  await page
    .getByRole('group', { name: /dog taxi/ })
    .getByRole('radio', { name: 'Yes' })
    .check();
  await page
    .getByRole('group', { name: /photos/ })
    .getByRole('radio', { name: 'No' })
    .check();
  await page
    .getByRole('group', { name: /emergency vet/ })
    .getByRole('radio', { name: 'Yes' })
    .check();
  await page.getByRole('button', { name: 'Send onboarding form' }).click();
  await expect(page.getByText('Error: Please confirm the information is accurate')).toBeVisible();
  await axe(page);
  await page.getByLabel(/I confirm this information is accurate/).check();
  await page.getByRole('button', { name: 'Send onboarding form' }).click();
  await expect(page.getByText('your onboarding form has been sent')).toBeVisible();

  await page.getByRole('link', { name: 'Upload a record' }).click();
  await expect(page).toHaveURL(/\/vaccinations$/);
  await page.getByLabel('Vaccination record', { exact: true }).setInputFiles('tests/e2e/fixtures/not-a-pdf.pdf');
  await page.getByRole('checkbox', { name: 'Core vaccinations' }).check();
  await page.getByLabel('Core vaccinations: valid until').fill(plusDays(300));
  await page.getByRole('button', { name: 'Upload record' }).click();
  await expect(page.getByText(/Please upload a PDF or a photo/)).toBeVisible();
  await axe(page);

  await page.getByLabel('Vaccination record', { exact: true }).setInputFiles('tests/e2e/fixtures/vaccination-card.pdf');
  for (const v of ['Core vaccinations', 'Leptospirosis vaccination', 'Kennel cough vaccination']) {
    await page.getByRole('checkbox', { name: v }).check();
    await page.getByLabel(`${v}: valid until`).fill(plusDays(300));
  }
  await page.getByRole('button', { name: 'Upload record' }).click();
  await expect(page.getByText('we’ll check the record')).toBeVisible();
  await expect(page.getByText('Waiting for review').first()).toBeVisible();
  documentHref = (await page.getByRole('link', { name: 'vaccination-card.pdf' }).first().getAttribute('href'))!;

  const res = await page.request.get(documentHref);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect(res.headers()['cache-control']).toContain('no-store');
});

test('another customer cannot open this dog or its document', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER_2.email, DEMO_CUSTOMER_2.password);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(dogName)).toHaveCount(0);
  const r = await page.goto(dogUrl);
  expect(r?.status()).toBe(404);
  const doc = await page.request.get(documentHref);
  expect(doc.status()).toBe(404);
  const anon = await page.context().browser()!.newContext();
  expect((await anon.request.get(new URL(documentHref, page.url()).toString())).status()).toBe(404);
  await anon.close();
});

test('owner reviews records, records assessments and approves the dog', async ({ page }) => {
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: 'Owner' }).getByRole('link', { name: 'Reviews' }).click();
  await page.getByRole('link', { name: dogName }).first().click();
  await expect(page.getByRole('heading', { name: dogName, level: 1 })).toBeVisible();
  await expect(page.getByText('Very friendly, loves fetch')).toBeVisible();
  await axe(page);

  for (let i = 0; i < 3; i++) {
    const section = page.getByRole('region', { name: /vaccination/i }).first();
    await section.getByRole('radio', { name: 'Accept' }).check();
    await section.getByRole('button', { name: 'Save decision' }).click();
    await expect(page.getByText(`Records waiting for review (${2 - i})`)).toBeVisible();
  }

  const assess = page.getByRole('region', { name: 'Meet and greet and trial day' });
  for (const kind of ['Meet and greet', 'Trial day']) {
    await assess.getByRole('group', { name: 'Assessment' }).getByRole('radio', { name: kind }).check();
    await assess.getByRole('group', { name: 'Outcome' }).getByRole('radio', { name: 'Passed', exact: true }).check();
    await assess.getByRole('button', { name: 'Record assessment' }).click();
    await expect(assess.getByText('Assessment recorded.')).toBeVisible();
  }
  await page.reload();
  await expect(page.getByText('Ready for approval')).toBeVisible();
  await page.getByLabel('Change status to').selectOption('approved');
  await page.getByRole('button', { name: 'Update status' }).click();
  await expect(page.getByText('Status updated.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await signOut(page);
});

test('customer sees the dog approved and no Owner notes', async ({ page }) => {
  await asCustomer(page);
  await page.goto(dogUrl);
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Internal note')).toHaveCount(0);
  await page.goto('/admin/dogs/' + dogUrl.split('/').pop());
  await expect(page).toHaveURL(/\/access-denied$/);
});
