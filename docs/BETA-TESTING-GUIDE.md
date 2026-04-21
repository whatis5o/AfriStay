# AfriStay Beta Testing Guide
> Use this with Perplexity, Gemini, ChatGPT or any AI to get structured testing help.

---

## What to paste into the AI

Copy the block below, paste it into Perplexity / Gemini / ChatGPT, then ask whatever you need:

```
I'm beta testing AfriStay (afristay.rw) — a property and vehicle rental platform 
built in Rwanda. It's like Airbnb but for Rwanda.

The platform has 3 roles:
- Guest: browses listings, makes bookings, pays via IremboPay
- Owner: lists properties/vehicles, approves or rejects booking requests, gets paid out by admin
- Admin: approves listings, manages users, initiates payouts, sends emails

Key flows that must work:
1. Guest signs up → browses → books → pays → gets confirmation email
2. Owner gets notified of booking → approves → guest pays → owner gets payout email
3. Admin approves a new listing submitted by an owner
4. Admin selects paid bookings → clicks Initiate Payout → owners get email notification
5. Admin invites a new owner via email → owner clicks link → sets up password + profile
6. Anyone can submit feedback at afristay.rw/Feedback

Tech: Vanilla JS, Supabase backend, IremboPay payments (Rwanda), Resend emails.
```

Then ask things like:
- "Give me 20 edge cases to test for the booking flow"
- "What bugs are most common in payment confirmation flows?"
- "Write me a test script for a guest trying to book a property"
- "What should I look for when testing email delivery?"

---

## Core flows to test (tick as you go)

### Guest flows
- [ ] Sign up with a new email — verify confirmation email arrives
- [ ] Log in and get redirected back to the page you were on
- [ ] Browse listings — search, filter by location works
- [ ] Open a listing detail page — images load, price is correct
- [ ] Make a booking request — check-in/out dates, guest count
- [ ] Receive "Booking Request Received" email after submitting
- [ ] After owner approves: see "Pay Now" button on profile bookings tab
- [ ] Click Pay Now → IremboPay form opens with correct amount
- [ ] Complete sandbox payment → get booking confirmation email
- [ ] Receipt visible in profile dashboard

### Owner flows
- [ ] Invited via admin → click email link → setup form appears (name, phone, password)
- [ ] After setup → redirected to owner dashboard (not home page)
- [ ] Create a new listing (title, price, images, location, category)
- [ ] Listing appears as "Pending" until admin approves
- [ ] See new booking request in dashboard → Approve it
- [ ] After guest pays → see booking status change to Confirmed
- [ ] Booking calendar shows on Dashboard tab — booked dates are highlighted
- [ ] Earnings tab shows payout history and monthly chart
- [ ] Receive payout email when admin initiates payout

### Admin flows
- [ ] PIN prompt appears before entering admin dashboard
- [ ] Listing Requests tab — can approve / reject owner submissions
- [ ] Approved listing immediately goes live on the site
- [ ] Bookings tab — can filter, approve, mark complete
- [ ] Payouts tab — shows paid bookings, can select and click Initiate Payout
- [ ] Payout status changes from "Not Paid Out" → "Processing" after initiation
- [ ] After initiating payout: owners get email notification
- [ ] Mark as Paid → status changes to "Paid Out" → owners get second email
- [ ] Export CSV — All / Unpaid / Paid downloads correctly
- [ ] Send Email tab — custom email with attachment sends correctly
- [ ] Feedback tab — submissions from /Feedback/ appear here
- [ ] Can change feedback status: New → Reviewed → Resolved

---

## Edge cases to test (the stuff that usually breaks)

| What to test | Why it breaks |
|---|---|
| Book with check-out = check-in (same day) | Date validation |
| Submit booking with no phone number | Required field check |
| Try to access /Dashboards/Admin without signing in | Auth guard |
| Owner tries to access admin dashboard | Role guard |
| Click Pay Now twice quickly | Double-payment risk |
| Slow internet during payment — what does user see? | Loading states |
| Owner approves booking after it expired | Expired booking handling |
| Admin initiates payout for booking with no owner wallet set | Missing wallet edge case |
| Submit feedback with very long description (5000 chars) | Input length handling |
| Upload a 15MB image when creating a listing | File size limit |
| Two people book the same dates on the same listing | Availability conflict |
| Sign up with an email that has capital letters | Email case sensitivity |
| Log in on mobile — does the nav and dashboard look right? | Mobile responsiveness |

---

## What to check in every flow

1. **Email** — did the right person get the right email? Check spam too.
2. **Status** — did the booking/listing/payout status update correctly in the DB?
3. **UI** — does the dashboard reflect the new status without refreshing?
4. **Mobile** — does it work on a phone screen?
5. **Error messages** — if something fails, is the error message actually helpful?

---

## How to run your 10-person beta

1. Pick 10 people: 5 guests, 3 owners, 2 random (non-tech) people
2. Send each one this WhatsApp message:

   > "Hey! I'm testing AfriStay before we launch — it's like Airbnb for Rwanda.
   > Can you try it out? Just go to afristay.rw, try to find a place and book it.
   > When anything confuses you or breaks, go to afristay.rw/Feedback and report it.
   > Takes like 10 mins. I'll really appreciate it!"

3. Give them 1 week max (people forget after that)
4. Check your admin dashboard → Feedback tab daily
5. After a week: sort by P0 (can't complete booking) → P1 (confusing) → P2 (minor)
6. Fix P0s and P1s before going live with real IremboPay credentials

---

## Prompts to paste into Perplexity / Gemini / ChatGPT

**To get more test cases:**
```
I'm testing a property booking platform. The main flow is: 
browse listings → request booking → owner approves → guest pays via mobile money → 
both get email confirmation. What are the top 15 edge cases I should test?
```

**To understand what can go wrong with payments:**
```
What are common bugs and failure points in webhook-based payment confirmation systems? 
We use IremboPay in Rwanda which sends a POST webhook when payment completes.
```

**To write a test script for a specific flow:**
```
Write a step-by-step test script for testing a guest booking flow on a property rental site. 
Include what to verify at each step (UI, email, database state).
```

**To prioritize bugs from your feedback:**
```
I have these bug reports from beta testers: [paste feedback here]
Categorize them by severity (P0/P1/P2/P3) and suggest which to fix before launch.
```
