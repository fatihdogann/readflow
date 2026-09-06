export interface AgentRunTask {
  prompt: string;
  timeoutMs: number;
}

export interface AgentRunResult {
  text: string;
  meta: Record<string, unknown>;
}

export interface AgentAdapter {
  readonly name: string;
  run(task: AgentRunTask): Promise<AgentRunResult>;
}

export interface AgentRuntimeInfo {
  mode: "command" | "mock" | "none";
  command?: string;
  source?: "env" | "detected" | "profile";
  candidatesFound?: string[];
  message?: string;
}

export class AgentError extends Error {}
