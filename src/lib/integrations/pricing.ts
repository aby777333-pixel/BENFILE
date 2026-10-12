/**
 * Commercial status of every catalogued API, from docs/BENFILE_APIS_PRICING_BY_CATEGORY.pdf
 * and docs/BENFILE_APIS_PRICING_BY_TIER.pdf (both 2026-10). Keyed by catalogue id.
 *
 *   FREE         - usable in production at no charge once onboarded
 *   FREE_TIER    - free developer / sandbox allowance, paid beyond it (self-serve purchase)
 *   PAID         - must be purchased; price public and self-serve
 *   CONTRACT     - must be purchased through a commercial / institutional agreement (no public price)
 *   UNPUBLISHED  - no public API pricing; government / stakeholder access only
 */
export type PriceTier = 'FREE' | 'FREE_TIER' | 'PAID' | 'CONTRACT' | 'UNPUBLISHED';

export interface PricingInfo {
  tier: PriceTier;
  /** Short, human-readable price note. */
  price: string;
  /** True when a card / self-serve signup is enough (no sales call, no legal agreement). */
  selfServe: boolean;
  /** What must happen before the integration can go live. */
  toObtain: string;
}

const attestrPayg: PricingInfo = { tier: 'FREE_TIER', price: 'Free demo credits; then prepaid pay-as-you-go wallet, per-request price in the Attestr console', selfServe: true, toObtain: 'Register an app at attestr.com, top up the wallet, copy the Basic auth token.' };
const setuContract = (what: string): PricingInfo => ({ tier: 'CONTRACT', price: `Per-${what} commercial pricing; no public rate`, selfServe: false, toObtain: 'Setu sales onboarding (KYC + agreement); sandbox credentials first.' });
const hvContract: PricingInfo = { tier: 'CONTRACT', price: 'Usage-based, customised by module and volume', selfServe: false, toObtain: 'HyperVerge sales onboarding; staging appId / appKey issued after agreement.' };
const cibil: PricingInfo = { tier: 'CONTRACT', price: 'Member agreement + per-enquiry pricing; free "Try it out" synthetic data in the marketplace', selfServe: false, toObtain: 'Register on the TransUnion CIBIL API Marketplace, KAM approval, legal documentation, UAT sign-off.' };
const scofit: PricingInfo = { tier: 'CONTRACT', price: 'Per-check transactional pricing; no public rate', selfServe: false, toObtain: 'Scofit developer onboarding.' };
const ecourts: PricingInfo = { tier: 'FREE_TIER', price: 'INR 200 free credits on signup; Case Search INR 0.60 (PAYG) / 0.20 (Enterprise); Case Detail INR 1.50 / 0.50', selfServe: true, toObtain: 'Sign up at ecourtsindia.com/api, copy the eci_live_ token, confirm the search parameter names from the partner docs.' };
const casparser: PricingInfo = { tier: 'FREE_TIER', price: 'Free 10 credits / month; INR 999 / 50, INR 3 500 / 200, INR 10 500 / 750 credits per month (1 parse = 1 credit)', selfServe: true, toObtain: 'Sign up at casparser.in; use key sandbox-with-json-responses for development.' };
const tnUnpublished: PricingInfo = { tier: 'UNPUBLISHED', price: 'Not publicly listed for enterprise / API access; citizen portal fees only', selfServe: false, toObtain: 'Apply to the Tamil Nadu department as an authorised stakeholder; until then handle via document upload.' };
const dilisense: PricingInfo = { tier: 'FREE_TIER', price: 'Free developer tier 100 requests / month; then from EUR 0.10 per call', selfServe: true, toObtain: 'Create an account at dilisense.com, copy the x-api-key.' };
const opensanctions: PricingInfo = { tier: 'FREE_TIER', price: 'Free community tier for testing; from EUR 0.10 per query on the developer tier', selfServe: true, toObtain: 'Create an API key at opensanctions.org (ApiKey header).' };
const landlensPaid = (note: string): PricingInfo => ({ tier: 'PAID', price: note, selfServe: true, toObtain: 'Create a LandLens key (llk_) at verified.realestate and buy a credit bundle.' });
const brave: PricingInfo = { tier: 'FREE_TIER', price: 'USD 5 free credit / month; then about USD 5 per 1 000 requests', selfServe: true, toObtain: 'Create a subscription at api-dashboard.search.brave.com (card required).' };
const metaFree: PricingInfo = { tier: 'FREE', price: 'No per-call fee; app review and user OAuth consent required', selfServe: true, toObtain: 'Create a Meta for Developers app, pass app review for the needed permissions, add a client-initiated OAuth flow in the portal.' };

export const PRICING: Record<string, PricingInfo> = {
  '1.1': { tier: 'PAID', price: 'INR 12 000 / year + GST (INR 14 160) for API registration; 750 free verifications / day, slabs beyond', selfServe: false, toObtain: 'Register with Protean as an approved verification agency (eligibility criteria apply).' },
  '1.2': hvContract,
  '1.3': { tier: 'CONTRACT', price: 'Commercial per-eKYC pricing; no public rate', selfServe: false, toObtain: 'Setu onboarding plus UIDAI AUA/KUA / sub-AUA arrangement.' },
  '1.4': { tier: 'FREE', price: 'No NeGD fee; requester onboarding and eligibility required', selfServe: false, toObtain: 'Apply as a DigiLocker requester organisation on API Setu.' },
  '1.5': hvContract,
  '1.6': setuContract('verification'),
  '1.7': { tier: 'FREE_TIER', price: '1-month free sandbox trial (Start plan); production customised by volume', selfServe: false, toObtain: 'HyperVerge Start plan signup, then commercial plan.' },
  '1.8': { tier: 'FREE_TIER', price: 'Widget / SDK free; e-mail OTP billed per message (MSG91 OTP widget pricing)', selfServe: true, toObtain: 'Create an MSG91 account, copy the authkey.' },
  '1.9': { tier: 'FREE_TIER', price: 'Free tier to start; production scales with volume', selfServe: true, toObtain: 'Create a Mappls developer account (client id / secret).' },
  '2.1': setuContract('verification'),
  '2.2': setuContract('statement'),
  '2.3': { tier: 'CONTRACT', price: 'Per-call / per-session commercial pricing; production needs Sahamati onboarding', selfServe: false, toObtain: 'Setu AA sandbox first; production requires FIU registration with Sahamati.' },
  '2.4': setuContract('data session'),
  '2.5': setuContract('data session'),
  '2.6': { tier: 'CONTRACT', price: 'Volume-based commercial pricing via Perfios Hub', selfServe: false, toObtain: 'Perfios Hub sales onboarding.' },
  '2.7': setuContract('data session'),
  '2.8': setuContract('insight report'),
  '3.1': cibil,
  '3.2': cibil,
  '3.3': cibil,
  '3.4': { tier: 'CONTRACT', price: 'Corporate agreement; RBI-compliant member onboarding', selfServe: false, toObtain: 'Contact CRIF; developer.crif.com after approval.' },
  '4.1': attestrPayg,
  '4.2': { tier: 'CONTRACT', price: 'Per-transaction commercial pricing; no public rate', selfServe: false, toObtain: 'Indiconnect BizStack onboarding; staging credentials are public in the docs.' },
  '4.3': attestrPayg,
  '4.4': scofit,
  '4.5': attestrPayg,
  '4.6': { tier: 'CONTRACT', price: 'Per-check transactional pricing; free trial via dev console', selfServe: false, toObtain: 'FastKYC dev console signup, then commercial plan.' },
  '4.7': scofit,
  '5.1': attestrPayg,
  '5.2': attestrPayg,
  '5.3': attestrPayg,
  '5.4': attestrPayg,
  '5.5': hvContract,
  '5.6': hvContract,
  '5.7': { tier: 'PAID', price: 'Prepaid; about INR 1.80 - 3.00 per request (tier dependent)', selfServe: false, toObtain: 'Indiconnect BizStack prepaid account.' },
  '6.1': dilisense,
  '6.2': dilisense,
  '6.3': opensanctions,
  '6.4': dilisense,
  '6.5': opensanctions,
  '7.1': ecourts,
  '7.2': ecourts,
  '7.3': ecourts,
  '7.4': ecourts,
  '7.5': ecourts,
  '8.1': casparser,
  '8.2': casparser,
  '8.3': casparser,
  '8.4': casparser,
  '8.5': casparser,
  '8.6': casparser,
  '8.7': casparser,
  '8.8': casparser,
  '8.9': casparser,
  '9.1': tnUnpublished,
  '9.2': tnUnpublished,
  '9.3': tnUnpublished,
  '9.4': tnUnpublished,
  '9.5': tnUnpublished,
  '9.6': tnUnpublished,
  '9.7': tnUnpublished,
  '9.8': { tier: 'PAID', price: 'Per successful call, pay-as-you-go; sandbox demo hits free; rate not public', selfServe: false, toObtain: 'Profiden onboarding (organisation API key).' },
  '9.9': { tier: 'PAID', price: 'Per successful call, pay-as-you-go; rate not public', selfServe: false, toObtain: 'Profiden onboarding (organisation API key).' },
  '9.10': landlensPaid('1 credit per successful ppa_approval lookup; credit bundles from INR 699'),
  '9.11': { tier: 'UNPUBLISHED', price: 'Governed by state department arrangements; not public', selfServe: false, toObtain: 'NIC / NAPIX authorised stakeholder onboarding.' },
  '9.12': { tier: 'UNPUBLISHED', price: 'Developer / enterprise pricing not published', selfServe: false, toObtain: 'Contact Landeed developer sales.' },
  '9.13': ecourts,
  '9.14': { tier: 'FREE', price: 'guideline_value is a free LandLens tool (API key still required)', selfServe: true, toObtain: 'Create a LandLens key (llk_) at verified.realestate.' },
  '9.15': landlensPaid('road_width 2 credits, street_profile 1 credit per answer; bundles from INR 699; 60 calls / min, 3 000 / day'),
  '10.1': { tier: 'FREE', price: 'No per-call fee; development tier with limited access', selfServe: true, toObtain: 'Create a LinkedIn developer app, request Verified-on-LinkedIn product access, member OAuth consent in the portal.' },
  '10.2': brave,
  '10.3': metaFree,
  '10.4': metaFree,
  '10.5': brave,
  '10.6': { tier: 'CONTRACT', price: 'Commercial pricing by solution and volume; no public per-call rate', selfServe: false, toObtain: 'ComplyAdvantage sales onboarding; sandbox account issued after agreement.' },
};

export const PRICE_TIER_LABEL: Record<PriceTier, string> = {
  FREE: 'Free',
  FREE_TIER: 'Free tier + pay-as-you-go',
  PAID: 'Paid (public price)',
  CONTRACT: 'Commercial agreement',
  UNPUBLISHED: 'No public API / pricing',
};

export function pricingFor(id: string): PricingInfo {
  return PRICING[id] ?? { tier: 'UNPUBLISHED', price: 'Unknown', selfServe: false, toObtain: 'Not assessed.' };
}
