import { GraphObject } from "./graph-object.js";

export class ReplicationManager {
  constructor() {
    this.localReplicator = {};
  }

  ensureObject({ className, identifier, state = {}, persistentProps = [], editableProps = [] }) {
    let Class = GraphObject.getClass(className);
    if (!Class && typeof window !== "undefined") {
      Class = window[className];
    }
    if (!Class) {
      Class = class extends GraphObject {};
      GraphObject.setClass(className, Class);
      if (typeof window !== "undefined") {
        window[className] = Class;
      }
    }
    Class.prototype._persistentProperties = persistentProps;
    Class.prototype._editableProperties = editableProps;
    const obj = GraphObject.createObject(className, identifier, state);
    obj._replicator = this.localReplicator;
    obj.setStateClean();
    return obj;
  }

  replaceState(obj, state = {}) {
    if (!obj) return;
    obj._replicator = null;
    Object.entries(state).forEach(([key, value]) => {
      obj[key] = value;
    });
    obj._replicator = this.localReplicator;
    obj.setStateClean();
  }
}
