// Copyright (c) 2019 datagraph gmbh

/**
 @overview
The class GraphObject is an abstract class which wraps each
instance in a proxy to mediate property access and implement a jdo/jpa-like
state machine to control instance.
The logic distinguishes detached/attached situations wrt a GraphDatabase
and, for attached objects, constrcts for them a delta map and uses that cache
upon tranaction completion to propagate changes to the respective remote
storage service.

The state graph is a reduced version of the JDO space which corresponds to
that model's 'persistent' states, and the 'transient' realm of that JDO space
does not figure in this implementation.

That is, the reduced space includes just
    new
    clean
    dirty
    deleted
of which new is unattached and the others describe attached states.
equivalents.

see:
    https://db.apache.org/jdo/state_transition.html,
    https://en.wikipedia.org/wiki/Java_Persistence_API
  
For GraphObject instances, when the object is attached,
- writes to persistent properties generate delta maps
- side-effect the state.
*/

/**
 Encapsulate an error due to an invalid operation.
 @extends Error
 */
export class GraphStateError extends Error {
  constructor(state, operation) {
    super(`Operation (${operation}) is ìnvalid in state (${state}).`);
    this.state = state;
    this.operation = operation;
  }
}

/**
 * The class GraphObject is the abstract root class for all managed objects.
 * @abstract
 * 
 * It wraps instances in handlers which administer the instance state with two data structures:
 * deltas and patches.
 * Deltas hold the changes to the object state since the last transaction.
 * They are used as the basis for patches, which are communicated to the remote store
 * when a transaction is committed, and to roll-back the object state when a transaction is aborted.
 * The are represented as a map of property names to pairs of values - the new and the old.
 * Patches hold changes to the object state to be communicated to the remote store.
 * They are represented as an object with three properties: post, put, and delete.
 * Each property is an array of statements, where a statement is an triple of the instance
 * identifier, the field name and a field value. 
 * The value is either a singleton or is an array if the field is multi-valued.
 * The singleton values is either atomic or a reference to another instance.
 * 
 *
 * @typedef {Object<string, [any, any]>} Deltas in the arrangement [new, old]
 * @typedef [Iri, string, any] Statement
 * @typedef {Object} Patch
 * @property statement[] delete
 * @property statement[] post
 * @property statement[] put
 */

export class GraphObject {
  constructor (options) {
    var handler = this.initializeState(this.createHandler(this));
    this.initializeInstance(options);
    return this.createProxy(this, handler);
  }


  /**
   * Initialize the handler meta-properties.
   * 
   * @param {Object} [handler=this._handler] - The handler object.
   * @param {Object} [options={state: GraphObject.stateNew}] - Initialization options.
   * @returns {Object} - The initialized handler.
   */
  initializeState(handler = this._handler, options = {state: GraphObject.stateNew}) {
    handler._deltas = {}; // Initialize as an object
    handler._identifier = undefined;
    handler._state = options.state;
    /** hold the store instance to which this instance is attached */
    handler._replicator = null;
    handler._self = this;
    return (handler);
  }


  /**
   * Perform general initialization out-of-line.
   * 
   * @param {Object} options - Initialization options.
   */
  initializeInstance(options) {}


  /**
   * 
   * Create the proxy which wraps the target instance and manages its property access.
   *   The final step of {@link GraphObject} base constructor invokes these to
   create the proxy which wraps the target instance and manages its property
   access. It excludes those which begin with '_' and limits control to
   {@link GraphObject#persistentProperties}, if specified.
   {@link Object#set} is augmented to record modifcations and
   {@link Object#get} can be augmented perform property-specific retrieval.
   Set modifies instance state as a side-effect.
   As a special case, given get('_self'), it returns the target instance.
   * @param {Object} target - The target instance.
   * @param {Object} handler - The handler object.
   * @returns {Proxy} - The created proxy.
 
   */
  createProxy(target, handler) {
    return (new Proxy(target, handler));
  }

  /**
   * Create the handler for the target instance.
   * 
   * @param {Object} object - The target instance.
   * @returns {Object} - The created handler.
   */
  createHandler (object) {
  var handler = {
    get(target, name) {
      // console.debug("handled get", target, name)
      if (name == "_handler") { return (handler); }
      if (handler.hasOwnProperty(name)) { return (handler[name]); }
      return (target[name])
    },

    set(target, name, value) {
      console.debug("GraphObject.set")
      if (name == "_handler") { throw new GraphStateError(true, "set"); }
      if (handler.hasOwnProperty(name)) { handler[name] = value; return true;}
      var properties = target.constructor.persistentProperties();
      console.debug("GraphObject.set: handling", target, name, value, handler._replicator)
      if (handler._replicator) {
        // if the instance is attached
        if (properties.includes(name)) { 
          // ... and the property is persistent then record the change
          switch (handler._state) {
            case GraphObject.stateClean:
              handler._state = GraphObject.stateModified;
              break;
            case GraphObject.stateDeleted:
              throw new GraphStateError(handler._state, "set: invalid state");
            case GraphObject.stateModified:
              break;
            default:
              throw new GraphStateError(handler._state, "set: invalid state");
          }
          // if the instance is attached, then record deltas
          console.debug('persistent set');
          var oldValue = target[name];
          if (oldValue != value ) {
            var deltas = handler._deltas;
            if (! deltas) {
              deltas = {};
              handler._deltas = deltas;
            }
            var delta = deltas[name];
            handler._state = GraphObject.stateModified;
            if (delta) {
              if (delta[1] == value) {
                // if setting back to the original value, delete the entry
                delete deltas[name]; // Correct deletion
              } else {
                // otherwise replace the new value
                delta[0] = value;
              }
            } else {
              // iff this is the first change, record [new,old]
              delta = [value, oldValue];
              deltas[name] = delta;
            }
          }
        } else {
          // just allow the change
        }
      }
      // set the property
      target[name] = value;
      return true;
    },
  }
  return(handler);
  }


  /**
   The getter return a property which serves as the identity in the store.
   The value should be suitable to act as both an object and a map key.
   */
  getIdentifier () {
    return (this._identifier);
  }
  
  /**
   * Set the identifier for the instance.
   * The setter must record a value suitable as the instance identity in the store.
   * @abstract
   * @param {string} value - The identifier value.
   */
  setIdentifier (value) {
    this._identifier = value;
  }

  replicator() {
    return (this._replicator);
  }

  /**
   * Set the replicator for the instance.
   * 
   * @param {Object} replicator - The replicator object.
   */
  setReplicator(replicator) {
    this._replicator = replicator;
  }

  /**
   Return the current instance state, ["clean", "deleted", "dirty", "new"],
   to reflect the correspondence between the instance state and that in the
   store.
   The state is held in the handler.
   */
  state() {
    return (this._state);
  }

  deltas() {
    return (this._deltas);
  }

  /* record the state in the proxy */
  setStateClean() {
    this._deltas = {};
    this._state = GraphObject.stateClean;
  }

  /* record the state in the proxy */
  setStateDeleted() {
    this._state = GraphObject.stateDeleted;
  } 

  /* record the state in the proxy */
  setStateModified() {
    this._state = GraphObject.stateModified;
  } 

  /* record the state in the proxy */
  setStateNew() {
    this._state = GraphObject.stateNew;
  } 

  /**
   * Accept a delta-array with the state of the new instance.
   * Mark the instance as clean as it is consistent with the deltas source.
   * 
   * @param {Object} deltas - The delta array.
   */
  oncreate(deltas) {
    console.debug('GraphObject.oncreate', this);
    this.rollforward(deltas);
    this.setStateClean();
    }

  /**
   * Accept a delta-array with changes to the state of the new instance.
   * Mark the instance as clean as it is consistent with the deltas source.
   * 
   * @param {Delta} deltas - The delta array.
   */
  onupdate(deltas) {
    console.debug('GraphObject.onupdate', this);
    this.rollforward(deltas);
    this.setStateClean(); 
   }

  /**
   * Remove fields from the instance.
   * 
   * @param {Object} deltas - The delta array.
   */
  ondelete(deltas) {
    var self = this._self;
    Object.entries(deltas).forEach(function([name, values]) {
      // console.debug('ondelete', name, values);
      // remove the property
      if (self.hasOwnProperty(name)) {
        delete self[name];
      }
    });
  }

  /**
   Return an array of the values of persistent properties.
   Operate on _self in order to skip wrapper.
   */
  persistentValues() {
        var self = this._self || this;
    var names = self.persistentProperties();
    var values = [];
    names.forEach(function(name) { 
      values.push(self[name]);
    });
    return (values);
  }

  /**
   * Return an array of the names of persistent properties.
   * Those are the properties which are stored in the database.
   * @returns string[];
   */
  persistentProperties() {
    var self = this._self || this;
    return (self.constructor.persistentProperties());
   }

  /**
   * Return an array of the names of editable properties.
   * Those are the properties which can be modified by the user in an interface.
   * @returns string[];
   */
  editableProperties() {
    var self = this._self || this;
    return (self.constructor.editableProperties());
  }

  /**
   compute the put/patch/delete patch given the object state
   implement as properties of the base function to permit extension
   */
  asPatch() {
    console.debug('GraphObject.asPatch');
    return (GraphObject.asPatch(this));
  }

  /**
   * 
   * @returns 
   */
  asNewPatch() {
    console.debug('GraphObject.asStatePatch');
    return (GraphObject.asNewPatch(this));
  }

  /**
   * Use a deltas array to restore the state of the target instance.
   * Restrict the rollback to the persistent properties.
   * 
   * @param {Object} [deltas=this._deltas] - The delta array.
   * @returns {Object} - The delta array.
   */
  rollback(deltas = this._deltas) {
    var self = this._self;
    var props = self.persistentProperties();
    console.debug('rollback', self, deltas, "props", props);
    Object.entries(deltas).forEach(function([name, values]) {
      // console.debug('rollback', name, values);
      if (props.includes(name)) {
        var oldValue = values[1];
        self[name] = oldValue;
      }
    });
    this.setStateClean();
    return (deltas);
  }

  /**
   * Use a delta array to assert the new state of the target instance.
   * The rollforward applies to all properties - not just the persistent ones.
   * 
   * @param {Object} [deltas=this._deltas] - The delta array.
   * @returns {Object} - The delta array.
   */
  rollforward(deltas = this._deltas) {
    var self = this._self;
    console.debug('rollforward', self, deltas);
    Object.entries(deltas).forEach(function([name, values]) {
      // console.debug('rollforward', name, values);
      var newValue = values[0];
        self[name] = newValue;
    });
    // console.debug('rollforward.end', this);
    this._deltas = {}; // Reset to an empty object
    return (deltas);
  }

  // delegate to class for property definition access
  get propertyDefinitions () {
    console.debug("GraphObject.propertyDefinitions", this, this.constructor.name, this.constructor.propertyDefinitions)
    return (this.constructor.propertyDefinitions);
  }

  /**
   * Get the property definition for the given designator.
   * 
   * @param {string} designator - The property designator.
   * @returns {Object} - The property definition.
   */
  getPropertyDefinition(designator) {
    return (this.propertyDefinitions.get(designator));
  }

  /**
   * Set the property definition for the given designator.
   * 
   * @param {string} designator - The property designator.
   * @param {Object} definition - The property definition.
   */
  setPropertyDefinition(designator, definition) {
    this.propertyDefinitions.set(designator, definition);
  }

  /**
   * Get the property name for the given designator.
   * 
   * @param {string} designator - The property designator.
   * @returns {string} - The property name.
   */
  getPropertyName (designator) {
    console.debug("getPropertyName", this.propertyDefinitions, designator, typeof designator);
    return ((this.getPropertyDefinition(designator) || {}).name)
  }

  /**
   * Set the property name for the given designator.
   * 
   * @param {string} designator - The property designator.
   * @param {string} value - The property name.
   */
  setPropertyName (designator, value) {
    var definition = this.getPropertyDefinition(designator);
    if (!definition) {
      definition = {};
      this.setPropertyDefinition(designator, definition);
    }
    return(definition.name = value);
  }

  /**
   * Get the property identifier for the given designator.
   * 
   * @param {string} designator - The property designator.
   * @returns {string} - The property identifier.
   */
  getPropertyIdentifier(designator) {
    return (this.constructor.getPropertyIdentifier(designator));
  }

  /**
   * Set the property identifier for the given designator.
   * 
   * @param {string} designator - The property designator.
   * @param {string} value - The property identifier.
   */
  setPropertyIdentifier(designator, value) {
    return (this.constructor.setPropertyIdentifier(designator, value));
  }

  /**
   * Get the property type for the given designator.
   * 
   * @param {string} designator - The property designator.
   * @returns {string} - The property type.
   */
  getPropertyType(designator) {
    return (this.constructor.getPropertyType(designator));
  }

  /**
   * Set the property type for the given designator.
   * 
   * @param {string} designator - The property designator.
   * @param {string} value - The property type.
   */
  setPropertyType(designator, value) {
    return (this.constructor.setPropertyType(designator, value));
  }
}

GraphObject.classes = {};

GraphObject.setClass = function(className, classInstance) {
  this.classes[className] = classInstance;
}
GraphObject.getClass = function(className) {
  return (this.classes[className]);
}
GraphObject.create = function(fromClass, definitions = {}, options = {}) {
  var object = Object.create(fromClass.prototype, definitions);
  var handler = this.createHandler(object);
  object.initializeInstance(options);
  handler = object.initializeState(handler);
  return (new Proxy(object, handler))
}

/**
   Given a class name return a known class instance or create it 
   @param {string} className
   @returns {GraphObject} - The class instance.
   @throws {Error} - If the class name is invalid.

   allow absolute IRI, including URNs
   */
GraphObject.ensureClass = function(className) {
  var classInstance;
  
  classInstance = this.getClass(className);
  if (!classInstance) {
    if ((typeof className == 'string') && className.match(/^[a-zA-Z0-9_]+$/)) {
      classInstance = window[className];
      if (!classInstance) { // unknown class, define it
        console.log("GraphObject.ensureClass: ", "unknown class", className);
        classInstance = eval `class ${className} extends GraphObject {}`;
        //Object.setPrototypeOf(classInstance.prototype, GraphObject.prototype);
        //Object.setPrototypeOf(classInstance, GraphObject);
      }
      this.setClass(className, classInstance);
    } else {
      throw new Error(`GraphObject.ensureClass: invalid class name ${className}`);
    }
  }
  console.log("GraphObject.ensureClass: ", "className", className, "classInstance", classInstance);
  return (classInstance);
}


 /**
   Given a class name, the instance identifier and an initial state,
   instantiate the object, assign the initial state, create its proxy and return that.
   Do _not_ invoke its constructor.
   @param {string} className
   @param {string} identifier
   @param {Object} [state]
   */
GraphObject.createObject = function(className, identifier, state = {}) {
  // console.log('createObject', className, 'prototype', className.prototype)
  var classInstance = this.ensureClass(className);
  // console.log('class', classInstance);
  // console.log('state', state);
  var defs = {};
  if (classInstance) {
    var instance = Object.create(classInstance.prototype, defs);
    instance.setIdentifier(identifier);

    var handler = instance.initializeState(instance.createHandler(instance));
    // no ... this.initializeInstance(...arguments);
    // apply state after initialization, but before proyxing
    Object.entries(state).forEach(function([entryKey, entryValue]) {
     instance[entryKey] = entryValue;
    });
    console.log("GraphObject.createObject: instance", instance, handler);
    //var proxy = instance.createProxy(instance, handler);
    var proxy = new Proxy(instance, handler);
    console.log("GraphObject.createObject: proxy", proxy);
    // console.log('graph-environment.createObject: instance', typeof(instance), instance);
    // console.log('graph-environment.createObject: proxy', typeof(proxy), proxy);
    // console.log('graph-environment.createObject: instance.constructor', instance.constructor);
    // console.log('graph-environment.createObject: instance.constructor', proxy.constructor);
    // console.log('graph-environment.createObject: state', instance._state);
    return( proxy );
  } else {
    console.warn(`GraphObject.createObject: class not found '${className}'`);
    return (state);
  }
}




GraphObject.propertyDefinitions = new Map();
Object.defineProperty(GraphObject.prototype, "_self", {get: function() { return (this) }})
//Object.defineProperty(GraphObject.prototype, "propertyDefinitions", {get: function() { return (this.constructor.propertyDefinitions) }})

GraphObject.getPropertyDefinition = function(designator) {
    return (this.propertyDefinitions.get(designator));
}
GraphObject.setPropertyDefinition = function(designator, definition) {
  return (this.propertyDefinitions.set(designator, definition));
}

GraphObject.getPropertyName = function(designator) {
    console.debug("getPropertyName", this.propertyDefinitions, designator, typeof designator);
    return ((this.getPropertyDefinition(designator) || {}).name)
}
GraphObject.setPropertyName = function(designator, value) {
    var definition = this.getPropertyDefinition(designator);
    if (!definition) {
      definition = {};
      this.setPropertyDefinition(designator, definition);
    }
    return(definition.name = value);
}

GraphObject.getPropertyIdentifier = function(designator) {
    return ((this.getPropertyDefinition(designator) || {}).identifier)
}
GraphObject.setPropertyIdentifier = function(designator, value) {
    var definition = this.getPropertyDefinition(designator);
    if (!definition) {
      definition = {};
      this.setPropertyDefinition(designator, definition);
    }
    return(definition.identifier = value);
}

GraphObject.getPropertyType = function(designator) {
    return ((this.getPropertyDefinition(designator) || {}).type)
}
GraphObject.setPropertyType = function(designator, value) {
    var definition = this.getPropertyDefinition(designator);
    if (!definition) {
      definition = {};
      this.setPropertyDefinition(designator, definition);
    }
    return(definition.type = value);
}

/**
 * Compute the patch for the given object state.
 * 
 * @param {GraphObject} object - The object to compute the patch for.
 * @returns {Patch} - The computed patch.
 */
GraphObject.asPatch = function(object) {
    console.debug('GraphObject.asPatch');
    console.debug(object, object._state,);
    var patchOperator = GraphObject.asPatch[object._state];
    console.debug("GraphObject.asPatch: using: ", patchOperator);
    if (!patchOperator) {
      throw new GraphStateError(object._state, "asPatch");
    }
    return (patchOperator.call(object));
  }
// Initialize as an object to hold the state-specific implementations
GraphObject.asPatch = Object.assign(GraphObject.asPatch, {});
/**
 * Compute the new patch for the given object state.
 * 
 * @param {GraphObject} object - The object to compute the new patch for.
 * @returns {Patch} - The computed new patch.
 */
GraphObject.asNewPatch = function(object) {
    console.debug('GraphObject.asNewPatch');
    console.debug(object, object._state,);
    var patchOperator = GraphObject.asPatch[GraphObject.stateNew];
    console.debug("GraphObject.asNewPatch: using: ", patchOperator);
    if (!patchOperator) {
      throw new GraphStateError(object._state, "asNewPatch");
    }
    return (patchOperator.call(object));
  }
  

GraphObject.stateClean = Symbol.for("clean");
Object.defineProperty(GraphObject.prototype, "stateClean", {get: function () { return (this.constructor.stateClean) }})
GraphObject.asPatch[GraphObject.stateClean] =
  function() {
    return ({delete: [], post: [], put: []});
  }

GraphObject.stateDeleted = Symbol.for("deleted");
Object.defineProperty(GraphObject.prototype, "stateDeleted", {get: function () { return (this.constructor.stateDeleted) }})
GraphObject.asPatch[GraphObject.stateDeleted] =
  function() {
    // iterate over all properties and collect the elements to delete
    var self = this._self;
    var id = this.getIdentifier();
    var statements = [];
    var deltas = this._deltas;
    self.persistentProperties().forEach(function(name) {
      var oldValue = ((deltas && deltas.hasOwnProperty(name)) ? deltas[name][1] : self[name]);
      if (oldValue instanceof Array) {
        for (let eltValue of oldValue) {
          statements.push([id, name, eltValue]);
        }
      } else {
        statements.push([id, name, oldValue]);
      }
    });
    /*var type = self["_type"];
    if (type) {
      statements.push([id, "@type", type]);
    }*/
    return ({delete: statements, post: [], put: []});
  }

GraphObject.stateModified = Symbol.for("dirty");
Object.defineProperty(GraphObject.prototype, "stateModified", {get: function () { return (this.constructor.stateModified) }})
GraphObject.asPatch[GraphObject.stateModified] =
  function() {
    // iterate over all properties and collect the elements to delete
    var self = this._self;
    var id = this.getIdentifier();
    var posts = [];
    var deletes = [];
    var deltas = this._deltas;
    console.debug("properties: ", self.persistentProperties());
    self.persistentProperties().forEach(function(name) {
      if (deltas && deltas.hasOwnProperty(name)) {
        var [newValue, oldValue] = deltas[name];
        if (oldValue) {
          if (oldValue instanceof Array) {
            for (let eltValue of oldValue) {
              deletes.push([id, name, eltValue]);
            }
          } else {
            deletes.push([id, name, oldValue]);
          }
        }
        if (newValue) {
          if (newValue instanceof Array) {
            for (let eltValue of newValue) {
              posts.push([id, name, eltValue]);
            }
          } else {
            posts.push([id, name, newValue]);
          }
        }
      };
    });
    return ({post: posts, delete: deletes, put: []});
  }

GraphObject.stateNew = Symbol.for("new");
Object.defineProperty(GraphObject.prototype, "stateNew", {get: function () { return (this.constructor.stateNew) }})
GraphObject.asPatch[GraphObject.stateNew] =
  function() {
    //console.debug('GraphObject.prototype.asPatch[GraphObject.stateNew]');
    //console.debug(this);
    //console.debug(this.persistentProperties());
    // iterate over all properties and collect the elements to delete
    var self = this._self;
    var id = this.getIdentifier();
    var statements = [];
    // collect storage  representation agnostic  entity-attribute-value statements
    console.debug("properties", self.persistentProperties())
    self.persistentProperties().forEach(function(name) {
      var newValue = self[name];
      if (newValue) {
        if (newValue instanceof Array) {
          for (let eltValue of newValue) {
            statements.push([id, name, eltValue]);
          }
        } else {
          statements.push([id, name, newValue]);
        }
      }
    });
    /*var type = self["_type"];
    if (type) {
      statements.push([id, "@type", type]);
    }*/
    return ({post: statements, delete: [], put: []});
  }


// collect property definitions for classes on-demand.
// walk the constructor chain from the requesting class and collect the declarations.
// bind to respective initiating class's prototype

/**
 * Compute the effective properties for the given name.
 * 
 * @param {string} name - The property name.
 * @returns {Array<string>} - The effective properties.
 */
GraphObject.computeEffectiveProperties = function(name) {
  var props = [];
  for (var constructor = this;
       (constructor instanceof Function);
       constructor = Object.getPrototypeOf(constructor)) {
    var cprops = constructor[name];
    //console.debug(constructor); console.debug(cprops);
    if (!cprops) { break; }
    props = cprops.concat(props)
  }
  // de-duplicate
  return (Array.from(new Set(props)));
}

/**
 * Get the editable properties for the class.
 * 
 * @returns {Array<string>} - The editable properties.
 */
GraphObject.editableProperties = function() {
  if (this.prototype.hasOwnProperty('_editableProperties')) {
    return(this.prototype._editableProperties);
  } else {
    var properties = this.computeEffectiveProperties('_editableProperties');
    this.prototype._editableProperties = properties;
    return (properties);
  }
}

/**
 * Get the persistent properties for the class.
 * 
 * @returns {Array<string>} - The persistent properties.
 */
GraphObject.persistentProperties = function() {
  if (this.prototype.hasOwnProperty('_persistentProperties')) {
    return(this.prototype._persistentProperties);
  } else {
    var properties = this.computeEffectiveProperties('_persistentProperties');
    this.prototype._persistentProperties = properties;
    return (properties);
  }
}

GraphObject._persistentProperties = null;
GraphObject._editableProperties = null;


if (typeof window !== "undefined") {
  window.GraphObject = GraphObject;
}



// console.log('graph-object.js: loaded');

