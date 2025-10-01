export function decodeBase91(str) {
  const ENCODING_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\"";
  const DEC = new Array(256).fill(-1);
  for (let i = 0; i < ENCODING_TABLE.length; i++) DEC[ENC.charCodeAt(i)] = i;
  let v = -1, b = 0, n = 0;
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const d = DEC[c];
    if (d === -1) continue;
    if (v < 0) v = d;
    else {
      v += d * 91;
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
  if (v > -1) {
    out.push((b | (v << n)) & 255);
  }
  return new Uint8Array(out);
}
