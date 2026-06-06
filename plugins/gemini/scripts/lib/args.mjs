import { ConfigError } from "./errors.mjs";

const VALUE_FLAGS = new Set(["--base", "--cwd"]);
const BOOLEAN_FLAGS = new Set(["--wait", "--background", "--json"]);

const VALID_FLAGS_FOR_HELP = [...VALUE_FLAGS, ...BOOLEAN_FLAGS].sort();

export function parseArgs(argv, { allowPositionals = false } = {}) {
  const options = {};
  const positionals = [];
  let i = 0;

  while (i < argv.length) {
    const token = argv[i];

    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      i += 1;
      continue;
    }

    // Handle --flag=value form
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? null : token.slice(eq + 1);

    if (VALUE_FLAGS.has(name)) {
      if (inlineValue != null) {
        options[name.slice(2)] = inlineValue;
        i += 1;
      } else {
        const value = argv[i + 1];
        if (value == null || value.startsWith("--")) {
          throw new ConfigError(`Flag ${name} requires a value.`, {
            suggestion: `Usage: ${name} <value>`
          });
        }
        options[name.slice(2)] = value;
        i += 2;
      }
      continue;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue != null) {
        throw new ConfigError(`Flag ${name} does not take a value.`, {
          suggestion: `Use ${name} without =...`
        });
      }
      options[name.slice(2)] = true;
      i += 1;
      continue;
    }

    throw new ConfigError(`Unknown flag: ${name}`, {
      suggestion: `Valid flags: ${VALID_FLAGS_FOR_HELP.join(", ")}`
    });
  }

  if (!allowPositionals && positionals.length > 0) {
    throw new ConfigError(`Unexpected positional arguments: ${positionals.join(" ")}`, {
      suggestion: "This command does not accept positional arguments."
    });
  }

  return { options, positionals };
}

/**
 * When a Claude Code slash command passes $ARGUMENTS as a single quoted string,
 * we receive it as one argv entry. Split it on whitespace, preserving quoted
 * substrings so focus text with spaces round-trips correctly.
 */
export function splitRawArgumentString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && i + 1 < raw.length) {
        current += raw[i + 1];
        i += 1;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function normalizeArgv(argv) {
  if (argv.length === 1) {
    const raw = argv[0];
    if (!raw || !raw.trim()) return [];
    return splitRawArgumentString(raw);
  }
  return argv;
}
