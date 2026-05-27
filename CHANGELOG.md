# Changelog

## 0.1.7

- **Fixed**: Table rows and cells now use positional alignment (by index) instead of text-similarity matching. Previously, a row whose content changed enough to exceed the 50% Levenshtein threshold in `nodesMatch` would be classified as "entirely new," causing every cell in that row to render green via `tr.diff-added td`. Now rows are matched positionally (row 0 vs row 0, cell 0 vs cell 0), so inline diffs within cells render correctly.

## 0.1.6

- Initial public release.
