'use strict';

/**
 * Generates release notes (commits since the previous release tag) and a
 * machine-readable release record for the Release stage.
 *   VERSION=1.0.0-12-abc1234 IMAGE=... node scripts/release-notes.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const version = process.env.VERSION || 'dev';
const image = process.env.IMAGE || 'unknown';
const tag = `v${version}`;
const previousTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${tag}^`) || git('describe', '--tags', '--abbrev=0', '--match', 'v*');
const range = previousTag && previousTag !== tag ? `${previousTag}..HEAD` : 'HEAD~20..HEAD';
const commits = git('log', range, '--pretty=format:- %s (%h, %an)', '--no-merges') || git('log', '-20', '--pretty=format:- %s (%h, %an)');

const notes = [
  `# wam-pantry ${tag}`,
  '',
  `- **Released:** ${new Date().toISOString()}`,
  `- **Image:** \`${image}\``,
  `- **Commit:** ${git('rev-parse', 'HEAD') || 'unknown'}`,
  `- **Jenkins build:** ${process.env.BUILD_URL || 'local'}`,
  `- **Previous release:** ${previousTag && previousTag !== tag ? previousTag : 'n/a (first release)'}`,
  '',
  '## Changes',
  commits || '- (no commits found)',
  '',
].join('\n');

const dist = path.join(__dirname, '..', 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, `release-notes-${version}.md`), notes);
fs.writeFileSync(path.join(dist, `release-${version}.json`), JSON.stringify({
  version, tag, image, previousTag: previousTag || null, environment: 'production', releasedAt: new Date().toISOString(),
}, null, 2));
console.log(notes);
