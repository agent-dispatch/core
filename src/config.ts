import type { AccountProfile, Capability, DispatchPolicy, Provider } from "./types.js";

export interface BackendConfig {
  provider: Provider;
  capability: Capability;
  adapter: string;
  account: string;
  details?: Record<string, unknown>;
}

export interface AgentDispatchConfig {
  stateDir?: string;
  accounts: Record<string, Omit<AccountProfile, "name">>;
  backends: Record<string, BackendConfig>;
  defaults?: {
    accountProfile?: string;
    provider?: Provider;
    capability?: Capability;
    backend?: string;
  };
  policy?: DispatchPolicy;
}

export function listAccountProfiles(config: AgentDispatchConfig): AccountProfile[] {
  return Object.entries(config.accounts).map(([name, account]) => ({
    name,
    ...account
  }));
}

export function getAccountProfile(config: AgentDispatchConfig, name: string): AccountProfile | undefined {
  const account = config.accounts[name];
  return account ? { name, ...account } : undefined;
}

export function validateConfig(config: AgentDispatchConfig): string[] {
  const errors: string[] = [];
  for (const [backendName, backend] of Object.entries(config.backends)) {
    const account = config.accounts[backend.account];
    if (!account) {
      errors.push(`Backend ${backendName} references missing account profile ${backend.account}.`);
      continue;
    }
    if (account.provider !== backend.provider) {
      errors.push(`Backend ${backendName} provider ${backend.provider} does not match account ${backend.account}.`);
    }
  }
  return errors;
}
