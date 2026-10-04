import type { RemoteAccessErrorCode } from "../shared/remoteAccess.js";

/** A remote-access failure with a stable code and a message that is safe to show and log: never provider text. */
export class RemoteAccessFailure extends Error {
  constructor(
    readonly code: RemoteAccessErrorCode,
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
  }
}
