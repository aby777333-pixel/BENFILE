# BENFILE integrations

Source documents: [BENFILE_APIS.pdf](./BENFILE_APIS.pdf) (75 APIs in 10 categories),
[BENFILE_APIS_PRICING_BY_CATEGORY.pdf](./BENFILE_APIS_PRICING_BY_CATEGORY.pdf) and
[BENFILE_APIS_PRICING_BY_TIER.pdf](./BENFILE_APIS_PRICING_BY_TIER.pdf) (commercial status, October 2026).
Machine-readable catalogue: `src/lib/integrations/catalog.ts`; pricing: `src/lib/integrations/pricing.ts`.
Live status is shown on **/admin → Integration catalogue**. What to buy: [PURCHASE_LIST.md](./PURCHASE_LIST.md).

## How it works

```
process.env (server only)
   └─ src/lib/integrations/catalog.ts     which env vars each API needs → LIVE / SANDBOX_FALLBACK / NOT_CONFIGURED / MANUAL
   └─ src/lib/external/live/index.ts      builds a live connector when its env vars exist and drops the sandbox it supersedes
   └─ src/lib/integrations/http.ts        timeout, retry (429/5xx), per-provider rate limit, secret scrubbing, injectable fetch
```

* Secrets are read from the server environment only (Netlify → Site configuration → Environment variables). They never
  reach the browser; the admin page only reports whether a variable is *set*.
* Every live connector implements the existing `ExternalConnector` interface, so findings still pass through consent
  checks, entity resolution, media classification, PENDING human review and the audit trail. Nothing attaches to a
  Client 360 profile without a reviewer.
* With no credentials configured the behaviour is unchanged: all sandbox connectors run and are labelled **Sandbox**.

## Live connectors (switch on by setting the variables)

| Connector key | Catalogue | Env vars | Supersedes | Notes |
| --- | --- | --- | --- | --- |
| `attestr-mca` | 5.1–5.4 | `ATTESTR_AUTH_TOKEN` (+ optional `ATTESTR_FETCH_DIRECTORS=false`) | `mca-sandbox` | Employer → MCA master via autocomplete; director match → DIRECTORSHIP with DIN. PAN from director rows is never stored. DPDP V3 consent applies. |
| `opensanctions` | 6.3, 6.5 | `OPENSANCTIONS_API_KEY` (+ optional `OPENSANCTIONS_DATASET`, `OPENSANCTIONS_THRESHOLD`) | `sanctions-sandbox` | Query-by-example `/match/default`; topics split into SANCTIONS_SCREEN and PEP_SCREEN (always stored, even on zero hits). |
| `dilisense` | 6.1, 6.2, 6.4 | `DILISENSE_API_KEY` (+ `DILISENSE_ADVERSE_MEDIA=true` once the Adverse Media product is subscribed; optional `DILISENSE_BASE_URL`, `DILISENSE_MEDIA_ENDPOINT`) | `sanctions-sandbox` | `checkIndividual` (dob as dd/mm/yyyy, fuzzy_search=1) grouped by `source_type`; adverse media from `/media/checkIndividual` grouped by category. Free tier 100 calls/month. |
| `complyadvantage` | 10.6 (alt. for 6.x) | `COMPLYADVANTAGE_API_KEY` (+ optional `COMPLYADVANTAGE_SEARCH_URL`, `COMPLYADVANTAGE_FUZZINESS`) | `sanctions-sandbox` | One search → SANCTIONS_SCREEN + PEP_SCREEN + one NEWS finding per adverse-media article. Enterprise contract pricing. |
| `ecourts` | 7.1–7.3, 9.13 | `ECOURTS_API_TOKEN` (+ optional `ECOURTS_BASE_URL`, `ECOURTS_SEARCH_PARAM`) | `courts-sandbox` | Partner docs are behind login: confirm the litigant-name query parameter (default `party_name`) at onboarding. Legal records always need human review. |
| `brave-web` | 10.2 | `BRAVE_SEARCH_API_KEY` | `web-sandbox` | Query = quoted name + one corroborator (employer / city). Identifiers are never sent. |
| `brave-news` | 10.5 | `BRAVE_SEARCH_API_KEY` | `media-sandbox` | Last 12 months, India, routed through adverse-media classification. |
| `landlens` | 9.10, 9.14, 9.15 | `LANDLENS_API_KEY` (+ optional `LANDLENS_BASE_URL`) | – | Property side: **Inventory → project → Price intelligence → “Refresh guideline value from LandLens”** writes `guideline_value_per_sqft` and an OFFICIAL_GUIDELINE comparable; `fetchRoadWidth` and `callTool` are available for DD items. Tamil Nadu only. |

## Integration points (contract in code, provider onboarding required)

| Category | Providers | Where it plugs in |
| --- | --- | --- |
| KYC & identity (1.x) | Protean PAN, HyperVerge KYC / OCR / mobile, Setu eKYC / BAV, DigiLocker, MSG91, Mappls | `ProviderAdapter` (`src/lib/providers`) → canonical model via `/api/ingest`; OCR → document centre |
| Banking & financial (2.x) | Setu BAV / Insights / AA, Perfios | Wealth register (`assets`, `bank_relationships`, `cash_flow_periods`) via `actions-wealth.ts` |
| Credit (3.x) | TransUnion CIBIL, CRIF | `ingestBureauReport` → `credit_bureau_reports` (requires bureau membership + client consent) |
| Employment (4.x) | Attestr UAN, Indiconnect, Scofit, FastKYC | Employment domain of the canonical model (`ProviderAdapter`) |
| Corporate & tax (5.5–5.7) | HyperVerge GST, Indiconnect Udyam | `ExternalConnector` (`searchCompanies`) – replaces `gst-sandbox` |
| AML monitoring (6.5) | OpenSanctions `changed_since` re-match | `refresh_schedules` / continuous refresh |
| Legal (7.4–7.5) | eCourts refresh + orders | `legal_matters` monitoring, order PDFs into Storage |
| Investments (8.x) | CASParser | Document centre → structured parse → `assets` (MF / demat / AIF / NPS) |
| Property (9.8–9.9, 9.12) | Profiden RERA, Landeed | `property_due_diligence` items RERA / PARENT_DOCUMENTS |
| Public & professional (10.1, 10.3, 10.4) | LinkedIn, Meta, Instagram | OAuth flows must be client-initiated from the portal; connectors then run under `PROFESSIONAL` / `SOCIAL` consent |

## Manual / portal-only sources

TamilNilam (Patta / Chitta / FMB / A-Register / transfer history), TNREGINET (EC / registration records) and NIC
Property Chain publish no public developer API. They are catalogued as **Manual / portal** and are handled through the
document centre (upload → classify → DD item) until authorised stakeholder access is granted.

## Adding a live connector

1. Implement `ExternalConnector` in `src/lib/external/live/<provider>.ts` using `httpRequest` (inject `fetchImpl` in tests).
2. Register a factory in `src/lib/external/live/index.ts` with its `envVars` and the sandbox keys it `supersedes`.
3. Add / update the catalogue rows in `src/lib/integrations/catalog.ts` (`implementation: 'LIVE_CONNECTOR'`, `connectorKey`).
4. Add tests in `tests/integrations.test.ts` with a fake fetch; never call the network from tests.
5. Add the variable names to `.env.example`; set the values in Netlify.
