import type { AccountProfile, Capability, DispatchPolicy, DispatchTarget, Provider, RuntimeProtocol, TargetMode } from "./types.js";

export type RuntimeModelConfig = string | Record<string, unknown>;

export interface BackendConfig {
  provider: Provider;
  capability: Capability;
  adapter: string;
  account: string;
  details?: Record<string, unknown>;
}

export interface RuntimeProfileConfig {
  provider: Provider;
  account: string;
  capability: Capability;
  backend: string;
  target?: Partial<DispatchTarget> & { mode: TargetMode };
  protocol?: RuntimeProtocol;
  framework?: string;
  model?: RuntimeModelConfig;
  runtimeTools?: Record<string, unknown>;
  requiredInputs?: string[];
  metadata?: Record<string, unknown>;
}

export type RuntimeProfile = RuntimeProfileConfig & { name: string };

export interface AgentDispatchConfig {
  stateDir?: string;
  accounts: Record<string, Omit<AccountProfile, "name">>;
  backends: Record<string, BackendConfig>;
  runtimes?: Record<string, RuntimeProfileConfig>;
  defaults?: {
    runtime?: string;
    accountProfile?: string;
    provider?: Provider;
    capability?: Capability;
    backend?: string;
    targetMode?: TargetMode;
    protocol?: RuntimeProtocol;
    framework?: string;
    model?: RuntimeModelConfig;
    runtimeTools?: Record<string, unknown>;
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

export function listRuntimeProfiles(config: AgentDispatchConfig): RuntimeProfile[] {
  return Object.entries(config.runtimes ?? {}).map(([name, runtime]) => ({
    name,
    ...runtime
  }));
}

export function getRuntimeProfile(config: AgentDispatchConfig, name: string): RuntimeProfile | undefined {
  const runtime = config.runtimes?.[name];
  return runtime ? { name, ...runtime } : undefined;
}

export function getDefaultRuntimeProfile(config: AgentDispatchConfig): RuntimeProfile | undefined {
  return config.defaults?.runtime ? getRuntimeProfile(config, config.defaults.runtime) : undefined;
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
  for (const [runtimeName, runtime] of Object.entries(config.runtimes ?? {})) {
    const account = config.accounts[runtime.account];
    if (!account) {
      errors.push(`Runtime ${runtimeName} references missing account profile ${runtime.account}.`);
      continue;
    }
    if (account.provider !== runtime.provider) {
      errors.push(`Runtime ${runtimeName} provider ${runtime.provider} does not match account ${runtime.account}.`);
    }

    const backend = config.backends[runtime.backend];
    if (!backend) {
      errors.push(`Runtime ${runtimeName} references missing backend ${runtime.backend}.`);
      continue;
    }
    if (backend.provider !== runtime.provider) {
      errors.push(`Runtime ${runtimeName} provider ${runtime.provider} does not match backend ${runtime.backend}.`);
    }
    if (backend.capability !== runtime.capability) {
      errors.push(`Runtime ${runtimeName} capability ${runtime.capability} does not match backend ${runtime.backend}.`);
    }
    if (backend.account !== runtime.account) {
      errors.push(`Runtime ${runtimeName} account ${runtime.account} does not match backend ${runtime.backend}.`);
    }
  }
  if (config.defaults?.runtime && !config.runtimes?.[config.defaults.runtime]) {
    errors.push(`Default runtime ${config.defaults.runtime} was not found.`);
  }
  if (config.defaults?.backend && !config.backends[config.defaults.backend]) {
    errors.push(`Default backend ${config.defaults.backend} was not found.`);
  }
  if (config.defaults?.accountProfile && !config.accounts[config.defaults.accountProfile]) {
    errors.push(`Default account profile ${config.defaults.accountProfile} was not found.`);
  }
  return errors;
}
