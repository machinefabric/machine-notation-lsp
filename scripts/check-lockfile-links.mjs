// A COMMITTED LOCKFILE RESOLVES ITS PACKAGES FROM THE REGISTRY OR FROM INSIDE
// ITS OWN REPOSITORY.
//
// A package-lock.json written while a dependency was installed from a working
// copy beside this one (`"link": true`, `"resolved": "../tagged-urn-js"`)
// names a folder a clean checkout elsewhere does not have, and `npm ci` there
// fails. This refuses every entry of a lockfile git holds for this repository
// that is located, linked or resolved outside it, naming the file and the
// package; registry and git URLs, and links between workspaces inside the
// repository, are what a clean checkout can install and pass.
//
// It reads each lockfile as git's index holds it, which is what a commit
// records and, in a clean clone, what was committed. The file on disk is
// not read: while dependencies are installed from local working copies it is
// rewritten with links on purpose, and that is not a lockfile anyone commits
// unless it is staged, which this then refuses.
//
//   node scripts/check-lockfile-links.mjs
//
// Exits 0 when every lockfile is clean, 1 with one line per offending entry,
// and 2 when it cannot read a lockfile at all.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCKFILE_NAMES = ["package-lock.json", "npm-shrinkwrap.json"];
const READ_VERSIONS = new Set([2, 3]);
// A URL scheme is two characters or more, so a Windows drive (C:\…) is a path.
const URL_SCHEME = /^([a-z][a-z0-9+.-]+):/i;

/** The name of the package an entry of `packages` installs, from its key. */
function packageName(key, entry) {
  const at = key.lastIndexOf("node_modules/");
  if (at >= 0) return key.slice(at + "node_modules/".length);
  // A package located outside node_modules (a workspace, or the folder a link
  // points at) is named by its own package.json, which npm copies only when
  // it differs from the folder's name.
  return typeof entry.name === "string" ? entry.name : path.posix.basename(key);
}

/** The filesystem path a `resolved` value names, or null when it is a URL. */
function resolvedPath(resolved) {
  const scheme = URL_SCHEME.exec(resolved);
  if (!scheme) return resolved;
  if (scheme[1].toLowerCase() === "file") return resolved.slice("file:".length);
  return null;
}

function outside(repoRoot, target) {
  const rel = path.relative(repoRoot, target);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

/**
 * Every entry of one lockfile that leads outside the repository.
 *
 * @param {string} text the lockfile's contents
 * @param {string} file its path relative to the repository's root, as git lists it
 * @param {string} repoRoot the repository's root, absolute
 * @returns {string[]} one message per offending entry, naming the file and the package
 */
export function lockfileProblems(text, file, repoRoot) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: is not JSON: ${error.message}`);
  }
  if (!READ_VERSIONS.has(lock.lockfileVersion)) {
    throw new Error(
      `${file}: lockfileVersion ${JSON.stringify(lock.lockfileVersion)} is not one this check reads (2 or 3); ` +
        "regenerate it with the npm the repository uses",
    );
  }
  if (lock.packages === null || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
    throw new Error(`${file}: has no "packages" object`);
  }

  const lockDir = path.join(repoRoot, path.dirname(file));
  const problems = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "") continue;
    const name = packageName(key, entry);
    if (outside(repoRoot, path.resolve(lockDir, key))) {
      problems.push(`${file}: package "${name}" is located at ${key}, outside the repository`);
      continue;
    }
    if (entry.link === true) {
      if (typeof entry.resolved !== "string") {
        problems.push(`${file}: package "${name}" (${key}) is a link with no "resolved" target`);
      } else if (outside(repoRoot, path.resolve(lockDir, entry.resolved))) {
        problems.push(`${file}: package "${name}" (${key}) is linked to ${entry.resolved}, outside the repository`);
      }
      continue;
    }
    if (typeof entry.resolved === "string") {
      const local = resolvedPath(entry.resolved);
      if (local !== null && outside(repoRoot, path.resolve(lockDir, local))) {
        problems.push(`${file}: package "${name}" (${key}) is resolved from ${entry.resolved}, outside the repository`);
      }
    }
  }
  return problems;
}

function git(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
}

/** The root of the git repository holding `dir`; an error when there is none. */
export function repositoryRoot(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`${dir} is not inside a git checkout, so there are no committed lockfiles to read`);
  }
}

/** Every lockfile git's index holds for the repository, with what each leads outside it. */
export function repositoryProblems(repoRoot) {
  const files = git(repoRoot, ["ls-files", "-z", "--cached", "--", ...LOCKFILE_NAMES.map((n) => `:(glob)**/${n}`)])
    .split("\0")
    .filter(Boolean);
  const problems = [];
  for (const file of files) {
    problems.push(...lockfileProblems(git(repoRoot, ["show", `:${file}`]), file, repoRoot));
  }
  return { files, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = repositoryProblems(repositoryRoot(path.dirname(fileURLToPath(import.meta.url))));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(problem);
    console.error(
      "A committed lockfile must resolve every package from the registry, as package.json declares it: " +
        "reinstall with the dependency declared by version, not from a local working copy.",
    );
    process.exit(1);
  }
  console.log(`${result.files.length} lockfile(s), every package resolved inside the repository or from a URL.`);
}
