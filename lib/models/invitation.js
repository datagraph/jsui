export class Invitation {
  constructor({ id, email, inviteCode = "", httpReferrer = "", accountName = "" }) {
    this.id = id;
    this.email = email;
    this.inviteCode = inviteCode;
    this.httpReferrer = httpReferrer;
    this.accountName = accountName;
  }
}
