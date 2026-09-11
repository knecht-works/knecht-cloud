export const PUBLISH_FOLLOWUP_PROMPT = [
  'Publish your work from this run:',
  '1. Review the uncommitted changes with `git status` and `git diff`.',
  '2. If the run is not on a work branch yet, create one with `git checkout -b <name>` (a short descriptive name).',
  '3. Commit the changes in logical chunks with proper commit messages.',
  '4. Open a pull request with `knecht-git open-pr`: the title and description must summarize what was changed and why, based on what you actually did.',
  'If there is nothing to publish, say so and stop.',
].join('\n')
