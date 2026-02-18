export const sampleData = {
  accounts: [
    {
      id: 1,
      friendlyId: "jhacker",
      name: "jhacker",
      email: "jhacker@example.com",
      fullname: "Jane Hacker",
      homepage: "http://example.com",
      blog: "http://example.com/blog",
      company: "Example Corp",
      balance: 0,
      authenticationToken: "sample-token",
    },
  ],
  repositories: [
    {
      id: 1,
      accountId: 1,
      name: "foaf",
      friendlyId: "foaf",
      summary: "A sample FOAF dataset.",
      description: "Example repository description.",
      homepage: "http://example.com/foaf",
      quadCount: 10,
      diskSize: "42 KB",
      license: "CC-BY",
    },
  ],
  queries: [
    {
      id: 1,
      repositoryId: 1,
      name: "All Triples",
      friendlyId: "all-triples",
      summary: "Selects all triples.",
      queryText: "SELECT * WHERE { ?s ?p ?o } LIMIT 10",
      running: false,
    },
  ],
  invitations: [
    {
      id: 1,
      email: "newuser@example.com",
      inviteCode: "INVITE-001",
      httpReferrer: "http://blog.dydra.com/",
      accountName: "",
    },
  ],
};
