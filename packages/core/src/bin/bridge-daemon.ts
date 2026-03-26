#!/usr/bin/env node
import { BridgeDaemonServer } from '../daemon/server.js';

async function main(): Promise<void> {
  const server = new BridgeDaemonServer();
  await server.start();

  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
