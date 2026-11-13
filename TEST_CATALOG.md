# Test catalogue — capdag/machine-notation-lsp

Generated from the test catalogue. Edit the tests, not this file.

10 tests: 10 numbered, 0 unnumbered.

## Numbered

| Number | Repository | Language | Test | Location | Description |
|---|---|---|---|---|---|
| TEST12840 | capdag/machine-notation-lsp | js | `test12840_aDocumentIsReadAgainstTheRegistry` | server/test/server.test.ts:132 | TEST12840: a document is read against the registry: the caps its headers name and the fabric aliases its steps use are fetched, and it resolves — a step by its fabric alias, a constant held to its media's rules. |
| TEST12841 | capdag/machine-notation-lsp | js | `test12841_problemsArePlacedWhereTheyAre` | server/test/server.test.ts:150 | TEST12841: what is wrong is placed where the text writes what it is about: a syntax error where reading stopped, an arg the cap does not declare at the member that names it, a constant its rules refuse at the constant, a step that is no header and no alias at the step, and a definition the registry could not give at the header that names it. |
| TEST12842 | capdag/machine-notation-lsp | js | `test12842_theTokenUnderTheCursor` | server/test/server.test.ts:186 | TEST12842: the token under the cursor is what that part of a wiring is: the arg a member names, its node or its constant, the step, the policy, the output a target names and its node. |
| TEST12843 | capdag/machine-notation-lsp | js | `test12843_completionsOfferNamesOfTheStep` | server/test/server.test.ts:208 | TEST12843: completions offer, in a wiring's source group, the args of its step as `name=`; in its targets, the step's outputs; in step position, the header and fabric aliases. |
| TEST12844 | capdag/machine-notation-lsp | js | `test12844_hoversNameWhatTheyAreOver` | server/test/server.test.ts:228 | TEST12844: hovering a step shows its cap's args and outputs by name; hovering a named member shows that arg. |
| TEST12845 | capdag/machine-notation-lsp | js | `test12845_machinesInStepPositionAreReadFromFiles` | server/test/server.test.ts:244 | TEST12845: a document that names another machine reads it from the file its header names, relative to the document's own file, and resolves with its steps written in — their caps fetched too. |
| TEST13129 | capdag/machine-notation-lsp | js | `TEST13129 a link outside the repository is refused, naming the lockfile and the package` | test/lockfile-links.test.mjs:27 | TEST13129: a lockfile entry linked to a folder outside the repository — what installing from a local working copy writes — is refused, and the refusal names the lockfile and the package; the same lockfile without it passes. |
| TEST13130 | capdag/machine-notation-lsp | js | `TEST13130 a package located or resolved by path outside the repository is refused` | test/lockfile-links.test.mjs:58 | TEST13130: a package located, or resolved by path, outside the repository is refused: the linked folder's own entry ("../sigdash"), a file: tarball beside the repository, and an absolute path. |
| TEST13131 | capdag/machine-notation-lsp | js | `TEST13131 registry and git URLs and paths inside the repository pass; an unreadable lockfile is an error` | test/lockfile-links.test.mjs:77 | TEST13131: what a clean checkout can install passes — registry and git URLs, a tarball and a workspace inside the repository — and a lockfile the check cannot read (not JSON, an older lockfileVersion) is an error naming the file, never a pass. |
| TEST13132 | capdag/machine-notation-lsp | js | `TEST13132 the lockfiles git holds for a repository are checked, as staged` | test/lockfile-links.test.mjs:98 | TEST13132: the check reads every lockfile git's index holds for a repository — what a commit records — and not the file on disk: a staged lockfile with a planted link fails it, the clean one passes, and every lockfile this repository holds passes. |

