# Contributing

## Releasing

A release is a git tag. Push the tag and CI does the rest: builds the image
for amd64 and arm64, pushes it to `ghcr.io/knecht-works/knecht-cloud`, creates
the GitHub Release with the changelog and announces it on Discord.

Only `feat:` and `fix:` commits show up in the changelog (see CLAUDE.md).
Preview it before tagging:

```bash
bash scripts/changelog-preview.sh
```

### Regular release

1. Work on a branch `releases/vX.Y.Z`, open a PR against `main`, let CI pass.
2. Merge the PR.
3. Checkout `main` and push the tag:

```bash
git checkout main && git pull
git tag vX.Y.Z && git push origin vX.Y.Z
```

Done. Running instances see the release as an update in the dashboard (System
page), and `install.sh` picks it up as the newest version.

### Pre-release

Any tag with a hyphen (`vX.Y.Z-rc.1`) is a pre-release. CI builds and
publishes it exactly like a regular release, but:

- the `latest` image tag does not move
- no instance is offered it as an update
- a normal install ignores it
- no Discord announcement

So you can tag the release branch directly, before merging:

```bash
git checkout releases/vX.Y.Z
git tag vX.Y.Z-rc.1 && git push origin vX.Y.Z-rc.1
```

Next candidate: `-rc.2`, and so on. The stable release afterwards lists all
changes since the previous stable release, RCs are skipped in the diff.

### Installing a pre-release

On a fresh server, fetch the installer from the pre-release tag itself and pin
the same tag via `KNECHT_REF`:

```bash
curl -fsSL https://raw.githubusercontent.com/knecht-works/knecht-cloud/vX.Y.Z-rc.1/scripts/install.sh \
  | sudo env KNECHT_DOMAIN=knecht.example.com KNECHT_REF=vX.Y.Z-rc.1 bash
```

On an existing instance, switch it by hand (the dashboard never offers a
pre-release):

```bash
cd /opt/knecht
git fetch --tags && git checkout vX.Y.Z-rc.1
sed -i 's/^KNECHT_VERSION=.*/KNECHT_VERSION=vX.Y.Z-rc.1/' .env
docker compose pull && docker compose up -d
```

Once the matching stable release exists, the instance offers it as a regular
update in the dashboard. Migrations run forward only, so back up
`/data/knecht/data` before switching if you want a way back.
