// A run environment's lifecycle states. server/daemon/envs.ts owns the
// transitions, the UI renders them. One source so the two sides can't drift.
export const ENV_STATES = ['down', 'up', 'stopped', 'archived'] as const
export type EnvState = (typeof ENV_STATES)[number]

// The transitions between those states that take long enough to show (a
// stop exports the database, a restore rebuilds the stack). Not persisted:
// server/daemon/envs.ts tracks them in memory and the run payload carries
// the current one as `envTransition`.
export const ENV_TRANSITIONS = ['stopping', 'rebooting', 'restoring', 'archiving'] as const
export type EnvTransition = (typeof ENV_TRANSITIONS)[number]
