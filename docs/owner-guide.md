# Owner guide: running a normal day (draft for Stephen to review)

**Draft, 13 Nov 2026.** Written from the Owner screens in the app (`src/app/admin`) and from `docs/decisions.md`. I have only described buttons and headings I could see in the code. Where I could not confirm what a screen does, it is marked **Check**. Nothing here is a new feature. Screens may change; if a label below does not match what you see, tell the team.

## The menu

The Owner menu has: **Dashboard**, **Bookings**, **Requests**, **Memberships**, **Invoices**, **Refunds**, **Reviews**, **Incidents**, **Customers**, **Opening**, **Prices**, **Requirements**, **Terms**, **Business**, **Data requests**.

## A normal day

1. **Start at the Dashboard.** The page heading is "Today". Look at **Needs you**. It lists everything waiting for you, with a due label, and says "All clear" with "Nothing is waiting for you" when there is nothing. Under it are small summaries: Requests waiting, Records to review, Dogs ready to approve, Waiting for meet and greet or trial, Dogs today, Invoices, Incidents, Vaccinations expiring (30 days), Membership days not confirmed, and Data requests. Each has a link to the full page. "Recent activity" at the bottom shows what has been done.
2. **Answer requests** (see section 1).
3. **Check dogs in and out** on the day (section 2).
4. **Handle records and vaccinations** when they appear (section 4).
5. **Handle refunds** when they appear (section 5).
6. **At month end**, approve invoices (section 3).

## 1. Requests (customers asking for days)

- Open **Requests** from the menu, or the link on the Dashboard. The heading is "Waiting for you (n)". When there are none it says "No requests waiting."
- Each request has an **Approve** and a **Decline** button. Each has an optional note box. The note is **shown in the customer's account only**, not in the email (D91). Decline sends the customer a polite standard email with no note (D80).
- **What happens when you approve:** the customer is emailed a link to pay to secure the booking. Their place is held for up to 24 hours (or until the day starts if that is sooner), and the hold deadline is in the email (D78, D80). Days that cost £0, and membership days, are confirmed without payment (D83).
- **What happens when you decline:** the places are released and the customer gets the standard email (D80). You can also decline a single day of a request from the day view.
- **If the customer doesn't pay in time**, the place is released automatically and they get a "booking not completed" email (D78).
- **If you don't answer before the booking cut-off** (23:59 the day before), the request closes by itself at no charge (D79).
- A section called **Payment links that couldn't be created (n)** appears if a pay link failed. The screen has a button for each. **Check:** I did not confirm the exact button label.

## 2. The day view: dogs today, check in and check out

- Open **Bookings**. The heading is the date. Use the dates links, or the date box to jump to another day.
- **Dogs (n)** lists the dogs booked. If none, it says "No dogs booked."
- For each dog, depending on its state:
  - **Check in**, **No-show** (before arrival).
  - **Check out** (once the dog has been checked in).
  - **Undo** (after check-in or no-show).
- If a dog can't be checked in (for example its core or leptospirosis vaccination isn't valid that day), the row shows "Can't be checked in" and gives the reason. **Core (DHP) and leptospirosis cannot be overridden** (D73). Only kennel cough can be overridden, and you must give a reason in the box "Reason for checking [dog] in anyway" (D11, D73).
- Each dog also has a box for an **Internal note (only you can see this)**.
- To cancel a day yourself, give a **Reason for cancelling**. There is a box "Still charge for this day". If you leave it unticked, the customer is not charged (D39).
- **Requests waiting (n)** on the same page shows requests for that day. Approve or decline whole requests under **Requests**.
- **Book a dog**: use this to book for a customer. Fields: Dog, Date, Dog taxi, "This is a trial day", "If it's a trial day, charge at", and a "Reason for any override". Overrides are recorded, and licence vaccination rules still can't be overridden (D42, D73).
- **Places and taxi counts:** the page also shows places taken and the taxi count. **Check:** the day view still has "Morning" and "Afternoon" headings in the code, although half days are removed (D100). Treat them as leftovers until the team confirms.

## 3. Invoices and month-end

- Open **Invoices**. Sections: **Owed to you**, **To check**, and **Approve drafts**.
- Membership invoice drafts are created on the 25th for the following month. Approved invoices are emailed on the 28th at 09:00. They are due 5 days after sending, with one reminder on the 4th day at 15:30 (D24, D25, D55). Invoices for mid-month joiners go out straight away (D55).
- **Approve all unchanged drafts (n) – £total** is the one-tap button (D95). It approves each draft using the version and total you were shown. A draft that changed since you looked is refused and stays a draft; the screen lists it under **Check these first (n)** and shows a "Drafts approved" message saying how many were approved and skipped.
- To check one invoice, open it. The page has **Check and approve** with a button "Approve invoice for £x". After approval it says "Approved – waiting to send" and offers **Back to draft** until it is sent. Once sent, an invoice is never edited: corrections are credit notes (non-negotiable 4).
- On an invoice you can also: **Email it again**, **Record a payment** (for money received another way: you must say "Why are you recording this by hand?"), and **Issue a credit note** (choose days or an amount, with a reason shown on the credit note).
- **Add your business details** appears as a warning until the registered company name, number, address and contact email are set. Invoices can't be sent until then (D51). Use **Business** in the menu.
- **Export for your accountant** is at the bottom of the Invoices page (D15).
- Invoice numbers run in one sequence starting LK9DOUGIE-01 (D52). Payment is by card only through a pay link (D53, D59).

## 4. Vaccinations and approving dogs

- **Records waiting for review (n)** (on the Dashboard under "Records to review", and on the **Reviews** page): customers' uploaded vaccination records.
- Open the dog. The dog page has **Checklist**, **Day care approval**, **Records waiting for review**, and **Meet and greet and trial day**.
- For each record, check the date given and valid-until date, and the answer to "First course of vaccinations finished on" if it is a first course. **Decision** options: **Accept**, **Ask for a new copy**, **Reject**. Add a **Message to the customer** (needed if you ask for a new copy or reject). Then **Save decision**.
- A dog can't be booked or checked in within 14 days of a first course finishing (D74).
- **Record an assessment** after a meet and greet or a trial day: Assessment, Outcome, Date and Internal notes (only you can see these), then **Record assessment**.
- **Day care approval**: **Change status to** one of **Approved for day care** (only offered when every required item is done), **Suspended (pause bookings)**, **Not accepted**, **Back to onboarding**. Add a **Reason shown to the customer** when suspending or not accepting. Then **Update status**.
- The Dashboard also lists **Vaccinations expiring (30 days)** with dates. Customers get reminders at 60, 30, 14 and 7 days and when a vaccination expires (D75).

## 5. Refunds

- Open **Refunds**. Sections:
  - **Refund requests (n)**: member days cancelled free (at least 48 hours ahead) wait here. **Approve refund** sends the money back to the card. **Decline** needs a reason that the customer sees (D56, D106).
  - **Money to return (n)**: for money paid another way. After returning it, fill in "How was the money returned?" and press **Mark as refunded**.
  - **Card refunds**: if a card refund fails you'll see "n card refunds failed" and a **Try again** button.
  - **Recently decided**.
- Ad hoc days cancelled at least 48 hours before are refunded to the card automatically (D58). Stripe keeps its fee (D20).

## 6. Memberships

- Open **Memberships**. **Active (n)** lists active memberships. Each has **End this membership** with a **Last day** box. **Older requests (n)** holds requests made under the old flow; newer ones are under **Requests**.
- Dog and customer pages let you set or change days directly (D89). Members confirm their days each month; the Dashboard lists **Membership days not confirmed** (D88, D92).

## 7. Incidents and daily checks

- **Incidents** lists reports. **New** starts one. Customers are always emailed (no details in the email) and read the report in their account; internal notes are never shown (D62).
- **Daily check – [dog]**: Date, Food, Water, Toileting, Mood, Medication given, Note, and a box "Share this note with the customer". Some checks must be shared (a change in drinking or signs of stress, fear, aggression, anxiety or pain) and can't be unshared (D63). Checks are locked once saved.

## 8. Settings

- **Opening** (availability, closures, capacity), **Prices**, **Requirements**, **Terms**, **Business**. Changes to prices start on a chosen future date; old bookings keep the price they were booked at (D44, D45).
- **Data requests**: customers can ask for their data or for deletion. A deletion request can't be approved while there are upcoming bookings, a membership, unpaid invoices or a payment in progress (D65).

## Things to check with the team (not confirmed from the screens)

- Exact label of the button on "Payment links that couldn't be created".
- Whether the day view's Morning and Afternoon headings are removed (D100).
- Any screen not listed above (for example Customers and settings details): I read headings only, not every field.
- Quiet hours, notification emails to you and other automatic emails are described in `docs/decisions.md` (D57, D66, D88); this guide does not repeat every rule.
