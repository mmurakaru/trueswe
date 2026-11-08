# Releases

Contributions include a Changeset.
The version workflow opens a draft version pull request and the artifact workflow publishes a GitHub source archive after that version update is merged.
Package manifests are private and the workflow does not publish to npm.

Set the repository secret `RELEASE_TOKEN` to a GitHub token that can write repository contents and pull requests.
This token lets the version pull request trigger its normal CI checks.
The default `GITHUB_TOKEN` can open the version pull request, and GitHub holds its resulting CI runs for maintainer workflow approval.
With that fallback, a maintainer approves the trusted version-branch workflow runs before merging.
See [GitHub workflow event rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).
Complete the release acceptance checks before marking the draft ready.

Pending Changesets skip artifact setup and build work.
Feature pull requests still run the normal CI checks.
