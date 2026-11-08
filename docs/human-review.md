# Human review

Jev suggests tool failure, wrong path, missing context, task misunderstanding, or no supported category.
Bend sends confidence below 0.7, missing evidence, API errors, and unsupported judgments to manual review.

> [!NOTE]
> Suggestions remain unconfirmed until a human records a decision.
> Jev never selects agents or changes verifier outcomes.
> A failed tool call alone does not establish a harmful error.

## Request and inspect

```sh
pnpm start review examples/review-attempt.json
pnpm start reviews examples/codex-smoke.json
```

The request names a Jev model and defaults to `TYPESAFE_API_KEY`.
Use `keyEnvironment` for another credential reference.
The local record preserves the request, model identity, evidence, category, confidence, and probabilities.
Request failures are shown in the command output.

## Record a human decision

Inspect the trajectory, then prepare the [label request](../examples/label-attempt.json).
It needs an accept, change, or reject decision, a recorded evidence reference, and an explanation.
Accept and change also require a category.

```sh
pnpm start label examples/label-attempt.json
```

Suggestions and human decisions retain separate histories, including concurrent requests.
Review records live under the experiment's `reviews/` directory and are linked from the report.
Langfuse receives separate categorical scores on the attempt's trace.
A changed human decision updates the same human score; local history preserves every decision.
Score-export failures preserve local review data.

## Evidence bounds

Requests contain at most 32,000 serialized UTF-8 bytes from the frozen task, instructions, native trajectory, and agent settings.
Trajectories larger than two megabytes require local inspection.
Known environment credentials and selected authentication-file tokens are removed before excerpt selection.
Original native trajectories stay local.

The integration uses the [TypeSafe JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js) at version 0.7.0.
