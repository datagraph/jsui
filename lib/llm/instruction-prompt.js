/**
 * What the model is told when the instruction came from the location bar
 * (U-76, item 3).
 *
 * The bar addresses two kinds of thing and they want different prompts, for
 * a reason worth stating rather than discovering: a presentation has data —
 * panels, queries, parameters, a grant — and the chrome has none.  Sending
 * the dashboard contract when the target is the workspace would offer a
 * model a vocabulary of queries for a surface that cannot run one, and the
 * cheapest way for it to satisfy "add a panel for the open orders" would
 * then be to write a query into the furniture.
 *
 * So `instructionSystem' dispatches on the target's kind.  A presentation
 * takes the revision prompt it already had, which is how U-79 retires the
 * second implementation rather than adding a third: the Revise box and the
 * bar reach the same function with the same arguments, and the only
 * difference between them is who filled in the target.
 */

import { componentCatalog } from "../app/toolbox/catalog.js";
import { outlineOf } from "../app/tree.js";
import { WORKSPACE_HOSTS, IMMUTABLE_HOSTS, workspaceViewFor } from "../app/workspace.js";
import { REGIONS, REGION_KINDS, regionHost, regionViewName, requiredRegions }
  from "../app/regions.js";
import { revisionSystem, patchBudget, grantContract } from "./dashboard-prompt.js";

/**
 * The contract for a change to the chrome.
 *
 * Shorter than the dashboard contract on purpose.  Everything the model
 * could do here is arrangement, and the operations are the same six it
 * already knows; what it has to be told is what a host is, that it cannot
 * make one, and that most of them cannot be moved out of existence.
 */
export const WORKSPACE_CONTRACT = [
  "## Rearranging the interface itself",
  "",
  "The target of this instruction is the **workspace** — the interface's own",
  "layout, not a page it generated. It holds no data, runs no queries and has no",
  "parameters. Everything you can change here is arrangement.",
  "",
  "### Hosts",
  "",
  "Each band of the interface is a `host` element: it names a view the build",
  "already draws, and placing it says where that view goes. You cannot write what",
  "is inside one, and you cannot invent a host — the registered ones are:",
  "",
  `${WORKSPACE_HOSTS.map((h) => "`" + h + "`").join(", ")}.`,
  "",
  "A host naming anything else renders as an empty box with the reason on it,",
  "which is a visible fault and not a silent one — but it is still a fault.",
  "",
  "### Regions",
  "",
  "`content` is one band holding every open pane, and a pane's own parts are",
  "hosts in their turn (U-115). They are arranged in a SEPARATE VIEW of this",
  "same document, one per kind of pane, and a patch that means to move one must",
  "name that view:",
  "",
  REGION_KINDS.map((kind) =>
    `* \`${regionViewName(kind)}\` — `
    + REGIONS[kind].map((r) => "`" + regionHost(kind, r.region) + "`").join(", ")
    + (requiredRegions(kind).length
        ? `; \`${requiredRegions(kind).join("`, `")}\` may not be dropped`
        : "")).join("\n"),
  "",
  "What each one holds:",
  "",
  REGION_KINDS.flatMap((kind) => REGIONS[kind].map((r) =>
    `* \`${regionHost(kind, r.region)}\` — ${r.what}`)).join("\n"),
  "",
  "A region is the pane's part for EVERY instance of that kind: `repository:views`",
  "is the view list of every repository pane, not of one repository. There is no",
  "way to arrange one repository differently from another, and asking for one is",
  "worth saying so rather than approximating.",
  "",
  "A region of one pane cannot be placed beside a region of another: they are",
  "different panes, and only one of them is on the screen at a time.",
  "",
  "`results-pane` arranges the **results pane** (U-120), which is not a page of",
  "the service but a station reached by the Results tab \u2014 the graph icon \u2014 in the",
  "left margin of whichever pane is on the screen. It is where a reading sent out",
  "of a view's own result tabs is kept, and where a presentation moved there by",
  "name is held by reference until someone opens it. A repository pane has no",
  "results region: the result of running a view is in that view's own tabs, and",
  "what is KEPT is kept to be compared with readings from other repositories.",
  "That pane's own margin strip is its chrome and not one of its regions, so no",
  "arrangement places or moves it: showing the pane hides the margin the reader",
  "pressed, and the strip is the way back.",
  "",
  "The component catalogue below is the one used for pages, so several of its",
  "examples show `data-bound` regions. **There is nothing to bind here.** The",
  "workspace declares no panels, and an element that names one is refused — use",
  "the layout and text components for what they look like, not for what a page",
  "would put in them.",
  "",
  "### What you may do",
  "",
  "```patch",
  '[{"op": "set-layout", "element": "w-chrome",',
  '  "value": {"columns": "220px 1fr", "areas": ["header header", "tabs content", "footer location"]}},',
  ' {"op": "set-placement", "element": "w-tabs", "value": {"area": "tabs"}},',
  ' {"op": "move-element", "element": "w-location", "parent": "w-chrome"},',
  ' {"op": "insert-element", "parent": "w-chrome", "kind": "text",',
  '  "attributes": {"emphasis": "muted"}, "text": "staging", "area": "header"}]',
  "```",
  "",
  "```patch",
  '[{"op": "set-layout", "view": "repository-pane", "element": "r-repository-pane",',
  '  "value": {"columns": "1fr 1fr", "areas": ["views editors", "metadata summary"]}},',
  ' {"op": "set-placement", "view": "repository-pane", "element": "r-repository-metadata",',
  '  "value": {"area": "metadata"}}]',
  "```",
  "",
  "**Rearranging is one operation.** Rewrite the root's `areas` template; do not",
  "move every band. A band's `area` and the template's names are the only things",
  "that decide where it appears.",
  "",
  "### What you may not",
  "",
  `\`${IMMUTABLE_HOSTS.join("`, `")}\` are marked IMMUTABLE. They may not be`,
  "changed, removed, or left without an area in the template — the last of those",
  "is the one that looks like a layout change and is really a deletion, and it is",
  "refused the same way.",
  "",
  "This arrangement is **saved for the account and reloaded next time**. It is not",
  "a preview. If what was asked for would leave the interface hard to use, say so",
  "and propose something narrower rather than doing it and letting the user find",
  "out — though nothing is lost either way: every change is a revision, the bar",
  "offers an undo beside its reply, and `?workspace=default` restores the",
  "arrangement this build shipped with.",
].join("\n");

/** The chrome as it stands, as an outline. */
export function workspaceSummary(document, { page = "main" } = {}) {
  const v = workspaceViewFor(document, page);
  const lines = ["## The interface as it stands", "",
                 `Arrangement \`${v?.name || page}\`  ·  revision ${document?.revision ?? 1}`];
  if (!v || !v.elements?.length) {
    lines.push("", "(nothing is arranged yet — the build's default is on the screen)");
    return lines.join("\n");
  }
  lines.push("", outlineOf(v.elements));
  // The panes' arrangements, which are views of the same document and are
  // addressed by naming them.  Shown whether or not the instruction looks as
  // though it is about one: a model told only about the bands answers "the
  // view list is not something I can move" to a request that is one
  // `set-layout' away (U-115).
  for (const kind of REGION_KINDS) {
    const pane = (document?.views || []).find((x) => x?.name === regionViewName(kind));
    if (!pane || !pane.elements?.length) continue;
    lines.push("", `Arrangement \`${pane.name}\` — the parts of a ${kind} pane`,
               "", outlineOf(pane.elements));
  }
  return lines.join("\n");
}

/**
 * The whole system prompt for one instruction from the bar.
 *
 * `target.kind' chooses, and a presentation is routed to the prompt the
 * Revise box has used since phase 4 — deliberately the same call and not a
 * copy of it, because two prompts that are meant to stay identical do not.
 */
export function instructionSystem(base, {
  target = null, grant = null, document: doc = null, answerTokens = 0,
  request = "", page = "main",
} = {}) {
  if (target?.kind === "workspace") {
    return [base, WORKSPACE_CONTRACT,
            componentCatalog(request, { tier: 1 }),
            doc ? workspaceSummary(doc, { page }) : "",
            patchBudget(answerTokens), grantContract(grant)]
      .filter(Boolean).join("\n\n");
  }
  return revisionSystem(base, { grant, document: doc, answerTokens, request });
}

export default instructionSystem;
