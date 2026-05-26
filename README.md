# @anandanair/tiptap-visual-diff

A Tiptap v3 extension that provides real-time **visual diffs** by comparing the editor's current content against a reference document. Highlights additions, removals, and modifications using **ProseMirror decorations** — the actual document content stays clean.

> Built for review workflows where you want to show what changed without polluting the editable content with diff markup.

## Features

- **Inline visual diffs** — green for additions, red strikethrough for removals, amber for modifications
- **Purely decorative** — diff classes are applied via ProseMirror decorations, never written into the document
- **Handles all node types** — paragraphs, headings, code blocks, lists (bullet/ordered/task), tables, images, blockquotes, horizontal rules, mentions
- **Code-aware** — code blocks use line-level diffing; removed code lines render as individual widgets
- **Mark-aware** — detects formatting-only changes (bold added, link removed, etc.) and highlights them as modifications
- **Attribute-aware** — catches heading level changes and image src changes
- **Look-ahead alignment** — handles insertions and deletions of up to 20 consecutive nodes without misalignment
- **Performance** — decorations are cached and only rebuilt when the document or comparison target changes

## Installation

```bash
npm install @anandanair/tiptap-visual-diff
```

This package requires the following peer dependencies (install them if you haven't already):

```bash
npm install @tiptap/core @tiptap/pm diff
```

## Quick Start

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ComparePlugin } from "@anandanair/tiptap-visual-diff";

// Parse your original/reference content to Tiptap JSON
const originalJSON = {
  type: "doc",
  content: [
    /* ... */
  ],
};

const editor = new Editor({
  extensions: [
    StarterKit,
    ComparePlugin.configure({
      comparisonContent: originalJSON,
    }),
  ],
  content: "<p>The new version of the document...</p>",
});

// Later: update the comparison target dynamically
editor.commands.setComparisonContent(newOriginalJSON);
```

## Usage with React

```tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ComparePlugin } from "@anandanair/tiptap-visual-diff";

function DiffEditor({ originalJSON, proposedMarkdown, onSave }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      ComparePlugin.configure({ comparisonContent: originalJSON }),
    ],
    content: proposedMarkdown,
    contentType: "markdown",
  });

  return <EditorContent editor={editor} />;
}
```

### Parsing original markdown to JSON

If your original content is markdown, parse it to Tiptap JSON using a headless editor:

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

function parseMarkdownToJSON(markdown: string) {
  const temp = new Editor({
    extensions: [StarterKit, Markdown],
    content: markdown,
    contentType: "markdown",
  });
  const json = temp.getJSON();
  temp.destroy();
  return json;
}
```

## API

### `ComparePlugin.configure(options)`

| Option              | Type                          | Default | Description                                 |
| ------------------- | ----------------------------- | ------- | ------------------------------------------- |
| `comparisonContent` | `Record<string, any> \| null` | `null`  | The Tiptap JSON document to compare against |

### Commands

| Command                | Parameters                             | Description                                                |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `setComparisonContent` | `content: Record<string, any> \| null` | Update the comparison target without recreating the editor |

## CSS Classes

The extension applies these classes via ProseMirror decorations. **Add styles to your CSS to make diffs visible:**

| Class                         | Applied to                     | Meaning                             |
| ----------------------------- | ------------------------------ | ----------------------------------- |
| `.diff-added`                 | Inline text, block nodes       | Content added (green background)    |
| `.diff-removed`               | Widget (span/div)              | Content removed (red strikethrough) |
| `.diff-modified`              | Inline text, block nodes       | Content modified (amber background) |
| `.diff-code-added`            | Inline text inside code blocks | Code line added                     |
| `.diff-removed-block`         | Widget (div)                   | Entire block node removed           |
| `.diff-removed-cell`          | Widget (td)                    | Table cell removed                  |
| `.diff-removed-code-block`    | Widget (pre > code)            | Entire code block removed           |
| `.diff-removed-code-line`     | Widget (div)                   | Individual code line removed        |
| `.diff-removed-image-wrapper` | Widget (div)                   | Image removed (container)           |
| `.diff-removed-image-overlay` | Widget (div)                   | Image removed (overlay text)        |
| `.diff-added code`            | Inline `<code>` elements       | Inline code within added blocks     |

### Example Styles

```css
.diff-added {
  background-color: rgba(16, 185, 129, 0.12);
  color: #065f46;
  border-radius: 3px;
  padding: 1px 4px;
}

.diff-removed {
  background-color: rgba(239, 68, 68, 0.08);
  color: #991b1b;
  text-decoration: line-through;
  border-radius: 3px;
  padding: 1px 4px;
}

.diff-modified {
  background-color: rgba(234, 179, 8, 0.15);
  color: #92400e;
  border-radius: 3px;
  padding: 1px 4px;
}

.diff-removed-block {
  background-color: rgba(239, 68, 68, 0.08);
  color: #991b1b;
  text-decoration: line-through;
  border-left: 3px solid #ef4444;
  padding: 2px 8px;
  border-radius: 4px;
  margin: 2px 0;
}

.diff-code-added {
  background-color: rgba(16, 185, 129, 0.18);
}

.diff-removed-code-line {
  background-color: rgba(239, 68, 68, 0.08);
  color: #991b1b;
  text-decoration: line-through;
  font-family: monospace;
  font-size: 0.875rem;
  padding: 0 4px;
}

/* Inline <code> within entirely-added blocks.
   When a block node (p, h1-h6, li) has .diff-added,
   child <code> elements need explicit styling because
   browser defaults block color inheritance. */
.diff-added code {
  background-color: rgba(16, 185, 129, 0.22);
  color: #065f46;
  border-radius: 2px;
  padding: 1px 3px;
}

.dark .diff-added code {
  background-color: rgba(16, 185, 129, 0.18);
  color: #34d399;
}
```

## How It Works

1. The extension stores the `comparisonContent` as a ProseMirror plugin state
2. When the document changes, it converts the comparison JSON into ProseMirror nodes
3. It aligns the two node trees using a greedy look-ahead matcher (window of 20)
4. For matched nodes, it compares text content character-by-character (or line-by-line for code blocks)
5. Differences are rendered as ProseMirror decorations — inline spans for text changes, widgets for removed content, node decorations for added/modified blocks

The editor's document content is **never modified** — diffs are purely visual.

## Limitations (v0.1)

- **Insertion/deletion cap**: The look-ahead alignment covers up to 20 consecutive nodes. Inserting or deleting more than 20 consecutive block nodes at once may cause downstream misalignment. In practice, even large content insertions rarely exceed this.
- **No accept/reject API**: This is a visual diff tool, not a track-changes system. To accept or reject changes, edit the document directly and save.
- **ESM only**: No CommonJS build in v0.1. Modern bundlers (Next.js, Vite, webpack 5) handle ESM natively.

## License

MIT
