import assert from "node:assert/strict";
import { test } from "node:test";
import { AcpFramer, encodeAcp } from "./framing.ts";

test("encode then feed round-trips a JSON-RPC message", () => {
  const framer = new AcpFramer();
  const msg = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } };
  const frames = framer.feed(encodeAcp(msg));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], msg);
});

test("feed splits concatenated frames and holds a partial", () => {
  const framer = new AcpFramer();
  const a = encodeAcp({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "s" } });
  const b = encodeAcp({ jsonrpc: "2.0", id: 2, result: {} });
  const joined = Buffer.concat([a, b, Buffer.from('Content-Length: 16\r\n\r\n{"partial":true')]);
  const frames = framer.feed(joined);
  assert.equal(frames.length, 2);
  const rest = framer.feed(Buffer.from("}"));
  assert.equal(rest.length, 1);
  assert.deepEqual(rest[0], { partial: true });
});
