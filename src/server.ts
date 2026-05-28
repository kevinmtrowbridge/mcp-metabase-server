/**
 * Main Metabase MCP Server class
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import axios from "axios";

import { MetabaseClient } from "./client/metabase-client.js";
import { ResourceHandlers } from "./handlers/resource-handlers.js";
import { ToolRegistry } from "./handlers/tool-registry.js";
import { MetabaseConfig } from "./types/metabase.js";
import { ErrorCode, McpError } from "./types/errors.js";
import { loadConfig, validateConfig } from "./utils/config.js";

// Schema definitions
const ListResourceTemplatesRequestSchema = z.object({
  method: z.literal("resources/list_templates"),
});

const ListToolsRequestSchema = z.object({
  method: z.literal("tools/list"),
});

export class MetabaseServer {
  private server: Server;
  private metabaseClient: MetabaseClient;
  private resourceHandlers: ResourceHandlers;
  private toolRegistry: ToolRegistry;

  constructor(config?: MetabaseConfig) {
    // Load and validate configuration
    const serverConfig = config || loadConfig();
    validateConfig(serverConfig);

    // Initialize server
    this.server = new Server(
      {
        name: "metabase-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize Metabase client
    this.metabaseClient = new MetabaseClient(serverConfig);

    // Initialize handlers
    this.resourceHandlers = new ResourceHandlers(this.metabaseClient);
    this.toolRegistry = new ToolRegistry(this.metabaseClient);

    // Setup request handlers
    this.setupResourceHandlers();
    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupResourceHandlers(): void {
    // List resources
    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      async (request) => {
        this.logInfo("Listing resources...");

        try {
          return await this.resourceHandlers.handleListResources();
        } catch (error) {
          this.logError("Failed to list resources", error);
          throw new McpError(
            ErrorCode.InternalError,
            "Failed to list Metabase resources"
          );
        }
      }
    );

    // List resource templates
    this.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async () => {
        return await this.resourceHandlers.handleListResourceTemplates();
      }
    );

    // Read resource
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        this.logInfo("Reading resource...", { uri: request.params?.uri });

        const uri = request.params?.uri;
        if (!uri) {
          throw new McpError(ErrorCode.InvalidParams, "URI is required");
        }

        try {
          return await this.resourceHandlers.handleReadResource(uri);
        } catch (error) {
          this.logError("Failed to read resource", error);
          if (error instanceof McpError) {
            throw error;
          }
          if (axios.isAxiosError(error)) {
            const data = error.response?.data;
            let detail: string;
            if (typeof data === "string") {
              detail = data;
            } else if (data?.message) {
              detail = data.message;
            } else if (data?.error) {
              detail = data.error;
            } else if (data) {
              detail = JSON.stringify(data);
            } else {
              detail = error.message;
            }
            throw new McpError(
              ErrorCode.InternalError,
              `Metabase API error (${error.response?.status || "unknown"}): ${detail}`
            );
          }
          throw new McpError(
            ErrorCode.InternalError,
            "Failed to read resource"
          );
        }
      }
    );
  }

  private setupToolHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.toolRegistry.getAllToolSchemas(),
      };
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      this.logInfo("Calling tool...", { tool: request.params?.name });

      const toolName = request.params?.name;
      const args = request.params?.arguments || {};

      if (!toolName) {
        throw new McpError(ErrorCode.InvalidParams, "Tool name is required");
      }

      try {
        return await this.toolRegistry.handleTool(toolName, args);
      } catch (error) {
        this.logError("Tool execution failed", error);

        if (error instanceof McpError) {
          throw error;
        }

        if (axios.isAxiosError(error)) {
          // Extract the most useful error info from Metabase's response.
          // Metabase returns errors in various shapes: plain string, { message }, { error }, or nested objects.
          const data = error.response?.data;
          let detail: string;
          if (typeof data === "string") {
            detail = data;
          } else if (data?.message) {
            detail = data.message;
          } else if (data?.error) {
            detail = data.error;
          } else if (data) {
            detail = JSON.stringify(data);
          } else {
            detail = error.message;
          }
          return {
            content: [
              {
                type: "text",
                text: `Metabase API error (${error.response?.status || "unknown"}): ${detail}`,
              },
            ],
            isError: true,
          };
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    });
  }

  private setupErrorHandling(): void {
    // Enhanced error handling with logging
    this.server.onerror = (error: Error) => {
      this.logError("Server Error", error);
    };

    // Graceful shutdown
    process.on("SIGINT", async () => {
      this.logInfo("Shutting down server...");
      await this.server.close();
      process.exit(0);
    });
  }

  private logInfo(message: string, data?: unknown): void {
    const logMessage = {
      timestamp: new Date().toISOString(),
      level: "info",
      message,
      data,
    };
    console.error(JSON.stringify(logMessage));
    console.error(`INFO: ${message}`);
  }

  private logError(message: string, error: unknown): void {
    const errorObj = error as Error;
    const logMessage = {
      timestamp: new Date().toISOString(),
      level: "error",
      message,
      error: errorObj.message || "Unknown error",
      stack: errorObj.stack,
    };
    console.error(JSON.stringify(logMessage));
    console.error(`ERROR: ${message} - ${errorObj.message || "Unknown error"}`);
  }

  /**
   * Start the server
   */
  async run(): Promise<void> {
    try {
      this.logInfo("Starting Metabase MCP server...");
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.logInfo("Metabase MCP server running on stdio");
    } catch (error) {
      this.logError("Failed to start server", error);
      throw error;
    }
  }
}
