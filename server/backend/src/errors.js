export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(logger = console) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    if (error instanceof HttpError) {
      ({ status, code, message } = error);
    } else if (error.type === 'entity.parse.failed') {
      status = 400; code = 'INVALID_JSON'; message = 'Request body must be valid JSON.';
    } else if (error.type === 'entity.too.large') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body exceeds the size limit.';
    } else if (error.status === 415) {
      status = 415; code = 'UNSUPPORTED_MEDIA_TYPE'; message = 'Unsupported request encoding or content type.';
    }
    if (status >= 500) {
      // Error objects may contain SQL, connection URIs or user input. Log metadata only.
      logger.error({ event: 'request_failed', request_id: req.requestId, status });
    }
    if (status === 503) res.set('Retry-After', '5');
    return res.status(status).json({ code, message, request_id: req.requestId });
  };
}
