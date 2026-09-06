import { z } from 'zod';
import { ASSERTION_KINDS, SOURCE_CLASSES } from './types';

const nullableStr = z.string().nullable();
const nullableNum = z.number().nullable();
const nullableBool = z.boolean().nullable();
const tier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]);

export const ProvenanceSchema = z.object({
  sourceKey: z.string().min(1),
  sourceLabel: z.string().min(1),
  sourceClass: z.enum(SOURCE_CLASSES),
  tier,
  assertion: z.enum(ASSERTION_KINDS),
  retrievedAt: nullableStr.optional(),
  recordId: nullableStr.optional(),
  evidencePath: nullableStr.optional(),
  confidence: nullableNum.optional(),
});

const fact = <T extends z.ZodTypeAny>(v: T) => z.object({ value: v.nullable(), provenance: ProvenanceSchema });

export const IncomeSchema = z.object({
  amount: nullableNum,
  currency: z.string(),
  period: z.enum(['ANNUAL', 'MONTHLY']),
  kind: z.enum(['DECLARED', 'RETURNED', 'VERIFIED', 'ESTIMATED']),
});

export const SourceRecordSchema = z.object({
  key: z.string(),
  label: z.string(),
  sourceClass: z.enum(SOURCE_CLASSES),
  tier,
  available: z.boolean(),
  verificationStatus: z.enum(['VERIFIED', 'PARTIAL', 'UNVERIFIED', 'NOT_AVAILABLE', 'ERROR']),
  retrievedAt: nullableStr,
  lastUpdatedAt: nullableStr,
  confidence: nullableNum,
  completeness: nullableNum,
  evidencePath: nullableStr.optional(),
});

export const CanonicalProfileSchema = z.object({
  schemaVersion: z.literal('1.0'),
  provider: z.object({ key: z.string(), name: z.string(), adapterVersion: z.string() }),
  verification: z.object({
    verificationId: z.string().min(1),
    referenceId: nullableStr,
    status: z.enum(['COMPLETED', 'PARTIAL', 'PENDING', 'FAILED', 'UNKNOWN']),
    requestedAt: nullableStr,
    completedAt: nullableStr,
    updatedAt: nullableStr,
    providerRequestId: nullableStr.optional(),
  }),
  sources: z.array(SourceRecordSchema),
  person: z.object({
    fullName: fact(z.string()),
    gender: fact(z.string()),
    dateOfBirth: fact(z.string()),
    age: fact(z.number()),
    occupation: fact(z.string()),
    income: fact(IncomeSchema),
    relatives: z.array(z.object({ name: z.string(), relation: nullableStr, provenance: ProvenanceSchema })),
    photoUrl: fact(z.string()).nullable().optional(),
  }),
  contacts: z.object({
    phones: z.array(z.object({ number: z.string(), phoneType: nullableStr, provenance: ProvenanceSchema })),
    emails: z.array(z.object({ email: z.string(), provenance: ProvenanceSchema })),
  }),
  identityDocuments: z.array(
    z.object({
      docType: z.enum(['PAN', 'AADHAAR', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENCE', 'RATION_CARD', 'GSTIN', 'DIN', 'OTHER']),
      number: nullableStr,
      maskedNumber: nullableStr,
      nameOnDocument: nullableStr,
      subtype: nullableStr,
      status: nullableStr,
      aadhaarLinked: nullableBool,
      issuedAt: nullableStr.optional(),
      expiresAt: nullableStr.optional(),
      provenance: ProvenanceSchema,
    }),
  ),
  addresses: z.array(
    z.object({
      fullAddress: nullableStr,
      street: nullableStr,
      city: nullableStr,
      state: nullableStr,
      country: nullableStr,
      pinCode: nullableStr,
      addressType: nullableStr,
      provenance: ProvenanceSchema,
    }),
  ),
  bankAccounts: z.array(
    z.object({
      accountNumber: nullableStr,
      ifsc: nullableStr,
      bankName: nullableStr,
      branch: nullableStr,
      accountType: nullableStr,
      accountHolderName: nullableStr,
      verified: nullableBool,
      provenance: ProvenanceSchema,
    }),
  ),
  employment: z.object({
    records: z.array(
      z.object({
        employer: z.object({
          name: z.string(),
          establishmentId: nullableStr,
          ownershipType: nullableStr,
          setupDate: nullableStr,
          employeeCount: nullableNum,
          pfFilings: z.array(z.object({ period: z.string(), employeeCount: nullableNum, amount: nullableNum })),
          confidence: nullableNum,
          provenance: ProvenanceSchema,
        }),
        status: z.enum(['CURRENT', 'EXITED', 'UNKNOWN']),
        joiningDate: nullableStr,
        exitDate: nullableStr,
        employeeNameOnRecord: nullableStr,
        employeeNameMatch: nullableBool,
        employerNameMatch: nullableBool,
        provenance: ProvenanceSchema,
      }),
    ),
    epfo: z
      .object({
        uan: nullableStr,
        memberId: nullableStr,
        aadhaarLinked: nullableBool,
        pfFilingAvailable: nullableBool,
        employeeNameMatch: nullableBool,
        provenance: ProvenanceSchema,
      })
      .nullable(),
  }),
  mobile: z
    .object({
      number: nullableStr,
      isValid: nullableBool,
      subscriberStatus: nullableStr,
      connectionType: z.enum(['PREPAID', 'POSTPAID', 'UNKNOWN']),
      serviceProvider: nullableStr,
      originalProvider: nullableStr,
      networkRegion: nullableStr,
      isPorted: nullableBool,
      provenance: ProvenanceSchema,
    })
    .nullable(),
  credit: z
    .object({
      score: nullableNum,
      band: z.enum(['EXCELLENT', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR', 'NO_HISTORY', 'NOT_AVAILABLE']),
      bureau: nullableStr,
      scoreDate: nullableStr,
      identifiers: z.record(nullableStr),
      accounts: z.array(z.any()),
      events: z.array(z.any()),
      summary: z.object({
        activeLoans: nullableNum,
        securedLoans: nullableNum,
        unsecuredLoans: nullableNum,
        creditCards: nullableNum,
        totalOutstanding: nullableNum,
        utilization: nullableNum,
        enquiriesLast12m: nullableNum,
        delinquencies: nullableNum,
      }),
      provenance: ProvenanceSchema,
    })
    .nullable(),
  providerRisk: z.array(
    z.object({
      isSafe: nullableBool,
      riskLevel: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN']),
      reason: nullableStr,
      description: nullableStr,
      detectedAt: nullableStr,
      updatedAt: nullableStr,
      provenance: ProvenanceSchema,
    }),
  ),
  warnings: z.array(z.string()),
});

export function validateCanonical(input: unknown) {
  return CanonicalProfileSchema.safeParse(input);
}
