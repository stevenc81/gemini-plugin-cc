import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "./errors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..", "..");
const PROMPTS_DIR = path.join(PLUGIN_ROOT, "prompts");
const SCHEMAS_DIR = path.join(PLUGIN_ROOT, "schemas");

const SCHEMA_BY_TEMPLATE = Object.freeze({
  review: "review-output"
});

export function loadTemplate(name) {
  const filePath = path.join(PROMPTS_DIR, `${name}.md`);
  return fs.readFileSync(filePath, "utf8");
}

export function loadSchemaText(schemaName = "review-output") {
  const filePath = path.join(SCHEMAS_DIR, `${schemaName}.schema.json`);
  return fs.readFileSync(filePath, "utf8").trimEnd();
}

export function renderPrompt(name, vars = {}) {
  const template = loadTemplate(name);
  const providedVars = { ...vars };
  if (!("SCHEMA" in providedVars)) {
    const schemaName = SCHEMA_BY_TEMPLATE[name];
    if (!schemaName) {
      throw new ConfigError(`No schema binding configured for prompt "${name}".`, {
        suggestion: `Add "${name}" to SCHEMA_BY_TEMPLATE in prompts.mjs, or pass an explicit SCHEMA in vars.`
      });
    }
    providedVars.SCHEMA = loadSchemaText(schemaName);
  }

  const referencedVars = new Set();
  const output = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => {
    referencedVars.add(key);
    if (!(key in providedVars)) {
      throw new ConfigError(`Prompt template "${name}" references unknown placeholder {{${key}}}.`, {
        suggestion: `Provide a value for ${key} or remove it from the template.`
      });
    }
    return String(providedVars[key] ?? "");
  });

  return { text: output, referencedVars: [...referencedVars] };
}
