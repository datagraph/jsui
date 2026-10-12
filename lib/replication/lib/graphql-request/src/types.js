export class ClientError extends Error {
    constructor(response, request) {
        const message = `${ClientError.extractMessage(response)}: ${JSON.stringify({ response, request })}`;
        super(message);
        this.response = response;
        this.request = request;
        // this is needed as Safari doesn't support .captureStackTrace
        /* tslint:disable-next-line */
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(this, ClientError);
        }
    }
    static extractMessage(response) {
        try {
            return response.errors[0].message;
        }
        catch (e) {
            return `GraphQL Error (Code: ${response.status})`;
        }
    }
}
