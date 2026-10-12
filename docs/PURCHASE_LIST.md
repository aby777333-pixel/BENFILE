# BENFILE API purchase list

Derived from `BENFILE_APIS_PRICING_BY_CATEGORY.pdf` and `BENFILE_APIS_PRICING_BY_TIER.pdf` (October 2026).
Live status of each item is visible on **/admin → Integration catalogue** once the variable is set in Netlify.

## A. Wired in code - works as soon as a key is pasted (self-serve signup)

| # | Integration | Provider | Cost | Env var | What it switches on |
| --- | --- | --- | --- | --- | --- |
| 9.14 | Guideline value | LandLens | **Free** tool (key required) | `LANDLENS_API_KEY` | Inventory → project → “Refresh guideline value” |
| 6.3 / 6.5 | Sanctions screening + monitoring basis | OpenSanctions | Free community tier; from EUR 0.10 / query | `OPENSANCTIONS_API_KEY` | Live SANCTIONS / PEP screen (replaces sandbox) |
| 6.1 / 6.2 / 6.4 | AML, PEP, adverse media | Dilisense | 100 free calls / month; from EUR 0.10 / call | `DILISENSE_API_KEY` (+ `DILISENSE_MEDIA_ENDPOINT` once confirmed) | Live SANCTIONS / PEP screen; adverse media once endpoint confirmed |
| 7.1 – 7.3, 9.13 | Court, tribunal and litigation search | eCourtsIndia | INR 200 free; INR 0.60 / search (PAYG), INR 1.50 / detail | `ECOURTS_API_TOKEN` | Live LEGAL_RECORD findings (replaces sandbox) |
| 5.1 – 5.4 | MCA company, director, LLP, company search | Attestr | Free demo credits; prepaid wallet, per request | `ATTESTR_AUTH_TOKEN` | Live CORPORATE_RECORD + DIRECTORSHIP (replaces sandbox) |
| 10.2 / 10.5 | Web search + news | Brave | USD 5 free / month; about USD 5 per 1 000 requests | `BRAVE_SEARCH_API_KEY` | Live WEB_MENTION + NEWS (replaces sandbox) |
| 9.10 / 9.15 | CMDA / DTCP approvals, road width | LandLens | 1 – 2 credits per answer; bundles from INR 699 | `LANDLENS_API_KEY` | `callTool` / `fetchRoadWidth` for DD items (same key as 9.14) |

**Suggested first purchase (lowest cost, highest coverage):** LandLens key (free), OpenSanctions developer tier, eCourtsIndia PAYG top-up, Attestr wallet, Brave Search subscription. Everything above the free tiers is pay-as-you-go; none needs a contract.

## B. Must be purchased through a commercial agreement (contract in code; provider onboarding first)

| # | Integration | Provider | Pricing | Blocker |
| --- | --- | --- | --- | --- |
| 1.2, 1.5, 1.7, 5.5, 5.6 | KYC, OCR, mobile lookup, GST | HyperVerge | Usage-based, customised | Sales onboarding; appId / appKey issued after agreement |
| 1.3, 1.6, 2.1 – 2.5, 2.7, 2.8 | Aadhaar eKYC, bank verification, statements, Account Aggregator, insights | Setu | Per-call / per-session, not public | Setu agreement; AA production also needs Sahamati FIU registration; eKYC needs UIDAI sub-AUA |
| 2.6 | Source of funds | Perfios | Volume-based | Perfios Hub onboarding |
| 3.1 – 3.3 | Credit score / report / risk | TransUnion CIBIL | Member agreement + per enquiry | KAM approval, legal documentation, UAT sign-off, RBI-compliant purpose |
| 3.4 | Commercial credit | CRIF High Mark | Corporate agreement | RBI-compliant member onboarding |
| 4.2, 5.7 | UAN lookup, Udyam | Indiconnect | Prepaid; Udyam about INR 1.80 – 3.00 / request | BizStack prepaid account |
| 4.4, 4.7 | Current employment / status | Scofit | Per check, not public | Developer onboarding |
| 4.6 | Employer verification | FastKYC | Per check; free trial | Dev console, then plan |
| 1.1 | PAN verification | Protean | INR 12 000 / year + GST; 750 free / day | Approved-agency registration (eligibility) |
| 9.8, 9.9 | RERA project / agent | Profiden | Per successful call, not public | Organisation API key via onboarding |
| 10.6 | Adverse media | ComplyAdvantage | Commercial, by volume | Sales onboarding (connector already in code if you do buy it) |

Attestr UAN / employment history (4.1, 4.3, 4.5) is pay-as-you-go on the same wallet as 5.x but needs the DPDP V3 consent flow before it can be enabled; the adapter is an integration point.

## C. Free, but need onboarding / app review rather than a purchase

| # | Integration | Provider | Blocker |
| --- | --- | --- | --- |
| 1.4 | DigiLocker documents | API Setu / NeGD | Requester-organisation eligibility and onboarding |
| 1.9 | Address verification | Mappls | Developer account (free tier), scales with volume |
| 1.8 | E-mail OTP | MSG91 | Account; per-message billing beyond widget |
| 8.1 – 8.9 | CAS / demat / AIF / NPS parsing | CASParser | Free 10 credits / month; INR 999 / 50 credits upward; sandbox key works today |
| 10.1 | Verified on LinkedIn | LinkedIn | Developer app + product access; member OAuth consent in the portal |
| 10.3 / 10.4 | Meta / Instagram profiles | Meta | App review for permissions; user OAuth consent in the portal |

## D. Cannot be purchased as an API today (manual / document workflow)

| # | Source | Why |
| --- | --- | --- |
| 9.1 – 9.5 | TamilNilam: Patta / Chitta, FMB, A-Register, ownership, transfer history | API only for authorised government stakeholders; no public pricing or sandbox |
| 9.6 – 9.7 | TNREGINET: EC and registration records | No developer API; UAT portal only |
| 9.11 | NIC Property Chain title chain | Authorised stakeholder onboarding via NAPIX; pricing by state arrangement |
| 9.12 | Landeed parent documents | Endpoint and pricing not published; developer sales only |

These are covered through the document centre (client / landowner uploads → classification → DD items) until stakeholder access is granted.

## Rough monthly budget for section A at pilot volume (100 clients / month)

| Provider | Assumption | Estimate |
| --- | --- | --- |
| OpenSanctions | 100 queries | EUR 10 (or free tier) |
| Dilisense | 100 calls | free tier |
| eCourtsIndia | 100 searches + 50 details | INR 135 |
| Attestr | 150 autocomplete + 100 master | wallet; check console rate |
| Brave | 200 web + 200 news | within USD 5 free credit |
| LandLens | 50 guideline (free) + 20 road-width (40 credits) | one INR 699 bundle |

Prices are the providers' published starting rates at the time of the review; confirm at signup.
