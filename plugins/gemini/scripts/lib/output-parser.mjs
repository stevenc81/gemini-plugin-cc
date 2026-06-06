import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.resolve(HERE, "..", "..", "schemas");

const schemaCache = new Map();
function getSchema(schemaName) {
  if (!schemaCache.has(schemaName)) {
    const filePath = path.join(SCHEMAS_DIR, `${schemaName}.schema.json`);
    schemaCache.set(schemaName, JSON.parse(fs.readFileSync(filePath, "utf8")));
  }
  return schemaCache.get(schemaName);
}

export function stripFences(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

export function parseStructuredOutput(rawText, schemaName) {
  const inner = stripFences(rawText);
  if (!inner) {
    return {
      parsed: null,
      parseError: "Empty output from model.",
      rawOutput: rawText ?? ""
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(inner);
  } catch (err) {
    return {
      parsed: null,
      parseError: `JSON parse failed: ${err.message}`,
      rawOutput: rawText
    };
  }
  const validationErrors = validate(parsed, getSchema(schemaName), "");
  if (validationErrors.length > 0) {
    return {
      parsed: null,
      parseError: `Schema validation failed: ${validationErrors.join("; ")}`,
      rawOutput: rawText
    };
  }
  return { parsed, parseError: null, rawOutput: rawText };
}

export function parseReviewOutput(rawText) {
  return parseStructuredOutput(rawText, "review-output");
}

function validate(value, schema, pathStr) {
  const errors = [];
  const location = pathStr || "(root)";

  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push(`${location}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
      return errors;
    }
  }

  if (schema.type) {
    const actualType = jsonType(value);
    if (schema.type === "integer") {
      if (actualType !== "number" || !Number.isInteger(value)) {
        errors.push(`${location}: expected integer, got ${actualType}`);
        return errors;
      }
    } else if (actualType !== schema.type) {
      errors.push(`${location}: expected ${schema.type}, got ${actualType}`);
      return errors;
    }
  }

  if (typeof schema.minimum === "number" && typeof value === "number") {
    if (value < schema.minimum) {
      errors.push(`${location}: expected >= ${schema.minimum}, got ${value}`);
    }
  }

  if (schema.type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${location}: missing required property "${key}"`);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push(`${location}: unexpected property "${key}"`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          errors.push(...validate(value[key], childSchema, joinPath(pathStr, key)));
        }
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value)) {
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...validate(item, schema.items, `${pathStr}[${i}]`));
      });
    }
  }

  return errors;
}

function jsonType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function joinPath(parent, key) {
  return parent ? `${parent}.${key}` : key;
}

export const internals = { stripFences, validate };
