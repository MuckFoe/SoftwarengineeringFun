// NFR-4: make control characters visible instead of letting the browser act on them.
export function visibleText(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code === 0x7f) out += "␡";
    else if (code < 0x20 && code !== 0x0a && code !== 0x09)
      out += String.fromCharCode(0x2400 + code);
    else out += ch;
  }
  return out;
}
