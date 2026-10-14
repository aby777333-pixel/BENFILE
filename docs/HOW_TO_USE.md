# BENFILE - how to work a client, start to finish

Written 12 Oct 2026 for relationship managers and analysts. Screens are named as they appear in the left menu.

## 1. You only have a name: create a prospect and get consent
1. **New verification → "Start with consent - new prospect"** (right-hand panel).
2. Enter the name, optional mobile / e-mail / city, choose how long the link lives, click **Create prospect & consent link**.
3. Use **Open in WhatsApp** or **Open e-mail draft** (opens a pre-written message on your own device) or **Copy link**. Send it to the person directly, never to a group. BENFILE does not send anything itself.
4. The person opens the link on their phone, reads Part A, unticks anything they refuse, optionally gives employer / city / date of birth / profile URLs, types their name and accepts. Their record now shows **Consent: GRANTED** and a reference `PORTAL-A-...` on **Notes & Cases**.

Nothing is looked up before step 4. If they decline, the record simply stays empty.

## 2. Preliminary screening (Part A in force)
1. Open the client → **External Intel**.
2. "Matching details" is pre-filled from what they gave; add employer, cities (comma-separated, e.g. `Chennai, Kottayam`) and date of birth if you know them. Never type PAN, Aadhaar, phone or e-mail here.
3. **Run external intelligence search.** Findings arrive as *pending*. Re-running with better details re-scores the pending ones.
4. Review each card: **Add to profile** (becomes a risk signal / relationship), **Reject match** (same name, different person), or **Mark for review**. Low scores (25-45%) with gaps "employer, city" are almost always a different person.

Until provider keys are added on `/admin → Integration catalogue`, every connector is **Sandbox** and returns illustrative records, not facts.

## 3. Documents
- The person uploads PAN / Aadhaar / passport / proofs on the same portal link (**Documents** section). You can also upload on the client's **Documents** tab.
- Each upload is private, hashed and marked *Uploaded* until a person reviews it. OCR extraction and provider verification switch on when HyperVerge is configured.
- Aadhaar: shown masked everywhere; the full number is sealed and revealed only with a logged reason (owner decision 2026-10-14). Staff still never type an Aadhaar number into a search form.

## 4. Onboarding (Part B)
1. Send the same portal link again (or mint a new one on the client's **Documents** tab → Create portal link). The portal shows Part B expanded as the next step.
2. The person ticks the categories (credit is off by default and needs its own bureau consent), types their name and accepts → reference `PORTAL-B-...`, valid 12 months.
3. Part B unlocks identity, documents, address, banking, employment, investments and risk. These fill only when a licensed provider is connected (see `docs/PURCHASE_LIST.md`).

## 5. New client verification (left panel on New verification)
This is where a **provider's JSON result** lands - the structured response a KYC provider returns about a person. BENFILE maps it to its own model and builds every tab of the Client 360 as a dated snapshot.
- Today, with no provider connected, use **Load full sample** to see what a fully verified client looks like, tick the consent confirmation and click **Ingest & build Client 360**.
- Once a provider is licensed: paste its response here for an existing client (**Re-verify** on the client header opens this with the client selected), or let the provider push to `POST /api/ingest` automatically.
- It is not for typing identifiers by hand.

## 6. Contact details
**Contact** tab → **Add contact / Edit contact**. Stored masked (`98XXXXX345`, `ab***@example.com`) and hashed, full value sealed and revealed only with a logged reason. Marked *client declared* until an ownership check (one-time code / provider) confirms it.

## 6a. Details the client types themselves (portal → My details)
- Once Part A (or B) is in force, the portal shows **My details**: name as on PAN, date of birth, PAN, Aadhaar, passport (+ expiry), voter ID, driving licence, mobile / alternate mobile, e-mail / alternate e-mail, current and permanent address. **Every field is optional.**
- Stored like everything else: masked + hashed on the record, full value sealed (reveal with a logged reason). Aadhaar is treated the same way (masked on the record, full number sealed - consent terms 2026-10-14). Format is checked on the device and again on the server; a wrong PAN / mobile / PIN is refused with a plain message.
- Where you see it: **Contact** tab → *Details declared by the client on the portal* (masked, reveal where allowed); the submission itself on **Documents → Portal submissions** as *DETAILS* (masked values only). The primary mobile / e-mail also fills the declared contact if it was empty.
- Review: **Accept** keeps the items as *client declared* (they never become verified by acceptance); **Reject** retires every item from that submission. A later different value supersedes the earlier one automatically; the same value again changes nothing.
- These values are never searched on their own - they only help confirm or exclude matches once a document or provider check runs under consent.

## 7. Withdrawal, expiry, refresh
- The person can withdraw on the portal at any time; searches stop immediately.
- Part A expires after 30 days, Part B after 365; the External Intel tab refuses to run past expiry.
- Screening refreshes may run quarterly within the consent period; changes land on the intelligence timeline.

## What is deliberately not possible
- Running any check on someone who has not accepted Part A.
- Searching by PAN, Aadhaar, phone or e-mail from a screen.
- Sending the portal link automatically from BENFILE.
- Attaching a finding to a profile without a named reviewer accepting it.
