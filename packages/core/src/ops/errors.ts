/** Carries the HTTP status the transport should report, so routes stay thin. */
export class OpsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}
