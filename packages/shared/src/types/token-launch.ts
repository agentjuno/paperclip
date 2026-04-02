import type { ApprovalStatus, TokenLaunchDeployStatus } from "../constants.js";

export interface TokenLaunchWalletOption {
  address: string;
  chainType: string | null;
  walletType: string;
  walletClientType: string | null;
  connectorType: string | null;
  isPrimary: boolean;
}

export interface CompanyTokenLaunchSocialLinks {
  x?: string | null;
  farcaster?: string | null;
  telegram?: string | null;
  discord?: string | null;
}

export interface CompanyTokenLaunchDraft {
  stage: string | null;
  companyWebsiteUrl: string | null;
  businessSummary: string | null;
  tractionSummary: string | null;
  launchRationale: string | null;
  socialLinks: CompanyTokenLaunchSocialLinks;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenDescription: string | null;
  imageUrl: string | null;
  tweetUrl: string | null;
  tokenWebsiteUrl: string | null;
  selectedFeeWalletAddress: string | null;
}

export interface BankrPartnerDeployRequest {
  tokenName: string;
  tokenSymbol?: string;
  description?: string;
  image?: string;
  tweetUrl?: string;
  websiteUrl?: string;
  feeRecipient: {
    type: "wallet";
    value: string;
  };
  simulateOnly?: boolean;
}

export interface BankrFeeDistributionEntry {
  address: string;
  bps: number;
}

export interface BankrFeeDistribution {
  creator?: BankrFeeDistributionEntry;
  bankr?: BankrFeeDistributionEntry;
  partner?: BankrFeeDistributionEntry;
  ecosystem?: BankrFeeDistributionEntry;
  protocol?: BankrFeeDistributionEntry;
  [key: string]: BankrFeeDistributionEntry | undefined;
}

export interface BankrPartnerDeployResult {
  success: true;
  tokenAddress: string;
  poolId: string;
  txHash?: string;
  activityId: string;
  chain: string;
  simulated?: boolean;
  feeDistribution?: BankrFeeDistribution;
}

export interface CompanyTokenLaunchSimulation {
  fingerprint: string;
  request: BankrPartnerDeployRequest;
  result: BankrPartnerDeployResult;
  simulatedAt: Date;
}

export interface CompanyTokenLaunchRequest {
  id: string;
  companyId: string;
  launchId: string;
  approvalId: string;
  submittedByUserId: string;
  feeWalletAddress: string;
  simulationFingerprint: string;
  bankrPayload: BankrPartnerDeployRequest;
  simulationResult: BankrPartnerDeployResult;
  deployStatus: TokenLaunchDeployStatus;
  deploymentError: string | null;
  deploymentErrorDetails: Record<string, unknown> | null;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  tokenAddress: string | null;
  poolId: string | null;
  txHash: string | null;
  activityId: string | null;
  chain: string | null;
  feeDistribution: BankrFeeDistribution | null;
  deployedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  approvalStatus: ApprovalStatus;
  decisionNote: string | null;
}

export interface CompanyTokenLaunch {
  id: string;
  companyId: string;
  draft: CompanyTokenLaunchDraft;
  walletOptions: TokenLaunchWalletOption[];
  latestSimulation: CompanyTokenLaunchSimulation | null;
  deployedTokenAddress: string | null;
  deployedPoolId: string | null;
  deployedTxHash: string | null;
  deployedActivityId: string | null;
  deployedChain: string | null;
  deployedFeeDistribution: BankrFeeDistribution | null;
  deployedAt: Date | null;
  deploymentUnknownAt: Date | null;
  claimFeesUrl: string | null;
  claimFeesDocsUrl: string;
  requests: CompanyTokenLaunchRequest[];
  createdAt: Date;
  updatedAt: Date;
}
