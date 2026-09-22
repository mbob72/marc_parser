/** Service tags are exactly three ASCII letters, in either case. */
export function isAlphabeticTag(tag: string): boolean {
  return /^[a-z]{3}$/i.test(tag);
}

/** FMT remains in the internal model for format validation; LDR becomes leader. */
export function keepImportedField(tag: string): boolean {
  return !isAlphabeticTag(tag) || tag.toUpperCase() === "FMT";
}

/** Match an entire subfield value: no trimming or case folding of a/Y. */
export function hasDeletionFlag(value: Buffer, delimiter: Buffer): boolean {
  let position = value.indexOf(delimiter);
  while (position !== -1) {
    const start = position + delimiter.length;
    const next = value.indexOf(delimiter, start);
    const end = next === -1 ? value.length : next;
    if (end - start === 2 && value[start] === 0x61 && value[start + 1] === 0x59) {
      return true;
    }
    position = next;
  }
  return false;
}
