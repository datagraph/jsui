export class Account {
  static _persistentProperties = [
    "firstname",
    "familyname",
    "fullname",
    "email",
    "homepage",
    "blog",
    "company",
    "location",
    "phone",
    "skype_id",
    "jabber_id",
    "workinfo",
  ];

  static _editableProperties = [
    "firstname",
    "familyname",
    "fullname",
    "email",
    "homepage",
    "blog",
    "company",
    "location",
    "phone",
    "skype_id",
    "jabber_id",
    "workinfo",
  ];

  constructor({
    id,
    friendlyId,
    name,
    email,
    fullname,
    homepage,
    blog,
    company,
    balance = 0,
    authenticationToken = "",
  }) {
    this.id = id;
    this.friendlyId = friendlyId;
    this.name = name;
    this.email = email;
    this.fullname = fullname;
    this.homepage = homepage;
    this.blog = blog;
    this.company = company;
    this.balance = balance;
    this.authenticationToken = authenticationToken;
  }

  displayName() {
    return this.fullname || this.friendlyId || this.name;
  }

  gravatarUrl(size = 48) {
    return `https://secure.gravatar.com/avatar/00000000000000000000000000000000?s=${size}&d=mm`;
  }
}
