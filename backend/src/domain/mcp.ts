import type { LlmServicePort } from "@veriqorn/contracts";
import type { IndexingPort } from "../indexing-port";

export type McpLlmPort = Pick<LlmServicePort, "chat">;

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "veriqorn-platform";
const SERVER_VERSION = "1.0.0";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpSessionSink {
  send(event: string, data: unknown): void;
  close(): void;
}

export class McpService {
  private readonly sessions = new Map<string, McpSessionSink>();

  constructor(
    private readonly indexing: IndexingPort,
    private readonly llm: McpLlmPort,
  ) {}

  registerSession(sessionId: string, sink: McpSessionSink): void {
    this.sessions.set(sessionId, sink);
  }

  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): McpSessionSink | undefined {
    return this.sessions.get(sessionId);
  }

  async handleRequest(raw: unknown, projectId: string): Promise<JsonRpcResponse> {
    if (!raw || typeof raw !== "object") {
      return { jsonrpc: "2.0", id: 0, error: { code: -32600, message: "Invalid JSON-RPC request" } };
    }
    const request = raw as JsonRpcRequest;
    try {
      switch (request.method) {
        case "initialize": return this.handleInitialize(request);
        case "initialized":
        case "notifications/initialized":
          return { jsonrpc: "2.0", id: request.id ?? 0, result: {} };
        case "tools/list": return this.handleToolsList(request);
        case "tools/call": return await this.handleToolsCall(request, projectId);
        default:
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` },
          };
      }
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  private handleInitialize(request: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    };
  }

  private handleToolsList(request: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "search_code",
            description: "Search the indexed codebase semantically. Returns relevant code snippets with file paths and relevance scores.",
            inputSchema: {
              type: "object",
              required: ["query"],
              properties: {
                query: { type: "string", description: "The search query" },
                topK: { type: "number", description: "Number of results to return (default 10)" },
                filePathPrefixes: { type: "array", items: { type: "string" }, description: "Filter results to files matching these path prefixes" },
              },
            },
          },
          {
            name: "ask_about_code",
            description: "Ask a question about the codebase. Uses indexed retrieval and the configured LLM to generate an answer.",
            inputSchema: {
              type: "object",
              required: ["question"],
              properties: {
                question: { type: "string", description: "The question about the code" },
              },
            },
          },
          {
            name: "get_file_context",
            description: "Get indexed code context for a specific file or symbol.",
            inputSchema: {
              type: "object",
              required: ["filePath"],
              properties: {
                filePath: { type: "string" },
                symbol: { type: "string" },
              },
            },
          },
          {
            name: "list_indexed_files",
            description: "List all indexed files, optionally filtered by a path prefix.",
            inputSchema: {
              type: "object",
              properties: { prefix: { type: "string" } },
            },
          },
        ],
      },
    };
  }

  private async handleToolsCall(request: JsonRpcRequest, projectId: string): Promise<JsonRpcResponse> {
    const params = request.params ?? {};
    const toolName = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments && typeof params.arguments === "object") ? params.arguments as Record<string, unknown> : {};

    switch (toolName) {
      case "search_code": return this.toolSearchCode(request.id, args, projectId);
      case "ask_about_code": return this.toolAskAboutCode(request.id, args, projectId);
      case "get_file_context": return this.toolGetFileContext(request.id, args, projectId);
      case "list_indexed_files": return this.toolListIndexedFiles(request.id, args, projectId);
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        };
    }
  }

  private async toolSearchCode(id: number | string, args: Record<string, unknown>, projectId: string): Promise<JsonRpcResponse> {
    const retrieval = await this.indexing.retrieveEvidence({
      projectId,
      query: String(args.query ?? ""),
      ...(typeof args.topK === "number" ? { topK: args.topK } : {}),
      ...(Array.isArray(args.filePathPrefixes) ? { filePathPrefixes: args.filePathPrefixes.map(String) } : {}),
    });
    const text = retrieval.items.length > 0
      ? retrieval.items
          .map((item, i) => `[${i + 1}] ${item.filePath} (relevance: ${Math.round(item.relevanceScore * 100)}%)\n${item.snippet}`)
          .join("\n\n---\n\n")
      : "No results found. Run POST /api/v1/ai/index-jobs first to index a repository.";
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
  }

  private async toolAskAboutCode(id: number | string, args: Record<string, unknown>, projectId: string): Promise<JsonRpcResponse> {
    const question = String(args.question ?? "");
    const retrieval = await this.indexing.retrieveEvidence({ projectId, query: question, topK: 10 });

    if (retrieval.items.length === 0) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "No indexed context is available. Run an index job before asking code questions." }] },
      };
    }

    const contextBlocks = retrieval.items.map((item) => `### ${item.filePath}\n\`\`\`\n${item.snippet}\n\`\`\``);
    const systemPrompt = `You are a code assistant. Use the following code context to answer accurately and cite file paths.\n\n${contextBlocks.join("\n\n")}`;

    try {
      const response = await this.llm.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        { maxTokens: 2048 },
      );
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: response.content }] } };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: error instanceof Error ? error.message : "LLM call failed" },
      };
    }
  }

  private async toolGetFileContext(id: number | string, args: Record<string, unknown>, projectId: string): Promise<JsonRpcResponse> {
    const filePath = String(args.filePath ?? "");
    const symbol = typeof args.symbol === "string" ? args.symbol : undefined;

    const retrieval = await this.indexing.retrieveEvidence({
      projectId,
      query: symbol ?? filePath,
      topK: 20,
      pathHints: [filePath],
      ...(symbol ? { symbolHints: [symbol] } : {}),
    });

    const matching = retrieval.items.filter((item) => item.filePath.includes(filePath) || filePath.includes(item.filePath));
    const items = matching.length > 0 ? matching : retrieval.items.slice(0, 5);
    const text = items.length > 0
      ? items.map((item) => `### ${item.filePath} (chunk ${item.chunkIndex})\n\`\`\`\n${item.snippet}\n\`\`\``).join("\n\n")
      : `No indexed content found for ${filePath}`;
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
  }

  private async toolListIndexedFiles(id: number | string, args: Record<string, unknown>, projectId: string): Promise<JsonRpcResponse> {
    const summary = await this.indexing.getCatalogSummary(projectId);
    if (summary.chunkCount === 0) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "No index catalog found. Run POST /api/v1/ai/index-jobs first." }] },
      };
    }
    const prefix = typeof args.prefix === "string" ? args.prefix : undefined;
    const files = prefix
      ? summary.files.filter((file) => file.startsWith(prefix) || file.includes(prefix))
      : summary.files;
    const text = files.length > 0
      ? `Indexed files (${files.length}):\n${files.join("\n")}`
      : "No indexed files matched the filter.";
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
  }
}
