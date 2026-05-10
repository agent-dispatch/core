export type KnownProvider = "aws" | "gcp" | "azure" | "kubernetes" | "local";
export type Provider = KnownProvider | (string & {});

export type KnownCapability =
  | "agent-runtime"
  | "service-deploy"
  | "job-runner"
  | "container-task"
  | "workflow-runner";
export type Capability = KnownCapability | (string & {});

export type KnownTaskType =
  | "agent.run"
  | "command.run"
  | "service.deploy"
  | "job.run"
  | "container.run"
  | "workflow.step";
export type TaskType = KnownTaskType | (string & {});

export type TargetMode = "session" | "runtime" | "managed-service" | "job" | (string & {});

export type TaskStatus =
  | "queued"
  | "provisioning"
  | "starting"
  | "running"
  | "completing"
  | "succeeded"
  | "cancelling"
  | "cancelled"
  | "failed";

export type EventType =
  | "task.created"
  | "task.provisioning"
  | "task.started"
  | "task.progress"
  | "task.log"
  | "task.result"
  | "task.succeeded"
  | "task.failed"
  | "task.cancelling"
  | "task.cancelled"
  | "runtime.provisioned"
  | "session.created"
  | (string & {});

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface AccountProfile {
  name: string;
  provider: Provider;
  region?: string;
  credentialSource: string;
  details?: Record<string, unknown>;
}

export interface DispatchTarget {
  mode: TargetMode;
  details?: Record<string, unknown>;
}

export interface DispatchInput {
  instruction?: string;
  command?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DispatchRequest {
  provider: Provider;
  accountProfile: string;
  capability: Capability;
  backend?: string;
  taskType: TaskType;
  target: DispatchTarget;
  input: DispatchInput;
  metadata?: Record<string, unknown>;
}

export type PolicyEffect = "allow" | "deny";

export interface DispatchPolicyRule {
  effect: PolicyEffect;
  providers?: Provider[];
  accountProfiles?: string[];
  capabilities?: Capability[];
  taskTypes?: TaskType[];
  targetModes?: TargetMode[];
  reason?: string;
}

export interface DispatchPolicy {
  defaultEffect?: PolicyEffect;
  rules: DispatchPolicyRule[];
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  matchedRule?: DispatchPolicyRule;
}

export interface AdapterCapability {
  provider: Provider;
  capability: Capability;
  taskTypes: TaskType[];
  targetModes: TargetMode[];
  configRequirements?: string[];
}

export interface RuntimeTarget {
  provider: Provider;
  accountProfile: string;
  capability: Capability;
  backend: string;
  mode: TargetMode;
  details?: Record<string, unknown>;
  providerRefs?: Record<string, unknown>;
}

export interface ResolvedTarget {
  account: AccountProfile;
  target: RuntimeTarget;
}

export interface RuntimeRecord {
  id: string;
  taskId: string;
  provider: Provider;
  accountProfile: string;
  capability: Capability;
  backend: string;
  status: "configured" | "provisioning" | "ready" | "deleting" | "deleted" | "failed";
  providerRefs: Record<string, unknown>;
  cleanupStatus?: "pending" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  taskId: string;
  provider: Provider;
  accountProfile: string;
  capability: Capability;
  backend: string;
  status: "creating" | "ready" | "stopping" | "stopped" | "failed";
  providerRefs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  provider: Provider;
  accountProfile: string;
  capability: Capability;
  taskType: TaskType;
  target: DispatchTarget;
  input: DispatchInput;
  backend?: string;
  status: TaskStatus;
  providerRefs: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: RuntimeErrorShape;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeEvent {
  id?: string;
  taskId: string;
  sequence?: number;
  type: EventType;
  timestamp?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface ArtifactRecord {
  id: string;
  taskId: string;
  kind: string;
  uri: string;
  contentType?: string;
  sizeBytes?: number;
  providerRefs?: Record<string, unknown>;
  createdAt: string;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  result?: Record<string, unknown>;
  artifacts: ArtifactRecord[];
  error?: RuntimeErrorShape;
}

export interface RuntimeErrorShape {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface ProvisionRequest {
  dispatch: DispatchRequest;
  task: TaskRecord;
  target: RuntimeTarget;
}

export interface ProvisionResult {
  runtime?: RuntimeRecord;
  session?: SessionRecord;
  providerRefs?: Record<string, unknown>;
}

export interface StartTaskRequest {
  dispatch: DispatchRequest;
  task: TaskRecord;
  target: RuntimeTarget;
  runtime?: RuntimeRecord;
  session?: SessionRecord;
}

export interface StartTaskResult {
  providerRefs?: Record<string, unknown>;
  result?: Record<string, unknown>;
  artifacts?: ArtifactRecord[];
}

export interface CancelResult {
  status: "cancelled" | "not_found" | "failed";
  providerRefs?: Record<string, unknown>;
  error?: RuntimeErrorShape;
}

export interface CleanupResult {
  status: "completed" | "skipped" | "failed";
  providerRefs?: Record<string, unknown>;
  error?: RuntimeErrorShape;
}

export interface TaskHandle {
  taskId: string;
  status: TaskStatus;
  provider: Provider;
  accountProfile: string;
  capability: Capability;
  backend: string;
  poll: {
    statusTool: "get_task_status";
    logsTool: "get_task_logs";
    resultTool: "get_task_result";
  };
}
