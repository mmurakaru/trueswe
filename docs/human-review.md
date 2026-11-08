# Human review

Use `npm start -- review examples/review-attempt.json` to request a review suggestion for a recorded terminal attempt.
The request names a Jev model and uses `TYPESAFE_API_KEY` by default.
Set `keyEnvironment` to reference a different environment variable.
The local record preserves the requested model, returned model identity, question, bounded evidence, confidence, and probabilities.

Jev suggests tool failure, wrong path, missing context, task misunderstanding, or no supported category.
Bend routes confidence below 0.7, unavailable evidence, API errors, and unsupported judgments to manual review.
Every suggestion remains unconfirmed until a human records a decision.
Jev does not select agents or change verifier outcomes.
A nonzero tool result alone is not a confirmed harmful error.

Use `npm start -- reviews examples/codex-smoke.json` to list suggestions and decision histories.
Inspect the trajectory before recording a label.
Use `npm start -- label examples/label-attempt.json` only after a human has accepted, changed, or rejected the category.
The label request needs a recorded evidence reference and an explanation.
Accepted and changed decisions need a category.
Rejected decisions create no accepted category.
Repeated review requests and human decisions preserve their histories separately.
Concurrent requests use a lock for each attempt's record and finalize their own judgment identifiers.
A human decision recorded while Jev is running remains in the history.

Each attempt's review record lives under `reviews/` inside its experiment directory.
The Markdown report links that record and shows the current human decision separately from the latest suggestion.
Langfuse receives separate categorical scores for Jev suggestions and human decisions on the attempt's existing trace.
A changed or rejected human decision updates the same human score, while the local history retains every decision.
Local review data remains available if a score export fails.

Evidence includes excerpts of the frozen task, selected project instructions, native trajectory, and explicit agent settings.
Requests contain at most 32,000 serialized UTF-8 bytes.
Trajectories above the two-megabyte read limit require local manual inspection.
Known environment credentials and selected Codex authentication-file tokens are redacted before excerpts are selected.
Native trajectories remain local and retain their original contents.

The integration uses the [TypeSafe JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js) request and response contract at version 0.7.0.
