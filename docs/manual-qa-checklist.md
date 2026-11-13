# Manual checks for Stephen

A plain checklist for trying the site by hand on your own computer. Nothing here sends real emails or takes real money: emails go to a local inbox called Mailpit, and "payments" use a pretend card page. Tick each box as you go. If something does not match "Expected", write down the page, what you did and what you saw (a screenshot helps) and send it to the team.

## 1. Start the site

1. Open the Terminal app and go to the project folder.
2. Make sure Docker Desktop is running (the whale icon in the menu bar, with "Docker Desktop is running").
3. Type `docker compose up -d` and press Return. This starts the local database and the local inbox.
4. The first time only: `pnpm db:migrate` then `pnpm db:seed`. This creates the demo people and one demo dog each.
5. Type `pnpm dev` and press Return. When it says "Ready", open <http://localhost:3000> in Chrome.
6. Your local inbox (Mailpit) is at <http://localhost:8025>. Every email the site sends appears there.

If the page keeps reloading by itself, stop `pnpm dev` (Ctrl+C), delete the `.next` folder, and start it again.

## 2. Demo accounts (all made up)

| Who | Email | Password |
| --- | --- | --- |
| Owner | owner@lunak9club.test | demo-owner-password |
| Customer (dog: Biscuit) | casey@example.test | demo-customer-password |
| Second customer (dog: Rex) | jordan@example.test | demo-customer-password |

On the sign-in page the site asks for your email first and offers a sign-in link. To use a password instead, press **Sign in with a password instead**.

Use two browser windows if you can: one for a customer, one for the Owner (a private window works well for the second).

## 3. The 15 journeys

### As a customer (Casey)

1. **Home page, signed out.** Open <http://localhost:3000>.
   Expected: a page about the club, a "Request a day" card, four steps for "How your first day works", and a list of vaccinations. The cancellation line says "cancel free at least 48 hours before". There are no numbers of places left, and no box about "Trust block".
2. **Sign in with an emailed link.** On the sign-in page type casey@example.test and press **Email me a sign-in link**. Open Mailpit, open the email, click the link.
   Expected: you land on your account. Clicking the same link a second time does not sign you in again.
3. **Sign in with a password.** Sign out (**Menu**, then **Sign out** on a phone-width window). Sign in again with the password.
   Expected: you land on your account page ("Hello, Casey").
4. **Ask for two days.** Go to **Book**. Tick two weekdays, press **Check price and availability**, then **Send booking request**.
   Expected: a message "Booking request sent", the days listed as requested, and an email in Mailpit. Nothing has been charged, and the page says plainly that sending a request does not secure the booking.
5. **See the Owner's answer and pay.** After journey 10 below (the Owner approves), go to your account. Press the **Pay £…** button, then **Pay … with a test card**.
   Expected: "Payment received – you're booked", a receipt email, and the days show as booked.
6. **Cancel at least 48 hours ahead.** In **Bookings**, press **Cancel** on a day more than two days away, then **Yes, cancel booking**.
   Expected: the page says there is no charge and the money is refunded to your card (the pretend card), and an email about the refund arrives.
7. **Cancel less than 48 hours ahead.** Book and pay for tomorrow (journeys 4, 10 and 5), then cancel it.
   Expected: the page warns "This day will still be charged" before you confirm, and afterwards the day shows "Cancelled (late – charged)". No refund email.
8. **Join the waitlist.** Ask the Owner to set a day's places to 0 (journey 13), then try to book that day.
   Expected: the day shows "Full – join the waitlist" (words and an icon, not just a colour). After you join, the day appears under your bookings as "On the waitlist" with a **Leave waitlist** button. The page never says how many places are left.
9. **Your dogs.** Press **Dogs**, then open Biscuit.
   Expected: the dog's page with a coloured block showing the first letter, the breed, and a status badge.

### As the Owner

10. **Today and approving a request.** Sign in as the Owner (private window). On **Today**, find the new request and press **Approve**.
    Expected: "Request approved. The customer has been emailed." The customer gets a "please pay to secure your booking" email with a deadline. Pressing **Decline** instead gives the customer a polite email with no reasons in it.
11. **Bookings for a day.** Open **Bookings**, pick the day, and look at who is booked.
    Expected: the dogs, the taxi list if any, and the day's capacity. The Owner can see how many places are left; customers cannot.
12. **Month-end invoices (local test only).** Open **Invoices**. If there are membership drafts, press **Approve all unchanged drafts**.
    Expected: unchanged drafts are approved together; any that changed are listed separately and left for you to check. Nothing is sent to real customers locally.
13. **Change a day's places or close a day.** In **Bookings** for a day, set "Places per session" to 0 and press **Update capacity**.
    Expected: customers now see that day as "Full – join the waitlist". Under **Opening** you can also close a day; customers then see it as "Closed" and cannot pick it.
14. **A file waiting for a virus check.** (Only if the virus scanner has been switched on for testing; otherwise skip.) Expected: Today shows "A file is waiting for a virus check". Opening it first shows a warning page; only pressing **Open anyway** shows the file.
15. **Refunds.** Open **Refunds**.
    Expected: member-day refund requests wait here for your approval; refunds to the card for ordinary days happen without waiting.

## 4. Check browser zoom (Book, Bookings and Account)

Zoom makes everything bigger, like a person with poor eyesight or a small phone would see it.

1. Sign in as Casey in Chrome. Open **Book**.
2. Hold the Command key (⌘) and press the **+** key until the browser shows **200%** (click the magnifying glass icon at the right of the address bar to see it). Press ⌘ and **0** to go back to 100%.
3. At 200%, look at each of **Book**, **Bookings** and **Account**. Then do it again at **400%** (keep pressing ⌘ and **+**; 500% is the maximum).

What to look for, at both 200% and 400%:

- Nothing runs off the right-hand side. You should never need to scroll sideways (scrolling down is fine).
- The bar at the bottom with Book, Bookings, Dogs and Account (on a narrow window), and the bar with the **Check price and availability** button on the Book page, do not cover any button or text you need. If the bottom bars take up so much room that you cannot see the page, tell us.
- You can still tap or click every button and link, and every date box on the Book page.
- Text is not cut off, and nothing overlaps other text.
- The **Menu** button opens a panel; **Esc** closes it, and the cursor returns to the **Menu** button.

Also try it with a narrow window: drag the edge of the browser window until it is about the width of a phone (or press F12 in Chrome, then the phone icon, and choose "iPhone 12 Pro"), and repeat the checks.

## 5. Check with a screen reader (VoiceOver on a Mac)

VoiceOver reads the page aloud, as a blind person would hear it. It is built into the Mac.

**Turn it on or off:** press ⌘ + F5 (Touch ID Macs: hold ⌘ and triple-press the Touch ID button). The first time, a short welcome appears; you can press Esc to skip it. The key combination "VO" below means Control + Option held down together.

**Move around:**

| Do this | To |
| --- | --- |
| VO + Right arrow | Go to the next thing on the page |
| VO + Left arrow | Go back one |
| VO + Space | Press the button or link you are on |
| Tab | Jump to the next button, link or box |
| VO + U | Open the "rotor": a list of headings, links and landmarks you can jump between (use the left and right arrows to change list) |
| Esc | Close a panel |

Use Safari or Chrome. Do each check on **Book**, **Bookings** and **Account**, first in a wide window, then in a narrow (phone-width) one.

What you should hear:

1. **Page and headings.** The page title and a main heading, such as "Book day care". In the rotor under Headings, the headings are in a sensible order.
2. **The bar of four tabs** (narrow window). It is announced as navigation, with items "Book", "Bookings", "Dogs" and "Account", and the one you are on is described as the **current page**. In a wide window the same four names appear in the top bar.
3. **The Menu button.** It says "Menu" and that it opens a dialog. When it opens, the cursor stays inside it; **Esc** closes it and you are back on the Menu button.
4. **Choosing days on Book.** Each date box is read with its date and its state in words: "Available", "Full – join the waitlist" or "Closed" (with the reason). The state is never only a colour.
5. **Form boxes and errors.** Every box is read with its label (for example "Email address", "Password"). If you press a button without filling something in, the error is read out and the cursor goes to it.
6. **The request button.** The button is read with its name ("Check price and availability", then "Send booking request"). The sentence that a request does not secure the booking is read before you send.
7. **Status after you act.** After sending a request, paying or cancelling, the message at the top of the page ("Booking request sent", "Payment received – you're booked") is read out.

Write down anything that is silent, read twice, read in a confusing order, or described by colour alone.

## 6. When you have finished

Press Ctrl+C in the Terminal to stop the site, and `docker compose down` to stop the database and inbox if you like. Nothing you did affects real customers or real money.
