import { mcpTool } from '@ai-sdk/mcp';
import { Middleware } from '../core/types';

/**
 * Middleware that integrates MCP (Model Context Protocol) servers.
 * Allows agents to use tools from any MCP server compatible with AI SDK.
 */
export class McpMiddleware implements Middleware {
    name = 'McpMiddleware';
    tools: Record<string, any> = {};

    constructor(private servers: Array<{ name: string; url: string }>) { }

    async waitReady() {
        // In a real implementation, we might connect to servers here
        // For now, we assume servers are pre-configured or handled by the caller
    }

    /**
     * Helper to add a specific tool from an MCP server
     */
    async addMcpTool(server: any, toolName: string) {
        this.tools[toolName] = mcpTool({
            server,
            tool: toolName,
        });
    }
}
