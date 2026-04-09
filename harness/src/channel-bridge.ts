#!/usr/bin/env node
/**
 * Channel bridge MCP server.
 *
 * Spawned by Claude Code as a subprocess. Connects to the harness via
 * WebSocket to receive routed messages and send replies back.
 *
 * Env vars:
 *   SESSION_ID     — identifies this session to the harness
 *   BRIDGE_WS_URL  — WebSocket URL of the harness bridge server
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import WebSocket from "ws";

const SESSION_ID = process.env.SESSION_ID;
const BRIDGE_WS_URL = process.env.BRIDGE_WS_URL;

if (!SESSION_ID || !BRIDGE_WS_URL) {
  process.stderr.write(
    "channel-bridge: SESSION_ID and BRIDGE_WS_URL env vars required\n",
  );
  process.exit(1);
}

const mcp = new Server(
  { name: "harness", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
    },
    instructions: [
      "Messages arrive as <channel source=\"harness\" adapter=\"...\" chat_id=\"...\" user=\"...\" ...>.",
      "Reply using the reply tool — pass adapter and chat_id from the tag.",
      "Use reply_to only when quoting an earlier message; omit it for normal responses.",
      "Your transcript output is not visible to the sender — always use the reply tool.",
    ].join("\n"),
  },
);

// --- Reply tool ---

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send a message back through the originating adapter",
      inputSchema: {
        type: "object" as const,
        properties: {
          adapter: {
            type: "string",
            description: "Source adapter: telegram, slack",
          },
          chat_id: {
            type: "string",
            description: "Chat/channel to reply in",
          },
          text: {
            type: "string",
            description: "Message text",
          },
          reply_to: {
            type: "string",
            description: "Optional message ID to quote-reply",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "File paths to attach",
          },
        },
        required: ["adapter", "chat_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  process.stderr.write(`channel-bridge [${SESSION_ID}]: tool call: ${req.params.name}(${JSON.stringify(req.params.arguments).slice(0, 200)})\n`);
  if (req.params.name === "reply") {
    const args = req.params.arguments as {
      adapter: string;
      chat_id: string;
      text: string;
      reply_to?: string;
      files?: string[];
    };
    process.stderr.write(`channel-bridge [${SESSION_ID}]: sending reply to harness: adapter="${args.adapter}" chat_id="${args.chat_id}" text="${args.text.slice(0, 100)}"\n`);
    sendToHarness({
      type: "reply",
      adapter: args.adapter,
      chat_id: args.chat_id,
      text: args.text,
      reply_to: args.reply_to,
      files: args.files,
    });
    return { content: [{ type: "text" as const, text: "sent" }] };
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});

// --- Permission relay ---

const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  sendToHarness({
    type: "permission_request",
    sessionId: SESSION_ID!,
    requestId: params.request_id,
    toolName: params.tool_name,
    description: params.description,
    inputPreview: params.input_preview,
  });
});

// --- WebSocket connection to harness ---

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectToHarness(): void {
  ws = new WebSocket(BRIDGE_WS_URL!);

  ws.on("open", () => {
    process.stderr.write(`channel-bridge [${SESSION_ID}]: connected to harness\n`);
    ws!.send(JSON.stringify({ type: "register", sessionId: SESSION_ID }));
  });

  ws.on("message", async (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      process.stderr.write(`channel-bridge [${SESSION_ID}]: failed to parse WS message: ${raw.toString().slice(0, 200)}\n`);
      return;
    }

    process.stderr.write(`channel-bridge [${SESSION_ID}]: received type="${msg.type}" from harness\n`);

    if (msg.type === "message") {
      // Inbound message from harness → push to Claude as channel notification
      process.stderr.write(`channel-bridge [${SESSION_ID}]: pushing channel notification to Claude: content="${String(msg.content).slice(0, 100)}" meta=${JSON.stringify(msg.meta)}\n`);
      try {
        await mcp.notification({
          method: "notifications/claude/channel",
          params: {
            content: msg.content as string,
            meta: (msg.meta as Record<string, string>) ?? {},
          },
        });
        process.stderr.write(`channel-bridge [${SESSION_ID}]: channel notification sent successfully\n`);
      } catch (err: any) {
        process.stderr.write(`channel-bridge [${SESSION_ID}]: ERROR sending channel notification: ${err.message}\n`);
      }
    } else if (msg.type === "permission_response") {
      // Permission verdict from harness → forward to Claude Code
      process.stderr.write(`channel-bridge [${SESSION_ID}]: forwarding permission response: requestId="${msg.requestId}" behavior="${msg.behavior}"\n`);
      await mcp.notification({
        method: "notifications/claude/channel/permission" as any,
        params: {
          request_id: msg.requestId as string,
          behavior: msg.behavior as string,
        },
      });
    } else {
      process.stderr.write(`channel-bridge [${SESSION_ID}]: unknown message type="${msg.type}"\n`);
    }
  });

  ws.on("close", () => {
    process.stderr.write(`channel-bridge [${SESSION_ID}]: disconnected from harness\n`);
    ws = null;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    process.stderr.write(`channel-bridge [${SESSION_ID}]: ws error: ${err.message}\n`);
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToHarness();
  }, 2000);
}

function sendToHarness(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    process.stderr.write(
      `channel-bridge [${SESSION_ID}]: cannot send, not connected\n`,
    );
  }
}

// --- Start ---

await mcp.connect(new StdioServerTransport());
connectToHarness();

// Clean shutdown
process.on("SIGTERM", () => {
  ws?.close();
  process.exit(0);
});
