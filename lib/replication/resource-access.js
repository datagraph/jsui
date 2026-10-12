// .js definitions for resource access operators
//
// they are arranged by application layer protocol and method
//
// headResource
// deleteResource
// getResource
// postResource
// putResource

// the implementation dispatches initially through the base operators based just on the accept media type.
// where the content type matters, the base operator look for a two-dimensional specialization.
// if the result for the accept type key is an object, it serves for a second level dispatch.
// a "*" media type provides a default at the second level.
// when the result for the accept is a function the base operator calls that directly.

// present interaction operations, simplified as getResource and postResource.
// implement them in terms application level protocol components - HTTP or higher, such as SPARQL pr GraphQL
// and eventuall MQTT and WebSockets.
// present the operations in terms of the interaction goals and content types, rather than protocol
// 
// that could be inverted, but there is value in having this api abstract over media type.
//


import { GSP, SESAME, HTTP, SPARQL } from './rdf-graph-store.js';
import { default as GQLRequest} from './lib/graphql-request/src/index.js';
import { RDFEnvironment, mediaTypeStem } from './rdf-environment.js';
import { CSV } from './lib/okfn/csv.js';

// Helper that invokes an implementation either using a callback or returning a promise.
function invokeImplementation(implementation, location, options, continuation, fail) {
  if (continuation) {
    return implementation(location, options, continuation, fail || console.warn);
  } else {
    return new Promise((accept, reject) => {
      implementation(location, options, accept, reject || fail || console.warn);
    });
  }
}

function invokeImplementationWithContent(implementation, location, content, options, continuation, fail) {
  if (continuation) {
    return implementation(location, content, options, continuation, fail || console.warn);
  } else {
    return new Promise((accept, reject) => {
      implementation(location, content, options, accept, reject || fail || console.warn);
    });
  }
}

/**
 deleteResource
 The accept 'application/json' is the only option for a delete.
 */

export function deleteResource(location, options, continuation, fail) {
  var mediaType = options['Accept'];
  if (!mediaType) {
    mediaType = "application/json";
  }
  const match = mediaTypeStem(mediaType);
  if (match) {
    var implementation = deleteResource[match];
    if (implementation) {
      return invokeImplementation(implementation, location, options, continuation, fail);
    } else if (implementation = deleteResource['text/plain']) {
      return invokeImplementation(implementation, location, options, continuation, fail);
    } else {
      console.trace();
      throw (new Error(`deleteResource: unimplemented media type: '${mediaType}'`));
    }
  } else {
    console.trace();
    throw (new Error(`deleteResource: unrecognized media type: '${mediaType}'`));
  }
}


export function deleteResource_ApplicationJson(location, options, continuation, fail) {
  console.debug("deleteResource['application/json']: ", location, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      console.trace("deleteResource: response: ", response, contentType);
      response.json().then(function(json) {
        console.trace("json:", json);
        continuation(json);
      }).catch(error => {
        console.warn(`deleteResource: error parsing JSON ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`deleteResource: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  HTTP.delete(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`deleteResource: error ${error}`);
      if (fail) fail(error);
    });
}
deleteResource['application/json'] = deleteResource_ApplicationJson;

export function deleteResource_TextPlain(location, options, continuation, fail) {
  console.debug("deleteResource['text/plain']: ", location, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      console.trace("deleteResource: response: ", response, contentType);
      response.text().then(function(body) {
        console.trace("body:", body);
        continuation(body);
      }).catch(error => {
        console.warn(`deleteResource: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`deleteResource: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  HTTP.delete(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`deleteResource: error ${error}`);
      if (fail) fail(error);
    });
}
deleteResource['text/plain'] = deleteResource_TextPlain;


/**
 GET:
 Retrieve and decode the resource according to media types.
 Initiate the request based on the Accept type, but decode based on the actual response Content-Type.

 @param {string} location - the resource location
 @param {Object} options
 @param {string} options.Accept, - the accept media type
 @param {string} options.environment, - the RDF environment
 @param {string} options.Authorization, - an authentication token
 @param {function} [continuation] - if present, the result disposition. if absent, create and return a Promise
 @param {function} [fail] - if present, the error disposition. if absent, use console.log.

 see: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
 */

// excel : would be https://github.com/SheetJS/sheetjs
// this needs to be two-dimensional

export function getResource(location, options, continuation, fail) {
  var mediaType = options['Accept'];
  if (!mediaType) {
    console.trace();
    throw (new Error("getResource: Accept option is required."));
  }
  const match = mediaTypeStem(mediaType);
  if (match) {
    var implementation = getResource[match];
    if (implementation) {
      return invokeImplementation(implementation, location, options, continuation, fail);
          } else if (implementation = getResource['text/plain']) {
      return invokeImplementation(implementation, location, options, continuation, fail);
          } else {
      console.trace();
      throw (new Error(`getResource: unimplemented media type: '${mediaType}'`));
    }
  } else {
    console.trace();
    throw (new Error(`getResource: unrecognized media type: '${mediaType}'`));
  }
}


/**
 HEAD:
 Probe the resource and return the  response for an ok status code
 */

export function headResource (location, options, continuation, fail = console.warn) {
 HTTP.head(location, options,
           function(response) {
             console.debug("HTTP.headResource: response: ", response);
             if (response.ok) {
               continuation(response);
             } else {
               fail(response);
             }
           });
}


/**
 POST:
 Transfer content to the resource according to content media type.
 Decode the response based on the actual response Content-Type.

 @param {Object} location - the resource location
 @param {string | Object} [expression] - content to accompany the request for the resource
 @param {Object} options
 @param {string} options.Accept, - the accept media type
 @param {string} options.'Content-Type', - the content media type

 see: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
 */

export function postResource(location, content, options, continuation, fail) {
  console.debug("postResource: ", location, content, options);
  let acceptType = options['Accept'];
  if (!acceptType) {
    console.trace();
    throw (new Error("postResource: Accept option is required."));
  }
  let acceptMatch = mediaTypeStem(acceptType);
  if (acceptMatch) {
    let implementation = postResource[acceptMatch];
    switch (typeof (implementation)) {
      case "function":
        return invokeImplementationWithContent(implementation, location, content, options, continuation, fail);
      case "object":
        let contentType = options['Content-Type'];
        let contentMatch = (contentType ? mediaTypeStem(contentType) : "*");
        if (contentMatch) {
          implementation = implementation[contentMatch] || implementation["*"];
          switch (typeof (implementation)) {
            case "function":
              return invokeImplementationWithContent(implementation, location, content, options, continuation, fail);
            default:
              console.trace();
              throw (new Error(`postResource: unimplemented media type combination: '${acceptType}'.'${contentType}'`));
          }
        } else {
          console.trace();
          throw (new Error(`postResource: unrecognized content media type: '${contentType}'`));
        }
      default:
        console.trace();
        throw (new Error(`postResource: unrecognized accept media type implementation: '${acceptType}': ${implementation}`));
    }
  } else {
    console.trace();
    throw (new Error(`postResource: unrecognized media type: '${acceptType}'`));
  }
}

/**
 PUT:
 Transfer content to the resource according to content media type.
 Decode the response based on the actual response Content-Type.

 @param {Object} location - the resource location
 @param {string | Object} [expression] - content to accompany the request for the resource
 @param {Object} options
 @param {string} options.Accept, - the accept media type
 @param {string} options.'Content-Type', - the content media type

 see: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
 */

export function putResource(location, content, options, continuation, fail) {
  console.debug("putResource: ", location, content, options);
  var mediaType = options['Accept'];
  if (!mediaType) {
    console.trace();
    throw (new Error("putResource: Accept option is required."));
  }
  var match = mediaTypeStem(mediaType);
  if (match) {
    var implementation = putResource[match];
    switch (typeof (implementation)) {
      case "function":
        return invokeImplementationWithContent(implementation, location, content, options, continuation, fail);
      case "object":
        var contentType = options['Content-Type'];
        var contentMatch = (contentType ? mediaTypeStem(contentType) : "*");
        if (contentMatch) {
          implementation = implementation[contentMatch] || implementation["*"];
          switch (typeof (implementation)) {
            case "function":
              return invokeImplementationWithContent(implementation, location, content, options, continuation, fail);
            default:
              console.trace();
              throw (new Error(`putResource: unimplemented media type combination: '${acceptType}'.'${contentType}'`));
          }
        } else {
          console.trace();
          throw (new Error(`putResource: unrecognized media type: '${contentType}'`));
        }
      default:
        console.trace();
        throw (new Error(`putResource: unrecognized media type implementation: '${acceptType}': ${implementation}`));
    }
  } else {
    console.trace();
    throw (new Error(`putResource: unrecognized media type: '${mediaType}'`));
  }
}

/**
 Given the intent to accept 'application/json' for a get, treat it as a
 simple http GET
 */

export function getResource_ApplicationJson(location, options, continuation, fail) {
  console.debug("getResource_ApplicationJson['application/json']: ", location, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      console.trace("getResource_ApplicationJson: response: ", response, contentType);
      response.json().then(function(json) {
        console.trace("json:", json);
        // don't annotate the json
        continuation(json);
      }).catch(error => {
        console.warn(`getResource_ApplicationJson: error parsing JSON ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`getResource_ApplicationJson: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_ApplicationJson: error ${error}`);
      if (fail) fail(error);
    });
}
getResource['application/json'] = getResource_ApplicationJson;

/**
 getResource['application/n-quads']
 needs to distinguish from GSP requests, which can constrain the result with spog arguments
 v/s straight sesame-like requests. the latter also covers the interaction model of SPARQL
 queries, whether in-line or as views.
 */
 export function getResource_ApplicationNQuads(location, options, continuation, fail) {
  console.debug("getResource: ", options);

  function succeed(response) {
    console.debug("getResource['application/n-quads']: response: ", response);
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      var environment = options.environment || RDFEnvironment.theEnvironment;
      function acceptText(document) {
        console.debug("getResource['application/n-quads']: document:", document);
        var graph = environment.decode(document, contentType);
        if (graph) {
          console.debug("getResource: graph:", graph);
          graph.location = location;
          continuation(graph);
        } else {
          console.warn("getResource: failed to decode", document);
          if (fail) fail(document);
        }
      }
      console.trace("getResource: response: ", response, contentType);
      response.text().then(acceptText).catch(error => {
        console.warn(`getResource: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`getResource: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  // location = ensureServiceLocation(location);
  // could be called with either a sparql endpoint, a view endpoint, or a graph store endpoint
  HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource: error ${error}`);
      if (fail) fail(error);
    });
}
getResource['application/n-quads'] = getResource_ApplicationNQuads;

export function getResource_ApplicationNTriples(location, options, continuation, fail) {
  return (getResource_ApplicationNQuads(location, options, continuation, fail));
}

getResource['application/n-triples'] = getResource_ApplicationNTriples;

export function getResource_ApplicationOctetStream(location, options, continuation, fail) {
  console.debug("getResource_ApplicationOctetStream: ", location, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      console.trace("getResource: response: ", response, contentType);
      response.blob().then(continuation).catch(error => {
        console.warn(`getResource: error parsing blob ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`getResource: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource: error ${error}`);
      if (fail) fail(error);
    });
}
getResource['application/octet-stream'] = getResource_ApplicationOctetStream;
// var ss = null;
// getResource("https://nl4.dydra.com/data/Value_Expectations.xlsx", {"Accept": 'application/octet-stream', acceptBody: console.debug}, function(blob) { blob.arrayBuffer().then(function(buffer) {ss= XLSX.read(buffer, {type:"buffer"})})})

export function getResource_ApplicationVndOpenxmlformatsOfficedocumentSpreadsheetmlSheet(location, options, continuation, fail) {
  console.debug("getResource_ApplicationVndOpenxmlformatsOfficedocumentSpreadsheetmlSheet: ", location, options);
  function succeed(blob) {
    function acceptBuffer(buffer) {
      var bodyContinuation = options.acceptBody;
      if (bodyContinuation) { bodyContinuation(buffer); }
      var sheet = XLSX.read(buffer, {type:"buffer"});
      sheet.mediaType = mediaTypeStem(contentType);
      sheet.location = location;
      continuation(sheet);
    }
    blob.arrayBuffer().then(acceptBuffer);
  }
  getResource_ApplicationOctetStream(location, options, succeed, fail);
}
getResource['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] = getResource_ApplicationVndOpenxmlformatsOfficedocumentSpreadsheetmlSheet;

export function getResource_TextCSV(location, options, continuation, fail) {
  console.debug("getResource_TextCSV: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptBody(document) {
        console.trace("getResource_TextCSV: document:", document);
        var bodyContinuation = options.acceptBody;
        if (bodyContinuation) { bodyContinuation(document); }  // even if it may be invalid
        var csv = CSV.parse(document);
        console.trace("getResource_TextCSV: csv:", csv);
        csv.mediaType = mediaTypeStem(contentType);
        csv.location = location;
        continuation(csv);
      }
      console.trace("getResource_TextCSV: response: ", response, contentType);
      response.text().then(acceptBody);
    } else {
      console.warn(`getResource: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_TextCSV: error ${error}`);
      if (fail) fail(error);
    });
}
getResource['text/csv'] = getResource_TextCSV; 

export function getResource_TextHTML(location, options, continuation, fail) {
  console.debug("getResource_TextHTML: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(document) {
        console.trace("document:", document);
        var html = new DOMParser().parseFromString(document, contentType);
        console.trace("getResource_TextHTML: html:", html);
        html.mediaType = mediaTypeStem(contentType);
        // not permitted : html.location = location;
        continuation(html);
      }
      console.trace("getResource_TextHTML: response: ", response, contentType);
      response.text().then(acceptText);
    }
  }
  HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_TextHTML: error ${error}`);
      if (fail) fail(error);
    });
}
getResource['text/html'] = getResource_TextHTML;
// getResource('https://nl4.dydra.com/data/', {"Accept": "text/html"}, console.debug);


export function getResource_TextPlain(location, options, continuation, fail) {
  console.debug("getResource_TextPlain: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      console.trace("getResource_TextPlain: response: ", response, contentType);
      response.text().then(continuation);
    } else {
      console.warn(`getResource_TextPlain: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_TextPlain: error ${error}`);
      if (fail) fail(error);
    });
}
getResource['text/plain'] = getResource_TextPlain;

/**
 * getResource_SparqlResultsJson
 * @param {string} location 
 * @param {Object} options 
 * @param {string} query 
 * @param {function} continuation 
 * @param {function} fail 
 */
export function getResource_SparqlResultsJson(location, options, continuation, fail) {
  console.debug("getResource_SparqlResultsJson: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptJSON(json) {
        // console.debug("json:", json);
        json.mediaType = mediaTypeStem(contentType);
        json.location = location;
        continuation(json);
      }
      console.trace("getResource_SparqlResultsJson: response: ", response, contentType);
      response.json().then(acceptJSON);
    } else {
      console.warn(`getResource_SparqlResultsJson: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  var query = options['Query'] || options['query'];
  if (query) {
    // if a query is present, it is a sparql request
    SPARQL.get(location, query, options)
      .then(succeed)
      .catch(error => {
        console.warn(`getResource_SparqlResultsJson: error ${error}`);
        if (fail) fail(error);
      });
  } else {
    // otherwise, treat it as a rest request for a view 
    HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_SparqlResultsJson: error ${error}`);
      if (fail) fail(error);
    });
  }
}
getResource['application/sparql-results+json'] = getResource_SparqlResultsJson;

export function getResource_ApplicationSparqlQuery(location, options, continuation, fail) {
  console.debug("getResource_ApplicationSparqlQuery: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(sparql) {
        console.debug("getResource_ApplicationSparqlQuery: sparql: ", sparql);
        continuation(sparql);
      }
      console.trace("getResource_ApplicationSparqlQuery: response: ", response, contentType);
      response.text().then(acceptText);
    } else {
      console.warn(`getResource_SparqlResultsJson: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  var query = options['Query'] || options['query'];
  if (query) {
    // if a query is present, it is a sparql request
    SPARQL.get(location, query, options)
      .then(succeed)
      .catch(error => {
        console.warn(`getResource_ApplicationSparqlQuery: error ${error}`);
        if (fail) fail(error);
      });
  } else {
    // otherwise, treat it as a rest request for a view 
    HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_ApplicationSparqlQuery: error ${error}`);
      if (fail) fail(error);
    });
  }
}
getResource['application/sparql-query'] = getResource_ApplicationSparqlQuery;

/**
 * getResource_ApplicationSparqlQueryJson
 * Request the query expression variants for a view - as json
 */
export function getResource_ApplicationSparqlQueryJson(location, options, continuation, fail) {
  console.debug("getResource_ApplicationSparqlQueryJson: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptJSON(json) {
        console.debug("json:", json);
        json.mediaType = mediaTypeStem(contentType);
        json.location = location;
        continuation(json);
      }
      console.debug("getResource_ApplicationSparqlQueryJson: response: ", response, contentType);
      response.json().then(acceptJSON);
    } else {
      console.warn(`getResource_SparqlResultsJson: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  var query = options['Query'] || options['query'];
  if (query) {
    // if a query is present, it is a sparql request
    SPARQL.get(location, query, options)
      .then(succeed)
      .catch(error => {
        console.warn(`getResource_ApplicationSparqlQueryJson: error ${error}`);
        if (fail) fail(error);
      });
  } else {
    // otherwise, treat it as a rest request for a view 
    HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_ApplicationSparqlQueryJson: error ${error}`);
      if (fail) fail(error);
    });
  }
}
getResource['application/sparql-query+json'] = getResource_ApplicationSparqlQueryJson;

/**
 Request the query expression variants for a view - as abstract algebra
 */
export function getResource_ApplicationSparqlQueryAlgebra(location, options, continuation, fail) {
  console.debug("getResource_ApplicationSparqlQueryAlgebra: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(text) {
        console.debug("getResource_ApplicationSparqlQueryAlgebra: text:", text);
        continuation(text);
      }
      console.debug("getResource_ApplicationSparqlQueryAlgebra: response: ", response, contentType);
      response.text().then(acceptText);
    } else {
      console.warn(`getResource_SparqlResultsJson: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  var query = options['Query'] || options['query'];
  if (query) {
    // if a query is present, it is a sparql request
    SPARQL.get(location, query, options)
      .then(succeed)
      .catch(error => {
        console.warn(`getResource_ApplicationSparqlQueryAlgebra: error ${error}`);
        if (fail) fail(error);
      });
  } else {
    // otherwise, treat it as a rest request for a view 
    HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_ApplicationSparqlQueryAlgebra: error ${error}`);
      if (fail) fail(error);
    });
  }
}
getResource['application/sparql-query-algebra'] = getResource_ApplicationSparqlQueryAlgebra;

export function getResource_ApplicationSparqlQueryOlogSVGXML(location, options, continuation, fail) {
  console.debug("getResource_ApplicationSparqlQueryOlogSVGXML: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(svg) {
        console.debug("getResource_ApplicationSparqlQueryOlogSVGXML: text: ", svg);
        continuation(svg);
      }
      console.trace("getResource_ApplicationSparqlQueryOlogSVGXML: response: ", response, contentType);
      response.text().then(acceptText);
    } else {
      console.warn(`getResource_ApplicationSparqlQueryOlogSVGXML: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  var query = options['Query'] || options['query'];
  if (query) {
    // if a query is present, it is a sparql request
    SPARQL.get(location, query, options)
      .then(succeed)
      .catch(error => {
        console.warn(`getResource_ApplicationSparqlQueryOlogSVGXML: error ${error}`);
        if (fail) fail(error);
      });
  } else {
    // otherwise, treat it as a rest request for a view 
    HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResource_ApplicationSparqlQueryOlogSVGXML: error ${error}`);
      if (fail) fail(error);
    });
  }
}
getResource['application/sparql-query+olog+svg+xml'] = getResource_ApplicationSparqlQueryOlogSVGXML;

export function getResourceImageVndDydraSparqlResultsCircosSVGXML(location, options, continuation, fail) {
  console.debug("getResourceImageVndDydraSparqlResultsCircosSVGXML: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(xml) {
        console.debug("getResource: sparql: ", xml);
        continuation(xml);
      }
      console.trace("getResource: response: ", response, contentType);
      response.text().then(acceptText);
    } else {
      console.warn(`getResourceImageVndDydraSparqlResultsCircosSVGXML: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  var query = options['Query'] || options['query'];
  if (query) {
    // if a query is present, it is a sparql request
    SPARQL.get(location, query, options)
      .then(succeed)
      .catch(error => {
        console.warn(`getResourceImageVndDydraSparqlResultsCircosSVGXML: error ${error}`);
        if (fail) fail(error);
      });
  } else {
    // otherwise, treat it as a rest request for a view 
    HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResourceImageVndDydraSparqlResultsCircosSVGXML: error ${error}`);
      if (fail) fail(error);
    });
  }
}
getResource['image/vnd.dydra.sparql-results+circos+svg+xml'] = getResourceImageVndDydraSparqlResultsCircosSVGXML;

export function getResourceImageVndDydraSparqlResultsGraphvizSVGXML(location, options, continuation, fail) {
  console.debug("getResourceImageVndDydraSparqlResultsGraphvizSVGXML: ", location, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(xml) {
        console.debug("getResourceImageVndDydraSparqlResultsGraphvizSVGXML: xml: ", xml);
        continuation(xml);
      }
      console.trace("getResourceImageVndDydraSparqlResultsGraphvizSVGXML: response: ", response, contentType);
      response.text().then(acceptText);
    } else {
      console.warn(`getResourceImageVndDydraSparqlResultsCircosSVGXML: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  var query = options['Query'] || options['query'];
  if (query) {
    // if a query is present, it is a sparql request
    SPARQL.get(location, query, options)
      .then(succeed)
      .catch(error => {
        console.warn(`getResourceImageVndDydraSparqlResultsCircosSVGXML: error ${error}`);
        if (fail) fail(error);
      });
  } else {
    // otherwise, treat it as a rest request for a view 
    HTTP.get(location, options)
    .then(succeed)
    .catch(error => {
      console.warn(`getResourceImageVndDydraSparqlResultsCircosSVGXML: error ${error}`);
      if (fail) fail(error);
    });
  }
}
getResource['image/vnd.dydra.sparql-results+graphviz+svg+xml'] = getResourceImageVndDydraSparqlResultsGraphvizSVGXML;

/**
 Post a query with the expection that it be reflected back
 */
export function postResourceApplicationSparqlQuery(location, query, options, continuation, fail) {
  console.debug("postResourceApplicationSparqlQuery: ", location, query, options);
  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(text) {
        console.debug("postResourceApplicationSparqlQuery: text:", text);
        continuation(text);
      }
      console.trace("postResourceApplicationSparqlQuery: response: ", response, contentType);
      response.text().then(acceptText);
    } else {
      console.warn(`postResourceApplicationSparqlQuery: failed ${response.status}`);
      if (fail) fail(response);
    }
  }
  HTTP.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResourceApplicationSparqlQuery: error ${error}`);
      if (fail) fail(error);
    });
}
postResource['application/sparql-query'] = postResourceApplicationSparqlQuery;

/**
 * postResource_ApplicationSparqlQueryJson
 * Post a query with the expectation that it be reflected back - as json
 */
 function postResource_ApplicationSparqlQueryJson(location, query, options, continuation, fail) {
  console.debug("postResource_ApplicationSparqlQueryJson: ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptJSON(json) {
        console.debug("json:", json);
        json.mediaType = mediaTypeStem(contentType);
        json.location = location;
        continuation(json);
      }
      console.debug("postResource: response: ", response, contentType);
      response.json().then(acceptJSON).catch(error => {
        console.warn(`postResource_ApplicationSparqlQueryJson: error parsing JSON ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationSparqlQueryJson: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationSparqlQueryJson: error ${error}`);
      if (fail) fail(error);
    });
}
postResource['application/sparql-query+json'] = postResource_ApplicationSparqlQueryJson;

/**
 * postResource_ApplicationSparqlQuerySse
 * Post a query with the expectation that it be reflected back - as an SSE
 */
 function postResource_ApplicationSparqlQuerySse(location, query, options, continuation, fail) {
  console.debug("postResource_ApplicationSparqlQuerySse: ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(text) {
        console.debug("postResource.text:", text);
        continuation(text);
      }
      console.debug("postResource: response: ", response, contentType);
      response.text().then(acceptText).catch(error => {
        console.warn(`postResource_ApplicationSparqlQuerySse: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationSparqlQuerySse: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationSparqlQuerySse: error ${error}`);
      if (fail) fail(error);
    });
}
postResource['application/sparql-query+sse'] = postResource_ApplicationSparqlQuerySse;

/**
 * postResource_ApplicationSparqlQueryAlgebra
 * Post a query with the expectation that it be reflected back - as query algebra
 */
 function postResource_ApplicationSparqlQueryAlgebra(location, query, options, continuation, fail) {
  console.debug("postResource_ApplicationSparqlQueryAlgebra: ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(text) {
        console.debug("postResource.text:", text);
        continuation(text);
      }
      console.debug("postResource: response: ", response, contentType);
      response.text().then(acceptText).catch(error => {
        console.warn(`postResource_ApplicationSparqlQueryAlgebra: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationSparqlQueryAlgebra: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationSparqlQueryAlgebra: error ${error}`);
      if (fail) fail(error);
    });
}
postResource['application/sparql-query-algebra'] = postResource_ApplicationSparqlQueryAlgebra;

/**
 * postResource_ApplicationSparqlQueryExecution
 * Request a query with the expectation that it be reflected back - as an execution plan text
 */
export function postResource_ApplicationSparqlQueryExecution(location, query, options, continuation, fail) {
  console.debug("postResource_ApplicationSparqlQueryExecution: ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(text) {
        console.debug("text:", text);
        continuation(text);
      }
      console.debug("postResource_ApplicationSparqlQueryExecution: response: ", response, contentType);
      response.text().then(acceptText).catch(error => {
        console.warn(`postResource_ApplicationSparqlQueryExecution: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationSparqlQueryExecution: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationSparqlQueryExecution: error ${error}`);
      if (fail) fail(error);
    });
}

postResource['application/sparql-query-execution'] = postResource_ApplicationSparqlQueryExecution;

/**
 * postResource_ApplicationSparqlQueryPlan
 * Post a query with the expectation that it be reflected back - as query plan
 */
 function postResource_ApplicationSparqlQueryPlan(location, query, options, continuation, fail) {
  console.debug("postResource_ApplicationSparqlQueryPlan: ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(text) {
        console.debug("text:", text);
        continuation(text);
      }
      console.debug("postResource: response: ", response, contentType);
      response.text().then(acceptText).catch(error => {
        console.warn(`postResource_ApplicationSparqlQueryPlan: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationSparqlQueryPlan: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationSparqlQueryPlan: error ${error}`);
      if (fail) fail(error);
    });
}
postResource['application/sparql-query-plan'] = postResource_ApplicationSparqlQueryPlan;

/**
 * postResource_ApplicationSparqlResultsJson
 * Post a query and expect the results in json
 */
function postResource_ApplicationSparqlResultsJson(location, query, options, continuation, fail) {
  console.debug("postResource_ApplicationSparqlResultsJson: ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptJSON(json) {
        console.debug("json:", json);
        json.mediaType = mediaTypeStem(contentType);
        json.location = location;
        continuation(json);
      }
      console.debug("postResource: response: ", response, contentType);
      response.json().then(acceptJSON).catch(error => {
        console.warn(`postResource_ApplicationSparqlResultsJson: error parsing JSON ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationSparqlResultsJson: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationSparqlResultsJson: error ${error}`);
      if (fail) fail(error);
    });
}
postResource['application/sparql-results+json'] = postResource_ApplicationSparqlResultsJson;

/**
 * A POST request for application/json needs to distinguish the request based on content type
 * The simple form of that api allows no error reccovery.
 */

postResource['application/json'] = {};

export function postResource_ApplicationJson(location, query, options, continuation, fail) {
  console.debug("postResource: application/json ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      console.debug("postResource_ApplicationJson: response: ", response, contentType);
      response.json().then(function(json) {
        console.debug("json:", json);
        json.mediaType = mediaTypeStem(contentType);
        json.location = location;
        continuation(json);
      }).catch(error => {
        console.warn(`postResource_ApplicationJson: error parsing JSON ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationJson: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  HTTP.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationJson: error ${error}`);
      if (fail) fail(error);
    });
}
postResource['application/json']['*'] = postResource_ApplicationJson;

function postResource_ApplicationJsonApplicationSparqlQuery(location, query, options, continuation, fail) {
  console.debug("postResource_ApplicationJsonApplicationSparqlQuery: ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptJSON(json) {
        console.debug("json:", json);
        json.mediaType = mediaTypeStem(contentType);
        json.location = location;
        continuation(json);
      }
      console.debug("postResource: response: ", response, contentType);
      response.json().then(acceptJSON).catch(error => {
        console.warn(`postResource_ApplicationJsonApplicationSparqlQuery: error parsing JSON ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationJsonApplicationSparqlQuery: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationJsonApplicationSparqlQuery: error ${error}`);
      if (fail) fail(error);
    });
}

postResource['application/json']['application/sparql-query'] = postResource_ApplicationJsonApplicationSparqlQuery;
postResource['application/json']['application/sparql-update'] = postResource_ApplicationJsonApplicationSparqlQuery;
postResource['application/json']['application/json'] = postResource_ApplicationJsonApplicationSparqlQuery;

export function postResource_ApplicationJsonApplicationGraphQL(location, query, options, continuation, fail) {
  console.debug("postResource: a/j ", location, query, options);
  // the signature is url, query variables
  GQLRequest(location, query, {})
    .then(function (json) {
      // console.debug("json:", json);
      // not available there: json.mediaType = mediaTypeStem(contentType);
      json.location = location;
      continuation(json);
    }).catch(error => {
      console.warn(`postResource_ApplicationJsonApplicationGraphQL: error parsing GraphQL ${error}`);
      if (fail) fail(error);
    })
  }
postResource['application/json']['application/graphql'] = postResource_ApplicationJsonApplicationGraphQL;

// var query = '{ Movie(title: "Inception") { releaseDate actors { name } } }'
// postResource('https://api.graph.cool/simple/v1/movies', query, {"Accept": 'application/json'}, console.debug);

/**
 postResource['application/n-quads']
 this can be either a GSP import or a SPARQL query.
 */
postResource['application/n-quads'] = {};

/**
 * postResource_ApplicationNQuads_SparqlQuery
 * PostResource with sparql content, to be executed as a SPARQL query, to return N-quads
 */
export function postResource_ApplicationNQuads_SparqlQuery(location, content, options, continuation, fail) {
  console.debug("postResource_ApplicationNQuads_SparqlQuery: ", options);

  function succeed(response) {
    console.debug("postResource_ApplicationNQuads_SparqlQuery: response: ", response);
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(document) {
        console.trace("document:", document);
        var graph;
        if (document) {
          graph = RDFEnvironment.theEnvironment.decode(document, contentType);
        } else {
          graph = RDFEnvironment.theEnvironment.createGraph([]);
        }
        console.trace("postResource_ApplicationNQuads_SparqlQuery: graph:", graph);
        graph.location = location;
        graph.contentType = mediaTypeStem(contentType);
        continuation(graph);
      }
      console.trace("postResource_ApplicationNQuads_SparqlQuery: response: ", response, contentType);
      response.text().then(acceptText).catch(error => {
        console.warn(`postResource_ApplicationNQuads_SparqlQuery: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationNQuads_SparqlQuery: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, content, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationNQuads_SparqlQuery: error ${error}`);
      if (fail) fail(error);
    });
}
postResource['application/n-quads']['application/sparql-query'] = postResource_ApplicationNQuads_SparqlQuery;

/**
 * postResource_ApplicationNQuads
 * postResource with non-sparql content executed as a graph store request to import rdf content
 */
export function postResource_ApplicationNQuads(location, content, options, continuation, fail) {
  console.log("postResource_ApplicationNQuads: ", options);

  function succeed(response) {
    console.debug("postResource_ApplicationNQuads: response: ", response);
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(document) {
        console.trace("document:", document);
        var graph;
        if (document) {
          graph = RDFEnvironment.theEnvironment.decode(document, contentType);
        } else {
          graph = RDFEnvironment.theEnvironment.createGraph([]);
        }
        console.trace("postResource: graph:", graph);
        graph.location = location;
        graph.contentType = mediaTypeStem(contentType);
        continuation(graph);
      }
      console.trace("postResource: response: ", response, contentType);
      response.text().then(acceptText).catch(error => {
        console.warn(`postResource_ApplicationNQuads: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_ApplicationNQuads: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  GSP.post(location, content, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_ApplicationNQuads: error ${error}`);
      if (fail) fail(error);
    });
}

postResource['application/n-quads']['*'] = postResource_ApplicationNQuads;
postResource['application/n-triples'] = postResource['application/n-quads'];

/**
 postResource_TextCsv
 Post a SPARQL request and expect a text/csv response
*/
export function postResource_TextCsv(location, query, options, continuation, fail) {
  console.debug("postResource_TextCsv: ", location, query, options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptBody(document) {
        console.trace("postResource_TextCsv: document:", document);
        var bodyContinuation = options.acceptBody;
        if (bodyContinuation) { bodyContinuation(document); }  // even if it may be invalid
        if (options.parse === false) {
          continuation(document);
        } else {
          var csv = CSV.parse(document);
          console.trace("postResource_TextCsv: csv:", csv);
          csv.mediaType = mediaTypeStem(contentType);
          csv.location = location;
          continuation(csv);
        }
      }
      console.trace("postResource_TextCsv: response: ", response, contentType);
      response.text().then(acceptBody).catch(error => {
        console.warn(`postResource_TextCsv: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`postResource_TextCsv: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  SPARQL.post(location, query, options)
    .then(succeed)
    .catch(error => {
      console.warn(`postResource_TextCsv: error ${error}`);
      if (fail) fail(error);
    });
}

postResource['text/csv'] = postResource_TextCsv;


/**
 putResource['application/n-quads']
 this can be either a GSP import or a SPARQL query.
 */
putResource['application/n-quads'] = {};

export function putResource_ApplicationNQuads(location, content, options, continuation, fail) {
  console.debug("putResource: ", options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      console.trace("putResource_ApplicationNQuads: response: ", response, contentType);
      response.text().then(function(document) {
        console.trace("document:", document);
        var graph;
        if (document) {
          graph = RDFEnvironment.theEnvironment.decode(document, contentType);
        } else {
          graph = RDFEnvironment.theEnvironment.createGraph([]);
        }
        console.trace("putResource_ApplicationNQuads: graph:", graph);
        graph.location = location;
        graph.contentType = mediaTypeStem(contentType);
        continuation(graph);
      }).catch(error => {
        console.warn(`putResource_ApplicationNQuads: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`putResource_ApplicationNQuads: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  HTTP.put(location, content, options)
    .then(succeed)
    .catch(error => {
      console.warn(`putResource_ApplicationNQuads: error ${error}`);
      if (fail) fail(error);
    });
}
putResource['application/n-quads']['*'] = putResource_ApplicationNQuads;

export function putResource_ApplicationNQuads_Sparql(location, content, options, continuation, fail) {
  console.debug("putResource_ApplicationNQuads_Sparql: ", options);

  function succeed(response) {
    if (response.ok) {
      var contentType = response.headers.get('Content-Type');
      function acceptText(document) {
        console.trace("document:", document);
        var graph;
        if (document) {
          graph = RDFEnvironment.theEnvironment.decode(document, contentType);
        } else {
          graph = RDFEnvironment.theEnvironment.createGraph([]);
        }
        console.trace("putResource: graph:", graph);
        graph.location = location;
        graph.contentType = mediaTypeStem(contentType);
        continuation(graph);
      }
      console.trace("putResource: response: ", response, contentType);
      response.text().then(acceptText).catch(error => {
        console.warn(`putResource_ApplicationNQuads_Sparql: error parsing text ${error}`);
        if (fail) fail(error);
      });
    } else {
      console.warn(`putResource_ApplicationNQuads_Sparql: failed ${response.status}`);
      if (fail) fail(response);
    }
  }

  HTTP.put(location, content, options)
    .then(succeed)
    .catch(error => {
      console.warn(`putResource_ApplicationNQuads_Sparql: error ${error}`);
      if (fail) fail(error);
    });
}
putResource['application/n-quads']['application/sparql-query'] = putResource_ApplicationNQuads_Sparql;
putResource['application/n-quads']["application/sparql-update"] = putResource_ApplicationNQuads_Sparql;

putResource['application/n-triples'] = putResource['application/n-quads'];



