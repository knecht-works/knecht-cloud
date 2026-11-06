import type { Project } from '../../db/schema'
import { downloadGithubUpload as download, getIssueSnapshot } from '../../utils/github-app'
import type { ObjectSnapshot, SnapshotComment, SnapshotFile } from '../../utils/object-snapshot'
import type { SessionObject } from '../../utils/sessions'

// body_html carries these signed for a private repository; the plain user-attachments link needs a browser login.
const IMAGE_SRC_RE = /<img\b[^>]*\ssrc="(https:\/\/(?:private-user-images\.githubusercontent\.com|user-images\.githubusercontent\.com|github\.com\/user-attachments\/assets)\/[^"]+)"/g
const FILE_HREF_RE = /href="(https:\/\/github\.com\/user-attachments\/files\/(\d+)\/([^"?#]+))"/g
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

const unescape = (url: string) => url.replaceAll('&amp;', '&')

function uploads(htmls: (string | null | undefined)[]): SnapshotFile[] {
  const files = new Map<string, SnapshotFile>()
  for (const html of htmls) {
    for (const [, src] of (html ?? '').matchAll(IMAGE_SRC_RE)) {
      const url = unescape(src!)
      const id = UUID_RE.exec(new URL(url).pathname)?.[0] ?? url
      const ext = /\.(\w+)$/.exec(new URL(url).pathname)?.[1] ?? 'png'
      if (!files.has(id)) files.set(id, { id, name: `${id}.${ext}`, type: `image/${ext}`, download: () => download(url) })
    }
    for (const [, href, id, name] of (html ?? '').matchAll(FILE_HREF_RE)) {
      if (files.has(id!)) continue
      files.set(id!, {
        id: id!,
        name: decodeURIComponent(name!),
        type: '',
        download: () => download(unescape(href!)).catch(() => {
          throw new Error('GitHub serves a file uploaded to a private repository only to a signed-in browser')
        }),
      })
    }
  }
  return [...files.values()]
}

export async function githubSnapshot(project: Project, object: SessionObject): Promise<ObjectSnapshot> {
  const data = await getIssueSnapshot(project.owner, project.name, Number(object.key))
  const { issue, comments, pull, reviews, reviewComments, parent, subIssues } = data
  const noun = pull ? 'Pull request' : 'Issue'
  const labels = issue.labels.map(l => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean)
  const assignees = (issue.assignees ?? []).map(a => a.login)
  const allComments: SnapshotComment[] = [
    ...comments.map(c => ({ author: c.user?.login ?? '', at: c.created_at, body: c.body ?? '' })),
    ...reviews.filter(r => r.body).map(r => ({ author: r.user?.login ?? '', at: r.submitted_at ?? '', body: `Review (${r.state.toLowerCase()}): ${r.body}` })),
    ...reviewComments.map(c => ({ author: c.user?.login ?? '', at: c.created_at, body: `On ${c.path}${c.line ? `:${c.line}` : ''}: ${c.body}` })),
  ]
  return {
    key: object.key,
    heading: `${noun} #${issue.number}: ${issue.title}`,
    url: issue.html_url,
    facts: [
      pull?.merged ? 'merged' : issue.state,
      pull ? `${pull.head.ref} into ${pull.base.ref}${pull.draft ? ', draft' : ''}` : '',
      `by ${issue.user?.login ?? 'unknown'}`,
      assignees.length ? `assigned to ${assignees.join(', ')}` : '',
      labels.length ? `labels ${labels.join(', ')}` : '',
    ],
    body: issue.body ?? '',
    comments: allComments,
    contents: `GitHub ${noun.toLowerCase()} with every field, the comments under "comments"${pull ? ', the pull request under "pull", its reviews and review comments' : ''}, each with body (markdown) and body_html; a pasted image is a github.com/user-attachments/assets/<id> link, downloaded as <id>.<ext>`,
    data: { ...issue, comments, pull, reviews, review_comments: reviewComments, parent, sub_issues: subIssues },
    files: uploads([issue.body_html, ...comments.map(c => c.body_html), ...reviews.map(r => r.body_html), ...reviewComments.map(c => c.body_html)]),
    links: [
      ...(parent ? [{ key: `#${parent.number}`, relation: 'parent', title: parent.title }] : []),
      ...subIssues.map(i => ({ key: `#${i.number}`, relation: 'sub-issue', title: i.title })),
    ],
  }
}
