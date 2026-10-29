/**
 * Delete controls appear where the role permits them, and nowhere else.
 *
 * REQ-2.6.1, REQ-3.9.1, REQ-3.9.2, REQ-4.5.1.  The controls themselves were
 * already drawn -- in six templates, unconditionally -- so any authenticated
 * user looking at another account's repositories was shown a trash can that
 * the server answers 401 to.  What the requirements ask for is not the
 * button; it is that the button belongs to the roles named.
 *
 * One pass over the rendered DOM, rather than a test inside each template.
 * The templates do not have the agent in scope, and a seventh template added
 * later would silently not be covered; a pass over everything is covered by
 * construction.
 *
 * THIS IS PRESENTATION, NOT PROTECTION.  The server authorises each of these
 * operations itself and refuses what this pass fails to remove.  Removing a
 * control keeps the interface honest about what the reader can do; it is not
 * what keeps anyone out.  Treating it as a security boundary would be the
 * mistake this comment exists to prevent.
 */

/** The three controls, and which capability each answers to. */
export const CONTROLS = [
  { selector: ".repo-delete-btn", capability: "mayDeleteRepository" },
  { selector: ".view-delete-btn", capability: "mayDeleteView" },
  { selector: ".account-delete-btn", capability: "mayDeleteAccount" },
];

/**
 * Remove every delete control the capabilities do not permit.
 *
 * Each control carries the account it would act on in `data-account'.  A
 * control with no such attribute is removed: a delete button that cannot say
 * what it would delete is not one a role check can clear, and leaving it is
 * the unsafe direction of the two.
 *
 * Returns what it did, so a caller — or a test — can assert on the decision
 * rather than on the absence of an element.
 */
export function applyDeletionPermissions(root, capabilities) {
  const removed = [];
  const kept = [];
  if (!root || !capabilities) return { removed, kept };
  for (const { selector, capability } of CONTROLS) {
    const permits = capabilities[capability];
    for (const btn of [...root.querySelectorAll(selector)]) {
      const account = btn.dataset?.account || "";
      const allow = typeof permits === "function" && account && permits(account);
      if (allow) kept.push({ selector, account });
      else { removed.push({ selector, account }); btn.remove(); }
    }
  }
  return { removed, kept };
}

export default applyDeletionPermissions;
