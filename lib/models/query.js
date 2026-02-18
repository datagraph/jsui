export class Query {
  constructor({
    id,
    repositoryId,
    name,
    friendlyId,
    summary = "",
    queryText = "",
    running = false,
  }) {
    this.id = id;
    this.repositoryId = repositoryId;
    this.name = name;
    this.friendlyId = friendlyId;
    this.summary = summary;
    this.queryText = queryText;
    this.running = running;
  }
}
