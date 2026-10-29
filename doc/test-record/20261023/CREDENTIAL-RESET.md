# Credentials to reset — 2026-10-24

Scope of the audit: every tracked and untracked file in the `jsui` and `spocq`
working copies, plus the full git history of both.  Produced while removing
literal credentials from the test suites (test record §Findings 8).

**Removing a secret from the working tree does not remove it from the git
history.** Everything in Part 1 has been published and must be rotated; the
edits only stop it spreading further.

---

## Part 1 — Published to a git remote.  Rotate these.

### 1.1  `james` — API access token

| | |
|---|---|
| what | the account's `urn:dydra:accessToken` (bearer token) |
| where published | **spocq**, remotes `github.com:lisp/spocq` and `gitlab.dydra.com:bitfuse/spocq` |
| commits | `b0a37dd` 2026-02-25 (`gensrc/graphql/test/common.sh`), `404df92` 2026-03-24 (`src/mcp/test/common.sh`), `541cd36` 2026-03-25 (`src/graphql/test/common.sh`) |
| exposed for | ~8 months |
| also in the working tree | `gensrc-sparql-12/{mcp,graphql}/test/**/common.sh` (4 files) and `src/client/service-ui/test-account-model-presentation copy.html` — untracked, never committed |

**Reset the `james` token on:**

| host | account present | note |
|---|---|---|
| `dydra.com` | yes | production; the token's own `<http://dydra.com/users/james>` |
| `nl4.dydra.com` | yes | the host the test suites are pointed at |
| `nl9.dydra.com` | yes | |
| `de17.dydra.com` | ssh-reachable only | the `~/.dydra/de17.dydra.com.token` convention names it |

### 1.2  `playwright` — account password

| | |
|---|---|
| what | the account password, also used as `ADMIN_PASSWORD` |
| where published | **jsui**, remote `github.com:datagraph/jsui` |
| commits | `2451913` 2026-02-18 — the **initial commit** — then `7d9764f` 2026-03-02 and `3ba0513` 2026-10-12 |
| exposed for | ~8 months, the whole life of the repository |
| files | `tests/test-helpers.js` (both logins), `tests/clean-test-repos.mjs`, `tests/admin-documented.spec.js`, `tests/zz-shot-documented.spec.js`, `doc/demo-dydra-studio.js`, `instructions.md`, and three under `tests-inst/` |

**Reset the `playwright` password on:**

| host | account present | note |
|---|---|---|
| `dydra.com` | yes | production; what the suite signs in to by default |
| `nl4.dydra.com` | yes | |
| `de17.dydra.com` | ssh-reachable only | `gensrc/patches/2026/verify-authn-patch.lisp` authenticated this account here |
| `nl9.dydra.com` | **no** (404) | nothing to do |

If any administrator account shares that password — it was the value of
`ADMIN_PASSWORD` — reset that account too.  The audit cannot tell from the
outside whether `playwright` is itself the administrator.

---

## Part 2 — In the working tree, never committed.  Decide separately.

### 2.1  A full production metadata export, 1,298 accounts

`spocq/src/javascripts/utilities/system.nq` and `system.system.nq`, ~48,600
lines each, exported from **dydra.com**:

| | |
|---|---|
| distinct accounts | **1,298** |
| `urn:dydra:accessToken` triples | **1,299** |
| `urn:dydra:encryptedPassword` triples | **1,302** |

Untracked, and `git log` shows they were never committed, so **this is not a
publication** — but it is every production credential, in the clear, in a
working copy.  They were **not** in `.gitignore`: one `git add -A` would have
pushed all 1,298 to github.  They are ignored as of 2026-10-24
(`spocq/.gitignore`), which closes that path but changes nothing about the
copies that exist.

Whether these 1,298 accounts need rotation is **not a question this audit can
answer** — it depends on where this working copy has been: backups, other
machines, anyone who has had the tree.  Two things are worth doing regardless:

1. Move the exports out of the working copy, or encrypt them at rest.  A
   `.gitignore` entry protects against git, not against a copied directory.
2. If the export has ever left this machine, treat it as a full credential
   compromise of the service and rotate everything.

### 2.2  Other carriers of the `james` token

**`common.sh` — all 39 copies under `datagraph/`, converted 2026-10-25.**  A
tree-wide `find . -name common.sh` turned up seven working copies of spocq
beyond the one already fixed.  Every one is now on the same resolver, and the
block is byte-identical across all 39 (one sha over the extracted region).

| tree | remote | `common.sh` tracked |
|---|---|---|
| `spocq` | `github.com:lisp/spocq` | 6 |
| `spocq-mcp` | `github.com:lisp/spocq` | 6 |
| `spocq-gensrc` | `gitlab.dydra.com:bitfuse/spocq` | 6 |
| `spocq-gensrc-12` | `gitlab.dydra.com:bitfuse/spocq` | 6 |
| `spocq-tmp` | `gitlab.dydra.com:bitfuse/spocq` | 6 |
| `spocq-llm` | `github.com:lisp/spocq` | 0 (untracked) |
| `spocq-e4826228` | `gitlab.dydra.com:bitfuse/spocq` | 0 (untracked) |

So **30 of the 39 were tracked**, across both remotes — the exposure was wider
than the single tree first audited, though it is the same token in every copy.
`spocq/gensrc/` and `spocq/src/` were already converted on 2026-10-24; the
other 31 on 2026-10-25, including the two host-revision trees
(`spocq-e4826228`, `spocq-mcp`) and the push-source cache (`spocq-gensrc/`,
whose `/test/` is excluded by `push-source` and so would never have been
refreshed from `gensrc/`).

Verified across all 39: the literal is gone; each file still parses
(`bash -n`); `STORE_HOST` is assigned before the block in every one; unset
refuses and names the calling script, `STORE_TOKEN=''` runs anonymously,
`STORE_TOKEN=<v>` is honoured, and a `~/.dydra/<host>.<account>.token` file is
read when present.

**Still carrying it:** `spocq/src/client/service-ui/test-account-model-presentation copy.html`
(untracked, never committed).

---

## Part 3 — What was changed, so it cannot recur

| repository | file | change |
|---|---|---|
| jsui | `tests/credentials.js` **(new)** | resolver: env → `~/.dydra/<host>.<account>.password` → `~/.dydra/<account>.password` → **throw**; the same shape as the shell suites' `.token` files |
| jsui | `tests/test-helpers.js` | both login defaults resolve; no literal |
| jsui | `tests/{clean-test-repos.mjs,admin,zz-shot,accounts-pane,events,collaboration}` | resolve through the module |
| jsui | `doc/demo-dydra-studio.js` | env, exits 2 when unset |
| jsui | `instructions.md` | the credential table now says "none — raises when unset" |
| jsui | `tests-inst/*` (3) | literals replaced by the undefined identifier `REDACTED_SEE_TESTS_CREDENTIALS`, so the frozen copy fails rather than authenticates |
| jsui | `.gitignore` | `tests/credentials.local.json`, `.env.test` — kept only so a file created here by mistake cannot be committed; credentials belong in `~/.dydra/` |
| spocq | `gensrc/{mcp,graphql}/test/**/common.sh` (4) | `STORE_TOKEN`: env → `~/.dydra/<host>.<account>.token` → **exit 2**; `STORE_TOKEN=''` still means a deliberate anonymous run |
| spocq | `src/{mcp,graphql}/test/**/common.sh` (4) | the same, on request |
| spocq | `gensrc/patches/2026/verify-authn-patch.lisp` | `DYDRA_TEST_ACCOUNT` / `DYDRA_TEST_PASSWORD`, errors with no default |
| spocq | `.gitignore` | the metadata exports, `*.token`, `.dydra/` |

Verified both directions: with nothing configured each entry point stops and
names the variable; configured, the suites run unchanged (jsui unit 14/14
scripts, the three documented specs 8 passed / 3 skipped).

## Part 4 — Not done, and why

- **The git history is untouched** in both repositories.  Rewriting it
  (`filter-repo`, force-push, re-clone by everyone) is a decision with
  consequences for every clone; rotation is the fix that works without it.
- **No credential was tested for validity.**  Replaying a recovered token
  against live hosts is the thing the leak enables, so the audit stops at
  "the account exists on this host".
- **`spocq/gensrc-sparql-12/` and the HTML file** (Part 2.2) were left
  unchanged.
