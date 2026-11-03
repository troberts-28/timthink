export class ReadOnlyError extends Error {
  constructor() {
    super("timthink is running read-only, so nothing under the docs folder can change");
    this.name = "ReadOnlyError";
  }
}
