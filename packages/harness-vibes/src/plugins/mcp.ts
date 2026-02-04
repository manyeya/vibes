import { Plugin } from '../core/types';

/**
 * MCP client types from @ai-sdk/mcp
 * Imported dynamically to avoid build errors when package is not installed
 */
interface MCPTool {
    description: string;
    inputSchema: Record<string, unknown>;
}

interface MCPClient {
    listTools(): Promise<MCPTool[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    close(): Promise<void>;
}

/**
 * Plugin that integrates MCP (Model Context Protocol) servers.
 * Allows agents to use tools from any MCP server compatible with AI SDK.
 *
 * Note: This is a placeholder implementation. The @ai-sdk/mcp package
 * provides createMCPClient but not a direct tool wrapper. To use MCP tools:
 * 1. Create an MCPClient using createMCPClient() from @ai-sdk/mcp
 * 2. List available tools via client.listTools()
 * 3. Call tools via client.callTool()
 * 4. Wrap each tool as a standard tool for the agent
 */
export class McpPlugin implements Plugin {
    name = 'McpPlugin';
    tools: Record<string, any> = {};

    /**
     * @param clients Pre-configured MCP clients (created via createMCPClient from @ai-sdk/mcp)
     */
    constructor(private clients: Array<{ name: string; client: MCPClient }>) {}

    async waitReady() {
        // Initialize tools from each MCP client
        for (const { name, client } of this.clients) {
            try {
                const tools = await client.listTools();
                for (const tool of tools) {
                    this.tools[`${name}_${tool.description}`] = {
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                        execute: async (args: Record<string, unknown>) => {
                            return await client.callTool(tool.description, args);
                        },
                    };
                }
            } catch (error) {
                console.error(`[McpPlugin] Failed to initialize client "${name}":`, error);
            }
        }
    }

    /**
     * Cleanup: close all MCP client connections
     */
    async cleanup() {
        for (const { client, name } of this.clients) {
            try {
                await client.close();
            } catch (error) {
                console.error(`[McpPlugin] Failed to close client "${name}":`, error);
            }
        }
    }
}
