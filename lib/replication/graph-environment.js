// Copyright (c) 2019 datagraph gmbh

/**
 @overview

 @typedef {Object} Context
 */

import { GraphObject } from "./graph-object.js";

/**
 The abstract GraphEnvironment class defines the interface to graphs
 and their elements.
 @abstract
 @property context - A dictionary which maps bi-directionally  between property names and IRI

 */

export class GraphEnvironment {
  /**
   @param {Object} options
   @param {(string|URL|Context)} options.context
   */
  constructor(options = {}) {
    //this.context = null;
    this.location = (options.location ? options.location.toString() : null);
    if (!this.location) {
      throw (new Error('GraphEnvironment: location is required'));
    }
    this.resolveContext(options['context']);

  }

  /**
   Return the base IRI from this environment's context.
   @return {string} - the base IRI
   */
  get baseIRI() {
    return (this.context['@base'] || null);
  }
  createWildCard() {
    return ( null );
  }
  /**
   Accept a context designator, retrieve if necessary, expand all definitions,
   and bind the environment's context property to it.
   @param {(string|URL|Context)} context - The context to resolve.
   */
  resolveContext(context) {
    var thisEnv = this;
    function expandContext (context) {
      var base = context['@base'];
      Object.values(context).forEach(function(def) {
        var uri = def['@id'];
        if (uri) {
          def['@id'] = (base ? new URL(uri, base).href: new URL(uri).href);
        }
      });
      return (context);
    }
    function fetchContext (context) {
      fetch(context).then(function(response) {
        thisEnv.context = expandContext(response.json());
      })
    }
    if (context) {
      switch (typeof(context)) {
      case 'object':
        if (context instanceof URL) {
          fetchContext(context.href);
        } else {
          this.context = expandContext(context);
        }
        break;
      case 'string':
        fetchContext(context);
        break;
      default:
        throw (new TypeError(`resolveContext: invalid context: ${context}` ) );
      }
    } else {
      var fullLocation = this.location;
      if (!fullLocation.endsWith('/')) {
        fullLocation += '/';
      }
      this.context = {'@base': fullLocation};
    }
  }

  /**
   Return the identifier for the root node of the given Graph.
   @param {Graph} graph
   */
  graphResourceID (graph) {
    throw (new Error('GraphEnvironment.fieldResourceID must be implemented'));
  }

  /**
   Return the identifers for all nodes in the given Graph.
   @param {Graph} graph
   */
  graphResourceIDs (graph) {
    throw (new Error('GraphEnvironment.fieldResourceIDs must be implemented'));
  }

  /**
   Given a property identifier, return the definition from the environment's context.
   @param {(string|URL)} identifier - An identifier present in the context
   @return {PropertyDefinition}
   @todo The definition should be a standard JavaScript property descriptor
   @todo Change name to getPropertyDescriptor
   */
  fieldDefinition(identifier) {
    var def;
    // console.log("fieldDefinition", identifier);
    switch (typeof(identifier)) {
    case 'string': // field name
      return (this.context[identifier] || null);
    case 'object': // url
      var namestring = identifier.lexicalForm;
      def = this.context[namestring];
      if (def) {
        return (def);
      } else {
        var localPart = predicateLeaf(identifier);
        def = this.context[localPart];
        if (def) {
          this.context[namestring] = def;
          return (def);
        } else {
          return (this.context[namestring] = {});
        }
      }
    default:
      return (null);
    }
  }

  /**
   Given a property identifier, return the type from its definition 
   @todo Change name to getPropertyType
   */
  fieldType(identifier) {
    var def = this.fieldDefinition(identifier);
    return (def ? def['@type'] : null)
  }

  /**
   Given an IRI, return the property name associated with it in the environment.
   If none is present in the context, add a definition which specifies the IRI leaf as the name
   and cache that for future references.
   @oaram {(string|URL)} uri
   @returns {string}
   */
  findIdentifierName(uri) {
    // console.log("fin", uri);
    var uriNamestring = null;
    switch (typeof(uri)) {
    case 'string': // iri as string
      uriNamestring = uri;
      break;
    case 'object': // url
      uriNamestring = uri.lexicalForm;
      break;
    default:
      throw (new TypeError(`findIdentifierName: invalid uri: ${uri}`));
    }
    var def = this.context[uriNamestring];
    if ( def) {
      return ( def.name );
    } else {
      var fieldName = predicateLeaf(uri);
      def = {'@id': uriNamestring, name: fieldName};
      this.context[fieldName] = def;
      this.context[uriNamestring] = def;
      return (fieldName);
    }
  }

  /**
   Given a property name, return the IRI associated with it in the environment.
   @param {string} name
   @returns {string}
   */
  findNameIdentifier(fieldName) {
    // console.log('fni');
    // console.log(this);
    // console.log(this.context);
    var uri = null;
    var def = this.context[fieldName];
    if (def) {
      return (def['@id']);
    } else {
      var identifier = this.createNamedNode(fieldName).lexicalForm;
      def = {'@id': identifier, name: fieldName};
      this.context[fieldName] = def;
      this.context[identifier] = def;
      return (identifier);
    }
  }

  /**
   Given a Graph, and a prototype, compute the per-id state deltas.
   @abstract
   */
  computeDeltas(graph, replicator) {
    throw (new Error('GraphEnvironment.computeDeltas must be implemented'));
  }

  /**
   Given a Graph, extract the first subject term, extract its description and instantiate it.
   @abstract
   */
  computeGraphObject(graph, identifier) {
    throw (new Error('GraphEnvironment.computeGraphObject must be implemented'));
  }
  /**
   Given a Graph and a list of identifiers, extract their descriptions and instantiate them.
   @param {Graph} graph
   @param {Array} identifiers - The sought identifiers
   @abstract
   */
  computeGraphObjects(graph, identifiers) {
    throw (new Error('GraphEnvironment.computeGraphObjects must be implemented'));
  }
  /**
   @param {Object} object
   @abstract
   */
  computeObjectGraph(object) {
    throw (new Error('GraphEnvironment.computeObjectGraph must be implemented'));
  }

  /**
   Given subject, predicate, object and graph terns, construct and return a statement
   @abstract
   @param {Node} subject
   @param {NamedNode} predicate
   @param {Term} object
   @param {Node} [graph]
   */
  createStatement(subject, predicate, object, context) {
    throw (new Error('GraphEnvironment.createStatement must be implemented'));
  }
  /**
   @abstract
   */
  createGraph(statements, options) {
    throw (new Error('GraphEnvironment.createGraph must be implemented'));
  }
  /**
   @abstract
   */
  createLiteral(value, options) {
    throw (new Error('GraphEnvironment.createLiteral must be implemented'));
  }
  /**
   @abstract
   */
  createAnonymousNode(label) {
    throw (new Error('GraphEnvironment.createAnonymousNode must be implemented'));
  }
  /**
   @abstract
   */
  createNamedNode(identifier) {
    throw (new Error('GraphEnvironment.createIdentifiedNode must be implemented'));
  }
}
  

/**
 Given an IRI return the last element of its path.
 @param {(string|URL)} url
 @returns {string}
 */
export function predicateLeaf(url) {
  var asURL = (url instanceof URL) ? url :
              (typeof url === 'string' || url instanceof String) ? new URL(url) :
              (url.type == "iri" || url.type == "uri" || url.type == "url") ? new URL(url.value) :
              (url.lexicalForm) ? new URL(url.lexicalForm) : undefined;
  if (!asURL) {
    throw (new Error(`predicateLeaf: invalid url: ${url}`));
  }
  switch (asURL.protocol) {
  case 'urn:':
    return (asURL.pathname.split(':').pop());
  default:
    return ( (asURL.hash.length > 0) ? asURL.hash.slice(1) : asURL.pathname.split('/').pop() );
  }
}

