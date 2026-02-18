import { Account } from "./models/account.js";
import { Repository } from "./models/repository.js";
import { Query } from "./models/query.js";
import { Invitation } from "./models/invitation.js";
import { Session } from "./models/session.js";
import { AuthStore } from "./auth_store.js";
import { ReplicationManager } from "./replication/replication_manager.js";
import { RdfStoreAdapter } from "./persistence/rdf_store_adapter.js";
import { sampleData } from "./sample_data.js";

export class AppState {
  constructor({ rdfClient } = {}) {
    this.session = new Session();
    this.session.load();
    this.authStore = new AuthStore();
    this.adapter = new RdfStoreAdapter({ rdfClient });
    this.replication = new ReplicationManager();
    this.accountTrackers = new Map();
    this.repositoryTrackers = new Map();
    this.openAccounts = new Set();
    this.openRepositories = [];
    this.openViews = [];
    this.cache = {
      accounts: sampleData.accounts.map((data) => new Account(data)),
      repositories: sampleData.repositories.map((data) => new Repository(data)),
      queries: sampleData.queries.map((data) => new Query(data)),
      invitations: sampleData.invitations.map((data) => new Invitation(data)),
    };

  }

  getCurrentAccount() {
    if (!this.session.accountName) return null;
    return this.cache.accounts.find((account) => account.friendlyId === this.session.accountName) || null;
  }

  async listAccounts() {
    const accounts = await this.adapter.listAccounts();
    return accounts?.length ? accounts : this.cache.accounts;
  }

  async getAccount(name) {
    if (!name) return null;
    const cached = this.cache.accounts.find((account) => account.friendlyId === name);
    if (cached) return cached;
    return this.adapter.getAccountByName(name);
  }

  async listRepositories(accountName = null) {
    const repos = await this.adapter.listRepositories(accountName);
    if (repos?.length) return repos;
    if (!accountName) return this.cache.repositories;
    const account = await this.getAccount(accountName);
    if (!account) return [];
    return this.cache.repositories.filter((repo) => repo.accountId === account.id);
  }

  async getRepository(accountName, repoName) {
    const repositories = await this.listRepositories(accountName);
    return repositories.find((repo) => repo.friendlyId === repoName) || null;
  }

  async listQueries(accountName, repoName) {
    const queries = await this.adapter.listQueries(accountName, repoName);
    if (queries?.length) return queries;
    const repository = await this.getRepository(accountName, repoName);
    if (!repository) return [];
    return this.cache.queries.filter((query) => query.repositoryId === repository.id);
  }

  async getQuery(accountName, repoName, queryName) {
    const queries = await this.listQueries(accountName, repoName);
    return queries.find((query) => query.friendlyId === queryName) || null;
  }

  async listInvitations() {
    const invitations = await this.adapter.listInvitations();
    return invitations?.length ? invitations : this.cache.invitations;
  }

  getAuthToken(accountName) {
    return this.authStore.getToken(accountName);
  }

  getAuthContext(accountName) {
    return this.authStore.getAuth(accountName);
  }

  setAccountFromConfig(accountName, config) {
    const existing = this.cache.accounts.find((account) => account.friendlyId === accountName);
    if (existing) {
      existing.email = config.email || existing.email;
      existing.fullname = config.fullname || existing.fullname;
      return existing;
    }
    const account = new Account({
      id: this.cache.accounts.length + 1,
      friendlyId: accountName,
      name: accountName,
      email: config.email,
      fullname: config.fullname || accountName,
    });
    this.cache.accounts.push(account);
    return account;
  }

  getAuthenticatedAccounts() {
    return this.authStore.listAccounts();
  }

  addOpenAccount(accountName) {
    if (!accountName) return;
    this.openAccounts.add(accountName);
  }

  addOpenRepository(accountName, repositoryName) {
    if (!accountName || !repositoryName) return;
    const exists = this.openRepositories.some(
      (item) => item.accountName === accountName && item.repositoryName === repositoryName
    );
    if (!exists) {
      this.openRepositories.push({ accountName, repositoryName });
    }
  }

  listOpenAccounts() {
    return Array.from(this.openAccounts);
  }

  listOpenRepositories() {
    return [...this.openRepositories];
  }

  addOpenView(accountName, repositoryName, viewName) {
    if (!accountName || !repositoryName || !viewName) return;
    const exists = this.openViews.some(
      (item) => item.accountName === accountName && item.repositoryName === repositoryName && item.viewName === viewName
    );
    if (!exists) {
      this.openViews.push({ accountName, repositoryName, viewName });
    }
  }

  listOpenViews() {
    return [...this.openViews];
  }

  removeOpenView(accountName, repositoryName, viewName) {
    this.openViews = this.openViews.filter(
      (item) => !(item.accountName === accountName && item.repositoryName === repositoryName && item.viewName === viewName)
    );
  }

  ensureAccountTracker(accountName, config = {}) {
    if (!accountName) return null;
    const existing = this.accountTrackers.get(accountName);
    if (existing) {
      this.replication.replaceState(existing, config);
      return existing;
    }
    const tracker = this.replication.ensureObject({
      className: "AccountConfig",
      identifier: `account:${accountName}`,
      state: config,
      persistentProps: Account._persistentProperties,
      editableProps: Account._editableProperties,
    });
    this.accountTrackers.set(accountName, tracker);
    return tracker;
  }

  ensureRepositoryTracker(accountName, repositoryName, config = {}) {
    if (!accountName || !repositoryName) return null;
    const key = `${accountName}/${repositoryName}`;
    const existing = this.repositoryTrackers.get(key);
    if (existing) {
      this.replication.replaceState(existing, config);
      return existing;
    }
    const tracker = this.replication.ensureObject({
      className: "RepositoryConfig",
      identifier: `repository:${accountName}/${repositoryName}`,
      state: config,
      persistentProps: Repository._persistentProperties,
      editableProps: Repository._editableProperties,
    });
    this.repositoryTrackers.set(key, tracker);
    return tracker;
  }

  getAccountTracker(accountName) {
    return this.accountTrackers.get(accountName) || null;
  }

  getRepositoryTracker(accountName, repositoryName) {
    const key = `${accountName}/${repositoryName}`;
    return this.repositoryTrackers.get(key) || null;
  }

  removeOpenAccount(accountName) {
    if (!accountName) return;
    this.openAccounts.delete(accountName);
    this.openRepositories = this.openRepositories.filter((item) => item.accountName !== accountName);
    this.accountTrackers.delete(accountName);
  }

  removeOpenRepository(accountName, repositoryName) {
    if (!accountName || !repositoryName) return;
    this.openRepositories = this.openRepositories.filter(
      (item) => !(item.accountName === accountName && item.repositoryName === repositoryName)
    );
    this.repositoryTrackers.delete(`${accountName}/${repositoryName}`);
  }
}
