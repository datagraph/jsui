var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { ClientError } from './types.js';
export { ClientError } from './types.js';
// obsolete import 'cross-fetch/polyfill'
export class GraphQLClient {
    constructor(url, options) {
        this.url = url;
        this.options = options || {};
    }
    rawRequest(query, variables) {
        return __awaiter(this, void 0, void 0, function* () {
            const _a = this.options, { headers } = _a, others = __rest(_a, ["headers"]);
            const body = JSON.stringify({
                query,
                variables: variables ? variables : undefined,
            });
            const response = yield fetch(this.url, Object.assign({ method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body }, others));
            const result = yield getResult(response);
            if (response.ok && !result.errors && result.data) {
                const { headers, status } = response;
                return Object.assign(Object.assign({}, result), { headers, status });
            }
            else {
                const errorResult = typeof result === 'string' ? { error: result } : result;
                throw new ClientError(Object.assign(Object.assign({}, errorResult), { status: response.status, headers: response.headers }), { query, variables });
            }
        });
    }
    request(query, variables) {
        return __awaiter(this, void 0, void 0, function* () {
            const _a = this.options, { headers } = _a, others = __rest(_a, ["headers"]);
            const body = JSON.stringify({
                query,
                variables: variables ? variables : undefined,
            });
            const response = yield fetch(this.url, Object.assign({ method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body }, others));
            const result = yield getResult(response);
            if (response.ok && !result.errors && result.data) {
                return result.data;
            }
            else {
                const errorResult = typeof result === 'string' ? { error: result } : result;
                throw new ClientError(Object.assign(Object.assign({}, errorResult), { status: response.status }), { query, variables });
            }
        });
    }
    setHeaders(headers) {
        this.options.headers = headers;
        return this;
    }
    setHeader(key, value) {
        const { headers } = this.options;
        if (headers) {
            headers[key] = value;
        }
        else {
            this.options.headers = { [key]: value };
        }
        return this;
    }
}
export function rawRequest(url, query, variables) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new GraphQLClient(url);
        return client.rawRequest(query, variables);
    });
}
export function request(url, query, variables) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new GraphQLClient(url);
        return client.request(query, variables);
    });
}
export default request;
function getResult(response) {
    return __awaiter(this, void 0, void 0, function* () {
        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.startsWith('application/json')) {
            return response.json();
        }
        else {
            return response.text();
        }
    });
}
