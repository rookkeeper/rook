import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";

export type AgentRestartMetadata = Record<string, unknown>;

export interface AgentSessionRecord {
  id: string;
  agent: string;
  name: string;
  createdAt: string;
  restart: AgentRestartMetadata;
}

export const DEFAULT_SESSION_LOG_PATH = path.resolve(REPO_ROOT, ".var", "rook", "agent-sessions.jsonl");

let sessionLogPath = DEFAULT_SESSION_LOG_PATH;

export function setSessionLogPath(nextPath: string): void {
  sessionLogPath = nextPath;
}

export function getSessionLogPath(): string {
  return sessionLogPath;
}

export function createSessionRecord(params: Omit<AgentSessionRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }): AgentSessionRecord {
  return {
    id: params.id ?? crypto.randomUUID(),
    agent: params.agent,
    name: params.name,
    createdAt: params.createdAt ?? new Date().toISOString(),
    restart: params.restart,
  };
}

export async function appendSessionRecord(record: AgentSessionRecord): Promise<void> {
  const filePath = getSessionLogPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function parseSessionRecords(contents: string): AgentSessionRecord[] {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line) as AgentSessionRecord & { name?: string };
      return {
        id: parsed.id,
        agent: parsed.agent,
        name: parsed.name ?? "default",
        createdAt: parsed.createdAt,
        restart: parsed.restart,
      };
    });
}

async function readSessionRecordFile(filePath: string): Promise<AgentSessionRecord[]> {
  try {
    return parseSessionRecords(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readSessionRecords(filePath = getSessionLogPath()): Promise<AgentSessionRecord[]> {
  const records = await readSessionRecordFile(filePath);
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findSessionRecord(id: string): Promise<AgentSessionRecord | undefined> {
  const records = await readSessionRecords();
  return records.find((record) => record.id === id);
}
