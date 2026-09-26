/** Thrown when a record doesn't exist OR the caller may not know it exists (never reveal which). */
export class NotFoundError extends Error {
  constructor(what = 'Record') {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** Input failed validation. `fields` maps field names to customer-friendly messages. */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** The record changed since it was loaded (optimistic locking) or the action no longer applies. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
