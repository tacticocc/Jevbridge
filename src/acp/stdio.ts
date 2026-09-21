import { spawn } from "node:child_process";
import process from "node:process";
import { AcpFramer, encodeAcp } from "./framing.ts";
import { AcpProxy } from "./proxy.ts";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from "./protocol.ts";
import { AcpSidecar } from "./sidecar.ts";
import { defaultSessionDir, SessionStore } from "./session-store.ts";
import { resolveUpstream, spawnCommand, type UpstreamSpec } from "./upstream.ts";

function writeStdout(msg: JsonRpcMessage): void {
  process.stdout.write(encodeAcp(msg));
}

async function readStdin(onMessage: (msg: JsonRpcRequest | JsonRpcNotification) => Promise<void>): Promise<void> {
  const framer = new AcpFramer();
  for await (const chunk of process.stdin) {
    for (const parsed of framer.feed(chunk as Buffer)) {
      const msg = parsed as JsonRpcMessage;
      if (isJsonRpcRequest(msg) || isJsonRpcNotification(msg)) await onMessage(msg);
    }
  }
}

export async function serveSidecar(store = new SessionStore(defaultSessionDir())): Promise<void> {
  const sidecar = new AcpSidecar(writeStdout, store);
  await readStdin((msg) => sidecar.dispatch(msg));
}

export async function serveProxy(upstream: UpstreamSpec, store = new SessionStore(defaultSessionDir())): Promise<void> {
  const child = spawn(spawnCommand(upstream.command), upstream.args, {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
    windowsHide: true,
  });
  if (!child.stdin || !child.stdout) {
    throw new Error("failed to spawn upstream ACP agent");
  }
  const proxy = new AcpProxy({
    toClient: writeStdout,
    toUpstream: (msg) => {
      child.stdin!.write(encodeAcp(msg));
    },
    store,
  });
  const upFramer = new AcpFramer();
  let chain = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    chain = chain.then(work, work);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    enqueue(async () => {
      for (const parsed of upFramer.feed(chunk)) {
        await proxy.onUpstream(parsed as JsonRpcMessage);
      }
    });
  });
  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
  const clientFramer = new AcpFramer();
  for await (const chunk of process.stdin) {
    const messages = clientFramer.feed(chunk as Buffer);
    await new Promise<void>((resolve, reject) => {
      enqueue(async () => {
        try {
          for (const parsed of messages) {
            await proxy.onClient(parsed as JsonRpcMessage);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }
  child.kill();
}

export async function serveAcp(options: { upstream?: UpstreamSpec; store?: SessionStore } = {}): Promise<void> {
  const store = options.store ?? new SessionStore(defaultSessionDir());
  const upstream = options.upstream ?? resolveUpstream(process.argv.slice(3), process.env);
  if (upstream) {
    await serveProxy(upstream, store);
    return;
  }
  await serveSidecar(store);
}
