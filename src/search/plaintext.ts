/**
 * Strips markdown syntax and YAML frontmatter from content,
 * returning plain text suitable for full-text indexing.
 */
export function stripMarkdown(md: string): string {
  let text = md;

  // Remove YAML frontmatter
  const fmEnd = text.indexOf("---", text.indexOf("---") + 3);
  if (fmEnd !== -1) {
    text = text.slice(fmEnd + 3).trimStart();
  }

  // Remove markdown headings (keep text)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Remove bold/italic markers
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");

  // Remove inline code backticks
  text = text.replace(/`([^`]+)`/g, "$1");

  // Remove code block fences (keep content)
  text = text.replace(/^```[\s\S]*?^```/gm, "");

  // Remove blockquote markers
  text = text.replace(/^>\s?/gm, "");

  // Remove link syntax [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove image syntax ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // Remove list markers
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // Collapse multiple newlines
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
