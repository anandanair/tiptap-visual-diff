import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Node as ProsemirrorNode } from "@tiptap/pm/model";
import { diffChars, diffLines } from "diff";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    setComparisonContent: (content: Record<string, any> | null) => ReturnType;
  }
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface CompareOptions {
  comparisonContent: Record<string, any> | null;
}

interface ComparePluginState {
  comparisonContent: Record<string, any> | null;
  decorations: DecorationSet;
}

/* ------------------------------------------------------------------ */
/*  Text extraction — maps any ProseMirror Node to plain text        */
/* ------------------------------------------------------------------ */

function nodeToText(node: ProsemirrorNode): string {
  if (!node) return "";

  switch (node.type.name) {
    case "text":
      return node.text ?? "";

    case "hardBreak":
      return "\n";

    case "paragraph":
    case "heading":
    case "codeBlock":
    case "blockquote":
    case "listItem":
    case "taskItem":
      return childrenText(node) + "\n";

    case "bulletList":
    case "orderedList":
    case "taskList":
    case "table":
    case "tableRow":
      return childrenText(node);

    case "horizontalRule":
      return "---\n";

    case "image":
      return `[Image: ${node.attrs?.alt || ""} (${node.attrs?.src || ""})]\n`;

    case "tableCell":
    case "tableHeader":
      return childrenText(node) + "\t";

    case "mention":
      return `@${node.attrs?.label || node.attrs?.id || ""}`;

    default:
      return childrenText(node);
  }
}

function childrenText(node: ProsemirrorNode): string {
  let text = "";
  node.forEach((child) => {
    text += nodeToText(child);
  });
  return text;
}

/* ------------------------------------------------------------------ */
/*  Node matching heuristics                                           */
/* ------------------------------------------------------------------ */

function areAttributesEqual(a: ProsemirrorNode, b: ProsemirrorNode): boolean {
  const attrsA = a.attrs || {};
  const attrsB = b.attrs || {};

  if (a.type.name === "heading" && attrsA.level !== attrsB.level) {
    return false;
  }
  if (a.type.name === "image" && attrsA.src !== attrsB.src) {
    return false;
  }
  return true;
}

function marksMatch(a: ProsemirrorNode, b: ProsemirrorNode): boolean {
  const marksA = a.marks || [];
  const marksB = b.marks || [];
  if (marksA.length !== marksB.length) return false;

  return marksA.every((markA) => {
    return marksB.some((markB) => {
      if (markA.type.name !== markB.type.name) return false;
      const attrsA = markA.attrs || {};
      const attrsB = markB.attrs || {};
      const keysA = Object.keys(attrsA);
      const keysB = Object.keys(attrsB);
      if (keysA.length !== keysB.length) return false;
      return keysA.every((k) => attrsA[k] === attrsB[k]);
    });
  });
}

function nodesMatch(a: ProsemirrorNode, b: ProsemirrorNode): boolean {
  if (!a || !b) return false;
  if (a.type.name !== b.type.name) return false;
  if (!areAttributesEqual(a, b)) return false;

  const ta = nodeToText(a);
  const tb = nodeToText(b);
  if (ta === tb) return true;

  const longer = Math.max(ta.length, tb.length);
  if (longer === 0) return true;

  const distance = levenshtein(ta.slice(0, 200), tb.slice(0, 200));
  return distance / Math.min(200, longer) < 0.5;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

/* ------------------------------------------------------------------ */
/*  DOM helpers for removed-content widgets                            */
/* ------------------------------------------------------------------ */

function createRemovedTextWidget(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "diff-removed";
  span.textContent = text;
  return span;
}

function createRemovedNodeWidget(node: ProsemirrorNode): HTMLElement {
  const isCell =
    node.type.name === "tableCell" || node.type.name === "tableHeader";
  const isCode = node.type.name === "codeBlock";
  const isImage = node.type.name === "image";

  if (isCell) {
    const el = document.createElement("td");
    el.className = "diff-removed diff-removed-cell";
    el.textContent = nodeToText(node).trimEnd();
    return el;
  }

  if (isCode) {
    const pre = document.createElement("pre");
    pre.className = "diff-removed-code-block";
    const code = document.createElement("code");
    code.className = "language-" + (node.attrs?.language || "plaintext");
    code.textContent = nodeToText(node).trimEnd();
    pre.appendChild(code);
    return pre;
  }

  if (isImage) {
    // Elegant container thumbnail placeholder for deleted images [2]
    const wrapper = document.createElement("div");
    wrapper.className = "diff-removed-image-wrapper";

    const img = document.createElement("img");
    img.src = node.attrs?.src || "";
    img.alt = node.attrs?.alt || "";

    const overlay = document.createElement("div");
    overlay.className = "diff-removed-image-overlay";
    overlay.textContent = "Removed Image";

    wrapper.appendChild(img);
    wrapper.appendChild(overlay);
    return wrapper;
  }

  const el = document.createElement("div");
  el.className = "diff-removed diff-removed-block";
  el.textContent = nodeToText(node).trimEnd();
  return el;
}

function createRemovedCodeLineWidget(text: string): HTMLElement {
  const div = document.createElement("div");
  div.className = "diff-removed-code-line";
  div.textContent = text;
  return div;
}

/* ------------------------------------------------------------------ */
/*  Decoration builders                                                */
/* ------------------------------------------------------------------ */

function addNodeDecoration(
  decos: Decoration[],
  from: number,
  to: number,
  className: string,
) {
  decos.push(Decoration.node(from, to, { class: className }));
}

function addInlineDecoration(
  decos: Decoration[],
  from: number,
  to: number,
  className: string,
) {
  decos.push(Decoration.inline(from, to, { class: className }));
}

function addRemovedTextWidget(decos: Decoration[], pos: number, text: string) {
  decos.push(Decoration.widget(pos, createRemovedTextWidget(text)));
}

function addRemovedNodeWidget(
  decos: Decoration[],
  pos: number,
  node: ProsemirrorNode,
) {
  decos.push(Decoration.widget(pos, createRemovedNodeWidget(node)));
}

function addRemovedCodeLineWidget(
  decos: Decoration[],
  pos: number,
  text: string,
) {
  decos.push(
    Decoration.widget(pos, createRemovedCodeLineWidget(text), {
      side: -1,
      block: true,
    }),
  );
}

/* ------------------------------------------------------------------ */
/*  Recursive node comparer                                            */
/* ------------------------------------------------------------------ */

function compareNodes(
  oldNode: ProsemirrorNode | null,
  newNode: ProsemirrorNode | null,
  pos: number,
  state: any,
  decos: Decoration[],
): number {
  const nodeSize = newNode ? state.doc.nodeAt(pos)?.nodeSize : 0;
  const end = pos + (nodeSize || 0);

  // Only old exists → node removed
  if (!newNode && oldNode) {
    addRemovedNodeWidget(decos, pos, oldNode);
    return pos;
  }

  // Only new exists → node added
  if (!oldNode && newNode) {
    if (nodeSize > 0) addNodeDecoration(decos, pos, end, "diff-added");
    return end;
  }

  if (!oldNode || !newNode) return end;

  // Different types → node modified
  if (oldNode.type.name !== newNode.type.name) {
    if (nodeSize > 0) addNodeDecoration(decos, pos, end, "diff-modified");
    return end;
  }

  // Same type — compare content based on node kind
  switch (newNode.type.name) {
    case "text": {
      const ot = oldNode.text ?? "";
      const nt = newNode.text ?? "";
      const formattingMatches = marksMatch(oldNode, newNode);

      if (ot === nt && formattingMatches) return end;

      if (ot === nt && !formattingMatches) {
        addInlineDecoration(decos, pos, end, "diff-modified");
        return end;
      }

      const diff = diffChars(ot, nt);
      let cursor = pos;
      for (const part of diff) {
        const len = part.value.length;
        if (part.added) {
          addInlineDecoration(decos, cursor, cursor + len, "diff-added");
          cursor += len;
        } else if (part.removed) {
          addRemovedTextWidget(decos, cursor, part.value);
        } else {
          cursor += len;
        }
      }
      return end;
    }

    case "codeBlock": {
      const ot = oldNode.textContent ?? "";
      const nt = newNode.textContent ?? "";
      if (ot === nt) return end;

      const diff = diffLines(ot, nt);
      let cursor = pos + 1;

      for (const part of diff) {
        const partLength = part.value.length;
        if (part.added) {
          addInlineDecoration(
            decos,
            cursor,
            cursor + partLength,
            "diff-code-added",
          );
          cursor += partLength;
        } else if (part.removed) {
          const lines = part.value.split("\n");
          if (lines.length > 1 && lines[lines.length - 1] === "") {
            lines.pop();
          }
          for (const line of lines) {
            addRemovedCodeLineWidget(decos, cursor, line);
          }
        } else {
          cursor += partLength;
        }
      }
      return end;
    }

    case "paragraph":
    case "heading":
    case "blockquote":
    case "listItem":
    case "taskItem":
    case "tableCell":
    case "tableHeader": {
      const oldChildren: ProsemirrorNode[] = [];
      oldNode.forEach((child) => {
        oldChildren.push(child);
      });

      const newChildren: ProsemirrorNode[] = [];
      newNode.forEach((child) => {
        newChildren.push(child);
      });

      const aligned = alignNodes(oldChildren, newChildren);
      let childPos = pos + 1;

      for (const item of aligned) {
        if ("oldNode" in item) {
          childPos = compareNodes(
            item.oldNode,
            item.newNode,
            childPos,
            state,
            decos,
          );
        } else if ("removed" in item) {
          compareNodes(item.node, null, childPos, state, decos);
        } else {
          childPos = compareNodes(null, item.node, childPos, state, decos);
        }
      }
      return end;
    }

    case "bulletList":
    case "orderedList":
    case "taskList":
    case "table":
    case "tableRow": {
      const oldChildren: ProsemirrorNode[] = [];
      oldNode.forEach((child) => {
        oldChildren.push(child);
      });

      const newChildren: ProsemirrorNode[] = [];
      newNode.forEach((child) => {
        newChildren.push(child);
      });

      const aligned = alignNodes(oldChildren, newChildren);
      let childPos = pos + 1;

      for (const item of aligned) {
        if ("oldNode" in item) {
          childPos = compareNodes(
            item.oldNode,
            item.newNode,
            childPos,
            state,
            decos,
          );
        } else if ("removed" in item) {
          compareNodes(item.node, null, childPos, state, decos);
        } else {
          childPos = compareNodes(null, item.node, childPos, state, decos);
        }
      }
      return end;
    }

    case "horizontalRule":
    case "image":
      return end;

    default:
      return end;
  }
}

/* ------------------------------------------------------------------ */
/*  Node alignment (look-ahead greedy matcher)                         */
/* ------------------------------------------------------------------ */

type AlignedItem =
  | { oldNode: ProsemirrorNode; newNode: ProsemirrorNode }
  | { removed: true; node: ProsemirrorNode }
  | { added: true; node: ProsemirrorNode };

function alignNodes(
  oldNodes: ProsemirrorNode[],
  newNodes: ProsemirrorNode[],
): AlignedItem[] {
  const result: AlignedItem[] = [];
  let oi = 0;
  let ni = 0;
  const LOOKAHEAD = 3;

  while (oi < oldNodes.length || ni < newNodes.length) {
    if (oi >= oldNodes.length) {
      result.push({ added: true, node: newNodes[ni++] });
      continue;
    }
    if (ni >= newNodes.length) {
      result.push({ removed: true, node: oldNodes[oi++] });
      continue;
    }

    if (nodesMatch(oldNodes[oi], newNodes[ni])) {
      result.push({ oldNode: oldNodes[oi++], newNode: newNodes[ni++] });
      continue;
    }

    let found = false;
    for (let k = 1; k <= LOOKAHEAD && ni + k < newNodes.length; k++) {
      if (nodesMatch(oldNodes[oi], newNodes[ni + k])) {
        for (let j = 0; j < k; j++) {
          result.push({ added: true, node: newNodes[ni++] });
        }
        found = true;
        break;
      }
    }
    if (found) continue;

    for (let k = 1; k <= LOOKAHEAD && oi + k < oldNodes.length; k++) {
      if (nodesMatch(oldNodes[oi + k], newNodes[ni])) {
        for (let j = 0; j < k; j++) {
          result.push({ removed: true, node: oldNodes[oi++] });
        }
        found = true;
        break;
      }
    }
    if (found) continue;

    result.push({ removed: true, node: oldNodes[oi++] });
    result.push({ added: true, node: newNodes[ni++] });
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  ProseMirror plugin                                                 */
/* ------------------------------------------------------------------ */

const pluginKey = new PluginKey("comparePlugin");

function createComparePlugin(options: CompareOptions) {
  return new Plugin({
    key: pluginKey,

    state: {
      init(config, state): ComparePluginState {
        return {
          comparisonContent: options.comparisonContent,
          decorations: DecorationSet.empty,
        };
      },

      apply(tr, pluginState, oldState, newState): ComparePluginState {
        const meta = tr.getMeta(pluginKey);
        let comparisonContent = pluginState.comparisonContent;
        let decorations = pluginState.decorations;

        let targetChanged = false;
        if (meta?.comparisonContent !== undefined) {
          comparisonContent = meta.comparisonContent;
          targetChanged = true;
        }

        // Performance Optimization: Only rebuild the diff tree if content actually changed
        if (tr.docChanged || targetChanged) {
          if (!comparisonContent) {
            decorations = DecorationSet.empty;
          } else {
            let oldDoc: ProsemirrorNode;
            try {
              oldDoc = newState.schema.nodeFromJSON(comparisonContent);

              const oldNodes: ProsemirrorNode[] = [];
              oldDoc.forEach((child) => oldNodes.push(child));

              const newNodes: ProsemirrorNode[] = [];
              newState.doc.forEach((child) => newNodes.push(child));

              const decos: Decoration[] = [];
              const aligned = alignNodes(oldNodes, newNodes);

              let pos = 0;
              for (const item of aligned) {
                if ("oldNode" in item) {
                  pos = compareNodes(
                    item.oldNode,
                    item.newNode,
                    pos,
                    newState,
                    decos,
                  );
                } else if ("removed" in item) {
                  compareNodes(item.node, null, pos, newState, decos);
                } else {
                  pos = compareNodes(null, item.node, pos, newState, decos);
                }
              }
              decorations = DecorationSet.create(newState.doc, decos);
            } catch (e) {
              console.error(
                "Failed to restore previous state schema mapping.",
                e,
              );
              decorations = DecorationSet.empty;
            }
          }
        } else {
          // If transaction has no document edits, map existing coordinate points
          decorations = decorations.map(tr.mapping, tr.doc);
        }

        return {
          comparisonContent,
          decorations,
        };
      },
    },

    props: {
      decorations(state) {
        return pluginKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/*  TipTap extension                                                   */
/* ------------------------------------------------------------------ */

export const ComparePlugin = Extension.create<CompareOptions>({
  name: "compare",

  addOptions() {
    return { comparisonContent: null };
  },

  addCommands(): any {
    return {
      setComparisonContent:
        (content: Record<string, any> | null) =>
        ({ state, dispatch }: { state: any; dispatch: any }) => {
          const tr = state.tr.setMeta(pluginKey, {
            comparisonContent: content,
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [createComparePlugin(this.options)];
  },
});

export default ComparePlugin;
