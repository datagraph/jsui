// Copyright (c) 2019 datagraph gmbh

/**
 Implement SPARQL and Graph Store protocol operations based on
 - fetch network operators
 - rdf codecs and data model

 The operations are defined as static function for the GSP and SPARQL classes.
 */

/*if ("function" === typeof importScripts) {
  importScripts('https://solid.github.io/releases/rdflib.js/rdflib-0.12.2.min.js');
}
*/

const now = Date.now;

export const rdfMediaTypes = [
  "application/n-quads",
  "application/n-triples",
  "application/rdf+xml",
  "text/turtle"
];
export const sparqlMediaTypes = [
  "application/sparql-results+json",
  "application/sparql-results+xml",
  "application/sparql-results+csv"
].concat(rdfMediaTypes);


export function mediaTypeStem(mediaType) {
  var match = mediaType.match(/([^;]+)(?:;.*)?/)
  return (match ? match[1] : null)
}

function ensureGSLocation(location) {
  if (!(location instanceof URL)) {
      location = new URL(location);
  }
  let path = location.pathname;
  if (path.endsWith(GSP.locationSuffix)) {
      return (location.toString());
  } else if (path.slice(1).split('/').length >= 3) {
      return (location.toString());
  } else {
      return (location.toString() + GSP.locationSuffix);
  }
}

function constrainGSLocation(location, options) {
  var constraintCount = 0;
  function appendArg(arg) {
    location = location + ( (0 == constraintCount) ? '?' : '&') + arg;
  }
  ['subject', 'predicate', 'object', 'graph'].forEach(function(term) {
    var constraint = options[term];
    if (constraint) {
      if (term == 'graph' && constraint == 'default') {
        appendArg('default');
      } else {
        if (term != 'object' && !constraint.startsWith('<')) {
          constraint = '<' + constraint + '>';
        }
        appendArg(term + '=' + encodeURIComponent(constraint));
      }
    }
  });
  if (options["default"]) { appendArg('default'); }
  var offset = options["offset"];
  var limit = options["limit"];
  if (limit) { appendArg("limit=" + limit); }
  if (offset) { appendArg("offset=" + offset); }
  return (location);
}

function ensureSPARQLLocation(location) {
  if (!(location instanceof URL)) {
      location = new URL(location);
  }
  let path = location.pathname;
  if (path.endsWith(SPARQL.locationSuffix)) {
      return (location.toString());
  } else if (path.slice(1).split('/').length >= 3) {
      return (location.toString());
  } else {
      return (location.toString() + SPARQL.locationSuffix);
  }
}
/**
 provide a generic logging fetch operator.
 it passes the response to its continuation whether or not the status is 'ok',
 as well as continuing after logging an error.
 in cases where additional continuations are supplied, they will obtain this error
 eg:

   var p = new Promise(function(accept, reject) { accept("accepted"); })
    .then(function(first) {console.log("first", first); return(first);})
    .catch(function(caught){console.log("caught", caucht);})
    .then(function(last){console.log("finally", last);})
   var p = new Promise(function(accept, reject) { reject("rejected"); })
    .then(function(first) {console.log("first", first); return(first);})
    .catch(function(caught){console.log("caught", caught); return("caught")})
    .then(function(last){console.log("finally", last);})
 */

function logFetch(location, args) {
  console.debug('fetch:', location, args);
  // in order to see the header entries...
  var headers = args.headers;
  console.debug('fetch: headers:', headers);
  var p = fetch(location, args);
  p.location = location;
/*  p = p.then(function(response) {
        if (response.ok) {
          return (response);
        } else {
          console.warb(`fetch failed: response: ${response.status}`);
          return (response);
        }
      }).catch(function(error) { console.warn("fetch failed: ", location, error); });
  // console.log(p);*/
  return (p);
}

/**
 The GSP class comprises the interface operators for the Graph Store Protocol
 */
export class GSP {
}
// window.GSP = GSP;
// 2021.04.05 eliminated as it prevented posting to views
GSP.locationSuffix = "/service";
GSP.fetchOp = logFetch;

/**
 The SPARQL class comprises the interface operators for the SPARQL Protocol
 */
export class SPARQL {
}
// window.SPARQL = SPARQL;
SPARQL.locationSuffix = "/sparql";
SPARQL.fetchOp = fetch ; // logFetch;

/**
 The SESAME class supports just a simple document-based get operation
 */

export class SESAME {
}
SESAME.fetchOp = fetch ; // logFetch;

export class HTTP {
}
HTTP.fetchOp = fetch; // logFetch;


// define generic protocol interface
// graph store protocol


/**
 GSP.delete
 Perform a GSP delete given the location, options for authentication and response
 content type, and an optional continuation operator.
 @param {string} location - the host and target repository name
 @param {Object} [options]
 @param {string} options.etag - the client revision identifer to identify the transaction
 @param {string} options.authorization - the basic authoentication string
 @param {string} options.accept - the media type for the confirmation response
 @param {string} options.contentDisposition - the replication disposition route
 @param {string} options.graph - the target graph
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 @returns {Promise}
 */

 GSP.delete = function(location, options = {}, continuation) {
  var headers = { "Accept": GSP.delete.acceptMediaType };
  headers = HTTP.setHeaderAuthorization(headers, options);
  if (options.etag) { headers["ETag"] = options.etag; }
  if (options.contentDisposition) { headers["Content-Disposition"] = options.contentDisposition; }
  var args = { method: "DELETE",
               cache: "no-cache",
               headers: headers };
  var constraint = options['graph'];
  
  location = ensureGSLocation(location);
  if (constraint) {
    location = location + '?graph=' + encodeURIComponent(constraint);
  }
  var p = GSP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
/**
 The default accept media type for delete requests
 */
GSP.delete.acceptMediaType = 'text/turtle';


/**
 GSP.get
 Perform a GSP get given the location, options for authentication and response
 content type, an optional graph designator, and an optional continuation operator.
 @param {string} location - the host and target repository name
 @param {Object} [options]
 @param {string} options.etag - the client revision identifer to identify the transaction
 @param {string} options.authorization - the basic authoentication string
 @param {string} options.accept - the media type for the response document
 @param {string} options.subject - a subject constraint
 @param {string} options.predicate - a predicate constraint
 @param {string} options.object - an object constraint
 @param {string} options.graph - a graph constraint
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

 GSP.get = function(location, options = {}, continuation) {
  var headers = { "Accept": (options["Accept"] || GSP.get.acceptMediaType) };
  headers = HTTP.setHeaderAuthorization(headers, options);
  var args = { method: "GET",
               cache: "no-cache",
               headers: headers };
  location = ensureGSLocation(location);
  location = constrainGSLocation(location, options);
  var p = GSP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
GSP.get.acceptMediaType = 'application/n-quads';


/**
 GSP.head
 @param {string} location - the host and target repository name
 @param {Object} [options]
 @param {string} options.authorization - the basic authoentication string
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

GSP.head = function(location, options, continuation) {
  var headers = {};
  headers = HTTP.setHeaderAuthorization(headers, options);
  var args = { method: "HEAD",
               cache: "no-cache",
               headers: headers };
  location = ensureGSLocation(location);
  var p = fetch(location, args);
  return (continuation ? p.then(continuation) : p);
}


/**
 GSP.patch
 Perform a GSP patch given the location, content, options for authentication and section
 content type, and an optional continuation operator.
 The content is first encoded as per the given content type and a request is issued
 with the given headers.
 @param {string} location - the host and target repository name
 @param {Patch} content - the request content
 @param {Object} [options]
 @param {string} options.etag - the client revision identifer to identify the transaction
 @param {string} options.authorization - the basic authentication string
 @param {string} options.accept - the media type for the response document
 @param {string} options.contentDisposition - the replication disposition route
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

GSP.patch = function (location, content, options = {}, continuation) {
  console.debug("GSP.patch", location, content, options);
  var contentType = options["Content-Type"] || GSP.patch.contentMediaType;
  var headers = { 
    "Accept": (options["Accept"] || GSP.patch.acceptMediaType),
    "Content-Type": contentType,
  };
  headers = HTTP.setHeaderAuthorization(headers, options);
  var contentEncoded = "";
  var boundary = null;
  if (options.etag) { headers["ETag"] = options.etag; }
  if (options.contentDisposition) { headers["Content-Disposition"] = options.contentDisposition; }
  
  if (content instanceof File) {
    contentEncoded = content;
  } else if (content instanceof Object) {
    content.encode(contentType, function(e, options ={}) {
      contentEncoded = e;
      boundary = options.boundary
    });
  } else {
    contentEncoded = content;
  }

  if (boundary) {
    headers["Content-Type"] += `; boundary=${boundary}`;
  }
  var args = { 
    method: "PATCH",
    headers: headers,
    body: contentEncoded 
  };
  var constraint = options['graph'];
  
  location = ensureGSLocation(location);
  if (constraint) {
    location = location + '?graph=' + encodeURIComponent(constraint);
  }
  var p = GSP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
GSP.patch.acceptMediaType = 'text/turtle';
GSP.patch.contentMediaType = 'multipart/related';

/**
 GSP.post
 Perform a GSP post given the location, content, options for authentication, and an optional continuation operator.
 Any object content is first encoded as per the given content type, while string or file content is used as-is.
 A request is issued with the given headers.
 @param {string} location - the host and target repository name
 @param {Graph} content - the request content
 @param {Object} [options]
 @param {string} options.etag - the client revision identifer to identify the transaction
 @param {string} options.authorization - the basic authentication string
 @param {string} options.accept - the media type for the response document
 @param {string} options.contentDisposition - the replication disposition route
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

 GSP.post = function (location, content, options = {}, continuation) {
  var contentType = options["Content-Type"] || GSP.post.contentMediaType;
  var headers = { 
    "Accept": (options["Accept"] || GSP.post.acceptMediaType),
    "Content-Type": contentType,
  };
  headers = HTTP.setHeaderAuthorization(headers, options);
  if (options.etag) { headers["ETag"] = options.etag; }
  if (options.contentDisposition) { headers["Content-Disposition"] = options.contentDisposition; }
  var contentEncoded = "";
  if (content instanceof File) {
    contentEncoded = content;
  } else if (content instanceof Object) {
    content.encode(contentType, function(e) { contentEncoded = e; });
  } else {
    contentEncoded = content;
  }
  var args = { 
    method: "POST",
    headers: headers,
    body: contentEncoded 
  };
  var constraint = options['graph'];
  
  location = ensureGSLocation(location);
  if (constraint) {
    location = location + '?graph=' + encodeURIComponent(constraint);
  }
  var p = GSP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
GSP.post.acceptMediaType = 'text/turtle';
GSP.post.contentMediaType = 'application/n-quads';


/**
 GSP.put
 Perform a GSP put given the location, content, options for authentication, and an optional continuation operator.
 The content is first encoded as per the given content type and a request is issued
 with the given headers.
 @param {string} location - the host and target repository name
 @param {Graph} content - the request content
 @param {Object} [options]
 @param {string} options.etag - the client revision identifer to identify the transaction
 @param {string} options.authorization - the basic authentication string
 @param {string} options.accept - the media type for the response document
 @param {string} options.contentDisposition - the replication disposition route
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

GSP.put = function (location, content, options = {}, continuation) {
  var contentType = options["Content-Type"] || GSP.put.contentMediaType;
  var headers = { 
    "Accept": (options["Accept"] || GSP.put.acceptMediaType),
    "Content-Type": contentType,
  };
  headers = HTTP.setHeaderAuthorization(headers, options);
  if (options.etag) { headers["ETag"] = options.etag; }
  if (options.contentDisposition) { headers["Content-Disposition"] = options.contentDisposition; }
  var contentEncoded = "";
  if (content instanceof File) {
    contentEncoded = content;
  } else if (content instanceof Object) {
    content.encode(contentType, function(e) { contentEncoded = e; });
  } else {
    contentEncoded = content;
  }
  var args = { 
    method: "PUT",
    headers: headers,
    body: contentEncoded 
  };
  var constraint = options['graph'];
  
  location = ensureGSLocation(location);
  if (constraint) {
    location = location + '?graph=' + encodeURIComponent(constraint);
  }
  var p = GSP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
GSP.put.acceptMediaType = 'text/turtle';
GSP.put.contentMediaType = 'application/n-quads';



// sparql protocol


/**
 SPARQL.get
 Execute a SPARQL query given a location and a query text.
 The request URL combines the location, the SPARQL endpoint suffix and the url-encoded query text.
 As a GET, content type is provided.
 A promise is created. Given a continuation, proceed with it,
 otherwise the active promise is returned.
 @param {string} location - the host and target repository name
 @param {string} query - the request content
 @param {Object} [options]
 @param {string} options.authorization - the basic authentication string
 @param {string} options.accept - the media type for the response document
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

SPARQL.get = function(location, query, options = {}, continuation) {
  console.debug("SPARQL.get ", query, options);
  var headers = { "Accept": (options["Accept"] || SPARQL.get.acceptMediaType) };
  headers = HTTP.setHeaderAuthorization(headers, options);
  var args = { method: "GET",
               cache: "no-cache",
               headers: headers  };
  location = ensureSPARQLLocation(location);
  if (query) {
    var queryArgument = "query=" + encodeURIComponent(query);
    location += "?" + queryArgument;
  } else {
    throw (new Error(`SPARQL.get: a query text is required: '${location}'`));
  }
  var p = SPARQL.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
SPARQL.get.contentMediaType = null;
SPARQL.get.acceptMediaType = 'application/sparql-results+json';


/**
 SPARQL.view
 Execute a SPARQL query given a location and a view name
 The request URL combines the location, the SPARQL endpoint suffix and the view name.
 A promise is created. Given a continuation, it is supplied to the promise,
 otherwise the active promise is returned.
 */

SPARQL.view = function(location, viewName, options = {}, continuation) {
  var headers = { 
    "Accept": (options["Accept"] || SPARQL.view.acceptMediaType),
  };
  headers = HTTP.setHeaderAuthorization(headers, options);
  var args = { 
    method: "GET",
    cache: "no-cache",
    headers: headers 
  };
  if (viewName) {
    location = location + "/" + viewName;
  } else {
    throw (new Error(`SPARQL.view: a view name is required: '${location}'`));
  }
  var p = SPARQL.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
SPARQL.view.contentMediaType = null;
SPARQL.view.acceptMediaType = 'application/sparql-results+json';


/**
 SPARQL.post
 Execute a SPARQL query given a location and a query text.
 The request URL combines the location and the SPARQL endpoint suffix.
 The query text is sent a the request body.
 A promise is created.
 Given a continuation, it is supplied to the promise,
 otherwise the active promise is returned.
 */
SPARQL.post = function(location, query, options = {}, continuation) {
  console.debug("SPARQL.post", location, query, options);
  var contentType = options["Content-Type"] || SPARQL.post.contentMediaType;
  var headers = { 
    "Accept": (options["Accept"] || SPARQL.post.acceptMediaType),
    "Content-Type": contentType,
  };
  headers = HTTP.setHeaderAuthorization(headers, options);
  if (options.headers) {
    console.warn("adding headers", options.headers);
    for (const [key, value] of Object.entries(options.headers)) {
      headers[key] = value;
    }
  }
  var args = { 
    method: "POST",
    cache: "no-cache",
    headers: headers,
    body: query 
  };
  location = ensureSPARQLLocation(location);
  if (! query) {
    throw (new Error(`SPARQL.get: a query text is required: '${location}'`));
  }

  var p = SPARQL.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
SPARQL.post.acceptMediaType = 'text/turtle';
SPARQL.post.contentMediaType = 'application/sparql-query';


/**
 SESAME.get
 Perform an HTTP get given the location, options for authentication and response
 content type, and an optional continuation operator.
 Given a continuation proceed with the response.
 @param {string} location - the host and target repository name
 @param {Object} [options]
 @param {string} options.authorization - the basic authoentication string
 @param {string} options.accept - the media type for the response document
 @param {string} options.subject - a subject constraint
 @param {string} options.predicate - a predicate constraint
 @param {string} options.object - an object constraint
 @param {string} options.graph - a graph constraint
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

SESAME.get = function(location, options = {}, continuation = null) {
  var headers = { 
    "Accept": (options["Accept"] || SESAME.get.acceptMediaType),
  };
  headers = HTTP.setHeaderAuthorization(headers, options);
  var args = { 
    method: "GET",
    cache: "no-cache",
    headers: headers 
  };
  location = constrainGSLocation(location, options);
  console.debug("SESAME.get:", location, args);
  var p = SESAME.fetchOp(location, args);
  // console.log("SESAME.get: promise: ", p, "continuation: ", continuation);
  return (continuation ? p.then(continuation) : p);
}
SESAME.get.acceptMediaType = 'application/n-quads';
// document.SESAME = SESAME;

/**
 provide general method to encode the authentication token.
 */
HTTP.setHeaderAuthorization = function (headers, options) {
  var authentication = options["Authentication"] || options["Authorization"] || options["authentication"] || options["authorization"];
  if (authentication) {
    if (authentication.startsWith("Bearer")) {
      headers = Object.assign(headers, {"Authorization": authentication})
    } else {
      headers = Object.assign(headers, {"Authorization": 'Basic ' + btoa(authentication)})
    }
  } else if (authentication = (options['token'] ||options['Token'])) {
    headers = headers.set("Authorization", 'Bearer ' + authentication);
  } else {
    delete headers["Authorization"];
  }
  return (headers);
}


/**
 HTTP performs a simple get, but requires an accept content type.
 */

HTTP.get = function(location, options = {}, continuation = null) {
  var mediaType = options["Accept"];
  if (!mediaType) { throw new Error(`HTTP.get: Accept is required.`); }
  var headers = { "Accept": mediaType };
  headers = HTTP.setHeaderAuthorization(headers, options);
  var args = { method: "GET",
               cache: "no-cache",
               headers: headers };
  // no suffix, no constraints, just a simple get
  console.debug("HTTP.get:", location, args);
  var p = HTTP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}

HTTP.head = function(location, options = {}, continuation = null) {
  var headers = {};
  var headers = HTTP.setHeaderAuthorization(headers, options);
  var args = { method: "HEAD",
               cache: "no-cache",
               headers: headers };
  // no suffix, no constraints, just a simple get
  // console.log("HTTP.get:", location, args);
  var p = HTTP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}

/**
 HTTP.put
 Perform an HTTP put given the location, content, options for authentication, and an optional continuation operator.
 The content is first encoded as per the given content type and a request is issued
 with the given headers.
 @param {string} location - the host and target repository name
 @param {string} content - the request content
 @param {Object} [options]
 @param {string} options.etag - the client revision identifer to identify the transaction
 @param {string} options.authorization - the basic authentication string
 @param {string} options.accept - the media type for the response document
 @param {string} options.contentType - the media type for the put document
 @param {string} options.contentDisposition - the replication disposition route
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

HTTP.put = function (location, content, options = {}, continuation) {
  var contentType = options["Content-Type"] || HTTP.put.contentMediaType;
  var headers = { 
    "Accept": (options["Accept"] || HTTP.put.acceptMediaType),
    "Content-Type": contentType,
  };
  headers = HTTP.setHeaderAuthorization(headers, options);
  if (options.etag) { headers["ETag"] = options.etag; }
  if (options.contentDisposition) { headers["Content-Disposition"] = options.contentDisposition; }
  var contentEncoded = "";
  if (content instanceof File) {
    contentEncoded = content;
  } else if (content instanceof Object) {
    content.encode(contentType, function(e) { contentEncoded = e; });
  } else {
    contentEncoded = content;
  }
  var args = { 
    method: "PUT",
    headers: headers,
    body: contentEncoded 
  };
  var p = HTTP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
HTTP.put.acceptMediaType = 'text/turtle';
HTTP.put.contentMediaType = 'text/plain';

HTTP.post = function (location, content, options = {}, continuation) {
  var contentType = options["Content-Type"] || HTTP.post.contentMediaType;
  var headers = { "Accept": (options["Accept"] || HTTP.put.acceptMediaType),
                              "Content-Type": contentType };
  headers = HTTP.setHeaderAuthorization(headers, options);
  if (options.etag) { headers["ETag"] = options.etag };
  if (options.contentDisposition) { headers["Content-Disposition"] = options.contentDisposition };
  var contentEncoded = "";
  if (content instanceof File) {
      contentEncoded = content;
  } else if (content instanceof Object) {
      content.encode(contentType, function(e) { contentEncoded = e; });
  } else {
      contentEncoded = content;
  }
  var args = { method: "POST",
               headers: headers,
               body: contentEncoded };
  var p = HTTP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
HTTP.post.acceptMediaType = 'text/turtle';
HTTP.post.contentMediaType = 'text/plain';

/**
 HTTP.delete
 Perform an HTTP delete given the location, options for authentication, and an optional continuation operator.
 The content is first encoded as per the given content type and a request is issued
 with the given headers.
 @param {string} location - the host and target repository name
 @param {Object} [options]
 @param {string} options.etag - the client revision identifer to identify the transaction
 @param {string} options.authorization - the basic authentication string
 @param {string} options.accept - the media type for the response document
 @param {function} [continuation] - if supplied, used to invoke the fetch promise.
 */

HTTP.delete = function (location, options = {}, continuation) {
  var headers = { 
    "Accept": (options["Accept"] || HTTP.delete.acceptMediaType),
  };
  headers = HTTP.setHeaderAuthorization(headers, options);
  if (options.etag) { headers["ETag"] = options.etag; }
  var args = { 
    method: "DELETE",
    headers: headers,
    body: null 
  };
  var p = HTTP.fetchOp(location, args);
  return (continuation ? p.then(continuation) : p);
}
HTTP.delete.acceptMediaType = 'application/json';
HTTP.delete.contentMediaType = null;
////////////////////////////////////////////////////////////////////////////////

// console.log('rdf-graph-store: loaded');

