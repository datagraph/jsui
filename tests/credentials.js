/**
 * Test credentials: the environment, or a file under ~/.dydra/.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * Until 2026-10-24 the account password sat in this directory as a literal
 * default -- `password = '...'` in test-helpers.js, and the same string in
 * five other files.  jsui has a github remote, those files are tracked, and
 * the string is in the history from the initial commit onward.  A default
 * that works is a default nobody overrides, so every run used it and every
 * clone carried it.  (The string is not repeated here: a file that explains
 * the leak while quoting the secret has not fixed it.)
 *
 * There is deliberately NO default.  A missing password raises, with a
 * message saying how to supply it.  A test that cannot authenticate must fail
 * loudly rather than fall back to a shared secret.
 *
 * ── Where the secret comes from ─────────────────────────────────────────────
 *
 *   1. $JSUI_PASSWORD (or $ADMIN_PASSWORD for the admin account)
 *   2. $JSUI_TOKEN    (or $ADMIN_TOKEN),              used as `:<token>'
 *   3. ~/.dydra/<host>.<account>.password
 *   4. ~/.dydra/<host>.<account>.token,               used as `:<token>'
 *   5. ~/.dydra/<account>.password
 *   6. ~/.dydra/<account>.token,                      used as `:<token>'
 *
 * This is the convention the shell suites already use for bearer tokens --
 * `~/.dydra/<host>.<account>.token', read by `dydra_token_file' in every
 * common.sh -- with `.password' added beside it.  Both live OUTSIDE the
 * working copy on purpose: a file under ~/.dydra/ cannot be committed by a
 * future `git add -A', however the ignore list changes.
 *
 * **Host-qualified beats bare, and within a tier a password beats a token.**
 * An account's password is not the same on every host, so the qualified name
 * must win over the bare one whichever kind it is -- otherwise a bare
 * `<account>.password' that happens to exist would shadow the token that is
 * the only thing a particular host accepts.
 *
 * ── Why a token at all ──────────────────────────────────────────────────────
 *
 * The login field is "Password or Token", and `lib/auth.js' reads a leading
 * `:' as "this IS the bearer token, do not go and ask for one".  That matters
 * on a host whose `/system/accounts/<a>/configuration' does not serve an
 * account document: a password login has nowhere to get a token from and
 * fails, while a token login needs no configuration resource at all.  nl4
 * answers that resource with the JSON string "NIL" (test record 20261023,
 * finding 11), so a token is the only way in there -- and `~/.dydra/' already
 * held one for both accounts.
 *
 * ── The host ────────────────────────────────────────────────────────────────
 *
 * Derived here rather than imported from test-helpers.js, which imports THIS
 * module -- the other direction would be a cycle.  Scheme, then path, then
 * port are stripped in that order: taking the path off first would turn
 * `https://nl4.dydra.com' into `https:' and name a file nobody has.  That is
 * the same bug, and the same fix, as in `dydra_token_file'.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `https://nl4.dydra.com/x' -> `nl4.dydra.com'. */
export function hostOf(value) {
  let host = String(value || '').trim();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');   // scheme
  host = host.replace(/\/.*$/, '');                      // path
  host = host.replace(/:.*$/, '');                       // port
  return host;
}

/** Hosts that are this machine, never the service holding the account. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '']);

/**
 * The host whose password is wanted -- NOT necessarily the origin the client
 * is served from.
 *
 * Against the dev server the page is `http://localhost:8099' and the API is
 * still the upstream it proxies to; the account lives there, so that is the
 * host the password file is named for.  A loopback host therefore resolves to
 * `JSUI_UPSTREAM' (what tests/dev-server.mjs forwards to), else dydra.com.
 *
 * `JSUI_API_HOST' is read first because it names the API explicitly -- but
 * note what it does elsewhere: test-helpers.js puts it in the LOGIN FORM's
 * Host field, where it must carry a scheme and must match the origin the page
 * was served from, or the request is cross-origin and its preflight is not
 * answered.  Setting it to a bare `dydra.com' while serving from localhost
 * breaks every login.  Here only the hostname is taken from it.
 */
export const apiHost = () => {
  const named = hostOf(process.env.JSUI_API_HOST || process.env.JSUI_ORIGIN || '');
  if (named && !LOOPBACK.has(named)) return named;
  return hostOf(process.env.JSUI_UPSTREAM || 'dydra.com') || 'dydra.com';
};

/** The account under test.  Not a secret, so it keeps an ordinary default. */
export const ACCOUNT = () => process.env.JSUI_ACCOUNT || 'playwright';

/** The account the admin console signs in as; the same one unless told otherwise. */
export const ADMIN_USER = () => process.env.ADMIN_USERNAME || ACCOUNT();

/** Candidate password files for an account, most specific first. */
export function passwordFiles(account, host = apiHost()) {
  const dir = join(homedir(), '.dydra');
  return [join(dir, `${host}.${account}.password`),
          join(dir, `${account}.password`)];
}

/** Candidate token files, named exactly as `dydra_token_file' in common.sh. */
export function tokenFiles(account, host = apiHost()) {
  const dir = join(homedir(), '.dydra');
  return [join(dir, `${host}.${account}.token`),
          join(dir, `${account}.token`)];
}

/**
 * Every candidate, in the order they are tried, each tagged with its kind.
 * Host-qualified pair first, then the bare pair.
 */
export function secretFiles(account, host = apiHost()) {
  const [hostPassword, barePassword] = passwordFiles(account, host);
  const [hostToken, bareToken] = tokenFiles(account, host);
  return [{ path: hostPassword, kind: 'password' },
          { path: hostToken,    kind: 'token' },
          { path: barePassword, kind: 'password' },
          { path: bareToken,    kind: 'token' }];
}

function readFirst(candidates) {
  for (const { path, kind } of candidates) {
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    const value = text.trim();
    if (value) return { value, path, kind };
    // An empty file is a mistake worth naming, not a silent miss.
    console.warn(`[credentials] ${path} is empty; ignored`);
  }
  return null;
}

/** What goes in the login field: a password as-is, a token with its `:' marker. */
const asSecret = ({ value, kind }) => (kind === 'token' ? `:${value}` : value);

/**
 * The secret for an account -- password or `:token' -- or throw.
 *
 * `envName'/`tokenEnvName' let the admin account be given its own variables
 * while sharing the file convention.
 */
export function secretFor(account, envName = 'JSUI_PASSWORD',
                          tokenEnvName = 'JSUI_TOKEN') {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const tokenFromEnv = process.env[tokenEnvName];
  if (tokenFromEnv) return `:${tokenFromEnv.trim()}`;
  const host = apiHost();
  const found = readFirst(secretFiles(account, host));
  if (found) return asSecret(found);
  throw new Error(
    `[credentials] no password or token for "${account}" on ${host}.\n`
    + `  Supply it in the environment:  ${envName}=... npx playwright test\n`
    + `                            or:  ${tokenEnvName}=... npx playwright test\n`
    + `  or in a file:                  ~/.dydra/${host}.${account}.password\n`
    + `                            or:  ~/.dydra/${host}.${account}.token\n`
    + `  or, if it is the same on every host:\n`
    + `                                 ~/.dydra/${account}.password\n`
    + `                            or:  ~/.dydra/${account}.token\n`
    + `  (~/.dydra/<host>.<account>.token is what the shell suites read.)\n`
    + `  There is no default: a working default is a shared secret that ends\n`
    + `  up in git.`);
}

/** Back-compatible name; a token is a credential for this purpose too. */
export const passwordFor = secretFor;

/** True when a secret can be resolved, so a spec may skip instead of failing. */
export function hasPassword(account = ACCOUNT(), envName = 'JSUI_PASSWORD',
                            tokenEnvName = 'JSUI_TOKEN') {
  if (process.env[envName] || process.env[tokenEnvName]) return true;
  return readFirst(secretFiles(account)) !== null;
}

/** Which file answered, and whether it was a password or a token -- for logs. */
export function secretSource(account = ACCOUNT()) {
  if (process.env.JSUI_PASSWORD) return { path: '$JSUI_PASSWORD', kind: 'password' };
  if (process.env.JSUI_TOKEN)    return { path: '$JSUI_TOKEN', kind: 'token' };
  const found = readFirst(secretFiles(account));
  return found ? { path: found.path, kind: found.kind } : null;
}

export const PASSWORD   = () => secretFor(ACCOUNT(), 'JSUI_PASSWORD', 'JSUI_TOKEN');
export const ADMIN_PASS = () => secretFor(ADMIN_USER(), 'ADMIN_PASSWORD', 'ADMIN_TOKEN');

/**
 * The `Authorization' header value for a secret, by the same rules the client
 * uses (`buildAuthHeader' in lib/auth.js): a leading `:', a `token:' prefix or
 * a `bearer ' prefix all mean the secret IS the token; anything else is a
 * password and goes in Basic.
 *
 * Built HERE, in node, and passed into `page.evaluate' as a finished string.
 * A spec that passes a user and a password into the browser and composes
 * `Basic btoa(user + ":" + password)' there is wrong the moment the secret is
 * a token -- it base64s the token as though it were a password and the
 * service answers 401.  That is not hypothetical: it is what the 27 Oct nl4
 * run did to `history filters [REQ-2.5.4]'.  Composing it on this side also
 * keeps the password out of the page's context.
 */
export function authorizationFor(account, secret) {
  const trimmed = String(secret || '').trim();
  if (/^bearer\s+/i.test(trimmed)) return `Bearer ${trimmed.replace(/^bearer\s+/i, '').trim()}`;
  if (trimmed.startsWith(':'))      return `Bearer ${trimmed.slice(1).trim()}`;
  if (/^token:/i.test(trimmed))     return `Bearer ${trimmed.slice(6).trim()}`;
  return `Basic ${Buffer.from(`${String(account).trim()}:${trimmed}`).toString('base64')}`;
}

/** The header for the account under test, and for the admin account. */
export const AUTHORIZATION       = () => authorizationFor(ACCOUNT(), PASSWORD());
export const ADMIN_AUTHORIZATION = () => authorizationFor(ADMIN_USER(), ADMIN_PASS());

/**
 * Kept so that `credential(NAME, fallback)` still reads for the NON-SECRET
 * values the specs ask for.  It refuses the secret names outright: those have
 * a resolver of their own, and routing a password through a function that
 * takes a fallback is how the literal got in last time.
 */
export function credential(name, fallback = undefined) {
  if (name === 'JSUI_PASSWORD') return PASSWORD();
  if (name === 'ADMIN_PASSWORD') return ADMIN_PASS();
  const fromEnv = process.env[name];
  if (fromEnv != null && fromEnv !== '') return fromEnv;
  if (fallback !== undefined) return fallback;
  throw new Error(`[credentials] ${name} is not set and has no default.`);
}
