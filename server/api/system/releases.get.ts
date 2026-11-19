import { currentVersion, isNewerVersion, listReleases } from '../../utils/version'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async () => {
  const current = currentVersion()
  const releases = await listReleases()
  return {
    current,
    releases: releases.map(r => ({ ...r, isNew: isNewerVersion(r.tag, current) })),
  }
})
