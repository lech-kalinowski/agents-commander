import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

// marked-terminal's constructor adds instance props (o, tab, etc.) that
// marked v15 rejects. Extract only the valid renderer methods from the prototype.
const instance = new TerminalRenderer();
const proto = Object.getPrototypeOf(instance);
const RENDERER_METHODS = [
  'space', 'text', 'code', 'blockquote', 'html', 'heading', 'hr',
  'list', 'listitem', 'checkbox', 'paragraph', 'table', 'tablerow',
  'tablecell', 'strong', 'em', 'codespan', 'br', 'del', 'link', 'image',
];

const renderer: Record<string, Function> = {};
for (const method of RENDERER_METHODS) {
  if (typeof proto[method] === 'function') {
    renderer[method] = proto[method].bind(instance);
  }
}

marked.use({ renderer: renderer as any });

export function renderMarkdown(content: string): string {
  try {
    return marked.parse(content, { async: false }) as string;
  } catch {
    return content;
  }
}
