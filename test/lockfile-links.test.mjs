// A COMMITTED LOCKFILE NEVER POINTS AT A FOLDER BESIDE THE REPOSITORY.
//
// A lockfile written while capdag or tagged-urn was installed from a working
// copy next to this one resolves them to "../capdag-js"-style folders; a clean
// clone anywhere else has no such folder and `npm ci` fails. The check refuses
// such an entry and names the file and the package; these tests plant one and
// see it refused, and hold this repository's own committed lockfiles to it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lockfileProblems, repositoryProblems, repositoryRoot } from "../scripts/check-lockfile-links.mjs";

const REPO = path.resolve(path.sep, "work", "repo");
const REGISTRY = "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz";

function lockfile(packages, lockfileVersion = 3) {
  return JSON.stringify({ name: "app", lockfileVersion, requires: true, packages: { "": { name: "app" }, ...packages } });
}

// TEST13129: a lockfile entry linked to a folder outside the repository — what
// installing from a local working copy writes — is refused, and the refusal
// names the lockfile and the package; the same lockfile without it passes.
test("TEST13129 a link outside the repository is refused, naming the lockfile and the package", () => {
  const clean = {
    "node_modules/left-pad": { version: "1.3.0", resolved: REGISTRY, integrity: "sha512-x" },
  };
  const planted = {
    ...clean,
    "node_modules/capdag": { resolved: "../capdag/capdag-js", link: true },
  };
  assert.deepEqual(lockfileProblems(lockfile(clean), "package-lock.json", REPO), []);
  assert.deepEqual(lockfileProblems(lockfile(planted), "package-lock.json", REPO), [
    'package-lock.json: package "capdag" (node_modules/capdag) is linked to ../capdag/capdag-js, outside the repository',
  ]);
  // A lockfile in a subfolder resolves its links from that subfolder: one level
  // up from server/ is still inside, two levels up is not.
  const nested = {
    "node_modules/shared": { resolved: "../shared", link: true },
    "node_modules/@scope/lib": { resolved: "../../lib", link: true },
  };
  assert.deepEqual(lockfileProblems(lockfile(nested), "server/package-lock.json", REPO), [
    'server/package-lock.json: package "@scope/lib" (node_modules/@scope/lib) is linked to ../../lib, outside the repository',
  ]);
  // A link with no target is not a lockfile npm writes; it is refused, not passed.
  assert.deepEqual(
    lockfileProblems(lockfile({ "node_modules/capdag": { link: true } }), "package-lock.json", REPO),
    ['package-lock.json: package "capdag" (node_modules/capdag) is a link with no "resolved" target'],
  );
});

// TEST13130: a package located, or resolved by path, outside the repository is
// refused: the linked folder's own entry ("../sigdash"), a file: tarball beside
// the repository, and an absolute path.
test("TEST13130 a package located or resolved by path outside the repository is refused", () => {
  const outsideTarball = "file:../vendor/tagged-urn-1.0.0.tgz";
  const absolute = path.resolve(path.sep, "elsewhere", "tagged-urn-js");
  const packages = {
    "../sigdash": { version: "1.0.0" },
    "node_modules/tagged-urn": { version: "1.0.0", resolved: outsideTarball },
    "node_modules/capdag": { resolved: absolute, link: true },
  };
  assert.deepEqual(lockfileProblems(lockfile(packages), "package-lock.json", REPO), [
    'package-lock.json: package "sigdash" is located at ../sigdash, outside the repository',
    `package-lock.json: package "tagged-urn" (node_modules/tagged-urn) is resolved from ${outsideTarball}, outside the repository`,
    `package-lock.json: package "capdag" (node_modules/capdag) is linked to ${absolute}, outside the repository`,
  ]);
});

// TEST13131: what a clean checkout can install passes — registry and git URLs,
// a tarball and a workspace inside the repository — and a lockfile the check
// cannot read (not JSON, an older lockfileVersion) is an error naming the file,
// never a pass.
test("TEST13131 registry and git URLs and paths inside the repository pass; an unreadable lockfile is an error", () => {
  const packages = {
    client: { name: "client", version: "1.0.0" },
    "node_modules/client": { resolved: "client", link: true },
    "node_modules/left-pad": { version: "1.3.0", resolved: REGISTRY },
    "node_modules/from-git": { version: "1.0.0", resolved: "git+ssh://git@example.com/org/from-git.git#0123abc" },
    "node_modules/vendored": { version: "1.0.0", resolved: "file:vendor/vendored-1.0.0.tgz" },
    "node_modules/bundled": { version: "1.0.0", inBundle: true },
  };
  assert.deepEqual(lockfileProblems(lockfile(packages), "package-lock.json", REPO), []);
  assert.throws(() => lockfileProblems("{", "package-lock.json", REPO), /^Error: package-lock\.json: is not JSON/);
  assert.throws(
    () => lockfileProblems(JSON.stringify({ lockfileVersion: 1, dependencies: {} }), "a/package-lock.json", REPO),
    /^Error: a\/package-lock\.json: lockfileVersion 1 is not one this check reads/,
  );
});

// TEST13132: the check reads every lockfile git's index holds for a repository
// — what a commit records — and not the file on disk: a staged lockfile with a
// planted link fails it, the clean one passes, and every lockfile this
// repository holds passes.
test("TEST13132 the lockfiles git holds for a repository are checked, as staged", (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-links-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", scratch, ...args], { encoding: "utf8" });
  git("init", "--quiet");
  fs.mkdirSync(path.join(scratch, "server"));
  const clean = lockfile({ "node_modules/left-pad": { version: "1.3.0", resolved: REGISTRY } });
  const planted = lockfile({ "node_modules/capdag": { resolved: "../../capdag-js", link: true } });
  const lockPath = path.join(scratch, "server", "package-lock.json");

  fs.writeFileSync(lockPath, planted);
  git("add", "server/package-lock.json");
  fs.writeFileSync(lockPath, clean);
  assert.deepEqual(repositoryProblems(repositoryRoot(scratch)), {
    files: ["server/package-lock.json"],
    problems: [
      'server/package-lock.json: package "capdag" (node_modules/capdag) is linked to ../../capdag-js, outside the repository',
    ],
  });

  git("add", "server/package-lock.json");
  fs.writeFileSync(lockPath, planted);
  assert.deepEqual(repositoryProblems(repositoryRoot(scratch)), { files: ["server/package-lock.json"], problems: [] });

  const own = repositoryProblems(repositoryRoot(path.dirname(fileURLToPath(import.meta.url))));
  assert.ok(own.files.length > 0, "this repository commits a lockfile, so the check must have found one");
  assert.deepEqual(own.problems, []);
});
