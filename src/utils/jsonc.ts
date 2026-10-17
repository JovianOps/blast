/** Parse JSON with comments and trailing commas (tsconfig.json flavour). */
export function parseJsonc(text: string): unknown {
  const clean = text.replace(/^\uFEFF/, '');
  return JSON.parse(removeTrailingCommas(stripComments(clean)));
}

function stripComments(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text.charAt(i);
    const next = text.charAt(i + 1);

    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text.charAt(i) !== '\n') i += 1;
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text.charAt(i) === '*' && text.charAt(i + 1) === '/')) i += 1;
      i += 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function removeTrailingCommas(text: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);

    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text.charAt(i + 1);
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text.charAt(j))) j += 1;
      const following = text.charAt(j);
      if (following === '}' || following === ']') continue;
    }
    out += ch;
  }
  return out;
}
