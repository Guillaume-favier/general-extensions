/**
 * parseLooseJson
 * --------------
 * Parses a JavaScript-object-literal-like string into a real JS value,
 * WITHOUT using eval/Function and WITHOUT any external dependencies.
 *
 * Supports:
 *   - Unquoted object keys:      { foo: 1 }
 *   - Single or double quoted strings, with escapes
 *   - Numbers (int, float, exponent, negative)
 *   - true / false / null
 *   - Nested objects and arrays
 *   - Trailing commas:           [1, 2, 3,]
 *   - // line comments and /* block comments *\/
 *
 * It does NOT support arbitrary JS expressions, function values, etc.
 * It's meant for "JSON5-ish" config-like literals, like the one you posted.
 */

export type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

export function parseLooseJson(input: string): JsonLike {
  const s = input;
  let i = 0;

  function error(msg: string): never {
    const line = s.slice(0, i).split("\n").length;
    throw new SyntaxError(`parseLooseJson: ${msg} at position ${i} (line ${line})`);
  }

  function skipWhitespaceAndComments(): void {
    for (;;) {
      const c = s[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        i++;
        continue;
      }
      if (c === "/" && s[i + 1] === "/") {
        i += 2;
        while (i < s.length && s[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && s[i + 1] === "*") {
        i += 2;
        while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      break;
    }
  }

  function parseValue(): JsonLike {
    skipWhitespaceAndComments();
    const c = s[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"' || c === "'") return parseString();
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    if (isIdentStart(c)) return parseKeywordOrBareValue();
    error(`Unexpected character "${c}"`);
  }

  function parseObject(): { [key: string]: JsonLike } {
    const obj: { [key: string]: JsonLike } = {};
    i++; // consume '{'
    skipWhitespaceAndComments();
    if (s[i] === "}") {
      i++;
      return obj;
    }
    for (;;) {
      skipWhitespaceAndComments();
      const key = parseKey();
      skipWhitespaceAndComments();
      if (s[i] !== ":") error(`Expected ":" after key "${key}"`);
      i++; // consume ':'
      const value = parseValue();
      obj[key] = value;
      skipWhitespaceAndComments();
      if (s[i] === ",") {
        i++;
        skipWhitespaceAndComments();
        if (s[i] === "}") {
          // trailing comma
          i++;
          break;
        }
        continue;
      }
      if (s[i] === "}") {
        i++;
        break;
      }
      error(`Expected "," or "}" in object`);
    }
    return obj;
  }

  function parseArray(): JsonLike[] {
    const arr: JsonLike[] = [];
    i++; // consume '['
    skipWhitespaceAndComments();
    if (s[i] === "]") {
      i++;
      return arr;
    }
    for (;;) {
      const value = parseValue();
      arr.push(value);
      skipWhitespaceAndComments();
      if (s[i] === ",") {
        i++;
        skipWhitespaceAndComments();
        if (s[i] === "]") {
          // trailing comma
          i++;
          break;
        }
        continue;
      }
      if (s[i] === "]") {
        i++;
        break;
      }
      error(`Expected "," or "]" in array`);
    }
    return arr;
  }

  function parseKey(): string {
    const c = s[i];
    if (c === '"' || c === "'") return parseString();
    if (isIdentStart(c)) {
      const start = i;
      i++;
      while (i < s.length && isIdentPart(s[i])) i++;
      return s.slice(start, i);
    }
    error(`Invalid object key starting with "${c}"`);
  }

  function parseString(): string {
    const quote = s[i];
    i++; // consume opening quote
    let result = "";
    while (i < s.length && s[i] !== quote) {
      const c = s[i];
      if (c === "\\") {
        const next = s[i + 1];
        switch (next) {
          case "n":
            result += "\n";
            break;
          case "t":
            result += "\t";
            break;
          case "r":
            result += "\r";
            break;
          case "b":
            result += "\b";
            break;
          case "f":
            result += "\f";
            break;
          case "\\":
            result += "\\";
            break;
          case "'":
            result += "'";
            break;
          case '"':
            result += '"';
            break;
          case "\n":
            break; // line continuation
          default:
            result += next;
        }
        i += 2;
        continue;
      }
      result += c;
      i++;
    }
    if (s[i] !== quote) error("Unterminated string literal");
    i++; // consume closing quote
    return result;
  }

  function parseNumber(): number {
    const start = i;
    if (s[i] === "-" || s[i] === "+") i++;
    while (i < s.length && s[i] >= "0" && s[i] <= "9") i++;
    if (s[i] === ".") {
      i++;
      while (i < s.length && s[i] >= "0" && s[i] <= "9") i++;
    }
    if (s[i] === "e" || s[i] === "E") {
      i++;
      if (s[i] === "+" || s[i] === "-") i++;
      while (i < s.length && s[i] >= "0" && s[i] <= "9") i++;
    }
    const raw = s.slice(start, i);
    if (raw === "" || raw === "-" || raw === "+") error("Invalid number");
    return Number(raw);
  }

  function parseKeywordOrBareValue(): JsonLike {
    const start = i;
    i++;
    while (i < s.length && isIdentPart(s[i])) i++;
    const word = s.slice(start, i);
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    if (word === "undefined") return null;
    // Fallback: treat unknown bare word as a string (some configs do this)
    return word;
  }

  function isIdentStart(c: string | undefined): boolean {
    return !!c && /[A-Za-z_$]/.test(c);
  }

  function isIdentPart(c: string | undefined): boolean {
    return !!c && /[A-Za-z0-9_$]/.test(c);
  }

  const result = parseValue();
  skipWhitespaceAndComments();
  if (i < s.length) error("Unexpected trailing content after value");
  return result;
}
