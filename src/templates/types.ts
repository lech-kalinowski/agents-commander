export interface PromptTemplate {
  id: string;              // from filename: "code-review-pipeline"
  name: string;            // frontmatter
  description: string;     // frontmatter
  category: string;        // "collaboration" etc.
  agents: string[];        // ["claude", "codex"]
  panels: number;          // recommended panel count
  content: string;         // prompt body (after frontmatter)
  source: 'builtin' | 'user';
  filePath: string;
}
