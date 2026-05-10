import type { ArtifactRecord, RuntimeEvent, RuntimeRecord, SessionRecord, TaskRecord } from "./types.js";

export interface LogChunk {
  taskId: string;
  cursor: number;
  nextCursor: number;
  data: string;
}

export interface TaskStore {
  saveTask(task: TaskRecord): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | undefined>;
  updateTask(taskId: string, patch: Partial<TaskRecord>): Promise<TaskRecord>;
  listTasks(): Promise<TaskRecord[]>;
  saveRuntime(runtime: RuntimeRecord): Promise<void>;
  updateRuntime(runtimeId: string, patch: Partial<RuntimeRecord>): Promise<RuntimeRecord>;
  saveSession(session: SessionRecord): Promise<void>;
  appendEvent(event: RuntimeEvent): Promise<RuntimeEvent>;
  listEvents(taskId: string, afterSequence?: number): Promise<RuntimeEvent[]>;
  appendLog(taskId: string, chunk: string): Promise<void>;
  readLogs(taskId: string, cursor?: number, limit?: number): Promise<LogChunk>;
  saveArtifact(artifact: ArtifactRecord): Promise<void>;
  listArtifacts(taskId: string): Promise<ArtifactRecord[]>;
}
