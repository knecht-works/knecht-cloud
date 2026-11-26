import { currentVersion, isNewerVersion, listReleases } from '#server/utils/version'
import { getSettings } from '#server/utils/settings'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async () => {
  const current = currentVersion()
  const releases = await listReleases(getSettings().prereleaseUpdates)
  return {
    current,
    releases: releases.map(r => ({ ...r, isNew: isNewerVersion(r.tag, current) })),
  }
})
