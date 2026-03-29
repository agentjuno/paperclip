import { z } from "zod";
import { APPROVAL_STATUSES, TOKEN_LAUNCH_DEPLOY_STATUSES } from "../constants.js";

function optionalTrimmedString(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();
}

function optionalUrl(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .url()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();
}

export const tokenLaunchWalletOptionSchema = z.object({
  address: z.string().min(1),
  chainType: z.string().nullable(),
  walletType: z.string().min(1),
  walletClientType: z.string().nullable(),
  connectorType: z.string().nullable(),
  isPrimary: z.boolean(),
});

export const companyTokenLaunchSocialLinksSchema = z.object({
  x: optionalUrl(500),
  farcaster: optionalUrl(500),
  telegram: optionalUrl(500),
  discord: optionalUrl(500),
}).default({});

export const companyTokenLaunchDraftSchema = z.object({
  stage: optionalTrimmedString(100).default(null),
  companyWebsiteUrl: optionalUrl(500).default(null),
  businessSummary: optionalTrimmedString(4000).default(null),
  tractionSummary: optionalTrimmedString(4000).default(null),
  launchRationale: optionalTrimmedString(4000).default(null),
  socialLinks: companyTokenLaunchSocialLinksSchema.default({}),
  tokenName: optionalTrimmedString(100).default(null),
  tokenSymbol: optionalTrimmedString(10).default(null),
  tokenDescription: optionalTrimmedString(500).default(null),
  imageUrl: optionalUrl(500).default(null),
  tweetUrl: optionalUrl(500).default(null),
  tokenWebsiteUrl: optionalUrl(500).default(null),
  selectedFeeWalletAddress: optionalTrimmedString(128).default(null),
});

export const companyTokenLaunchDraftUpdateSchema = z.object({
  stage: optionalTrimmedString(100),
  companyWebsiteUrl: optionalUrl(500),
  businessSummary: optionalTrimmedString(4000),
  tractionSummary: optionalTrimmedString(4000),
  launchRationale: optionalTrimmedString(4000),
  socialLinks: companyTokenLaunchSocialLinksSchema.optional(),
  tokenName: optionalTrimmedString(100),
  tokenSymbol: optionalTrimmedString(10),
  tokenDescription: optionalTrimmedString(500),
  imageUrl: optionalUrl(500),
  tweetUrl: optionalUrl(500),
  tokenWebsiteUrl: optionalUrl(500),
  selectedFeeWalletAddress: optionalTrimmedString(128),
}).strict();

export const bankrPartnerDeployRequestSchema = z.object({
  tokenName: z.string().min(1).max(100),
  tokenSymbol: z.string().min(1).max(10).optional(),
  description: z.string().max(500).optional(),
  image: z.string().url().max(500).optional(),
  tweetUrl: z.string().url().max(500).optional(),
  websiteUrl: z.string().url().max(500).optional(),
  feeRecipient: z.object({
    type: z.literal("wallet"),
    value: z.string().min(1),
  }),
  simulateOnly: z.boolean().optional(),
});

export const bankrFeeDistributionEntrySchema = z.object({
  address: z.string().min(1),
  bps: z.number().int().nonnegative(),
});

export const bankrFeeDistributionSchema = z.record(bankrFeeDistributionEntrySchema).default({});

export const bankrPartnerDeployResultSchema = z.object({
  success: z.literal(true),
  tokenAddress: z.string().min(1),
  poolId: z.string().min(1),
  txHash: z.string().min(1).optional(),
  activityId: z.string().min(1),
  chain: z.string().min(1),
  simulated: z.boolean().optional(),
  feeDistribution: bankrFeeDistributionSchema.optional(),
});

export const companyTokenLaunchSimulationSchema = z.object({
  fingerprint: z.string().min(1),
  request: bankrPartnerDeployRequestSchema,
  result: bankrPartnerDeployResultSchema,
  simulatedAt: z.coerce.date(),
});

export const companyTokenLaunchRequestSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  launchId: z.string().uuid(),
  approvalId: z.string().uuid(),
  submittedByUserId: z.string().min(1),
  feeWalletAddress: z.string().min(1),
  simulationFingerprint: z.string().min(1),
  bankrPayload: bankrPartnerDeployRequestSchema,
  simulationResult: bankrPartnerDeployResultSchema,
  deployStatus: z.enum(TOKEN_LAUNCH_DEPLOY_STATUSES),
  deploymentError: z.string().nullable(),
  deploymentErrorDetails: z.record(z.unknown()).nullable(),
  confirmedByUserId: z.string().nullable(),
  confirmedAt: z.coerce.date().nullable(),
  tokenAddress: z.string().nullable(),
  poolId: z.string().nullable(),
  txHash: z.string().nullable(),
  activityId: z.string().nullable(),
  chain: z.string().nullable(),
  feeDistribution: bankrFeeDistributionSchema.nullable(),
  deployedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  approvalStatus: z.enum(APPROVAL_STATUSES),
  decisionNote: z.string().nullable(),
});

export const companyTokenLaunchSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  draft: companyTokenLaunchDraftSchema,
  walletOptions: z.array(tokenLaunchWalletOptionSchema).default([]),
  latestSimulation: companyTokenLaunchSimulationSchema.nullable(),
  deployedTokenAddress: z.string().nullable(),
  deployedPoolId: z.string().nullable(),
  deployedTxHash: z.string().nullable(),
  deployedActivityId: z.string().nullable(),
  deployedChain: z.string().nullable(),
  deployedFeeDistribution: bankrFeeDistributionSchema.nullable(),
  deployedAt: z.coerce.date().nullable(),
  deploymentUnknownAt: z.coerce.date().nullable(),
  claimFeesUrl: z.string().url().nullable(),
  claimFeesDocsUrl: z.string().url(),
  requests: z.array(companyTokenLaunchRequestSchema).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const tokenLaunchSimulationRequestSchema = z.object({});
export const tokenLaunchSubmitRequestSchema = z.object({});
export const tokenLaunchConfirmRequestSchema = z.object({});

export type CompanyTokenLaunchDraftUpdate = z.infer<typeof companyTokenLaunchDraftUpdateSchema>;
