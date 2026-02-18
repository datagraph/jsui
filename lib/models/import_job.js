export class ImportJob {
  constructor({ id, status = "idle", message = "" }) {
    this.id = id;
    this.status = status;
    this.message = message;
  }
}
