// utils/base91.js
// Minimal basE91 decoder (public-domain style implementation).
// Returns Uint8Array of decoded bytes.
export function decodeBase91(input) {
  // basE91 alphabet
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\"";
  const d = new Array(256).fill(-1);
  for (let i = 0; i < table.length; i++) d[table.charCodeAt(i)] = i;

  let v = -1, b = 0, n = 0;
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    const val = c < 256 ? d[c] : -1;
    if (val === -1) continue; // skip invalid/whitespace
    if (v < 0) {
      v = val;
    } else {
      v += val * 91;
      b |= v << n;
      n += (v & 8191) > 88 ? 13 : 14;
      do {
        out.push(b & 255);
        b >>= 8;
        n -= 8;
      } while (n > 7);
      v = -1;
    }
  }
  if (v + 1) {
    out.push((b | (v << n)) & 255);
  }
  return new Uint8Array(out);
}