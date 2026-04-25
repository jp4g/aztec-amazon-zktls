<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Skills

Claude skills under `.claude/skills/` are installed via symlinks into git-submoduled upstream repos. Submodule clones live at `.claude/skills-src/`; only the specific skills symlinked into `.claude/skills/` are visible to Claude's loader.

Submodules:
- `.claude/skills-src/aztec-private-escrow-skills` — `github.com/aztec-pioneers/aztec-private-escrow-skills` (skills under its `skills/` subdir)
- `.claude/skills-src/primus-skills` — `github.com/primus-labs/skills` (skills at the repo root)

Clone the repo with `git clone --recursive …`, or run `git submodule update --init --recursive` post-clone, otherwise the symlink targets won't exist.

Common operations:
- **Add an installed skill**: `ln -s ../skills-src/<repo>/<path> .claude/skills/<name>` then commit.
- **Remove an installed skill**: `rm .claude/skills/<name>` then commit (the underlying files stay in the submodule).
- **Update upstream skills**: `git submodule update --remote .claude/skills-src/<repo>` then commit the bumped pointer.
