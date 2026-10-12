import { AuthStore } from "./auth_store.js";

const normalizeHost = (host) => {
  let baseUrl = host.trim();
  if (!baseUrl) {
    return "";
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `https://${baseUrl}`;
  }
  return baseUrl.replace(/\/$/, "");
};

const buildAuthHeader = (accountName, secret) => {
  if (!secret) return null;
  const trimmed = secret.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return `Bearer ${trimmed.slice(7).trim()}`;
  }
  if (trimmed.startsWith(":")) {
    const token = trimmed.slice(1).trim();
    return token ? `Bearer ${token}` : null;
  }
  if (trimmed.toLowerCase().startsWith("token:")) {
    return `Bearer ${trimmed.slice(6).trim()}`;
  }
  // For basic auth: base64 encode "username:password"
  // Ensure accountName is trimmed and credentials are properly formatted
  const username = accountName.trim();
  const password = trimmed;
  const credentials = `${username}:${password}`;
  const encoded = btoa(credentials);
  return `Basic ${encoded}`;
};

export const authenticateAccount = async ({ host, accountName, secret }) => {
  const baseUrl = normalizeHost(host || "");
  if (!baseUrl || !accountName || !secret) {
    throw new Error("Host, account, and password/token are required.");
  }
  const authHeader = buildAuthHeader(accountName, secret);
  const url = `${baseUrl}/system/accounts/${encodeURIComponent(accountName)}/configuration`;
  
  // Debug: Log the auth header format (without exposing the actual password)
  if (authHeader && authHeader.startsWith("Basic ")) {
    const encodedPart = authHeader.substring(6);
    try {
      const decoded = atob(encodedPart);
      const [username, password] = decoded.split(":", 2);
      console.info("auth: Basic auth header details", {
        headerFormat: "Basic <base64>",
        encodedBase64: encodedPart,
        encodedLength: encodedPart.length,
        username: username,
        usernameLength: username?.length || 0,
        passwordLength: password?.length || 0,
        decodedFormat: `${username}:${"*".repeat(password?.length || 0)}`,
        // Verify the encoding by re-encoding
        reEncodedMatches: btoa(decoded) === encodedPart,
      });
    } catch (e) {
      console.error("auth: Failed to decode Basic auth header", e);
      console.info("auth: Basic auth header (raw)", {
        headerFormat: "Basic <base64>",
        encodedBase64: encodedPart,
        encodedLength: encodedPart.length,
      });
    }
  }
  
  console.info("auth: request", {
    url,
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: authHeader ? (authHeader.startsWith("Basic ") ? "Basic ***" : authHeader) : "",
    },
  });
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: authHeader,
    },
    credentials: "include", // Include credentials (cookies) in case backend needs them
  });
  
  console.info("auth: response", {
    url,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  });
  
  if (!response.ok) {
    // Try to get more error details
    let errorMessage = `Authentication failed: ${response.status} ${response.statusText}`;
    try {
      const errorBody = await response.text();
      if (errorBody) {
        console.error("auth: error response body", errorBody);
        try {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.error || errorJson.message) {
            errorMessage += ` - ${errorJson.error || errorJson.message}`;
          }
        } catch (e) {
          // Not JSON, use as-is
          if (errorBody.length < 200) {
            errorMessage += ` - ${errorBody}`;
          }
        }
      }
    } catch (e) {
      // Ignore errors reading response body
    }
    throw new Error(errorMessage);
  }
  const config = await response.json();

  // The access token the server hands back, when it hands one back.
  //
  // This resource is how a password is exchanged for a token, so for a password
  // login the server's answer is the only source.  But the secret may already BE
  // a token -- the field accepts `:tok', `token:tok' and `bearer tok' -- and then
  // asking the server to return one is asking it to tell us what we just told it.
  //
  // That distinction stopped being academic: nl4 answers this resource with the
  // JSON string "NIL" for a valid account under a valid token, while
  // /system/accounts/{a} returns the account in full.  The configuration document
  // is assembled by a patch the deployed image loads (see the note at the head of
  // gensrc/odbc/metadata.lisp), so a host without it has no configuration to give.
  // A token login does not need one, and refusing to proceed locked out a session
  // that was already authenticated.
  const configured = (config && typeof config === "object") ? config : {};
  const supplied = authHeader && authHeader.startsWith("Bearer ")
                 ? authHeader.slice(7).trim() : null;
  const token = configured.accessToken || supplied;
  if (!token) {
    throw new Error(
      "Server did not return an access token. Log in with a token instead of a "
    + "password -- prefix it with `:' -- or use a host that serves "
    + "/system/accounts/<account>/configuration.");
  }
  return { token, config: configured, baseUrl };
};
