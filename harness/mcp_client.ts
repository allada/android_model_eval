import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** A single content item returned by an MCP tool call. */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Describes an MCP tool (name, description, JSON schema for inputs). */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Lightweight MCP client that connects to an HTTP-based MCP server,
 * lists available tools, and calls them.
 */
export class McpClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;

  private constructor(client: Client, transport: StreamableHTTPClientTransport) {
    this.client = client;
    this.transport = transport;
  }

  /** Connect to an MCP server at the given URL. */
  static async connect(url: string): Promise<McpClient> {
    const client = new Client({ name: "eval-harness", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
    return new McpClient(client, transport);
  }

  /** List all tools exposed by the server. */
  async listTools(): Promise<McpToolDef[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  /** Call a tool by name with the given arguments. Returns content items. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolContent[]> {
    const result = await this.client.callTool({ name, arguments: args });
    return (result.content as Array<Record<string, unknown>>).map((item) => {
      if (item.type === "image") {
        return {
          type: "image" as const,
          data: item.data as string,
          mimeType: item.mimeType as string,
        };
      }
      return { type: "text" as const, text: (item as { text: string }).text };
    });
  }

  /** Close the MCP session and transport. */
  async close(): Promise<void> {
    await this.client.close();
  }
}
