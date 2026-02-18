import { PersistenceAdapter } from "./adapter.js";

export class RdfStoreAdapter extends PersistenceAdapter {
  constructor({ rdfClient }) {
    super();
    this.rdfClient = rdfClient;
  }

  async getAccountByName(name) {
    if (!this.rdfClient) {
      return null;
    }
    return this.rdfClient.getAccount(name);
  }

  async listAccounts() {
    if (!this.rdfClient) {
      return [];
    }
    return this.rdfClient.listAccounts();
  }

  async listRepositories(accountName) {
    if (!this.rdfClient) {
      return [];
    }
    return this.rdfClient.listRepositories(accountName);
  }

  async getRepository(accountName, repositoryName) {
    if (!this.rdfClient) {
      return null;
    }
    return this.rdfClient.getRepository(accountName, repositoryName);
  }

  async listQueries(accountName, repositoryName) {
    if (!this.rdfClient) {
      return [];
    }
    return this.rdfClient.listQueries(accountName, repositoryName);
  }

  async getQuery(accountName, repositoryName, queryName) {
    if (!this.rdfClient) {
      return null;
    }
    return this.rdfClient.getQuery(accountName, repositoryName, queryName);
  }

  async listInvitations() {
    if (!this.rdfClient) {
      return [];
    }
    return this.rdfClient.listInvitations();
  }
}
