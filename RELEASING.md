# Releasing

## Initial publication

Version `0.1.0` was published manually before automated releases were enabled.
The Release Please manifest and bootstrap commit preserve it as the release
baseline.

## Automated releases

Every push to `main` runs Release Please. It opens or updates a release pull
request from [Conventional Commits](https://github.com/googleapis/release-please#how-should-i-write-my-commits).
Use `feat` for a minor release, `fix` for a patch release, `deps` for a
dependency release, and `!` in the PR title for a major release. GitHub uses
the PR title as the squash commit subject and discards the commit body, so
branch commit footers, `Release-As:`, and multi-entry release footers do not
reach Release Please. Merging the release pull request creates the matching
GitHub release. This repository does not publish to npm.

Repository rules for `main` must require `Validate Conventional Commit title`.
Enable this requirement after the title workflow first lands on `main`; the
check starts with subsequent pull requests.

Confirm each release in the GitHub Releases page.
