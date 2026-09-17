export const PUBLISH_FOLLOWUP_PROMPT = [
  'Publish your work from this run:',
  '1. Review the uncommitted changes with `git status` and `git diff`.',
  '2. If the run is not on a work branch yet, create one with `git checkout -b <name>` (a short descriptive name).',
  '3. Commit the changes in logical chunks with proper commit messages.',
  '4. Open a pull request with `knecht-git open-pr`: the title and description must summarize what was changed and why, based on what you actually did.',
  'If there is nothing to publish, say so and stop.',
].join('\n')

export const CLEAR_COMMAND = '/clear'
export const COMPACT_COMMAND = '/compact'
export const PR_COMMAND = '/pr'

export const CHAT_COMMANDS = [
  { name: CLEAR_COMMAND, description: 'Start a fresh agent session and clear the window.' },
  { name: COMPACT_COMMAND, description: 'Summarize the conversation into a fresh session and clear the window.' },
  { name: PR_COMMAND, description: 'Commit the work and open a pull request.' },
] as const
