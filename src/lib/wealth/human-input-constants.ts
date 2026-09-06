/** Plain constants shared by server pages and client forms (not a client module). */
export const HUMAN_CATEGORIES: Array<{ key: string; label: string; prompt: string }> = [
  { key: 'PERSONAL_OBSERVATION', label: 'Personal observation', prompt: 'What did you personally observe?' },
  { key: 'CLIENT_SAID', label: 'Client said', prompt: 'What did the client tell you?' },
  { key: 'THIRD_PARTY_SAID', label: 'Third party said', prompt: 'What were you told about this person?' },
  { key: 'MARKET_FEEDBACK', label: 'Market feedback', prompt: 'What is the market saying? (unverified)' },
  { key: 'COMMERCIAL_IMPRESSION', label: 'Commercial impression', prompt: 'What is your commercial impression? (opinion)' },
  { key: 'POSSIBLE_RISK', label: 'Possible risk', prompt: 'What needs verification?' },
  { key: 'OPPORTUNITY_NOTE', label: 'Opportunity note', prompt: 'What opportunity do you see? (opinion)' },
  { key: 'RELATIONSHIP_NOTE', label: 'Relationship note', prompt: 'What should the team know about the relationship?' },
  { key: 'OTHER', label: 'Other', prompt: 'Anything else worth recording as context?' },
];

export const HUMAN_SOURCE_TYPES: Array<{ key: string; label: string }> = [
  { key: 'FIRST_HAND_OBSERVATION', label: 'First-hand observation' },
  { key: 'CLIENT_DECLARED', label: 'Client declared' },
  { key: 'THIRD_PARTY_STATEMENT', label: 'Third-party statement' },
  { key: 'INTRODUCER_STATEMENT', label: 'Introducer statement' },
  { key: 'RM_OPINION', label: 'RM opinion' },
  { key: 'UNVERIFIED_MARKET_INFORMATION', label: 'Unverified market information' },
  { key: 'RUMOUR', label: 'Rumour' },
  { key: 'UNKNOWN_SOURCE', label: 'Unknown source' },
];
