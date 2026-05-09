import type { RuntimeErrorShape } from "./types.js";

export class AgentDispatchError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(error: RuntimeErrorShape) {
    super(error.message);
    this.name = "AgentDispatchError";
    this.code = error.code;
    this.retryable = Boolean(error.retryable);
    this.details = error.details;
  }

  toJSON(): RuntimeErrorShape {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details
    };
  }
}

export function toRuntimeError(error: unknown, code = "runtime.error"): RuntimeErrorShape {
  if (error instanceof AgentDispatchError) {
    return error.toJSON();
  }
  if (error instanceof Error) {
    return { code, message: error.message };
  }
  return { code, message: String(error) };
}
