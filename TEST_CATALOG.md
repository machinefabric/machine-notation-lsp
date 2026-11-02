# Test catalogue — capdag/machine-notation-lsp

Generated from the test catalogue. Edit the tests, not this file.

6 tests: 6 numbered, 0 unnumbered.

## Numbered

| Number | Repository | Language | Test | Location | Description |
|---|---|---|---|---|---|
| TEST12840 | capdag/machine-notation-lsp | js | `test12840_aDocumentIsReadAgainstTheRegistry` | server/test/server.test.ts:132 | TEST12840: a document is read against the registry: the caps its headers name and the fabric aliases its steps use are fetched, and it resolves — a step by its fabric alias, a constant held to its media's rules. |
| TEST12841 | capdag/machine-notation-lsp | js | `test12841_problemsArePlacedWhereTheyAre` | server/test/server.test.ts:150 | TEST12841: what is wrong is placed where the text writes what it is about: a syntax error where reading stopped, an arg the cap does not declare at the member that names it, a constant its rules refuse at the constant, a step that is no header and no alias at the step, and a definition the registry could not give at the header that names it. |
| TEST12842 | capdag/machine-notation-lsp | js | `test12842_theTokenUnderTheCursor` | server/test/server.test.ts:186 | TEST12842: the token under the cursor is what that part of a wiring is: the arg a member names, its node or its constant, the step, the policy, the output a target names and its node. |
| TEST12843 | capdag/machine-notation-lsp | js | `test12843_completionsOfferNamesOfTheStep` | server/test/server.test.ts:208 | TEST12843: completions offer, in a wiring's source group, the args of its step as `name=`; in its targets, the step's outputs; in step position, the header and fabric aliases. |
| TEST12844 | capdag/machine-notation-lsp | js | `test12844_hoversNameWhatTheyAreOver` | server/test/server.test.ts:228 | TEST12844: hovering a step shows its cap's args and outputs by name; hovering a named member shows that arg. |
| TEST12845 | capdag/machine-notation-lsp | js | `test12845_machinesInStepPositionAreReadFromFiles` | server/test/server.test.ts:244 | TEST12845: a document that names another machine reads it from the file its header names, relative to the document's own file, and resolves with its steps written in — their caps fetched too. |

