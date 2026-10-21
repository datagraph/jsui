/**
 * The interaction budget: what a PAGE may spend, as against what a MODEL may.
 *
 * Answers open question 3 of `ui-generator.md' §15, which the parameter work
 * (D-X, U-33) made urgent rather than theoretical.
 *
 * The grant (D-O, `lib/llm/grant.js') screens the model's tool calls.  It was
 * never asked about the interface's own runs, and it was right not to be: a
 * panel run at Gate 1 is the user pressing a button on a query they have just
 * read.  But a parameterised page re-runs a panel every time a reader turns a
 * selector, and those runs are nobody's decision in particular -- the user
 * authorised the QUERY, once, and then a control they did not write issues it
 * again and again, for as long as the page is open, under their token, with
 * no meter moving anywhere.  `refresh()' could always do this; a selector
 * makes it ordinary rather than deliberate, and ordinary is what needs a
 * number on it.
 *
 * So: a second budget, and the three ways it differs from the grant are the
 * whole design.
 *
 *   IT IS NOT AUTHORITY.  Every call it covers is a query the user already
 *   authorised at Gate 1, character for character (D-X).  Nothing here can
 *   widen what runs; it bounds HOW OFTEN.  That is why exceeding it is not a
 *   gate and not a refusal to be argued with -- it is a meter reaching its
 *   mark, and the remedy is a button.
 *
 *   IT IS RENEWABLE, and renewal asks nobody anything.  A grant widened is a
 *   user granting more authority; a budget renewed is a user saying "yes, go
 *   on" about work they have already approved.  Renewals are COUNTED,
 *   because the count is the real signal: a page renewed five times is not a
 *   page that needs a larger number, it is a page whose shape is wrong, and
 *   the number would hide that.
 *
 *   IT IS CHARGED BEFORE THE CALL, exactly as the grant is.  A refusal after
 *   the store has been read is not a limit, it is a complaint.
 *
 * What it deliberately is NOT is a rate limit.  A page with a bug that calls
 * `run' in a loop will spend its runs at once and then show refusals, which
 * is visible and recoverable; a rate limit would spread the same bug over an
 * afternoon and make it look like the store being slow.  The quantity is the
 * honest shape: it says what a page cost, not how fast it cost it.
 */

/** What a page may ask for before anyone has to say "go on". */
export const DEFAULT_INTERACTION = {
  // Thirty is a reader turning a three-value selector ten times, which is a
  // session; it is not a page redrawing itself on every keystroke, which is a
  // page that should be told so.
  maxRuns: 30,
  maxRows: 200000,
  maxBytes: 8 * 1024 * 1024,
  // What one press of the button adds.  The same as the initial allowance, so
  // "allow more" means "as much again" and needs no arithmetic from the user.
  renewal: 30,
};

/**
 * A budget.  Small and synchronous, like the grant: the pane reads `state()'
 * to paint a meter on every change and must not have to await anything.
 */
export function createInteractionBudget(spec = {}, { onChange = () => {} } = {}) {
  const limits = { ...DEFAULT_INTERACTION, ...spec };
  const spent = { runs: 0, rows: 0, bytes: 0 };
  const events = [];
  let renewals = 0;

  const note = (event) => {
    const e = { at: new Date().toISOString(), ...event };
    events.push(e);
    try { onChange(e, api); } catch { /* a meter that throws must not stop a page */ }
    return e;
  };

  const remaining = () => ({
    runs: Math.max(0, limits.maxRuns - spent.runs),
    rows: Math.max(0, limits.maxRows - spent.rows),
    bytes: Math.max(0, limits.maxBytes - spent.bytes),
  });

  /**
   * Why this request may not proceed, or null.
   *
   * The wording matters more here than in most refusals, because it is shown
   * inside the page, next to the control the reader just touched.  It has to
   * say what was spent, that nothing is wrong, and what to do -- in that
   * order, because a reader who thinks they have broken something stops.
   */
  function refusalFor(runs) {
    const want = Math.max(1, Number(runs) || 1);
    if (spent.runs + want > limits.maxRuns) {
      return `this page has used its ${limits.maxRuns} interactive run(s). `
           + `Nothing is wrong and nothing is lost — the queries behind it are the ones `
           + `you approved, and the interface will run them again as soon as you allow more.`;
    }
    if (spent.bytes >= limits.maxBytes) {
      return `this page has read its ${Math.round(limits.maxBytes / 1024)} KiB of results. `
           + `Allow more in the pane to keep going.`;
    }
    if (spent.rows >= limits.maxRows) {
      return `this page has read its ${limits.maxRows} rows. `
           + `Allow more in the pane to keep going.`;
    }
    return null;
  }

  const api = {
    get limits() { return { ...limits }; },
    get spent() { return { ...spent }; },
    get renewals() { return renewals; },
    get events() { return events.slice(); },
    get exhausted() { return remaining().runs === 0; },

    /**
     * May the page have this?  Charges the runs when it may.
     *
     * `runs' is more than one for a `refresh', which re-runs the whole set:
     * charging that as a single interaction would make the cheapest thing a
     * page can ask for and the most expensive cost the same, and a reader
     * holding down a refresh button would never reach the meter.
     */
    check({ runs = 1, panel = null, parameters = null } = {}) {
      const reason = refusalFor(runs);
      if (reason) {
        note({ type: "refused", panel, parameters, reason });
        return { ok: false, reason };
      }
      spent.runs += Math.max(1, Number(runs) || 1);
      note({ type: "charged", panel, parameters, runs: spent.runs, remaining: remaining() });
      return { ok: true, reason: null };
    },

    /** What it actually cost, once it is back.  Never refuses: it is spent. */
    chargeResult({ rows = 0, bytes = 0 } = {}) {
      spent.rows += Math.max(0, Number(rows) || 0);
      spent.bytes += Math.max(0, Number(bytes) || 0);
      note({ type: "spent", rows: spent.rows, bytes: spent.bytes, remaining: remaining() });
      return remaining();
    },

    /**
     * Allow more.  Additive, upward only, and counted.
     *
     * Upward only for the same reason the grant widens only upward: a dialog
     * that could also narrow would let authority be taken away by something
     * the user read as giving it.  Here it would be worse than with the
     * grant, because the user pressing this button is saying yes, and a yes
     * that quietly means less is not a thing to build.
     */
    renew(patch = {}) {
      const changed = {};
      const add = { maxRuns: patch.runs ?? limits.renewal,
                    maxRows: patch.rows ?? 0, maxBytes: patch.bytes ?? 0 };
      for (const [key, value] of Object.entries(add)) {
        const n = Math.max(0, Number(value) || 0);
        if (!n) continue;
        changed[key] = [limits[key], limits[key] + n];
        limits[key] += n;
      }
      if (Object.keys(changed).length) {
        renewals += 1;
        note({ type: "renewed", changed, renewals, limits: { ...limits },
               remaining: remaining() });
      }
      return changed;
    },

    remaining,

    /** Everything a meter, a page or a record needs, in one read. */
    state() {
      return { limits: { ...limits }, spent: { ...spent }, remaining: remaining(), renewals };
    },

    /** One line, for the meter and for the record. */
    summary() {
      const left = remaining();
      return `${spent.runs} of ${limits.maxRuns} interactive run(s)`
           + `${renewals ? `, renewed ${renewals}×` : ""}`
           + ` · ${spent.rows} rows · ${Math.round(spent.bytes / 1024)} KiB`
           + `${left.runs ? "" : " — spent"}`;
    },
  };
  return api;
}

/**
 * What the PAGE is told, which is less than what the pane knows.
 *
 * The page gets the counts so a control can be honest about being spent --
 * `select' disables itself rather than offering a choice that will be
 * refused -- and nothing else.  It does not get the events, because a page
 * does not need to know when its reader was refused twenty minutes ago, and
 * it does not get the object, because a page that could call `renew' would
 * make the button a decoration.
 */
export function budgetForPage(budget) {
  if (!budget) return null;
  const s = budget.state();
  return { runs: s.spent.runs, maxRuns: s.limits.maxRuns, remaining: s.remaining.runs,
           exhausted: s.remaining.runs === 0 };
}

export default createInteractionBudget;
