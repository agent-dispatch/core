import { describe, expect, it } from "vitest";
import { getDefaultRuntimeProfile, getRuntimeProfile, listRuntimeProfiles, validateConfig, type AgentDispatchConfig } from "../src/index.js";

const config: AgentDispatchConfig = {
  accounts: {
    "dev-aws": { provider: "aws", credentialSource: "aws-sdk-default" }
  },
  backends: {
    "aws-agentcore": {
      provider: "aws",
      capability: "agent-runtime",
      adapter: "aws-agentcore",
      account: "dev-aws"
    }
  },
  runtimes: {
    "research-agent": {
      provider: "aws",
      account: "dev-aws",
      capability: "agent-runtime",
      backend: "aws-agentcore",
      target: { mode: "session", details: { runtimeArn: "arn:aws:bedrock-agentcore:test" } },
      framework: "strands",
      runtimeTools: { enabled: ["web-search"] }
    }
  },
  defaults: {
    runtime: "research-agent"
  }
};

describe("AgentDispatchConfig runtime profiles", () => {
  it("lists and resolves named runtime profiles", () => {
    expect(listRuntimeProfiles(config)).toHaveLength(1);
    expect(getRuntimeProfile(config, "research-agent")).toMatchObject({
      name: "research-agent",
      provider: "aws",
      account: "dev-aws",
      capability: "agent-runtime",
      backend: "aws-agentcore"
    });
    expect(getDefaultRuntimeProfile(config)).toMatchObject({ name: "research-agent" });
  });

  it("validates runtime profile account and backend bindings", () => {
    expect(validateConfig(config)).toEqual([]);
    expect(validateConfig({
      ...config,
      runtimes: {
        broken: {
          provider: "gcp",
          account: "dev-aws",
          capability: "service-deploy",
          backend: "missing"
        }
      },
      defaults: { runtime: "unknown" }
    })).toEqual([
      "Runtime broken provider gcp does not match account dev-aws.",
      "Runtime broken references missing backend missing.",
      "Default runtime unknown was not found."
    ]);
  });
});
