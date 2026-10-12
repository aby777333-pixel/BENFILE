# BENFILE - working notes for Claude sessions

Client financial intelligence platform (India). Next.js 15 + Supabase (project `fxashuozglfcevdivtud`) + Netlify (`benfile.netlify.app`).

## How to ship
- `npm run typecheck && npm test && npm run build` before every commit. Tests use fake fetch only - never the network.
- Commit as `-c user.name="Aby (BENFILE)" -c user.email="aby777333@gmail.com"` (no global git identity on this machine).
- Netlify is **not** git-linked. Deploy with `netlify deploy --build --prod --message "..."` from the project folder.
- Schema changes: write `supabase/migrations/000N_*.sql` **and** apply the same SQL with the Supabase MCP `apply_migration`. Applied so far: 0001-0006.
- The desktop app copies any `@file` PDF into `public/`; remove it before committing (public/ is served).
- After a deploy, a browser that still has the old build shows "Application error: a client-side exception"; a reload fixes it.

## Product decisions already made (do not re-open without the owner)
- **Consent first, always.** No lookup of any kind runs on a person before they accept Part A. There is no covert mode and none should be added.
- **Two-stage consent** (`src/lib/portal/consent-stages.ts`, RPC `portal_consent`): Part A preliminary screening (30 days; identity name match, phone/e-mail ownership, sanctions/PEP, corporate, court, news, nominated profiles only) and Part B full verification (365 days). The server clamps ticked categories to the stage; the typed name + terms version + device + time are the evidence.
- **Portal links are handed over by a person.** The prospect form offers WhatsApp / mailto drafts on the RM's own device; BENFILE never sends the link itself. The owner explicitly declined adding OTP or other authentication to the link.
- **Identifiers never go into search forms.** PAN, Aadhaar, phone, e-mail enter only through verification ingest (hashed + masked, full value sealed in `sensitive_values`). Matching details on the External tab are employer, occupation, cities (comma-separated, union), DOB, nominated profile URLs.
- **Declared contact** (mobile/e-mail typed by the RM at prospect creation or via Contact tab → Add/Edit contact) is masked + hashed on `clients`, full value sealed when the role has `verification:ingest`, labelled "client declared" until an ownership check confirms it.
- **External search re-runs re-score PENDING findings** with the latest matching details; reviewed findings are never touched.
- `ActionForm` includes the clicked submit button's name/value (multi-button decision forms depend on it).

## Where things are
- Integration catalogue + pricing: `src/lib/integrations/{catalog,pricing}.ts`; live connectors `src/lib/external/live/*`; status on `/admin`. Purchase guidance `docs/PURCHASE_LIST.md`. No provider keys are set yet - every connector is sandbox until env vars are added in Netlify.
- Prospect flow: `/clients/new` right panel → `createProspect` (`src/lib/actions.ts`) → portal `/portal/[token]` (`src/components/portal/portal-app.tsx`, session-less Supabase client) → External Intel tab search works with no verification run (`src/lib/external/prospect-subject.ts`).
- Staff how-to: `docs/HOW_TO_USE.md`. Consent form text: Claude doc "BENFILE Client Consent & Screening Authorisation".

## Test data
- BF-000005 Abraham George (client id 2d39a790-9abc-49f1-90b2-0d9f4cb3d5c5): real-person test record created 2026-10-12. Part A + Part B accepted via portal; Aadhaar scan uploaded (pending review); 15 sandbox findings, 2 rejected. Treat its data as personal data.
- Demo accounts in README (admin@benfile.local etc.).
