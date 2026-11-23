/** Joins class names, skipping falsy parts, so variant classes can be written inline. */
export const cx = (...parts: unknown[]): string => parts.filter(Boolean).join(" ");
