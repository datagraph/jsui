// Copyright (c) 2019 datagraph gmbh

/**
 @overview
The class RDFDatabase extends GraphDatabase to implement communication to a remote store.
The implementation uses the W3C SPARQL and Graph Store Protocols to communicate
with a CRDT-as-RDF service.
*/

import {GraphDatabase} from './graph-database.js';
import {GSP, SPARQL} from './rdf-graph-store.js';
import * as RDFEnvironment from './rdf-environment.js';
import { getResource, headResource, postResource, putResource, deleteResource} from './resource-access.js';

/**
 @extends GraphDatabase
 */
export class RDFDatabase extends GraphDatabase {
  /**
   @param {string} name
   @param {string} location - The connection url namestring
   @param {string} authentication - The authentication string
   @param {Object} [options]
   */
  constructor(name, location, authentication, options = {}) {
    super(name, location, authentication, options);

    var thisDatabase = this;
    if (location) {
      thisDatabase.head({}).then(function(response) {
        //console.log("head responded");
        //console.log(response);
        //for (var [k,v] of response.headers.entries()) {console.log([k,v])};
        var etag = response.headers.get('etag');
        //console.log(`etag: '${etag}'`);
        if (etag) {
          thisDatabase.revision = etag;
        }
      }).catch(function(error) {
        console.log("new RDFDatabase: head failed");
        console.log(error);
      });
    }
  }

  /**
   Perform a GSP head request.
   Return the promise or its then result depending on the given continuation.
   @param {Object} options - The request headers
   @param {(function|null)} [continuation]
   */ 
  async head(options, continuation = null) {
    // console.log("RDFDatabase.head");
    options = Object.assign({}, options, {"Authentication": this.authentication});
    var p = GSP.head(this.location, options, continuation);
    return (p);
  }

  /**
   Perform a GSP patch request.
   Return the promise or its then result depending on the given continuation.
   The given patch is encoded as a patch document and sent as the request body.
   @param {Patch} patch - the patch content
   @param {Object} options - The request headers
   @param {(function|null)} [continuation]
   */
  async patchProperties(content, options, continuation) {
    console.log("RDFDatabase.patch", content, options);
    options = Object.assign({}, options, {"Authentication": this.authentication,
                                          contentDisposition: `replicate=${this.name.replace(/ /g,'')}`});
    var p = GSP.patch(this.location,
                      this.environment.createPatch(content),
                      options,
                      continuation);
    return (p);
  }


  /**
   Perform a GSP get request.
   Decode the response content as per its content type.
   Return the continuation result, if supplied or the decoded content itself.
   @param {Object} options - The request headers
   @param {(function|null)} [continuation]
   @todo Allow an option to override the response content.
   */
  async getProperties(options, continuation, fail = console.error) {
    console.log("RDFDatabase.getProperties");
    var thisDatabase = this;
    options = Object.assign({}, options,
                    {"Accept": 'application/n-quads',
                     environment: this.environment,
                     "Authentication": this.authentication});

    function succeed(response) {
        console.debug("RDFDatabase.getProperties: response: ", response);
        if (response.ok) {
          var contentType = response.headers.get('Content-Type');
          var environment = options.environment || RDFEnvironment.theEnvironment;
          function acceptText(document) {
            console.debug("RDFDatabase.getProperties: document:", document);
            var graph = environment.decode(document, contentType);
            if (graph) {
              console.debug("RDFDatabase.getProperties: graph:", graph);
              graph.location = thisDatabase.location;
              continuation(graph);
            } else {
              console.warn("RDFDatabase.getProperties: failed to decode", document);
              if (fail) fail(document);
            }
          }
          console.trace("RDFDatabase.getProperties: response: ", response, contentType);
          response.text().then(acceptText).catch(error => {
            console.warn(`getResource: error parsing text ${error}`);
            if (fail) fail(error);
          });
        } else {
          console.warn(`RDFDatabase.getProperties: failed ${response.status}`);
          if (fail) fail(response);
        }
      }

    GSP.get(this.location, options)
      .then(succeed)
      .catch(error => {
          console.warn(`RDFDatabase.getProperties: error ${error}`);
          if (fail) fail(error);
        });
  }

  /**
   Perform a SPARQL get on a describe query minted to reflect the state of the given key object.
   @param {Object} keyObject
   @param {Object} options
   @param {(function|null)} [continuation]
   */
  async describeProperties(keyObject, options, continuation) {
    console.log("RDFDatabase.describe");
    console.log(keyObject);
    options = Object.assign({}, options,
                    {"Accept": 'application/n-quads',
                     environment: this.environment,
                     "Authentication": this.authentication});
    let thisDatabase = this;
    let properties = keyObject.persistentProperties();
    let where = Object.getOwnPropertyNames(keyObject)
    .filter(key => properties.indexOf(key) >= 0)
    .map(key => {
      const value = keyObject[key];
      if (value) {
        const predicate = thisDatabase.environment.createNamedNode(key);
        // Use the predicate’s lexicalForm in the triple pattern.
        return `?s <${predicate.lexicalForm}> "${value}" .`;
      }
      return "";
    })
    .filter(pattern => pattern !== "")
    .join(' ');
    var query = `describe ?s where { ${where} }`;
    postResource(thisDatabase.location, query, options, continuation );
  }
}

// console.log('rdf-database.js: loaded');
