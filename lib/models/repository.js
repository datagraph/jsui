export class Repository {
  static _persistentProperties = [
    "homepage",
    "summary",
    "description",
    "abstract",
    "privacy_setting",
    "permissible_ip_addresses",
    "prefixes",
  ];

  static _editableProperties = [
    "homepage",
    "summary",
    "description",
    "abstract",
    "privacy_setting",
    "permissible_ip_addresses",
    "prefixes",
  ];

  constructor({
    id,
    accountId,
    name,
    friendlyId,
    summary = "",
    description = "",
    homepage = "",
    quadCount = 0,
    diskSize = "0 KB",
    license = "Unspecified",
    importStatus = null,
  }) {
    this.id = id;
    this.accountId = accountId;
    this.name = name;
    this.friendlyId = friendlyId;
    this.summary = summary;
    this.description = description;
    this.homepage = homepage;
    this.quadCount = quadCount;
    this.diskSize = diskSize;
    this.license = license;
    this.importStatus = importStatus;
  }

  rpcIdentifier(accountName) {
    return `${accountName}/${this.friendlyId}`;
  }
}
