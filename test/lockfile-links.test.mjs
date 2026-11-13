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

// A git repository in a scratch folder holding `files` as staged, which is all
// the check reads; the scratch folder is removed when the test ends.
function stagedRepository(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-links-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    execFileSync("git", ["-C", root, "add", file]);
  }
  return repositoryRoot(root);
}

function manifest(dependencies) {
  return `${JSON.stringify({ name: "app", version: "1.0.0", dependencies }, null, "\t")}\n`;
}

// What npm writes for `"sigdash": "file:../sigdash"`: the link, the linked
// folder's own entry, and what that folder has installed under it.
const SIGDASH_LINKED = {
  "../sigdash": { version: "1.113.883", dependencies: { lucide: "^1.17.0" } },
  "../sigdash/node_modules/lucide": { version: "1.17.0", resolved: "https://registry.npmjs.org/lucide/-/lucide-1.17.0.tgz" },
  "node_modules/sigdash": { resolved: "../sigdash", link: true },
};

// TEST13134: a file: dependency the repository's own package.json declares, as
// committed, passes: the link to the folder it names, that folder's entry and
// what is installed under it. Its .wstemplate may declare it as
// `file:{{ … }}` beside it, and a lockfile in a subfolder is read against the
// package.json in that subfolder.
test("TEST13134 a file: dependency the repository's package.json declares passes", (t) => {
  const declared = stagedRepository(t, {
    "package.json": manifest({ sigdash: "file:../sigdash", "left-pad": "^1.3.0" }),
    "package.json.wstemplate": manifest({ sigdash: "file:{{ projects.sigdash.path_from_here }}", "left-pad": "^1.3.0" }),
    "package-lock.json": lockfile({ ...SIGDASH_LINKED, "node_modules/left-pad": { version: "1.3.0", resolved: REGISTRY } }),
  });
  assert.deepEqual(repositoryProblems(declared), { files: ["package-lock.json"], problems: [] });

  const nested = stagedRepository(t, {
    "server/package.json": manifest({ shared: "file:../../shared" }),
    "server/package-lock.json": lockfile({
      "../../shared": { version: "1.0.0" },
      "node_modules/shared": { resolved: "../../shared", link: true },
    }),
  });
  assert.deepEqual(repositoryProblems(nested), { files: ["server/package-lock.json"], problems: [] });
});

// TEST13135: a link outside the repository that package.json does not declare
// is refused, naming the lockfile and the package, beside one it does declare;
// and a declaration only on disk, not staged, is no declaration.
test("TEST13135 an undeclared link outside the repository is refused beside a declared one", (t) => {
  const root = stagedRepository(t, {
    "package.json": manifest({ sigdash: "file:../sigdash", capdag: "^1.0.0" }),
    "package-lock.json": lockfile({ ...SIGDASH_LINKED, "node_modules/capdag": { resolved: "../capdag/capdag-js", link: true } }),
  });
  assert.deepEqual(repositoryProblems(root).problems, [
    'package-lock.json: package "capdag" (node_modules/capdag) is linked to ../capdag/capdag-js, outside the repository',
  ]);

  fs.writeFileSync(path.join(root, "package.json"), manifest({ sigdash: "file:../sigdash", capdag: "file:../capdag/capdag-js" }));
  assert.deepEqual(repositoryProblems(root).problems, [
    'package-lock.json: package "capdag" (node_modules/capdag) is linked to ../capdag/capdag-js, outside the repository',
  ]);
});

// TEST13136: a declaration covers its own package and its own folder only: a
// link to another folder than the one declared, and another package linked to
// the declared folder, are refused, naming the lockfile and the package.
test("TEST13136 a link to another folder than declared, or by another name, is refused", (t) => {
  const elsewhere = stagedRepository(t, {
    "package.json": manifest({ sigdash: "file:../sigdash" }),
    "package-lock.json": lockfile({
      "../vendor/sigdash": { version: "1.0.0" },
      "node_modules/sigdash": { resolved: "../vendor/sigdash", link: true },
    }),
  });
  assert.deepEqual(repositoryProblems(elsewhere).problems, [
    'package-lock.json: package "sigdash" is located at ../vendor/sigdash, outside the repository',
    'package-lock.json: package "sigdash" (node_modules/sigdash) is linked to ../vendor/sigdash, outside the repository; package.json declares it as file:../sigdash',
  ]);

  const renamed = stagedRepository(t, {
    "package.json": manifest({ sigdash: "file:../sigdash" }),
    "package-lock.json": lockfile({ ...SIGDASH_LINKED, "node_modules/sigdash-fork": { resolved: "../sigdash", link: true } }),
  });
  assert.deepEqual(repositoryProblems(renamed).problems, [
    'package-lock.json: package "sigdash-fork" (node_modules/sigdash-fork) is linked to ../sigdash, outside the repository',
  ]);
});

// TEST13137: in a .wstemplate, only a value that is `file:{{ … }}` outright
// declares a file: dependency. One a local render chooses
// (`{% if env.MFR_LOCAL_LIBS %}"file:{{ … }}"{% else %}…`) is a registry
// dependency as committed, so its link is refused; and a template declaration
// whose render, package.json, names no folder for it cannot say where the link
// may lead, so that link is refused too.
test("TEST13137 a local-render choice in a template declares nothing, and a declaration needs its rendered folder", (t) => {
  const localRender = stagedRepository(t, {
    "package.json": manifest({ capdag: "^1.0.0" }),
    "package.json.wstemplate": manifest({ capdag: "@@" }).replace(
      '"@@"',
      '{% if env.MFR_LOCAL_LIBS %}"file:{{ projects.capdag_js.path_from_here }}"{% else %}"^{{ projects.capdag_js.latest_remote_version }}"{% endif %}',
    ),
    "package-lock.json": lockfile({ "node_modules/capdag": { resolved: "../capdag/capdag-js", link: true } }),
  });
  assert.deepEqual(repositoryProblems(localRender).problems, [
    'package-lock.json: package "capdag" (node_modules/capdag) is linked to ../capdag/capdag-js, outside the repository',
  ]);

  const unrendered = stagedRepository(t, {
    "package.json": manifest({ sigdash: "^1.0.0" }),
    "package.json.wstemplate": manifest({ sigdash: "file:{{ projects.sigdash.path_from_here }}" }),
    "package-lock.json": lockfile({ "node_modules/sigdash": { resolved: "../sigdash", link: true } }),
  });
  assert.deepEqual(repositoryProblems(unrendered).problems, [
    'package-lock.json: package "sigdash" (node_modules/sigdash) is linked to ../sigdash, outside the repository; ' +
      "package.json.wstemplate declares it as a file: dependency, but package.json, its render, names no folder for it",
  ]);
});
