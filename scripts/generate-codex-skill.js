#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKILL_NAME = 'gsd-codex';
const SKILL_ROOT = path.join(ROOT, 'skills', SKILL_NAME);
const SOURCE_CLAUDE_PREFIX = '~/.claude/get-shit-done';
const TARGET_CLAUDE_PREFIX = `~/.codex/skills/${SKILL_NAME}/get-shit-done`;
const SOURCE_CLAUDE_PREFIX_WITH_SLASH = `${SOURCE_CLAUDE_PREFIX}/`;
const SOURCE_CLAUDE_AGENTS_PREFIX = '~/.claude/agents';
const SOURCE_CLAUDE_COMMANDS_PREFIX = '~/.claude/commands';
const SOURCE_CLAUDE_CACHE_PREFIX = '~/.claude/cache';
const SOURCE_CLAUDE_ROOT = '~/.claude/';
const TARGET_CLAUDE_AGENTS_PREFIX = `~/.codex/skills/${SKILL_NAME}/references/agents`;
const TARGET_CLAUDE_COMMANDS_PREFIX = `~/.codex/skills/${SKILL_NAME}/references/commands`;
const TARGET_CLAUDE_CACHE_PREFIX = `~/.codex/skills/${SKILL_NAME}/cache`;
const TARGET_CLAUDE_ROOT = `~/.codex/skills/${SKILL_NAME}/`;

const COMMANDS_SRC = path.join(ROOT, 'commands', 'gsd');
const AGENTS_SRC = path.join(ROOT, 'agents');
const WORKFLOWS_SRC = path.join(ROOT, 'get-shit-done', 'workflows');
const REFERENCES_SRC = path.join(ROOT, 'get-shit-done', 'references');
const TEMPLATES_SRC = path.join(ROOT, 'get-shit-done', 'templates');
const GET_SHIT_DONE_SRC = path.join(ROOT, 'get-shit-done');

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REPLACEMENTS = [
  [new RegExp(escapeRegExp(SOURCE_CLAUDE_PREFIX_WITH_SLASH), 'g'), `${TARGET_CLAUDE_PREFIX}/`],
  [new RegExp(escapeRegExp(SOURCE_CLAUDE_PREFIX), 'g'), TARGET_CLAUDE_PREFIX],
  [new RegExp(escapeRegExp(`${SOURCE_CLAUDE_AGENTS_PREFIX}/`), 'g'), `${TARGET_CLAUDE_AGENTS_PREFIX}/`],
  [new RegExp(escapeRegExp(`${SOURCE_CLAUDE_COMMANDS_PREFIX}/`), 'g'), `${TARGET_CLAUDE_COMMANDS_PREFIX}/`],
  [new RegExp(escapeRegExp(`${SOURCE_CLAUDE_CACHE_PREFIX}/`), 'g'), `${TARGET_CLAUDE_CACHE_PREFIX}/`],
  [new RegExp(escapeRegExp(SOURCE_CLAUDE_ROOT), 'g'), `${TARGET_CLAUDE_ROOT}`],
];

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.js',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.txt',
  '.sh',
  '.bash',
]);

function resetSkillDir() {
  if (fs.existsSync(SKILL_ROOT)) {
    fs.rmSync(SKILL_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(SKILL_ROOT, { recursive: true });
}

function countFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return 0;

  let count = 0;
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!predicate || predicate(fullPath, entry.name)) {
        count += 1;
      }
    }
  }

  return count;
}

function normalizeGitHubRepoUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) {
    return null;
  }

  const source = rawUrl.trim().replace(/^git\+/, '');
  const httpsMatch = source.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}.git`;
  }

  const sshMatch = source.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git`;
  }

  return null;
}

function detectSourceRepo() {
  const sources = [
    () => execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim(),
    () => execSync('git remote get-url upstream', { cwd: ROOT, encoding: 'utf8' }).trim(),
  ];

  for (const getUrl of sources) {
    try {
      const repoUrl = normalizeGitHubRepoUrl(getUrl());
      if (repoUrl) {
        return repoUrl;
      }
    } catch (err) {
      // Try next source.
    }
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    if (packageJson?.repository?.url) {
      return normalizeGitHubRepoUrl(packageJson.repository.url);
    }
  } catch (err) {
    // Fallback below.
  }

  return 'local-repo';
}

function detectSourceRef() {
  try {
    const head = execSync('git symbolic-ref -q --short refs/remotes/origin/HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    const parts = head.split('/');
    const branch = parts[parts.length - 1];
    if (branch) {
      return branch;
    }
  } catch (err) {
    // Continue to fallback logic.
  }

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    if (branch && branch !== 'HEAD') {
      return branch;
    }
  } catch (err) {
    // Ignore and fallback.
  }

  return 'main';
}

function collectRelativeFiles(dir, predicate) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = [];
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const sourcePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(sourcePath);
        continue;
      }

      if (!predicate || predicate(sourcePath, entry.name)) {
        files.push(path.relative(dir, sourcePath).replace(/\\/g, '/'));
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function createIndexFile() {
  const referencesRoot = path.join(SKILL_ROOT, 'references');
  const indexPath = path.join(referencesRoot, 'INDEX.md');

  const indexEntries = {
    Commands: collectRelativeFiles(
      path.join(referencesRoot, 'commands'),
      (_path) => path.extname(_path) === '.md'
    ),
    Workflows: collectRelativeFiles(
      path.join(referencesRoot, 'workflows'),
      (_path) => path.extname(_path) === '.md'
    ),
    Agents: collectRelativeFiles(
      path.join(referencesRoot, 'agents'),
      (_path) => path.extname(_path) === '.md'
    ),
    References: collectRelativeFiles(
      path.join(referencesRoot, 'references'),
      (_path) => path.extname(_path) === '.md'
    ),
    Templates: collectRelativeFiles(
      path.join(referencesRoot, 'templates'),
      (_path) => path.extname(_path) === '.md'
    ),
  };

  const lines = ['# GSD Codex Index', ''];
  for (const [title, entries] of Object.entries(indexEntries)) {
    lines.push(`## ${title} (${entries.length})`);
    for (const entry of entries) {
      lines.push(`- \`${title.toLowerCase()}/${entry}\``);
    }
    lines.push('');
  }

  fs.writeFileSync(indexPath, `${lines.join('\n')}\n`, 'utf8');
}

function replacePaths(content) {
  let rewritten = content;
  for (const [pattern, replacement] of REPLACEMENTS) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  return rewritten;
}

function transformAndCopyFile(srcFile, destFile) {
  const ext = path.extname(srcFile).toLowerCase();
  const data = fs.readFileSync(srcFile, 'utf8');

  const output = TEXT_EXTENSIONS.has(ext)
    ? replacePaths(data)
    : data;

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, output, 'utf8');
}

function copyDir(src, dest, shouldCopy) {
  if (!fs.existsSync(src)) {
    return;
  }

  const stack = [[src, dest]];

  while (stack.length) {
    const [sourceDir, destDir] = stack.pop();
    fs.mkdirSync(destDir, { recursive: true });

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        stack.push([sourcePath, destPath]);
        continue;
      }

      if (!shouldCopy(entry.name, sourcePath)) {
        continue;
      }

      transformAndCopyFile(sourcePath, destPath);
    }
  }
}

function copySkillScaffold() {
  // Command prompts and references that Codex loads directly.
  copyDir(
    COMMANDS_SRC,
    path.join(SKILL_ROOT, 'references', 'commands'),
    (name) => name.endsWith('.md') && !name.endsWith('.bak.md')
  );

  copyDir(
    AGENTS_SRC,
    path.join(SKILL_ROOT, 'references', 'agents'),
    (name) => name.endsWith('.md')
  );

  copyDir(WORKFLOWS_SRC, path.join(SKILL_ROOT, 'references', 'workflows'), () => true);
  copyDir(REFERENCES_SRC, path.join(SKILL_ROOT, 'references', 'references'), () => true);
  copyDir(TEMPLATES_SRC, path.join(SKILL_ROOT, 'references', 'templates'), () => true);

  // Runtime helper assets that workflows/agents invoke directly.
  copyDir(GET_SHIT_DONE_SRC, path.join(SKILL_ROOT, 'get-shit-done'), () => true);
}

function writeMetadata() {
  fs.mkdirSync(path.join(SKILL_ROOT, 'agents'), { recursive: true });
  createIndexFile();

  const sourceRepo = detectSourceRepo();
  const sourceRef = detectSourceRef();
  let sourceCommit = 'local-repo';
  try {
    sourceCommit = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (err) {
    // Non-fatal: keep local-repo placeholder when not in git context.
  }

  const skillReadme = [
    '---',
    'name: gsd-codex',
    'description: Adapt the official Get Shit Done (GSD) workflow for Codex sessions. Use when the user asks to run GSD-style project planning/execution flows (for example /gsd:new-project, /gsd:plan-phase, /gsd:execute-phase, /gsd:verify-work, debugging, roadmap updates), and Codex needs the corresponding command, workflow, agent, or template references.',
    '---',
    '',
    '# GSD for Codex',
    '',
    'Use this skill as a compatibility layer for the official GSD methodology.',
    '',
    '## Operating Rules',
    '',
    '1. Load only the specific reference files required for the current command.',
    '2. Treat `references/commands/*.md` as user-facing entry points and `references/workflows/*.md` as execution details.',
    '3. Use `references/agents/*.md` only when the command requires delegation behavior.',
    '4. Preserve safety constraints from the current environment; do not assume permission-skipping flags are allowed.',
    '5. Keep outputs aligned to the active repository conventions and existing planning files.',
    '',
    '## Navigation',
    '',
    '- Command docs: `references/commands/`',
    '- Workflow docs: `references/workflows/`',
    '- Agent roles: `references/agents/`',
    '- Core references: `references/references/`',
    '- Templates: `references/templates/`',
    '- Generated index: `references/INDEX.md`',
    '',
    '## Common Adaptations for Codex',
    '',
    '1. If an upstream flow expects runtime-specific slash command behavior, execute the equivalent steps directly in this session.',
    '2. If an upstream flow expects a tool not available here, apply the nearest supported equivalent and record the substitution in the output.',
    '3. Keep plans concrete and verifiable; include explicit file paths and checks.',
    '',
  ].join('\n');

  fs.writeFileSync(
    path.join(SKILL_ROOT, 'SKILL.md'),
    `${skillReadme}\n`,
    'utf8'
  );

  fs.writeFileSync(
    path.join(SKILL_ROOT, 'agents', 'openai.yaml'),
    `interface:\n  display_name: "GSD Codex"\n  short_description: "Get Shit Done workflow for Codex"\n  default_prompt: "Apply the official GSD workflow in this repository and execute the next concrete command safely."\n`,
    'utf8'
  );

  const manifest = {
    source_repo: sourceRepo,
    source_ref: sourceRef,
    source_commit: sourceCommit,
    generated_skill: SKILL_NAME,
    counts: {
      commands: countFiles(path.join(SKILL_ROOT, 'references', 'commands'), (f, name) => name.endsWith('.md')),
      agents: countFiles(path.join(SKILL_ROOT, 'references', 'agents'), (f, name) => name.endsWith('.md')),
      workflows: countFiles(path.join(SKILL_ROOT, 'references', 'workflows'), (f, name) => name.endsWith('.md')),
      references: countFiles(path.join(SKILL_ROOT, 'references', 'references'), (f, name) => name.endsWith('.md')),
      templates: countFiles(
        path.join(SKILL_ROOT, 'references', 'templates'),
        (_f, name) => name.endsWith('.md') || name === 'config.json',
      ),
    },
  };

  fs.writeFileSync(
    path.join(SKILL_ROOT, 'upstream.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

resetSkillDir();
copySkillScaffold();
writeMetadata();

console.log('Generated Codex skill at:');
console.log(`  ${SKILL_ROOT}`);
