export class BridgeError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeError';
  }
}

export function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) {
    throw new BridgeError(code, message);
  }
}

