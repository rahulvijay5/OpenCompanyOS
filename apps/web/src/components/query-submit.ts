export function emptyQueryMessage(query: string): string | null {
  if (query.trim().length === 0) {
    return "Enter a question before asking.";
  }
  return null;
}
