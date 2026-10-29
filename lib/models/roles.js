/**
 * Who the authenticated agent is, and therefore what the interface offers.
 *
 * REQ-1.1.5.  The "account metadata admin flag" is not a column: the `admin'
 * field was dropped from the accounts table by the rails migration
 * 20150426022900, and what replaced it is an RDF statement in the account's
 * own metadata -- `sioc:administrator_of' naming the service the account
 * administers.  The server surfaces it in the configuration document, where
 * `configuration-as' turns every predicate into its IRI local part, so the
 * client sees it as the key `administrator_of'.
 *
 * It was read in exactly one place before this module -- an expression inside
 * the admin app's login handler -- which meant the user app could not tell an
 * administrator from anyone else, and the one reading there was both
 * undocumented and untested.  Hence a module: the derivation is small, it is
 * security-relevant, and two applications need the same answer.
 *
 * What this is NOT: authorization.  The server decides what an agent may do
 * and answers 401 or 404 when it may not (REQ-20.2.4 says the same thing of
 * the LLM).  These predicates decide what the interface OFFERS -- whether a
 * delete control is drawn at all.  A control that is drawn and then refused
 * is a worse interface than one that was never drawn, and a control that is
 * NOT drawn is not a security measure.  Both halves matter: never treat a
 * false from here as protection, and never treat a true as permission.
 */

/** The service an administrator is an administrator OF. */
export const SERVICE_IRI = "http://dydra.com";

/** Role names, in increasing order of what they may do. */
export const ROLES = { USER: "user", OWNER: "owner", ADMINISTRATOR: "administrator" };

/** Compare two IRIs for the purpose of the flag: case and trailing slash are noise. */
const sameIri = (a, b) =>
  String(a || "").trim().replace(/\/+$/, "").toLowerCase()
  === String(b || "").trim().replace(/\/+$/, "").toLowerCase();

/**
 * Every service the configuration says this account administers.
 *
 * The value arrives as a string when there is one and an array when there are
 * several -- a JSON document built from RDF statements has no way to say
 * "always a list", and a reader that assumes either shape is wrong half the
 * time.  Absent, null and "" all mean none.
 */
export function administratorOf(configuration) {
  const raw = configuration?.administrator_of ?? configuration?.administratorOf ?? null;
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((x) => String(x || "").trim()).filter(Boolean);
}

/** REQ-1.1.5: the flag is set, for this service. */
export function isAdministrator(configuration, { service = SERVICE_IRI } = {}) {
  return administratorOf(configuration).some((iri) => sameIri(iri, service));
}

/**
 * The role an agent holds with respect to one account.
 *
 * `accountName' is who is authenticated; `subject' is the account being looked
 * at.  Owner means the two are the same account, which is the only ownership
 * this interface can establish without asking the server a second question.
 */
export function roleOf({ configuration = null, accountName = null, subject = null } = {}) {
  if (isAdministrator(configuration)) return ROLES.ADMINISTRATOR;
  if (accountName && subject && String(accountName) === String(subject)) return ROLES.OWNER;
  return ROLES.USER;
}

/**
 * What the interface may offer, given a role.
 *
 * Deleting an account excludes the agent's own account (REQ-2.6.1).  Not
 * because the server forbids it -- it may well permit it -- but because an
 * administrator who deletes the account they are authenticated as is left
 * holding a token for something that no longer exists, with no way back in,
 * and no confirmation dialog makes that recoverable.
 */
export function capabilities({ role = ROLES.USER, accountName = null } = {}) {
  const admin = role === ROLES.ADMINISTRATOR;
  const owner = admin || role === ROLES.OWNER;
  return {
    role,
    /** REQ-2.4.4: an administrator sees every account; everyone else sees their own. */
    mayListAllAccounts: admin,
    /** REQ-2.6.1 */
    mayDeleteAccount: (subject) => admin && !!subject && String(subject) !== String(accountName),
    /** REQ-3.9.1, REQ-3.9.2 */
    mayDeleteRepository: (subject) =>
      admin || (owner && !!subject && String(subject) === String(accountName)),
    /** REQ-4.5.1: views belong to the repository, so the repository's owner. */
    mayDeleteView: (subject) =>
      admin || (owner && !!subject && String(subject) === String(accountName)),
  };
}

/** The whole derivation in one call, for a caller that holds auth and a name. */
export function agentRole({ configuration = null, accountName = null, subject = null } = {}) {
  const role = roleOf({ configuration, accountName, subject: subject ?? accountName });
  return { role, administrator: role === ROLES.ADMINISTRATOR,
           ...capabilities({ role, accountName }) };
}

export default agentRole;
