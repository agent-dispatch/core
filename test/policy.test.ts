import { describe, expect, it } from "vitest";
import { authorizeDispatchRequest, type DispatchRequest } from "../src/index.js";

const request: DispatchRequest = {
  provider: "aws",
  accountProfile: "dev-aws",
  capability: "agent-runtime",
  taskType: "agent.run",
  target: { mode: "session" },
  input: { instruction: "run" }
};

describe("authorizeDispatchRequest", () => {
  it("allows requests when no policy is configured", () => {
    expect(authorizeDispatchRequest(request).allowed).toBe(true);
  });

  it("denies matching policy rules", () => {
    const decision = authorizeDispatchRequest(request, {
      rules: [
        {
          effect: "deny",
          providers: ["aws"],
          accountProfiles: ["dev-aws"],
          capabilities: ["agent-runtime"],
          taskTypes: ["agent.run"],
          targetModes: ["session"],
          reason: "blocked"
        }
      ]
    });
    expect(decision).toMatchObject({ allowed: false, reason: "blocked" });
  });

  it("supports deny-by-default allow lists", () => {
    const decision = authorizeDispatchRequest(request, {
      defaultEffect: "deny",
      rules: [{ effect: "allow", providers: ["aws"], accountProfiles: ["dev-aws"], capabilities: ["agent-runtime"] }]
    });
    expect(decision.allowed).toBe(true);
  });

  it("rejects raw credentials in dispatch input", () => {
    const decision = authorizeDispatchRequest({
      ...request,
      input: { accessKeyId: "not-allowed" }
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("accessKeyId");
  });
});
