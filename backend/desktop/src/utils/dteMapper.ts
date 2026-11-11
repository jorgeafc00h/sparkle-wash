// DTE Mapper Utilities - Enhanced version of existing json utils
// Handles property omission logic that mirrors Swift's nullable behavior

/**
 * Deep omits undefined values from an object and its nested objects/arrays
 * This mirrors Swift's Codable behavior where nil values are excluded from JSON
 */
export function deepOmitUndefinedEnhanced<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    const filtered = (obj as unknown[])
      .map(item => deepOmitUndefinedEnhanced(item))
      .filter(item => item !== undefined);
    return filtered as unknown as T;
  }

  if (typeof obj === 'object') {
    const result = {} as T;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        const processedValue = deepOmitUndefinedEnhanced(value);
        if (processedValue !== undefined) {
          (result as Record<string, unknown>)[key] = processedValue;
        }
      }
    }
    return result;
  }

  return obj;
}
