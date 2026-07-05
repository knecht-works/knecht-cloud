import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { db, schema } from '../../db'
import { pushBranch } from '../../daemon/git'
import { createPullRequest, getInstallationToken } from '../../utils/github-app'
import { defineAction } from './types'

export const createPrAction = defineAction({
  type: 'create-pr',
  params: {
    title: z.string().min(1),
    body: z.string().default(''),
  },
  yaml: z.object({ 'create-pr': z.object({ title: z.string().min(1), description: z.string().default('') }) })
    .transform(({ 'create-pr': p }): Step => ({ type: 'create-pr', title: p.title, body: p.description })),
  async run(step, rt) {
    const branch = (rt.ctx.branch as { name?: string } | undefined)?.name
    if (!branch) throw new Error('create-pr requires a preceding create-branch step')
    rt.log(`\n▶ create-pr: ${step.title}\n`)
    // Fresh token: the run may have outlived the 1h token from checkout.
    const token = await getInstallationToken(rt.project.owner, rt.project.name)
    await pushBranch(rt.checkoutDir, branch, token)
    let pr: { url: string, number: number } | null
    try {
      pr = await createPullRequest(rt.project.owner, rt.project.name, {
        title: step.title,
        body: step.body,
        head: branch,
        base: rt.project.defaultBranch,
      })
    }
    catch (e) {
      throw new Error(`create-pr failed: ${(e as Error).message}`, { cause: e })
    }
    // Nothing was committed (e.g. an empty agent run) — there's no diff to
    // open a PR for. Treat as a skip, not a failure.
    if (!pr) {
      rt.log(`No changes to open a PR for — skipping\n`)
      return
    }
    db.update(schema.runs).set({ prUrl: pr.url }).where(eq(schema.runs.id, rt.runId)).run()
    rt.log(`Opened PR #${pr.number}: ${pr.url}\n`)
    return { pr }
  },
})
