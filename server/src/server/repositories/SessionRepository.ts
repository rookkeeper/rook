export interface SessionRecord {
  sessionId: string;
  runtimeId: string;
  runtimeSessionId: string;
  title: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
}

export interface SessionRepository {
  list(): Promise<SessionRecord[]>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  save(record: SessionRecord): Promise<void>;
  touch(sessionId: string, updatedAt?: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
  environmentIds(sessionId: string): Promise<string[]>;
  replaceEnvironmentIds(sessionId: string, environmentIds: string[]): Promise<void>;
}
