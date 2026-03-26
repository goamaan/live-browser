import type { RpcEnvelope, RpcResponse } from '../shared/types.js';

export function encodeRpcMessage(message: RpcEnvelope | RpcResponse): string {
  return `${JSON.stringify(message)}\n`;
}

export function decodeRpcBuffer(buffer: string): { messages: Array<RpcEnvelope | RpcResponse>; remainder: string } {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  const messages = lines.filter(Boolean).map((line) => JSON.parse(line) as RpcEnvelope | RpcResponse);
  return { messages, remainder };
}
