type PrivyCandidate = {
  userId: string;
  email?: string | null;
};

function parseAllowlist(rawValue: string | undefined) {
  return new Set(
    (rawValue ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function normalizeEmail(email: string | null | undefined) {
  return typeof email === "string" && email.trim().length > 0
    ? email.trim().toLowerCase()
    : null;
}

export function isPrivyUserAllowed(candidate: PrivyCandidate) {
  const allowedUserIds = parseAllowlist(process.env.COMPANY_APP_ALLOWED_PRIVY_USER_IDS);
  const allowedEmails = new Set(
    Array.from(parseAllowlist(process.env.COMPANY_APP_ALLOWED_EMAILS)).map((email) =>
      email.toLowerCase()
    ),
  );

  if (allowedUserIds.size === 0 && allowedEmails.size === 0) {
    return true;
  }

  if (allowedUserIds.has(candidate.userId.trim())) {
    return true;
  }

  const normalizedEmail = normalizeEmail(candidate.email);
  if (normalizedEmail && allowedEmails.has(normalizedEmail)) {
    return true;
  }

  return false;
}
