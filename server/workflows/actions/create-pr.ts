import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { pushBranch } from '../../daemon/git'
import { gitProvider } from '../../git'
import type { PullRequest } from '../../git/types'
import { withPreviewFooter } from '../../utils/origin'
import { defineAction } from './types'
import { updateRun } from '../../stores/runs'

export const createPrAction = defineAction({
  type: 'create-pr',
  params: {
    title: z.string().min(1),
    body: z.string().default(''),
  },
  yaml: z.object({ 'create-pr': z.object({ title: z.string().min(1), description: z.string().default('') }) })
    .transform(({ 'create-pr': p }): Step => ({ type: 'create-pr', title: p.title, body: p.description })),
  legacyKey: 'pr',
  async run(step, rt) {
    const branch = (rt.ctx.branch as { name?: string } | undefined)?.name
    if (!branch) throw new Error('create-pr requires a preceding create-branch step')
    rt.log(`\n▶ create-pr: ${step.title}\n`)
    // Fresh token: the run may have outlived the 1h token from checkout.
    const git = gitProvider(rt.project)
    const credentials = await git.credentials(rt.project)
    await rt.sandbox.ensureUp()
    await pushBranch(rt.sandbox, branch, credentials)
    let pr: PullRequest | null
    try {
      pr = await git.createPullRequest(rt.project, {
        title: step.title,
        body: withPreviewFooter(step.body, rt.sessionId),
        head: branch,
        base: rt.project.defaultBranch,
      })
    }
    catch (e) {
      throw new Error(`create-pr failed: ${(e as Error).message}`, { cause: e })
    }
    if (!pr) {
      rt.log(`No changes to open a PR for, skipping\n`)
      return
    }
    updateRun(rt.runId, { prUrl: pr.url })
    rt.log(`${pr.existing ? 'Pushed to existing' : 'Opened'} PR #${pr.number}: ${pr.url}\n`)
    return { url: pr.url, number: pr.number }
  },
})
