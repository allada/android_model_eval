/** Configuration passed to a provider for each test execution. */
export interface ProviderConfig {
  /** URL of the running adb-mcp-bridge HTTP server. */
  mcpServerUrl: string;

  /** Per-task timeout in ms. The provider MUST abort if this expires. */
  timeoutMs: number;
}

/** Result returned by a provider after executing a task. */
export interface LlmExecutionResult {
  /** Whether the LLM finished without error (not the same as task success). */
  completedSuccessfully: boolean;

  /** Final text output from the LLM, if any. */
  finalOutput?: string;

  /** How long the LLM was active, in ms. */
  durationMs: number;
}

/**
 * Abstraction over any LLM that can receive a task prompt and
 * autonomously interact with MCP tools to complete it.
 */
export interface LlmProvider {
  /** Display name (e.g. "openai-gpt-4o", "claude-sonnet"). */
  readonly name: string;

  /**
   * Run a single task. The LLM should use MCP tools to accomplish the prompt.
   * Resolves when the LLM is done. Rejects on timeout or error.
   */
  execute(prompt: string, config: ProviderConfig): Promise<LlmExecutionResult>;
}
