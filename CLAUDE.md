# BENFILE - working notes for Claude sessions

Client financial intelligence platform (India). Next.js 15 + Supabase (project `fxashuozglfcevdivtud`) + Netlify (`benfile.netlify.app`).

## How to ship
- `npm run typecheck && npm test && npm run build` before every commit. Tests use fake fetch only - never the network.
- Commit as `-c user.name="Aby (BENFILE)" -c user.email="aby777333@gmail.com"` (no global git identity on this machine).
- Netlify is **not** git-linked. Deploy with `netlify deploy --build --prod --message "..."` from the project folder.
- Schema changes: write `supabase/migrations/000N_*.sql` **and** apply the same SQL with the Supabase MCP `apply_migration`. Applied so far: 0001-0008.
- The desktop app copies any `@file` PDF into `public/`; remove it before committing (public/ is served).
- After a deploy, a browser that still has the old build shows "Application error: a client-side exception"; a reload fixes it.

## Product decisions already made (do not re-open without the owner)
- **Consent first, always.** No lookup of any kind runs on a person before they accept Part A. There is no covert mode and none should be added.
- **Two-stage consent** (`src/lib/portal/consent-stages.ts`, RPC `portal_consent`): Part A preliminary screening (30 days; identity name match, phone/e-mail ownership, sanctions/PEP, corporate, court, news, nominated profiles only) and Part B full verification (365 days). The server clamps ticked categories to the stage; the typed name + terms version + device + time are the evidence.
- **Portal links are handed over by a person.** The prospect form offers WhatsApp / mailto drafts on the RM's own device; BENFILE never sends the link itself. The owner explicitly declined adding OTP or other authentication to the link.
- **Identifiers never go into search forms.** PAN, Aadhaar, phone, e-mail enter only through verification ingest (hashed + masked, full value sealed in `sensitive_values`). Matching details on the External tab are employer, occupation, cities (comma-separated, union), DOB, nominated profile URLs.
- **Declared contact** (mobile/e-mail typed by the RM at prospect creation or via Contact tab → Add/Edit contact) is masked + hashed on `clients`, full value sealed when the role has `verification:ingest`, labelled "client declared" until an ownership check confirms it.
- **Self-declared details on the portal** (0008, RPC `portal_declare_details`, table `client_declarations`, `src/lib/portal/declared-details.ts`): the person may type name, DOB, PAN, Aadhaar, passport, voter ID, DL, mobiles, e-mails, addresses - all optional, only after Part A/B consent. Same masking + hashing as ingest (`bf_*` SQL helpers mirror `masking.ts`), full value sealed in `sensitive_values`; **Aadhaar is never stored in full**. Items stay CLIENT DECLARED; accept = reviewer noted, reject = retired, new value = earlier SUPERSEDED. Shown on Contact tab + Documents → Portal submissions (masked only).
- **External search re-runs re-score PENDING findings** with the latest matching details; reviewed findings are never touched.
- `ActionForm` includes the clicked submit button's name/value (multi-button decision forms depend on it).

## Where things are
- Integration catalogue + pricing: `src/lib/integrations/{catalog,pricing}.ts`; live connectors `src/lib/external/live/*`; status on `/admin`. Purchase guidance `docs/PURCHASE_LIST.md`.
- **Provider keys live only in Netlify env vars** (Site configuration → Environment variables, or `netlify env:set`). The owner adds keys themselves; Claude never types or pastes a key anywhere - it checks presence with `netlify env:list --json` (names only), then redeploys (`netlify deploy --build --prod`, required for the server to see a new variable).
- Keys set as of 2026-10-14: `DILISENSE_API_KEY` (Screening API, free 100 calls/month then EUR 0.10; adverse media is a separate product - set `DILISENSE_ADVERSE_MEDIA=true` only once subscribed), `ATTESTR_AUTH_TOKEN` (the console "API Token", sent as `Authorization: Basic`), `OPENSANCTIONS_API_KEY`, `ECOURTS_API_TOKEN` (eCourts litigant-name query param still unconfirmed - partner docs behind login). Brave / ComplyAdvantage / everything else still sandbox. Dilisense contract: GET /v1/checkIndividual, `x-api-key`, dob dd/mm/yyyy, fuzzy_search=1; media GET /v1/media/checkIndividual with fetch_articles=true → news_exposures by category.
- When a live connector supersedes a sandbox, that sandbox's PENDING findings are marked SUPERSEDED on the next run (finding_review enum value added in 0007).
- Prospect flow: `/clients/new` right panel → `createProspect` (`src/lib/actions.ts`) → portal `/portal/[token]` (`src/components/portal/portal-app.tsx`, session-less Supabase client) → External Intel tab search works with no verification run (`src/lib/external/prospect-subject.ts`).
- Staff how-to: `docs/HOW_TO_USE.md`. Consent form text: Claude doc "BENFILE Client Consent & Screening Authorisation".

## Test data
- BF-000005 Abraham George (client id 2d39a790-9abc-49f1-90b2-0d9f4cb3d5c5): real-person test record created 2026-10-12. Part A + Part B accepted via portal; Aadhaar scan uploaded (pending review); first live Dilisense screen 2026-10-12 13:57 - 0 sanctions / 0 PEP hits; 13 sandbox findings pending, 2 rejected, 2 superseded. Treat its data as personal data.
- Demo accounts in README (admin@benfile.local etc.).
