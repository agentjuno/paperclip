export {};

declare global {
  namespace Express {
    interface Request {
      actor: {
        type: "board" | "agent" | "none";
        userId?: string;
        agentId?: string;
        companyId?: string;
        companyIds?: string[];
        isInstanceAdmin?: boolean;
        keyId?: string;
        runId?: string;
        userEmail?: string | null;
        userName?: string | null;
        source?: "local_implicit" | "session" | "company_session" | "board_key" | "agent_key" | "agent_jwt" | "none";
      };
    }
  }
}
