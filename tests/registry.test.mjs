/**
 * The MCP connection registry, and the handle that outlives a run (§34.4).
 *
 * Two claims are worth asserting away from a browser, because they are the
 * two the whole change rests on.  First, that a connection is ONE object: a
 * pane's view of it is a window, not a copy, so an endpoint corrected in one
 * surface is the endpoint every other surface uses.  Second, that an
 * exploration handle is the session's rather than the run's: a second run of
 * the same repository joins the exploration the first one opened instead of
 * starting a second beside it, which is what the service's own record assumes.
 *
 * Loading note: jsui's package.json declares no "type", so node reads its .js
 * as CommonJS while the browser loads the same files as modules.  The lib tree
 * is copied into a scratch package that does declare it, as the adapter's own
 * test does and for the same reason.
 */

import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-registry-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const load = (rel) => import(pathToFileURL(join(scratch, rel)).href);

const R = await load("lib/mcp/registry.js");
const { createToolAdapter } = await load("lib/llm/tool-adapter.js");

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

console.log("\na connection is one object, however many surfaces hold it");
{
  R.forgetAll();
  const a = R.mcpConnectionFor("alice", "sales", "https://dydra.com");
  const b = R.mcpConnectionFor("alice", "sales", "https://elsewhere.example");
  ok(a === b, "asking twice yields the same connection, not a second one");
  ok(a.mcpEndpoint === "https://dydra.com/alice/sales/mcp",
     "the endpoint is derived from the host that made it");
  ok(b.mcpEndpoint === "https://dydra.com/alice/sales/mcp",
     "and a later caller's host does not silently replace it");

  const pane = R.attachMcp({ account: "alice", repository: "sales" },
                           "alice", "sales", "https://dydra.com");
  pane.mcpEndpoint = "http://127.0.0.1:8080/alice/sales/mcp";
  ok(a.mcpEndpoint === "http://127.0.0.1:8080/alice/sales/mcp",
     "a pane writes THROUGH to the connection rather than keeping its own copy");
  a.token = "TOKEN";
  ok(pane.token === "TOKEN", "and reads through it, so neither can go stale");

  const store = R.storeFor(a);
  ok(store.endpoint === a.mcpEndpoint && store.token === "TOKEN"
     && store.account === "alice" && store.repository === "sales",
     "and the store the adapter routes on is made from the connection, not from a host");
}

console.log("\nwhat is connected, and who is told");
{
  R.forgetAll();
  let told = 0;
  const stop = R.onConnections(() => { told += 1; });
  const conn = R.mcpConnectionFor("alice", "sales", "https://dydra.com");
  ok(told === 1, "making one is announced, so an open chooser redraws itself");
  ok(conn.connected === null, "it has not been tried yet, which is not the same as failing");
  ok(R.connectedConnections().length === 0, "and a chooser offering connected stores offers none");
  conn.connected = true;
  ok(R.connectedConnections().map((c) => c.id).join() === "alice/sales",
     "once it has answered, it is what a chooser offers");
  stop();
  R.mcpConnectionFor("alice", "other", "https://dydra.com");
  ok(told === 1, "and a watcher that stopped is not told again");
  ok(R.storesFor(["alice/sales", "alice/nothing"]).length === 1,
     "a name with no connection behind it is left out rather than carried as a hole");
}

console.log("\nthe exploration handle outlives the run that opened it");
{
  R.forgetAll();
  const conn = R.mcpConnectionFor("alice", "sales", "https://dydra.com");
  conn.token = "TOKEN";

  // One store, one tool, one turn that calls it, then one that answers.
  const transport = (session) => async (url, init) => {
    const body = JSON.parse(init.body);
    const reply = (o) => new Response(JSON.stringify(o), { status: 200,
      headers: { "Content-Type": "application/json" } });
    if (String(url).includes("/mcp")) {
      if (body.method === "tools/list") {
        return reply({ jsonrpc: "2.0", id: 1, result: { tools: [
          { name: "survey", description: "explore", inputSchema: { type: "object" } }] } });
      }
      if (body.method === "resources/read") {
        return reply({ jsonrpc: "2.0", id: 1,
                       result: { contents: [{ text: "operations: catalog" }] } });
      }
      sent.push(body.params?.arguments || {});
      return reply({ jsonrpc: "2.0", id: 1, result: { content: [
        { type: "resource", resource: { text: `session: "${session}"\ncatalog` } }] } });
    }
    calls += 1;
    if (calls === 1) {
      return reply({ id: "m", stop_reason: "tool_use", content: [
        { type: "tool_use", id: "t1", name: "survey", input: { op: "catalog" } }] });
    }
    return reply({ id: "m", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] });
  };

  let sent = [], calls = 0;
  const run = (session) => createToolAdapter({
    apiKey: "k", model: "m", mcp: { repositories: [R.storeFor(conn)] },
    sessions: R.sessionStore(), primeWith: [], fetchImpl: transport(session),
  }).run("what is in here");

  await run("S-1");
  ok(conn.session === "S-1", "the handle the first run opened is kept on the connection");

  sent = []; calls = 0;
  const second = await run("S-2");
  ok(sent[0]?.session === "S-1",
     "a second run carries it from the first call, rather than opening a second exploration");
  ok(second.session === "S-1",
     "and reports the exploration it joined, not the one the server would have opened");
  ok(second.events.some((e) => e.type === "session" && e.carried === true),
     "the transcript says the handle was carried, so a reader is not left to assume it was opened");
  ok(conn.session === "S-1", "and nothing overwrote it");

  // Without a store, the run keeps its handles to itself -- what every caller
  // did before there was a registry, and what the adapter's own tests assume.
  sent = []; calls = 0;
  const loose = await createToolAdapter({
    apiKey: "k", model: "m", mcp: { endpoint: conn.mcpEndpoint, token: "TOKEN" },
    primeWith: [], fetchImpl: transport("S-9"),
  }).run("again");
  ok(loose.session === "S-9" && conn.session === "S-1",
     "a run given no session store opens its own and writes to nothing");
}

console.log("\na handle the store disowns does not outlive the run that found out");
{
  R.forgetAll();
  const conn = R.mcpConnectionFor("alice", "sales", "https://host.test");
  const store = R.sessionStore();
  store.set(conn.id, "S-OLD");
  ok(conn.session === "S-OLD", "a handle is kept, as before");

  let told = 0;
  const stopWatching = R.onConnections(() => { told += 1; });
  store.set(conn.id, null);
  ok(conn.session === null,
     "and null clears it -- so the next run does not open with a handle the store refused");
  ok(told === 1, "the surfaces are told, because a chip may be showing it");
  told = 0;
  store.set(conn.id, null);
  ok(told === 0, "clearing what is already clear tells nobody");
  stopWatching();
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
