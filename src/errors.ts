// SDK-specific error class. Thrown for any non-2xx response; carries the
// HTTP status, the server's error code + message when available, and the
// BaoBox request_id so callers can correlate with server logs.
export class BaoBoxError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId: string | null;
  public readonly body: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null,
    body: unknown,
  ) {
    super(message);
    this.name = "BaoBoxError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.body = body;
  }
}
