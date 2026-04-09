import { WebSocketServer, WebSocket } from "ws";
import type {
  BridgeMessage,
  BridgeReply,
  BridgePermissionRequest,
  BridgePermissionResponse,
  BridgeRegistration,
} from "./types.js";

export class BridgeServer {
  private wss: WebSocketServer;
  private sessions = new Map<string, WebSocket>();
  private pendingMessages = new Map<string, BridgeMessage[]>();
  private replyHandler?: (sessionId: string, msg: BridgeReply) => void;
  private permissionHandler?: (req: BridgePermissionRequest) => void;

  constructor(port: number) {
    this.wss = new WebSocketServer({ port, host: "127.0.0.1" });

    this.wss.on("connection", (ws) => {
      let sessionId: string | undefined;
      console.log(`[bridge] new WebSocket connection (total clients: ${this.wss.clients.size})`);

      ws.on("message", (raw) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          console.log(`[bridge] failed to parse WS message: ${raw.toString().slice(0, 200)}`);
          return;
        }

        console.log(`[bridge] received type="${msg.type}" from session="${sessionId ?? "unregistered"}"`);

        if (msg.type === "register") {
          const reg = msg as unknown as BridgeRegistration;
          sessionId = reg.sessionId;
          this.onRegister(sessionId, ws);
          return;
        }

        if (!sessionId) {
          console.log(`[bridge] WARNING: message from unregistered connection, ignoring`);
          return;
        }

        if (msg.type === "reply") {
          console.log(`[bridge] reply from session="${sessionId}": adapter="${msg.adapter}" text="${String(msg.text ?? "").slice(0, 100)}"`);
          this.replyHandler?.(sessionId, msg as unknown as BridgeReply);
        } else if (msg.type === "permission_request") {
          console.log(`[bridge] permission_request from session="${sessionId}": tool="${msg.toolName}"`);
          this.permissionHandler?.(
            msg as unknown as BridgePermissionRequest,
          );
        } else {
          console.log(`[bridge] unknown message type="${msg.type}" from session="${sessionId}"`);
        }
      });

      ws.on("close", () => {
        console.log(`[bridge] WebSocket closed for session="${sessionId ?? "unknown"}"`);
        if (sessionId && this.sessions.get(sessionId) === ws) {
          this.sessions.delete(sessionId);
        }
      });

      ws.on("error", (err) => {
        console.log(`[bridge] WebSocket error for session="${sessionId ?? "unknown"}": ${err.message}`);
      });
    });

    this.wss.on("listening", () => {
      console.log(`Bridge WS server listening on 127.0.0.1:${port}`);
    });
  }

  private onRegister(sessionId: string, ws: WebSocket): void {
    this.sessions.set(sessionId, ws);
    const pending = this.pendingMessages.get(sessionId);
    console.log(`[bridge] session "${sessionId}" registered (pending messages: ${pending?.length ?? 0}, total sessions: ${this.sessions.size})`);

    if (pending) {
      for (const msg of pending) {
        console.log(`[bridge] flushing pending message to "${sessionId}": type="${msg.type}" content="${String((msg as any).content ?? "").slice(0, 100)}"`);
        ws.send(JSON.stringify(msg));
      }
      this.pendingMessages.delete(sessionId);
    }
  }

  sendToSession(sessionId: string, msg: BridgeMessage): boolean {
    const ws = this.sessions.get(sessionId);
    const isOpen = ws && ws.readyState === WebSocket.OPEN;
    console.log(`[bridge] sendToSession("${sessionId}"): ws=${ws ? "exists" : "null"} readyState=${ws?.readyState ?? "N/A"} (OPEN=${WebSocket.OPEN}) isOpen=${isOpen}`);

    if (isOpen) {
      console.log(`[bridge] sending message to "${sessionId}": type="${msg.type}" content="${String((msg as any).content ?? "").slice(0, 100)}"`);
      ws.send(JSON.stringify(msg));
      return true;
    }

    const pending = this.pendingMessages.get(sessionId) ?? [];
    pending.push(msg);
    this.pendingMessages.set(sessionId, pending);
    console.log(`[bridge] QUEUED message for "${sessionId}" (queue depth: ${pending.length})`);
    return false;
  }

  sendPermissionResponse(
    sessionId: string,
    resp: BridgePermissionResponse,
  ): void {
    const ws = this.sessions.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(resp));
    }
  }

  onReply(handler: (sessionId: string, msg: BridgeReply) => void): void {
    this.replyHandler = handler;
  }

  onPermissionRequest(handler: (req: BridgePermissionRequest) => void): void {
    this.permissionHandler = handler;
  }

  isSessionConnected(sessionId: string): boolean {
    const ws = this.sessions.get(sessionId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  disconnectSession(sessionId: string): void {
    const ws = this.sessions.get(sessionId);
    if (ws) {
      ws.close();
      this.sessions.delete(sessionId);
    }
    this.pendingMessages.delete(sessionId);
  }

  close(): void {
    for (const ws of this.sessions.values()) {
      ws.close();
    }
    this.sessions.clear();
    this.pendingMessages.clear();
    this.wss.close();
  }
}
