// An error carrying an HTTP status code, thrown by engine/handlers and turned into a
// JSON response by the Express error middleware.
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
