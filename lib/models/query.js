export class Query {
  constructor({
    id,
    repositoryId,
    name,
    friendlyId,
    slug = null,
    summary = "",
    queryText = "",
    running = false,
  }) {
    this.id = id;
    this.repositoryId = repositoryId;
    this.name = name;
    this.friendlyId = friendlyId;
    this.slug = slug;
    this.summary = summary;
    this.queryText = queryText;
    this.running = running;
  }
}
