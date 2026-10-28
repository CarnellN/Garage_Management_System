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
    } else if (['ER_DUP_ENTRY', '23505'].includes(error.code)) {
      status = 409; code = 'DUPLICATE_RESOURCE'; message = 'A resource with these unique details already exists.';
    } else if (['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2', '23503'].includes(error.code)) {
      status = 409; code = 'RELATIONSHIP_CONFLICT'; message = 'This change conflicts with a related resource.';
    } else if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', '40001', '40P01'].includes(error.code)) {
      status = 409; code = 'CONCURRENT_CHANGE'; message = 'A concurrent change prevented this operation. Refresh before retrying.';
    } else if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', '42P01', '42703'].includes(error.code)) {
      status = 503; code = 'SCHEMA_NOT_READY'; message = 'The database schema required by this endpoint is not available.';
    } else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT', '57P01', '53300'].includes(error.code) || error.message === 'No connections available.' || error.message === 'Query read timeout') {
      status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'The database is temporarily unavailable.';
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
    if (status === 401) res.set('WWW-Authenticate', 'Bearer');
    return res.status(status).json({ code, message, request_id: req.requestId, ...(error instanceof HttpError && error.details ? { details: error.details } : {}) });
  };
}
