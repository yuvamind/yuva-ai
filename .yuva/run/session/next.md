# Next Steps
## Immediate Tasks
1. Review the diff and commit (git shows ~240 entries: .js deletions + .ts additions; stage to see them as renames)
2. Add a CHANGELOG entry for the TypeScript migration (publish surface moved to dist/; consumers unaffected)
3. Decide whether to adopt typescript-eslint "recommended" rules (deliberately not enabled during the migration)
## Files to Work On
- CHANGELOG.md
## Blockers
- engines says node >= 18 but execa@7 / glob@13 are ESM-only: require() of them needs Node >= 22.12 (pre-existing, unrelated to the migration)
