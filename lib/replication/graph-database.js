// Copyright (c) 2019 datagraph gmbh

/**
 @overview

Three classes combine to provide persistence to GraphObject instances.
- GraphDatabase
  This implements the communication with a remote store
- GraphDatabaseTransaction
  This uses a GraphDatabase to implement commit and abort operations for a collection of GraphDatabaseReplicator
- GraphDatabaseReplicator
  This provides a transaction with a handle on a collection of GraphObject instances

They provide the javascript to graph store mediation layer in a form which simplifies APIs
such as IndexedDB and JDO.
The API provides the standard operations

 -   open, close
 -   newTransaction
 -   newReplicator
 -   get, put, delete
 -   attach, detach
 -   commit

The application-thread API operators transform between native javascript
objects and graphs to be exchanged as websockets/fetch requests with a remote
graph store which acts as the storage service.  
The object to graph transformation relies on the GraphObject state tracking
and GraphEnvironment field to term mapping mechanisms.

The GraphDatabaseTransaction behaviour simplfies IndexedDB in that the transaction
has indefinite extent with operators to effect changes in the remote store:
- When a database is opened it creates a websocket connection to a store.
- GerapDatabaseReplicators are instantiated and attached to a database.
- GraphObject instances are attached to a Replicator, which then governs the object's persistence.
- All changes through accessors to an attached instance are tracked .
- If an instance is detached and reattached, intervening changes are not recorded
- Each commit of the governing transaction propagates to the store the state changes
  of instances attached to its replicators by accumulating all changes as patches
  and communicating them within a single remote transaction
- Any changes accepted from the store as websocket messages are merged into attached instances.
- A merge conflict generates an exception to the application, for which the default handler
  offers the options to either supercede the local change with the replicated state,
  or detach the instance from the transaction.
- A database is closed by disconnecting from the store, at which point it can be elected
  to discard any active transactions or retain them.

Data is exchanged betweem the client and the remote store on two levels: through immediate database 
operators or as replication.
The customary database immediate CRUD operators (read, create/write, delete)
concern the current instance state, without regard to past changes.
They are abstracted as the operators
- getProperties, to read state
- patchProperties, for create/write/delete.

It intends a concrete database classes to implement the getProperties and patchPorperties methods
on the concrete store

The replication relies on attach and detach operators to bind an instance to a replicator.
The replicator uses transactions to track instance state changes and commit them with integrity
The transaction provides the commit and abort completion operations to either replicate state change
to the store or roll instances back to an initial state.

Replication differs from simple write operations in that the former communicates instance state in the form
of patches which enumerate statements to delete and insert, while the latter replaces any exisitng statements
with an encoding of the current state.
The replicator also receives the messages from the remote store, decodes them and applies changes to instances.

Marshalling transforms GrpahObject deltas into abstract patch data and 
relies on a concrete GraphEnvironment implement transformation between instance representations and the
statement sequences
of that interface.
The concrete implementation for an RDG graph store combines JSON-LD term predicate to field name mapping together
with graph manipulation utilites from rdflib to acomplish this.

Replication from the store is handled by the onmessage handler, which inverts the marshalling process
and merges changes into the attached objects.

All operators behave asynchronously. The principle method returns a Promise while *Await variants arrange
to return the operation result or signal an exception.
*/

import {GraphEnvironment} from './graph-environment.js';
import {GraphObject} from './graph-object.js';
import {NotFoundError} from './errors.js';
import {makeUUIDString} from './revision-identifier.js';

if (typeof window === 'undefined') {
  var WebSocket = require('ws'); // Import 'ws' library for Node.js
}
const now = Date.now();

/**
 openWebSocket connects a database instance to its remote store over a websocket connection.
 The location is supplied to the database when it is instantiated.
 This is invoked in the database constructor, which binds the new websocket when accepting an onopen
 event through the promise's resove operator.

 Ány communication which appears as onmessage event is delegated to an database onmessage operator.
 An onclose just clears the websocket binding.
 Other events are just logged.
*/

/**
 * Open a WebSocket connection to the remote store.
 * 
 * @param {GraphDatabase} database - The database instance.
 * @returns {Promise<WebSocket>} - A promise that resolves to the WebSocket instance.
 */
function openWebSocket(database) {
  var location = database.location;
  console.log("GraphDatabase.openWebSocket: location", location);
  var p = new Promise(function (resolve, reject) {
    var url = new URL(location);
    var host = url.host;
    var wsURL = 'wss://' + host + '/ws'; // just /ws
    var websocket = null;

    console.log("GraphDatabase.openWebSocket: url", wsURL);
    try {
      if (typeof window !== 'undefined' && window.WebSocket) {
        websocket = new window.WebSocket(wsURL); // Use browser WebSocket
      } else {
        websocket = new WebSocket(wsURL); // Use 'ws' library WebSocket
      }
    } catch(e) {
      console.log('openWebSocket.new failed: ', e);
      return (null);
    }
    console.log("GraphDatabase.openWebSocket: websocket", websocket);
    websocket.onerror = function(event) {
      console.log("GraphDatabase.openWebSocket: error ", event, websocket);
      reject(event);
    };
    websocket.onclose = function() {
      console.log("GraphDatabase.openWebSocket: onclose");
      database.websocket = null;
    }
    websocket.onmessage = function (event) {
      // console.log("GraphDatabase.openWebSocket: onmessage", event)
      database.onmessage(event.data);
    };
    websocket.onopen = function (event) {
      console.log("GraphDatabase.openWebSocket: onopen", websocket, event);
      resolve(websocket);
    };
  });
  return (p);
}

// extract the request line, headers and body from a websocket response.

/**
 * Parse the request line, headers, and body from a WebSocket response.
 * 
 * @param {string} document - The response document.
 * @param {Object} [options={hasResponseLine: true}] - Parsing options.
 * @returns {Request|Response} - The parsed request or response.
 */
function onmessage_parse(document, options = {hasResponseLine: true}) {
  var lineRegex = /([^\r\n]*)\r\n/;
  var nextLine = function () {
    // peel the headers off the response document. The body is whatever is left.
    var result = document.match(lineRegex);
    if (result) {
      // console.log("nextLine: ", result);
      document = document.substring(result[0].length);
      // console.log("nextLine: ", result, document);
      return (result[1]);
    } else {
      return (null);
    }
  }
  var parseRRLine = function () {
    var responseLineRegex = /^([^\s]+)\s+([^\s]+)\s+(.*)$/;
    var line = nextLine() || "";
    var match = line.match(responseLineRegex);
    if (!match) {
      throw(`onmessage_parse: invalid response line: "${line}"`);
    }
    var field1 = match[1];
    if (['DELETE', 'PATCH', 'POST', 'PUT'].includes(field1)) {
      // is a request
      return ({httpVersion: match[3], method: field1, path: match[2]});
    } else {
      // is a response
      return ({httpVersion: field1, statusCode: match[2], reasonPhrase: match[3]});
    }
  }
  var parseHeaderLine = function () {
    var headerLineRegex = /^([^:]+)\s*:\s*(.*)$/;
    var line = nextLine() || "";
    if (line.length == 0) {
      return (null);
    } else {
      var match = line.match(headerLineRegex);
      if (!match) {
        throw(`onmessage_parse: invalid header line: "${line}"`);
      }
      return ({name: match[1], value: match[2]});
    }
  };
  var parseHeaders = function () {
    var headers = {};
    for (var header = parseHeaderLine(); header; header = parseHeaderLine()) {
      headers[header.name] = header.value;
    }
    return (headers);
  };
  var parseBody = function () {
    return (document);
  }
  
  var responseLine = (options.hasResponseLine ? parseRRLine() : {});
  // console.log("GraphDatabase.response line:", responseLine);
  var headers = parseHeaders();
  // console.log("GraphDatabase.parse_response: headers", headers);
  if (responseLine.method) {
    return (new Request(responseLine.path, {method: responseLine.method, headers: headers,
                                            body: parseBody()}));
  } else {
    return (new Response(parseBody(), {status: responseLine.statusCode, statusText: responseLine.reasonPhrase,
                                       headers: headers}));
  }
}
/*
var resp = onmessage_parse("HTTP/1.1 200 OK\r\nContent-Type: application/n-quads\r\n\r\n<http://x.o/s> <http://x.o/p> 'o' .")
*/

/**
 a GraphDatabase provides the base implementation for exchanging object state with a remote store.
 It follows the pattern exemplified by an IndexedDB database (IDBDatabase), but adds
 logic to support state replication to the store
 @abstract
 @property nodeAddress {string} - The V1 UUID stem which identifies this node serves to filter
  out mirrired replication requests
 @property {string} location - The connection string for request to the remote store
 @property {string} authentication - The authentication string for remote requests
 @property {GraphDatabaseReplicator} replicators - A map of replicator by name
 @property {string} disposition - The replication route name in the remote store.
  It is carried into replicators in order to appear in the content-disposition header of the replication request
 @property {string} revision - The current revision of the database
 @property {GraphEnvironment} environment - The environment to be used to translate between
  remote representation and namte objects.
 */
export class GraphDatabase { 
  constructor(name, location, authentication, options = {}) {
    //super();
    console.log('GraphDatabase.constructor');
    this.name = name;
    this.baseETag = this.makeUUID();
    this.nodeAddress = this.baseETag.substring(24);  // use to filter or check mirrored replications
    this.location = location;
    this.revision = "HEAD";
    this.revisions = [];
    this.authentication = authentication;
    this.replicator = null;
    this.websocket = null;
    this.disposition = options.disposition || this.name.replace(/ /g,'');
    this.environment = options.environment ||
     new (options.environmentClass || GraphDatabase.graphEnvironmentClass)({location: location});
    this.wildCard = this.environment.createWildCard();
    this.cacheStrategy = options.cacheStrategy || 'lazy';
    this.ensureReplicator();
    options.asynchronous = false;
    if (location) {
      // console.log("GraphDatabase: options.asynchronous", options.asynchronous);
      if (options.asynchronous) {
        // console.log("GraphDatabase: opening asyncronous connection");
        try {
          openWebSocket(this).then(function(websocket) {
            thisDatabase.setWebsocket(websocket);
          });
        } catch(e) { console.log("GraphDatabase.openWebSocket failed: ", e); }
      }
    }
  }

  setWebsocket(websocket) {
    console.log("GraphDatabase.setWebsocket: ", websocket);
    this.websocket = websocket;
    var url = new URL(this.location);
    var path = url.pathname;
    var CRLF = '\r\n';
    var method = 'PUT';
    var requestLine = `${method} ${path}/disposition HTTP/1.0`;
    var headers = "";
     headers += `Content-Disposition: replicate=${this.disposition}` + CRLF;
     headers += `ETag: ${this.baseETag}` + CRLF;
    if (this.authentication) {
      headers += "Authorization: Basic " + btoa(":" + this.authentication) + CRLF;
    }
    var data = requestLine + CRLF + headers + CRLF;
    // console.log("GraphDatabase.setWebsocket.send: data:", data);
    websocket.send(data);
    return(websocket);
  }

  onmessage(data) {
    // if there is some handler for the given media type, delegate to that to handle the message
    try {
      // console.log("onmessage: ", data);
      var response = onmessage_parse(data);
      var contentType;
      var match;
      var etag = response.headers.get('ETag');
      if (etag && this.revisions.find(function(p) { return (etag == p.revision); })) {
        console.log("onmessage: reflected", etag, data);
      } else {
        if ((contentType = response.headers.get('Content-Type')) &&
            (match = contentType.match(/([^;]+)(?:;.*)?/))) {
          var handler = onmessage[match[1]];
          // console.log("onmessage: contentType ", contentType, handler);
          if (handler) {
            handler(this, response);
          } else {
            throw (new Error(`GraphDatabase.onmessage: no handler defined for media type: ${contentType}`));
          }
        } else {
          console.log("onmessage: no media type", response);
        }
      }
    } catch (e) {
      console.log("onmessage: ", e, data);
    }
  }

  close({abort = false}) {
    if (this.websocket) {
      this.websocket.close();
    }
    this.websocket = null;
    if (abort && this.replicator) {  // Use single replicator
      this.replicator.rollbackObjects();
    }
  }

  name() {
    return( this.name );
  }

  version() {
    return( this.revision );
  }

  /**
   Given an name, create a replicator and register it with that name
   */

  /**
   * Create and return a new replicator registered with the given name.
   * 
   * @param {string} name - The name of the replicator.
   * @param {Object} [options={}] - Additional options.
   * @returns {GraphDatabaseReplicator} - The new replicator.
   * @throws {TypeError} - If the name is not provided.
   */
  ensureReplicator(options = {}) {
    if (this.replicator) {
      throw new Error('Database already has a replicator');
    }
    this.replicator = new GraphDatabaseReplicator(options);
    this.replicator.database = this;
    return this.replicator;
  }
  /**
   * Return the object replicator registered with the given name.
   * 
   * @returns {GraphDatabaseReplicator} - The replicator.
   */
  getReplicator() {
    return this.replicator;
  }

  /**
   * Clone the replicator registered with the given name.
   * 
   * @param {string} name - The name of the replicator.
   * @returns {GraphDatabaseReplicator} - The cloned replicator.
   */
  cloneReplicator() {
    var replicator = this.getReplicator();
    var clone = Object.assign(Object.create(GraphReplicator.prototype, {}), replicator);
    clone.transaction = null;
    return (clone);
  }


  

  /**
   * Create and return a new transaction associated with the given replicators.
   * By default, incorporate all replicators known to the database.
   * 
   * @param {Array<string>} [names=this.replicatorNames()] - The names of the replicators to include in the transaction.
   * @returns {GraphDatabaseTransaction} - The new transaction.
   */
  newTransaction(options = {}) {
    return new GraphDatabaseTransaction(this, options);
  }

  makeUUID() { // override
    return (makeUUIDString());
  }

  /**
   @abstract
   */
   async patchProperties(content, options, continuation) {}

  /**
   Transfer an immediate object's state to the remote store.
   The state is transformed into a patch, sent to the remote store, and returned to the application.
   @param {Object} object
   */

  /**
   * Transfer an immediate object's state to the remote store.
   * The state is transformed into a patch, sent to the remote store, and returned to the application.
   * 
   * @param {GraphObject} object - The object to transfer.
   * @param {Object} [options={}] - Additional options.
   * @param {function} [continuation] - The continuation function.
   * @returns {Promise} - A promise that resolves when the operation is complete.
   */
   async put(object, options, continuation) {  // single level
    // collect the current state
    var patch = object.asNewPatch();
    var id = object.getIdentifier();
    var deleteEntry = [id, this.wildCard, this.wildCard];
    patch.delete.push(deleteEntry);
    console.log("GraphDatabaseReplicator.put", object._state, patch, request);
    return ( this.patchProperties(patch, options, continuation) );
  }

  async putAwait(object) {
    return await this.put(object);
  }

  
  /**
   @abstract
   */
  async getProperties(options, continuation) { throw new Error('Must implement getProperties'); }

  /**
   Retrieve an object's state given either an identifier, or an object prototype
   An identifier is used as the subject constraint for a get,
   while a prototype is used to inform a describe.
   Use the revision proerty to constrain the request in order to support rollforward/rollback
   @param {(Object|string)} key
   */

  /**
   * Retrieve an object's state given either an identifier or an object prototype.
   * 
   * @param {(Object|string)} key - The identifier or object prototype.
   * @param {function} [continuation] - The continuation function.
   * @returns {Promise<Object|null>} - A promise that resolves to the retrieved object or null if not found.
   */
  async get(key, continuation) {
    console.log("GraphDatabase.get", key, this);
    var thisDatabase = this;
    var keyId = null;
    var keyObject = null;
    var p = null;

    function acceptGetContent (content) {
      console.log("GraphDatabase.get.acceptGetContent", content);
      if (content && content.statements.length > 0) {
        var deltas = thisDatabase.environment.computeDeltas(content, thisDatabase.replicator);
        console.log("GraphDatabase.get: deltas", deltas);
        var gottenObjects = deltas.map(function(perIdDeltas) {
          // console.log('GraphDatabase.get: next delta', perIdDeltas);
          var [id, deltas] = perIdDeltas;
          // console.log('GraphDatabaseReplicator.get: next perIdDeltas', perIdDeltas);
          var object = perIdDeltas.object;
          console.log('GraphDatabase.get: gotten:', object);
          if (object) {
            object.onupdate(deltas);
            return (object);
          } else {
            console.warn("GraphDatabase.get: no object created", perIdDeltas); 
            return (perIdDeltas);
          }
        });
        console.log("GraphDatabaseReplicator.get: gotten objects", gottenObjects);
        if ( continuation) { continuation( thisDatabase.cacheStrategy == 'eager' ? gottenObjects : gottenObjects[0]); }
      } else {
        if ( continuation) { continuation([]); }
      }
    }
    console.log("GraphDatabase.get: key", key);
    switch (typeof(key)) {
    case 'string' :
      console.log("GraphDatabase.get: as string", key);
      keyId = key;
      keyObject = thisDatabase.findObject(keyId);
      // perform a get to retrieve the single instance via from the database
      this.getProperties({subject: key, revision: this.revision},
                        function(content) { acceptGetContent(content, keyObject); });
      break;
    case 'object' :
      keyId = key.getIdentifier();
      console.log("GraphDatabase.get: as object", key, key.constructor.name, keyId);
      if (keyId) {
        console.log("GraphDatabase.getProperties");
        // objects should all be in replicators
        // this.objects.set(keyId, keyObject);
        this.getProperties({subject: keyId,  revision: this.revision},
          function(content) { acceptGetContent(content, key); } );
      } else {
        throw new Error(`GraphDatabase.get: Object is not identified: ${this}, ${object}.`);
      }
      break;
    default :
      continuation ([]);
    }

    // console.log("GraphDatabase.get: promise", p);
    return (keyObject);
  }

  async getAwait(key) {
    return await this.get(key);
  }

  /**
   Delete an immediate object's state to the remote store.
   Generate a deletion patch for the object.
    @param {GraphObject} object
   */

  /**
   * Delete an immediate object's state from the remote store.
   * Generate a deletion patch for the object.
   * 
   * @param {GraphObject} object - The object to delete.
   * @param {function} [continuation] - The continuation function.
   * @returns {Promise} - A promise that resolves when the operation is complete.
   */
  async delete(object, continuation) {

     // collect the current state
     var patch = object.asNewPatch();
     var id = object.getIdentifier();
     var posts = patch.post;
     patch.post = [];
     patch.delete = posts;
     console.log("GraphDatabaseReplicator.delete", object._state, patch, request);
     return ( this.patchProperties(patch, options, continuation) );
   }


  async deleteAwait(object) {
    return await this.delete(object);
  }

  /**
   @abstract
   */
  describe(keyObject, options, continuation) {
    throw (new Error(`${this.constructor.name}.describe must be defined`));
  }
  /**
   @abstract
   */
  head(options, continuation) {
    throw (new Error(`${this.constructor.name}.head must be defined`));
  }
  /**
   The base method caches the patch with time and regision tags.
   @param {Object} content
   @param {Array} content.delete
   */
  async patch(content, options, continuation) {
    // the state manipulation aspect, but without the transport
    var revision = {patch: content, name: Date.now(), revision: options.etag};
    this.patchProperties(content, options, continuation)
    return (revision);
  }

  async patchAwait(content, options) {
    return await this.patch(content, options);
  }

  findObject(id) {
    return this.replicator ? this.replicator.findObject(id) : null;  // Use single replicator
  }
}


GraphDatabase.open = function(name, location, authentication, options = {}) {
  //console.log('in open');
  var dbClass = (options.databaseClass || GraphDatabase.graphDatabaseClass);
  var db = new dbClass(name, location, authentication, options);
  //console.log('GraphDatabase.open', db);
  //console.log(db.constructor.name);
  return (db);
}
// permit configuration
GraphDatabase.graphDatabaseClass = GraphDatabase;
GraphDatabase.graphEnvironmentClass = GraphEnvironment;

/**
 Define the handlers for Websocket messages specific to the message content type
 @todo Shift these to the instance property
 */
export var onmessage = {};

onmessage['*/*'] = function(db, response) {
  // do nothing
}
onmessage['application/n-quads'] = function(db, response) {
}

onmessage['multipart/related'] = function(db, response) {
  // decode the multipart document as patches to the objects described by the
  // respective subjects
  var thisDatabase = this;
  response.text().then(function(document) {
    try {
      var contentType = response.headers.get('Content-Type');
      var patch = null;
      patch = db.environment.decode(document, contentType);
      if (patch) {
        var deltas = null;
        deltas = db.environment.computeDeltas(patch, thisDatabase.replicator);
        if (deltas) {
          // console.log("onmessage.multipart: deltas", deltas);
          var gottenObjects = deltas.map(function(perIdDeltas) {
            // console.log("onmessage.multipart: next delta", perIdDeltas);
            var [id, deltas] = perIdDeltas;
            var object = db.findObject(id);
            // console.log("onmessage.multipart: found:", object);
            if (object) {
              object.onupdate(deltas);
            } else {
              object = perIdDeltas['object'];
              // console.log("onmessage.multipart: created", object); 
              if (object) {
                object.oncreate(deltas);
              }
            }
            return (object);
          });
          console.log("onmessage.multipart: messaged", gottenObjects);
        }
      } else {
        console.log("onmessage.multipart: no patch", response);
      }
    } catch(error) {
      console.log("onmessage.multipart: error", error);
      return (null)
    }
  });
}


/**
 Manage a transaction over a GraphDatabaseReplicator collection.

 A transaction is created to wrap a set of replicators and commit the changes made to their
 attached instances to a remote database.
 It is instantiated for a named collection of replicators from a given database.

 @property {string} revisionID
 @property {string} disposition
 @property {Array} replicators
 @property {GraphDatabase} database
 */
export class GraphDatabaseTransaction { 
  constructor(database, names = [], options = {}) {
    //console.log("new Transaction", names);
    var thisTransaction = this;
    if (typeof(names) == 'string') {
      names = [names];
    }
    this.database = database;
    this.revisionId = database.makeUUID();
    this.parentRevisionID = "HEAD";
    this.disposition = options.disposition || database.disposition;

    this.replicator = database.getReplicator()

    //console.log('GraphDatabaseTransaction.constructed');
    //console.log(this);
    return (this);
  }

  /**
   Commmit accumulated changes to the remote store.
   Iterate over the owned object stores, collect their delete/post/put patches,
   delegate to the database with this collected patch.
   When that completes, clear the state on all registered objects and
   record the new revision id in the database.

   This returns no additional asynchronous control thread as, when invoked from
   a control thread in the database, this invocation is either already in an
   asynchronous, as a promise's then function.
   For an explicit invocation from the application thread return a request
   instance which can bind an onsuccess property to recieve control when the
   patch request completes.
   */
  commit() {
    console.log(`GDBTransaction.commit @${this.revisionID}`, this);
    // iterate over the owned stores;
    // for each, get its delta graph
    var posts = [];
    var puts = [];
    var deletes = [];
    this.replicators.forEach(function(replicator) {
      var patch = replicator.asPatch();
      deletes = deletes.concat(patch.delete ? patch.delete : []);
      posts = posts.concat(patch.post ? patch.post : []);
      puts = puts.concat(patch.put ? patch.put : []);
    });
    // pass the collected operations through to the remote Graph
    var thisTransaction = this;

    var p = this.database.patch({delete: deletes, post: posts, put: puts},
                                {contentDisposition: this.disposition,
                                 etag: this.revisionID},
                                function(response) {
                                  thisTransaction.cleanObjects();
                                  if (response.onsuccess) {
                                    response.onsuccess(new SuccessEvent("success", "commit", response.result));
                                  }
                                  // console.log("commit response", response);
                                  // console.log("headers", response.headers);
                                  // for (var [k,v] of response.headers.entries()) {console.log([k,v])};
                                  var etag = response.headers.get("etag");
                                  if (etag) {
                                    thisTransaction.database.revision = etag;
                                  }
                                  console.log(`GDBTransaction.commit @${thisTransaction.revisionID} complete`);
                                  return (response) ;
                                });
    return (thisTransaction);
  }

  /**
   Upon commit completion, set all attached objects to clean.
   */
  cleanObjects () {
    this.replicators.forEach(function (replicator) { replicator.cleanObjects(); });
  }

  /**
   Abort a transaction by delegating to the transaction's object stores to
   roll back changes in all attached objects
   */
  abort() {
    // revert all attached objects
    this.replicators.forEach(function(replicator) { replicator.rollbackObjects(); });
    return (this);
  }

}

/**
 Implement the IndexedDB interface (put, get, delete) and the JDO interface(attach, detach)
 with respect to JavaScript instances and the remote store.
 Support transactional behaviour with asPatch.
 */
export class GraphDatabaseReplicator { 
  constructor(name, options = {}) {
    // super(name);
    this.name = name;
    this.environment = options.environment;
    this.contentDisposition = options.contentDisposition;
    this.objects = new Map();
    this.patches = [];
    // this.transaction = null; // single direction dependency
    this.database = null;
  }

  /**
   * Find an object by its identifier.
   * 
   * @param {string} id - The identifier of the object to find.
   * @returns {GraphObject|null} - The found object or null if not found.
   */
  findObject(id) {
    return this.objects.get(id);
  }


  /**
   Register an object - and its reachability graph, to cause any changes to be recorded
   in order to propagate them to the remote store when the transaction commits.
   */
  attach(object) {
    // attach the instance to a replicator
    var thisReplicator = this;
    var replicator = object._replicator;
    if (replicator) {
      // no error, just stop walking
    } else if (object instanceof GraphObject) {
      object._replicator = thisReplicator;
      // mark the state as clean - whatever it is
      object.setStateClean();
      var objects = thisReplicator.objects;
      var attachChild = function(child) {
        if (child instanceof GraphObject) {
          thisReplicator.attach(object);
        } else if (child instanceof Array) {
          child.forEach(attachChild);
        }
      }
      if (! objects.has(object.getIdentifier())) {
        objects.set(object.getIdentifier(), object);
        object.persistentValues(object).forEach(attachChild);
        //console.log('attached');
      }
    }
    return (object);
  }

  /**
   Unregister an object
   */
  detach(object) {
    var thisReplicator = this;
    var objects = thisReplicator.objects;
    var detachChild = function(child) {
      if (child instanceof GraphObject) {
        thisReplicator.detach(child);
      } else if (child instanceof Array) {
        child.forEach(detachChild);
      }
    }
    if (object._replicator == this) {
      objects.delete(object.getIdentifier());
      object._state = GraphObject.stateNew;
      object._replicator = null;
      object.persistentValues(object).forEach(detachChild);
    }
    return (object);
  }

  /**
   Roll back changes in all attached objects.
   */
  rollbackObjects() {
    // no walking. it enumerates all attached instances
    /**
     * @param {GraphObject} object 
     */
    function rollbackObject(object) {
      object.rollback();
    };
    this.objects.forEach(function(object, id) {rollbackObject(object);});
    this.objects = new Map();
    return (this);
  }
  
  /**
   Set the state of all attached objects to clean.
   */
   cleanObjects() {
    /**
     *  @param {GraphObject} object
     */
     function cleanObject(object) {
      if (object instanceof GraphObject) {
        var state = object._state;
        object.setStateClean();
      } else { // there should not be anything else
      };
    }
    // no walking. it enumerates all attached instances 
    this.objects.forEach(function(object, id) {cleanObject(object);});
  }
  /**
   Collect and return the patches for all attached instances.
   in the process, convert from abstract form
   
     {put: [], post: [], delete: []}
   
   where each array entry is 
   
     [identifier, propertyName, value]

   to capture the respective operation on the identifier object
   */

  /**
   * Collect and return the patches for all attached instances.
   * 
   * @returns {Object} - The patch object containing delete, post, and put arrays.
   */
  asPatch() {
    var posts = [];
    var puts = [];
    var deletes = [];
    // first aggregate any explicit patches
    this.patches.forEach(function(patch) {
      deletes = deletes.concat(patch.delete || []);
      posts = posts.concat(patch.post || []);
      puts = puts.concat(patch.put || []);
    });
    /**
     * @param {GraphObject} object 
     */
    function objectAsPatch(object) {
      // add a patch for each attached instance
      var patch = object.asPatch();
      deletes = deletes.concat(patch.delete || []);
      posts = posts.concat(patch.post || []);
      puts = puts.concat(patch.put || []);
    }
    this.objects.forEach(objectAsPAtch);
    // console.log('asPatch: deletes,posts,puts', deletes, posts, puts);
    // do not convert the abstract form. let the database delegate that to its environment,
    // do NOT clean. leave that to the transaction when it commits.
    var patch = {delete: deletes, post: posts, put: puts};
    return (patch);
  }


}
if (typeof window !== "undefined") {
  window.GraphDatabaseReplicator = GraphDatabaseReplicator;
  window.GraphDatabaseTransaction = GraphDatabaseTransaction;
  window.GraphDatabase = GraphDatabase;
}
// console.log('graph-database.js: loaded');

