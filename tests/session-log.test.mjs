/**
 * The session log reader, against a stubbed SPARQL endpoint.
 *
 * What is worth asserting is the shaping, not the transport: that lisp
 * universal time becomes a real date, that the nodes come back in the order the
 * operations ran, and that `parent' becomes a depth the presentation can indent
 * by.  The vocabulary in the fixtures is the one a live nl4 session returned.
 */
import { cpSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "jsui-log-"));
cpSync(join(root, "lib"), join(scratch, "lib"), { recursive: true });
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
const { listSessions, readSession, listJournals, readJournal, readSessionRequests,
        universalToDate, sessionRepository } =
  await import(pathToFileURL(join(scratch, "lib", "mcp", "session-log.js")).href);

let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log(`  ok   ${what}`); }
                          else { fail++; console.log(`  FAIL ${what}`); } };

const bind = (rows) => ({ status: 200, ok: true, text: async () => JSON.stringify({
  head: {}, results: { bindings: rows.map((r) => Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, { type: "literal", value: String(v) }]))) } }) });

const G = "http://dydra.com/explorations/EB062DE9-C460-11F1-95F7-3BCB8CEB8DDD";
const M = "http://dydra.com/ns/mcp#";

console.log("\nthe endpoint and the clock");
{
  ok(sessionRepository("https://nl4.dydra.com/", "test") === "https://nl4.dydra.com/test/mcp",
     "the log is read from <account>/mcp, not the repository being explored");
  const d = universalToDate(4000594400);
  ok(d instanceof Date && d.getUTCFullYear() === 2026,
     "lisp universal time is converted, not read as unix seconds");
  ok(universalToDate(0) === null && universalToDate("x") === null,
     "an absent or unparsable timestamp is null rather than 1900");
}

console.log("\nlisting sessions");
{
  let sent = null;
  const fetchImpl = async (url, init) => { sent = { url, init }; return bind([
    { session: G, repository: "test/foaf", created: 4000594400, lastActive: 4000594400,
      version: 4, active: `${G}#n2` },
    { session: G + "x", repository: "test/other", created: 4000500000, lastActive: 4000500000,
      version: 1, active: `${G}x#n1` },
  ]); };
  const r = await listSessions({ host: "https://h", account: "test", token: "T", fetchImpl });
  ok(r.ok && r.sessions.length === 2, "both sessions are returned");
  ok(sent.url === "https://h/test/mcp/sparql", "posted to the account's exploration repository");
  ok(sent.init.headers.Authorization === "Bearer T", "under the account token");
  ok(r.sessions[0].id === "EB062DE9-C460-11F1-95F7-3BCB8CEB8DDD" && r.sessions[0].activeNode === "n2",
     "the id and the active node are reduced to their local names");
  ok(r.sessions[0].lastActive > r.sessions[1].lastActive, "newest first");
}

console.log("\nreading one session");
{
  const fetchImpl = async () => bind([
    { s: G, p: M + "type", o: M + "Exploration" },
    { s: G, p: M + "repository", o: "test/foaf" },
    { s: G, p: M + "created", o: 4000594400 },
    { s: G, p: M + "version", o: 4 },
    { s: G, p: M + "activeNode", o: `${G}#n2` },
    // deliberately out of order: the reader must sequence them
    { s: `${G}#n2`, p: M + "name", o: "n2" },
    { s: `${G}#n2`, p: M + "operation", o: "http://dydra.com/ns/mcp/operation#survey" },
    { s: `${G}#n2`, p: M + "status", o: M + "complete" },
    { s: `${G}#n2`, p: M + "parent", o: `${G}#n1` },
    { s: `${G}#n2`, p: M + "resultCount", o: 18 },
    { s: `${G}#n2`, p: M + "parameters", o: "{scope: predicates}" },
    { s: `${G}#n1`, p: M + "name", o: "n1" },
    { s: `${G}#n1`, p: M + "operation", o: "http://dydra.com/ns/mcp/operation#survey" },
    { s: `${G}#n1`, p: M + "status", o: M + "complete" },
    { s: `${G}#n1`, p: M + "resultCount", o: 8 },
    { s: `${G}#n1`, p: M + "parameters", o: "{scope: types}" },
  ]);
  const r = await readSession({ host: "https://h", account: "test", token: "T",
                                sessionUri: G, fetchImpl });
  const s = r.session;
  ok(r.ok && s.nodes.length === 2, "the header is separated from the nodes");
  ok(s.repository === "test/foaf" && s.version === 4 && s.activeNode === "n2",
     "the header is read");
  ok(s.nodes[0].name === "n1" && s.nodes[1].name === "n2",
     "nodes are ordered by the sequence they ran, not by the rows' order");
  ok(s.nodes[0].depth === 0 && s.nodes[1].depth === 1,
     "parent becomes a depth the presentation can indent by");
  ok(s.nodes[0].operation === "survey" && s.nodes[0].status === "complete",
     "operation and status are reduced to their local names");
  ok(s.nodes[1].resultCount === 18 && s.nodes[1].parameters === "{scope: predicates}",
     "what was asked and what came back are both kept");
}

console.log("\na store that will not answer");
{
  const fetchImpl = async () => ({ status: 404, ok: false, text: async () => "no such repository" });
  const r = await listSessions({ host: "https://h", account: "nope", token: "T", fetchImpl });
  ok(r.ok === false && /no such repository/.test(r.error), "the failure is reported, not thrown");
  ok(Array.isArray(r.rows) && r.rows.length === 0, "and the shape is still usable");
}

rmSync(scratch, { recursive: true, force: true });
const J = "http://dydra.com/mcp/journal/test/foaf/2026-10-15";
const R = `${J}#7F3A1C00-C460-11F1-95F7-3BCB8CEB8DDD`;

console.log("\nlisting the request journals");
{
  const fetchImpl = async () => bind([
    { journal: J, repository: "test/foaf", date: "2026-10-15" },
    { journal: J.replace("15", "13"), repository: "test/foaf", date: "2026-10-13" },
  ]);
  const r = await listJournals({ host: "https://h", account: "test", token: "T", fetchImpl });
  ok(r.ok && r.journals.length === 2, "both days are returned");
  ok(r.journals[0].date === "2026-10-15", "newest day first");
  ok(r.journals[0].repository === "test/foaf", "the target repository is carried, not the log's own");
}

console.log("\nreading a journal");
{
  const rows = [
    { s: J, p: M + "type", o: M + "Journal" },
    { s: J, p: M + "repository", o: "test/foaf" },
    { s: J, p: M + "date", o: "2026-10-15" },
    { s: R, p: M + "type", o: M + "Request" },
    { s: R, p: M + "agent", o: "james" },
    { s: R, p: M + "repository", o: "test/foaf" },
    { s: R, p: M + "method", o: "tools/call" },
    { s: R, p: M + "tool", o: "sparql" },
    { s: R, p: M + "era", o: "modern" },
    { s: R, p: M + "client", o: "claude-cli/1.2" },
    { s: R, p: M + "startedAt", o: 4000594400 },
    { s: R, p: M + "duration", o: 184 },
    { s: R, p: M + "status", o: M + "complete" },
    { s: R, p: M + "request", o: '{"jsonrpc":"2.0","id":7,"method":"tools/call"}' },
    { s: R, p: M + "requestSize", o: 46 },
    { s: R, p: M + "response", o: '{"jsonrpc":"2.0","id":7,"result":{}}' },
    { s: R, p: M + "responseSize", o: 900000 },
    { s: R, p: M + "truncated", o: "true" },
    { s: R, p: M + "exploration", o: G },
    // a second request, earlier, to prove the ordering is by time
    { s: J + "#aa", p: M + "type", o: M + "Request" },
    { s: J + "#aa", p: M + "method", o: "tools/list" },
    { s: J + "#aa", p: M + "startedAt", o: 4000594000 },
    { s: J + "#aa", p: M + "status", o: M + "error" },
    { s: J + "#aa", p: M + "errorCode", o: -32601 },
  ];
  const r = await readJournal({ host: "https://h", account: "test", token: "T",
                                journalUri: J, fetchImpl: async () => bind(rows) });
  ok(r.ok && r.requests.length === 2, "the journal's own header is not read as a request");
  ok(r.requests[0].method === "tools/list", "requests come back in the order they were made");
  const call = r.requests[1];
  ok(call.agent === "james" && call.repository === "test/foaf",
     "the authorized agent and the target repository are both kept");
  ok(call.request.includes("tools/call") && call.response.includes("result"),
     "what was asked and what came back are both kept");
  ok(call.responseSize === 900000 && call.truncated === true,
     "a clipped payload still reports its true size");
  ok(call.status === "complete" && call.duration === 184,
     "status and duration are shaped for the presentation");
  ok(call.exploration === G, "a call made during an exploration names it");
  ok(r.requests[0].errorCode === -32601, "a protocol error keeps its code");
}

console.log("\nthe requests of one exploration");
{
  let sent = null;
  const fetchImpl = async (url, init) => { sent = { url, init }; return bind([
    { s: R, p: M + "type", o: M + "Request" },
    { s: R, p: M + "method", o: "tools/call" },
    { s: R, p: M + "exploration", o: G },
  ]); };
  const r = await readSessionRequests({ host: "https://h", account: "test", token: "T",
                                        sessionUri: G, fetchImpl });
  ok(r.ok && r.requests.length === 1, "the exploration's calls are found");
  ok(sent.init.body.includes(`mcp:exploration <${G}>`),
     "the graph is left unbound: an exploration may span more than one day's journal");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
