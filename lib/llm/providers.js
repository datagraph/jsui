/**
 * Provider adapters for the prompt pane's tool-call loop.
 *
 * Why a provider seam at all: the loop itself -- ask, relay the tool calls,
 * feed the results back, ask again -- is the same everywhere.  What differs is
 * the wire shape: where the key goes, what a tool definition is called, how a
 * tool call comes back, and how a tool result is handed over.  Each provider
 * below is exactly that difference and nothing else, so the loop in
 * tool-adapter.js never learns which provider it is driving.
 *
 * Why not a remote Claude Code instance.  Claude Code is a CLI and an IDE/desktop
 * tool; it exposes no HTTP endpoint that a browser page can POST a prompt to and
 * receive tool-use blocks from, and the Agent SDK that would drive one is a Node
 * library.  Targeting it would mean standing up a server shim -- which would then
 * hold the key, defeating the decision that the LLM location and key are typed
 * into the page like the dydra host and token.  So the implemented provider is
 * Anthropic's remote Messages API, called directly from the browser.  A
 * `claude-code` provider can be registered here later if a shim is ever wanted;
 * nothing else would change.
 *
 * Three locations are registered: Anthropic's Messages API, OpenAI's Chat
 * Completions API, and OpenCode's inference gateway, which reaches each model
 * in that model's own shape (see `route').  Each also says where its models are listed, so the panes
 * can offer the models a location actually has rather than a typed guess.
 */

export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * The Messages API.
 *
 * Note the browser header: api.anthropic.com refuses cross-origin requests from
 * a page unless it is sent, because sending an API key from a browser exposes it
 * to anyone using that browser.  Here the key is the user's own, typed into
 * their own page and held only in memory -- the same standing as the dydra token
 * -- so the exposure is the one already accepted for that token.
 */
const anthropic = {
  id: "anthropic",
  label: "Anthropic Messages API",
  defaultEndpoint: "https://api.anthropic.com/v1/messages",
  defaultModel: "claude-opus-5",
  modelsEndpoint: "https://api.anthropic.com/v1/models?limit=1000",
  workspaceHint: "wrkspc_… (org-scoped keys)",
  supportsTools: true,

  /**
   * `workspaceId' is required when the key is scoped to the organization rather
   * than to one workspace: such a key does not say by itself which workspace to
   * bill and account the call to, and the API refuses it until the header names
   * one.  A workspace-scoped key carries that already and needs no header.  The
   * id is the `wrkspc_…' in the console URL of the workspace.
   */
  headers({ apiKey, workspaceId, browser = true }) {
    return {
      "Content-Type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
      ...(browser ? { "anthropic-dangerous-direct-browser-access": "true" } : {}),
    };
  },

  /** An MCP tool descriptor as this provider wants to read it. */
  toolSpec(tool) {
    return {
      name: tool.name,
      description: tool.description || "",
      // MCP says inputSchema; the Messages API says input_schema.  That single
      // rename is most of what a provider adapter is.
      input_schema: tool.inputSchema || tool.input_schema
                 || { type: "object", properties: {} },
    };
  },

  request({ model, system, messages, tools, maxTokens = 4096 }) {
    return {
      model, max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(tools && tools.length ? { tools } : {}),
      messages,
    };
  },

  /**
   * Read one reply.  `toolCalls` is the only part the loop acts on; `raw` is
   * carried back verbatim as the next assistant message, because the API
   * requires the tool_use blocks it issued to reappear exactly.
   */
  read(json) {
    const content = Array.isArray(json?.content) ? json.content : [];
    const text = content.filter((b) => b.type === "text")
                        .map((b) => b.text).join("\n").trim();
    const toolCalls = content.filter((b) => b.type === "tool_use")
                             .map((b) => ({ id: b.id, name: b.name, input: b.input || {} }));
    return {
      text, toolCalls,
      // The model the provider ACTUALLY served, which is not always the one
      // asked for: a family name can be answered with a point release, and
      // Article 50 provenance is only worth recording if it records the fact
      // rather than the request (`ui-generator.md' §2.6, R-P1).
      model: json?.model || null,
      stopReason: json?.stop_reason || null,
      usage: json?.usage || null,
      assistantMessage: { role: "assistant", content },
      error: json?.error ? (json.error.message || JSON.stringify(json.error)) : null,
    };
  },

  /** The results of one batch of tool calls, as the next user message. */
  toolResultMessage(results) {
    return {
      role: "user",
      content: results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.text ?? "",
        ...(r.ok ? {} : { is_error: true }),
      })),
    };
  },

  /** GET /v1/models answers newest first, with a display name beside each id. */
  readModels(json) {
    const data = Array.isArray(json?.data) ? json.data : [];
    return data.filter((m) => m && m.id)
               .map((m) => ({ id: m.id, label: m.display_name || m.id }));
  },
};

/**
 * The Chat Completions API (https://platform.openai.com/docs/api-reference).
 *
 * The same loop, a different wire shape: the key is a bearer token, a tool is a
 * `function' with `parameters', the system prompt is the first message rather
 * than a field, a tool call comes back in `message.tool_calls' with its
 * arguments as a JSON *string*, and each result goes back as its own `tool'
 * message -- so toolResultMessage answers with a list, one per call.
 *
 * The same shape is spoken by most self-hosted and proxy servers, so an "other"
 * location that is not a Messages endpoint is driven through this provider.
 *
 * api.openai.com answers cross-origin requests, so no browser header is needed;
 * the exposure of a key typed into the page is the one already accepted above.
 */
const openai = {
  id: "openai",
  label: "OpenAI Chat Completions API",
  defaultEndpoint: "https://api.openai.com/v1/chat/completions",
  defaultModel: "gpt-5",
  modelsEndpoint: "https://api.openai.com/v1/models",
  workspaceHint: "proj_… (optional project)",
  supportsTools: true,

  /** `workspaceId' carries the project, for keys that belong to several. */
  headers({ apiKey, workspaceId }) {
    return {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(workspaceId ? { "OpenAI-Project": workspaceId } : {}),
    };
  },

  toolSpec(tool) {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: tool.inputSchema || tool.input_schema
                 || { type: "object", properties: {} },
      },
    };
  },

  request({ model, system, messages, tools, maxTokens = 4096 }) {
    return {
      model, max_completion_tokens: maxTokens,
      messages: system ? [{ role: "system", content: system }, ...messages] : messages,
      ...(tools && tools.length ? { tools } : {}),
    };
  },

  read(json) {
    const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
    const message = choice?.message || { role: "assistant", content: "" };
    const text = typeof message.content === "string" ? message.content.trim() : "";
    const toolCalls = (message.tool_calls || [])
      .filter((c) => c.type === "function" || c.function)
      .map((c) => {
        let input = {};
        try { input = JSON.parse(c.function?.arguments || "{}") || {}; }
        catch { input = { _unparsed: c.function?.arguments }; }
        return { id: c.id, name: c.function?.name, input };
      });
    return {
      text, toolCalls,
      // The model the provider ACTUALLY served, which is not always the one
      // asked for: a family name can be answered with a point release, and
      // Article 50 provenance is only worth recording if it records the fact
      // rather than the request (`ui-generator.md' §2.6, R-P1).
      model: json?.model || null,
      stopReason: choice?.finish_reason || null,
      usage: json?.usage || null,
      // carried back verbatim, as the API requires the tool_calls it issued
      assistantMessage: message,
      error: json?.error ? (json.error.message || JSON.stringify(json.error)) : null,
    };
  },

  toolResultMessage(results) {
    return results.map((r) => ({
      role: "tool",
      tool_call_id: r.id,
      content: r.ok ? (r.text ?? "") : `ERROR: ${r.text ?? ""}`,
    }));
  },

  /**
   * The list holds every model the key can reach -- embeddings, speech, images
   * and moderation among them -- and only the chat models can drive the loop.
   * Newest first, as the Messages list is.
   */
  readModels(json) {
    const data = Array.isArray(json?.data) ? json.data : [];
    const notChat = /embed|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|babbage|davinci|sora/i;
    return data.filter((m) => m && m.id && !notChat.test(m.id))
               .sort((x, y) => (y.created || 0) - (x.created || 0))
               .map((m) => ({ id: m.id, label: m.id }));
  },
};

/**
 * The OpenAI Responses API -- not offered as a location of its own, but the
 * shape a gateway uses for some models (OpenCode serves GPT models this way).
 *
 * A tool is a flat `function'; the system prompt is `instructions'; the reply is
 * a list of output items, of which `message' items carry the text and
 * `function_call' items the calls.  The whole list is replayed as the next
 * input, and each result follows as a `function_call_output' item.
 */
const openaiResponses = {
  id: "openai-responses",
  label: "OpenAI Responses API",
  supportsTools: true,
  headers: openai.headers,

  toolSpec(tool) {
    return {
      type: "function",
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema || tool.input_schema
               || { type: "object", properties: {} },
    };
  },

  request({ model, system, messages, tools, maxTokens = 4096 }) {
    return {
      model, max_output_tokens: maxTokens,
      ...(system ? { instructions: system } : {}),
      input: messages,
      ...(tools && tools.length ? { tools } : {}),
    };
  },

  read(json) {
    const output = Array.isArray(json?.output) ? json.output : [];
    const text = output.filter((o) => o.type === "message")
      .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
      .filter((c) => c.type === "output_text").map((c) => c.text).join("\n").trim();
    const toolCalls = output.filter((o) => o.type === "function_call").map((c) => {
      let input = {};
      try { input = JSON.parse(c.arguments || "{}") || {}; }
      catch { input = { _unparsed: c.arguments }; }
      return { id: c.call_id, name: c.name, input };
    });
    return {
      text, toolCalls,
      // The model the provider ACTUALLY served, which is not always the one
      // asked for: a family name can be answered with a point release, and
      // Article 50 provenance is only worth recording if it records the fact
      // rather than the request (`ui-generator.md' §2.6, R-P1).
      model: json?.model || null,
      stopReason: json?.incomplete_details?.reason || json?.status || null,
      usage: json?.usage || null,
      assistantMessage: output,          // a list: the loop replays every item
      error: json?.error ? (json.error.message || JSON.stringify(json.error)) : null,
    };
  },

  toolResultMessage(results) {
    return results.map((r) => ({
      type: "function_call_output",
      call_id: r.id,
      output: r.ok ? (r.text ?? "") : `ERROR: ${r.text ?? ""}`,
    }));
  },

  readModels: openai.readModels,
};

/**
 * OpenCode's inference API (https://dev.opencode.ai/v2/docs/console/api/inference/).
 *
 * A gateway, not a wire shape: one location and one model list, behind which
 * each model is reached in its own provider's shape --
 *   Claude and Qwen models   Anthropic Messages   /anthropic/v1/messages
 *   GPT models               OpenAI Responses     /openai/v1/responses
 *   the rest                 Chat Completions     /openai/v1/chat/completions
 * -- always with the service-account key as a bearer token.  Gemini models are
 * reached through Google's generateContent, which no adapter here speaks, so
 * they are left out of the menu; so are the free models, which OpenCode serves
 * only to its own client.
 *
 * `route' is what makes it a gateway: the adapter asks it, once it knows the
 * model, for the wire provider and the URL to use.
 */
const opencode = {
  id: "opencode",
  label: "OpenCode inference API",
  defaultEndpoint: "https://opencode.ai/inference",
  defaultModel: "claude-sonnet-5",
  modelsEndpoint: "https://opencode.ai/inference/v1/models",
  workspaceHint: "organization id (optional)",
  supportsTools: true,

  headers({ apiKey, workspaceId }) {
    return {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(workspaceId ? { "X-Opencode-Org-Id": workspaceId } : {}),
    };
  },

  route(model, base = opencode.defaultEndpoint) {
    const root = String(base || opencode.defaultEndpoint).replace(/\/+$/, "");
    const id = String(model || "");
    const via = (wire, path, extra = {}) => ({
      provider: {
        ...wire,
        headers: (o) => ({ ...opencode.headers(o), ...extra }),
      },
      url: `${root}${path}`,
    });
    if (/^(claude|qwen)/i.test(id)) {
      return via(anthropic, "/anthropic/v1/messages", { "anthropic-version": ANTHROPIC_VERSION });
    }
    if (/^gpt/i.test(id)) return via(openaiResponses, "/openai/v1/responses");
    return via(openai, "/openai/v1/chat/completions");
  },

  readModels(json) {
    const data = Array.isArray(json?.data) ? json.data : [];
    return data.filter((m) => m && m.id && !/^gemini/i.test(m.id) && !/-free$/i.test(m.id))
               .map((m) => ({ id: m.id, label: m.id }));
  },
};

const PROVIDERS = new Map([[anthropic.id, anthropic], [openai.id, openai],
                           [opencode.id, opencode]]);

export function providerFor(id) {
  return PROVIDERS.get(String(id || "anthropic").toLowerCase()) || anthropic;
}

/** The locations offered in the LLM menu, in the order they are offered. */
export function presetProviders() {
  return [...PROVIDERS.values()].filter((p) => p.defaultEndpoint);
}

/**
 * The provider that speaks to a location.  A preset's own endpoint names it;
 * any other location speaks Messages if its path ends in /messages, and Chat
 * Completions otherwise, which is the shape most other servers offer.
 */
export function providerForEndpoint(url) {
  const u = String(url || "").trim();
  for (const p of PROVIDERS.values()) if (p.defaultEndpoint === u) return p;
  return /\/messages\/?$/.test(u) ? anthropic : openai;
}

/**
 * Where a location lists its models: the preset's own list, or else the
 * sibling `models' of the location's versioned path (…/v1/messages and
 * …/v1/chat/completions both list at …/v1/models), or else /v1/models.
 */
export function modelsEndpointFor(url) {
  const u = String(url || "").trim();
  for (const p of PROVIDERS.values()) if (p.defaultEndpoint === u) return p.modelsEndpoint;
  try {
    const parsed = new URL(u);
    const m = /^(.*?\/v\d+)(?:\/|$)/.exec(parsed.pathname);
    parsed.pathname = m ? `${m[1]}/models` : "/v1/models";
    parsed.search = "";
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * The models a location offers to this key, as [{id, label}].  Never throws:
 * a failure is returned as `error', so a menu can say why it is short.
 */
export async function listModels({ endpoint, apiKey, workspaceId, fetchImpl } = {}) {
  const provider = providerForEndpoint(endpoint);
  const url = modelsEndpointFor(endpoint);
  if (!url) return { ok: false, models: [], error: "not a URL" };
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  try {
    const headers = provider.headers({ apiKey, workspaceId });
    delete headers["Content-Type"];
    const res = await doFetch(url, { method: "GET", headers });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* reported below */ }
    if (!res.ok || !json) {
      // The same note as a refused run (see `credentialNote'): this is where a
      // bad key is usually met first, so it is where the explanation is worth
      // the most.
      const base = json?.error?.message || `HTTP ${res.status}`;
      return { ok: false, models: [], status: res.status,
               error: (res.status === 401 || res.status === 403)
                 ? `${base} \u2014 ${credentialNote({ apiKey, workspaceId, provider: provider.id })}`
                 : base };
    }
    return { ok: true, models: provider.readModels(json), status: res.status };
  } catch (e) {
    return { ok: false, models: [], error: String(e) };
  }
}

/**
 * What was sent, when what was sent was refused.
 *
 * `invalid x-api-key' is a true statement and a useless one: it says the string
 * in the header is not a key, and the user is looking at a field that contains
 * a key they just pasted.  The gap between those two is the whole problem, and
 * every explanation for it is a property of the string the pane actually held
 * -- its length, its ending, whether something came along with it in the copy,
 * whether it is a key of the wrong KIND.  None of that requires showing the
 * key, and none of it is guesswork.
 *
 * Nothing secret is returned.  The length and the last four characters are what
 * a key is identified by everywhere else; the prefix reported is the public
 * marker, never the body.
 */
export function credentialNote({ apiKey, workspaceId, provider = "anthropic" } = {}) {
  const k = String(apiKey ?? "");
  if (!k) {
    return "no key was sent at all -- the pane is holding an empty value, "
         + "whatever the field is showing";
  }
  const parts = [`the pane sent a ${k.length}-character key ending …${k.slice(-4)}`];
  // Anything outside printable ASCII came from the copy, not from the key: a
  // newline, a non-breaking space, a zero-width character picked up off a page.
  if (/[^\x21-\x7e]/.test(k)) {
    parts.push("which contains a space or a non-printing character -- the copy "
             + "took in more than the key");
  }
  if (provider === "anthropic") {
    if (/^sk-ant-admin/.test(k)) {
      parts.push("which is an Admin API key; the Messages API does not accept one");
    } else if (!/^sk-ant-/.test(k)) {
      parts.push("which does not begin with `sk-ant-\', so it is not an Anthropic "
               + "API key -- an OAuth or console session token is not one");
    }
  }
  return `${parts.join(", ")}. `
       + (workspaceId ? `It went with workspace \`${workspaceId}\'.`
                      : "No workspace header went with it.");
}

export function registerProvider(provider) {
  PROVIDERS.set(provider.id, provider);
  return provider;
}

export function providerIds() {
  return [...PROVIDERS.keys()];
}

export { anthropic, openai, openaiResponses, opencode };
