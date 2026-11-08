# Releases

Contributions include a Changeset.
The version workflow opens a version pull request and the artifact workflow publishes a GitHub source archive after that version update is merged.
Package manifests are private and the workflow does not publish to npm.

Set the repository secret `RELEASE_TOKEN` to a GitHub token that can write repository contents and pull requests.
This token lets the version pull request trigger its normal CI checks.
The default `GITHUB_TOKEN` can open the version pull request, but GitHub does not trigger other workflows from its events.
With that fallback, a maintainer must trigger CI through a human push to the version branch before merging.
See [GitHub workflow event rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

Pending Changesets skip artifact setup and build work.
Feature pull requests still run the normal CI checks.
