export class AgyError extends Error {
  constructor(message, { suggestion = null, cause = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.suggestion = suggestion;
    if (cause != null) this.cause = cause;
  }
}

export class AgyConnectionError extends AgyError {}
export class AgyAuthError extends AgyError {}
export class AgyTimeoutError extends AgyError {}

export class PluginError extends Error {
  constructor(message, { suggestion = null, cause = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.suggestion = suggestion;
    if (cause != null) this.cause = cause;
  }
}

export class GitError extends PluginError {}
export class ReviewOutputError extends PluginError {}
export class ConfigError extends PluginError {}
