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
  if (!config.accessToken) {
    throw new Error("Server did not return an access token.");
  }
  return { token: config.accessToken, config, baseUrl };
};
