export const toBytes32Array = (b: Buffer): number[] => {
  const buf = Buffer.alloc(32);
  b.copy(buf, 32 - b.length);

  return Array.from(buf);
};
