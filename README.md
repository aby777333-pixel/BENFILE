# BENFILE

**Client Financial Intelligence, Verification & Profiling Platform** for India, architected for additional countries.

BENFILE turns raw verification / API responses into a Client 360 intelligence terminal for authorised analysts:
identity consistency, financial health, credit, employment, banking, contact, addresses, risk, external intelligence
(government, corporate, legal, media, professional, social), relationship graph, verification history, analyst workspace,
consent, audit and privacy-by-design masking.

## Stack

- Next.js 15 (App Router, server components, server actions) + TypeScript + Tailwind
- Supabase (Auth, Postgres, RLS, SECURITY DEFINER RPCs) - project `fxashuozglfcevdivtud`
- Zod runtime validation, Recharts, Vitest

## Architecture

```
Provider API -> Adapter (src/lib/providers) -> Canonical model (src/lib/canonical, Zod)
             -> Engines (src/lib/engines: identity, risk, freshness, scoring, health, entity resolution, media)
             -> Persisted snapshot (verification_runs + normalised tables; never overwritten)
             -> Client 360 (src/app/(app)/clients/[id]/*)
External connectors (src/lib/external) -> Orchestrator -> entity resolution -> PENDING findings -> human review -> graph
```

Every fact carries an assertion kind (`VERIFIED_FACT` / `CLIENT_DECLARED` / `DERIVED` / `ANALYST_ASSESSMENT`),
a source key and a trust tier (1-7). Full sensitive identifiers live only in `sensitive_values` (no SELECT policy);
reveals go through an audited RPC. Search by PAN / phone / e-mail / UAN uses SHA-256 hashes.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run seed                 # ingests the fixtures as the demo Super Admin (RLS applies)
npm run dev
```

Tests: `npm test` (adapter, engines, masking, permissions, external orchestrator).

## Demo accounts (change before any real use)

| Role | E-mail |
| --- | --- |
| Super Admin | admin@benfile.local |
| Compliance Officer | compliance@benfile.local |
| Senior Analyst | senior@benfile.local |
| Analyst | analyst@benfile.local |
| Relationship Manager | rm@benfile.local |
| Auditor | auditor@benfile.local |

Password for all demo accounts is set in `.env.local` (`BENFILE_SEED_PASSWORD`).

## Sandbox connectors

No licensed government / registry / bureau / court / media API credentials are configured. The external connectors
in `src/lib/external/sandbox-connectors.ts` return deterministic illustrative records (labelled **Sandbox** in the UI)
so the full orchestration, entity-resolution and review workflow can be exercised. Replace them with live connectors
implementing the same `ExternalConnector` interface.

## Database

Schema: `supabase/migrations/0001_benfile_core.sql` (applied to the project). Demo staff users were created directly
in `auth.users`; see `scripts/seed.ts` for data seeding through the real ingest pipeline.
