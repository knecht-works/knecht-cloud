import { currentVersion, isNewerVersion, listReleases } from '../../utils/version'

export default defineEventHandler(async () => {
  const current = currentVersion()
  const releases = await listReleases()
  return {
    current,
    releases: releases.map(r => ({ ...r, isNew: isNewerVersion(r.tag, current) })),
  }
})
