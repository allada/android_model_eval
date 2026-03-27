/** Configuration passed to a provider for each test execution. */
export interface ProviderConfig {
  /** URL of the MCP server (port 3000). */
  mcpServerUrl: string;

  /** Device session ID created by the harness via the admin API. */
  deviceSessionId: string;

  /** Per-task timeout in ms. The provider MUST abort if this expires. */
  timeoutMs: number;
}

/** Token usage for a single test execution. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

/** Result returned by a provider after executing a task. */
export interface LlmExecutionResult {
  /** Error message if the LLM failed, undefined on success. */
  error?: string;

  /** Raw stdout+stderr from the LLM process. */
  rawOutput?: string;

  /** How long the LLM was active, in ms. */
  durationMs: number;

  /** Token usage if parseable from the provider output. */
  tokenUsage?: TokenUsage;
}

/**
 * Abstraction over any LLM that can receive a task prompt and
 * autonomously interact with MCP tools to complete it.
 */
export interface LlmProvider {
  /** Display name (e.g. "codex-o4-mini", "claude-sonnet"). */
  readonly name: string;

  /**
   * Run a single task. The provider should include the deviceSessionId
   * in its instructions so the LLM passes it to MCP tools.
   */
  execute(prompt: string, config: ProviderConfig): Promise<LlmExecutionResult>;
}
