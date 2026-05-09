import type { DispatchPolicy, DispatchPolicyRule, DispatchRequest, PolicyDecision } from "./types.js";

const forbiddenCredentialKeys = [
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
  "apiKey",
  "clientSecret",
  "privateKey",
  "password",
  "token"
];

export function authorizeDispatchRequest(request: DispatchRequest, policy?: DispatchPolicy): PolicyDecision {
  const credentialKey = findForbiddenCredentialKey(request.input) ?? findForbiddenCredentialKey(request.target.details);
  if (credentialKey) {
    return {
      allowed: false,
      reason: `Dispatch input must not include raw credential field ${credentialKey}. Use account profiles instead.`
    };
  }

  if (!policy) {
    return { allowed: true, reason: "No policy configured." };
  }

  for (const rule of policy.rules) {
    if (!ruleMatches(rule, request)) continue;
    return {
      allowed: rule.effect === "allow",
      reason: rule.reason ?? `Matched ${rule.effect} policy rule.`,
      matchedRule: rule
    };
  }

  const defaultEffect = policy.defaultEffect ?? "allow";
  return {
    allowed: defaultEffect === "allow",
    reason: `No policy rule matched; default effect is ${defaultEffect}.`
  };
}

function ruleMatches(rule: DispatchPolicyRule, request: DispatchRequest): boolean {
  return (
    matches(rule.providers, request.provider) &&
    matches(rule.accountProfiles, request.accountProfile) &&
    matches(rule.capabilities, request.capability) &&
    matches(rule.taskTypes, request.taskType) &&
    matches(rule.targetModes, request.target.mode)
  );
}

function matches<T extends string>(allowed: T[] | undefined, value: T): boolean {
  return !allowed || allowed.includes(value);
}

function findForbiddenCredentialKey(value: unknown, path = ""): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(value)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (forbiddenCredentialKeys.some((forbidden) => forbidden.toLowerCase() === key.toLowerCase())) {
      return fullPath;
    }
    const nestedKey = findForbiddenCredentialKey(nested, fullPath);
    if (nestedKey) return nestedKey;
  }
  return undefined;
}
