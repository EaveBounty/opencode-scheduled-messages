import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { OpenCodeClient, OpenCodeError } from "../src/opencode.js";

async function fakeServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("uses Basic auth with the opencode username", async () => {
  let seen = null;
  const fake = await fakeServer((req, res) => {
    seen = req.headers.authorization;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "2.1.1" }));
  });
  const client = new OpenCodeClient({ baseUrl: fake.url, password: "secret" });
  const info = await client.info();
  assert.equal(info.version, "2.1.1");
  assert.equal(seen, `Basic ${Buffer.from("opencode:secret").toString("base64")}`);
  await fake.close();
});

test("maps upstream errors to OpenCodeError", async () => {
  const fake = await fakeServer((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ _tag: "UnauthorizedError", message: "Authentication required" }));
  });
  const client = new OpenCodeClient({ baseUrl: fake.url });
  await assert.rejects(
    () => client.info(),
    (error) => {
      assert.ok(error instanceof OpenCodeError);
      assert.equal(error.status, 401);
      assert.equal(error.tag, "UnauthorizedError");
      return true;
    },
  );
  await fake.close();
});

test("parses SSE frames split across TCP chunks", async () => {
  const fake = await fakeServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write('data: {"type":"server.connected"');
    setTimeout(() => {
      res.write('}\n\n');
      res.write('data: {"type":"session.execution.started","sessionID":"ses_1"}\n\n');
      setTimeout(() => res.end(), 20);
    }, 10);
  });
  const client = new OpenCodeClient({ baseUrl: fake.url });
  const controller = new AbortController();
  const events = [];
  for await (const event of client.eventStream({ signal: controller.signal })) {
    events.push(event);
    if (events.length === 2) controller.abort();
  }
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "server.connected");
  assert.equal(events[1].sessionID, "ses_1");
  await fake.close();
});

test("builds a native deep link from base64url(origin)", async () => {
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", publicUrl: "https://host.ts.net:8443" });
  const link = client.deepLink("ses_123", "https://host.ts.net");
  const key = Buffer.from("https://host.ts.net:8443").toString("base64url");
  assert.equal(link, `https://host.ts.net:8443/server/${key}/session/ses_123`);
});
