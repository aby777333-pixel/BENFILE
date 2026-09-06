/** Role-based access control matrix. Mirrored in the database (role_permissions). */

export const ROLES = ['SUPER_ADMIN', 'COMPLIANCE_OFFICER', 'SENIOR_ANALYST', 'ANALYST', 'RELATIONSHIP_MANAGER', 'AUDITOR'] as const;
export type StaffRole = (typeof ROLES)[number];

export const PERMISSIONS = [
  'clients:read',
  'clients:write',
  'clients:delete',
  'verification:ingest',
  'verification:request',
  'risk:review',
  'risk:escalate',
  'cases:manage',
  'cases:assign',
  'notes:write',
  'documents:request',
  'sensitive:reveal',
  'reports:export',
  'audit:read',
  'external:search',
  'external:review',
  'consent:manage',
  'disputes:manage',
  'investor:capture',
  'scoring:configure',
  'users:manage',
  'retention:manage',
  'financial:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  SUPER_ADMIN: ALL,
  COMPLIANCE_OFFICER: [
    'clients:read', 'clients:write', 'verification:ingest', 'verification:request', 'risk:review', 'risk:escalate',
    'cases:manage', 'cases:assign', 'notes:write', 'documents:request', 'sensitive:reveal', 'reports:export',
    'audit:read', 'external:search', 'external:review', 'consent:manage', 'disputes:manage', 'investor:capture',
    'retention:manage', 'financial:read',
  ],
  SENIOR_ANALYST: [
    'clients:read', 'clients:write', 'verification:ingest', 'verification:request', 'risk:review', 'risk:escalate',
    'cases:manage', 'cases:assign', 'notes:write', 'documents:request', 'sensitive:reveal', 'reports:export',
    'external:search', 'external:review', 'consent:manage', 'disputes:manage', 'investor:capture', 'financial:read',
  ],
  ANALYST: [
    'clients:read', 'clients:write', 'verification:ingest', 'verification:request', 'risk:review', 'cases:manage',
    'notes:write', 'documents:request', 'reports:export', 'external:search', 'external:review', 'investor:capture',
    'financial:read',
  ],
  RELATIONSHIP_MANAGER: ['clients:read', 'notes:write', 'documents:request', 'consent:manage', 'investor:capture'],
  AUDITOR: ['clients:read', 'audit:read', 'financial:read'],
};

export function hasPermission(role: StaffRole | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

/** Sections of the Client 360 that a role may open. */
export const SECTION_ACCESS: Record<string, Permission> = {
  overview: 'clients:read',
  identity: 'clients:read',
  financial: 'financial:read',
  credit: 'financial:read',
  employment: 'clients:read',
  banking: 'financial:read',
  contact: 'clients:read',
  addresses: 'clients:read',
  risk: 'clients:read',
  external: 'external:search',
  graph: 'clients:read',
  documents: 'clients:read',
  history: 'clients:read',
  notes: 'clients:read',
  audit: 'audit:read',
  investor: 'investor:capture',
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPLIANCE_OFFICER: 'Compliance Officer',
  SENIOR_ANALYST: 'Senior Analyst',
  ANALYST: 'Analyst',
  RELATIONSHIP_MANAGER: 'Relationship Manager',
  AUDITOR: 'Auditor',
};
