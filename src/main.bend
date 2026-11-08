import Base
import ./attempt-policy.bend as Attempt
import ./experiment-policy.bend as Experiment
import ./review-policy.bend as Review

def print_help() -> IO(Unit):
  IO.print("TrueSWE\n\nUsage: trueswe --help | --version | plan CONFIG | run CONFIG | resume CONFIG | recover CONFIG | snapshot REQUEST | verify-snapshot DIRECTORY | publish-skill REQUEST | review REQUEST | reviews CONFIG | label REQUEST\n\nLocal coding-agent experiments with verified task outcomes.")

def finish_helper(result: U32 & (String & String)) -> IO(Unit):
  (status, (output, errors)) = result
  do IO<Unit>:
    IO.write(output)
    IO.print_err(errors)
    IO.exit(status)

def invoke_helper(arguments: List<String>) -> IO(U32 & (String & String)):
  do IO<U32 & (String & String)>:
    root : String <- IO.try(String, IO.get_env("TRUESWE_ROOT"))
    result : U32 & (String & String) <- IO.try(U32 & (String & String), Process.run("node", (root ++ "helpers/command-io.ts") <> arguments, "", 1048576, 3600000))
    return result

def run_helper(arguments: List<String>) -> IO(Unit):
  do IO<Unit>:
    result : U32 & (String & String) <- invoke_helper(arguments)
    finish_helper(result)

def helper_output(result: U32 & (String & String)) -> IO(String):
  match result:
    case (0, (output, errors)):
      do IO<String>:
        IO.print_err(errors)
        return output
    case (status, (_, errors)):
      IO.die(String, status, errors)

def persist_decision(values: String & String, configuration: String, ordinal: U32) -> IO(Unit):
  (state, outcome) = values
  do IO<Unit>:
    result : U32 & (String & String) <- invoke_helper(["finalize", configuration, U32.show(ordinal), state, outcome])
    output : String <- helper_output(result)
    return Unit{}

def finalize_attempt(evidence: Maybe<&2, U32>, +configuration: String, +ordinal: U32) -> IO(Unit):
  match evidence:
    case None{}:
      IO.die(Unit, 1, "Integration helper returned invalid verification evidence")
    case Some{code}:
      do IO<Unit>:
        result : U32 & (String & String) <- invoke_helper(["exception", configuration, U32.show(ordinal)])
        exception_name : String <- helper_output(result)
        persist_decision(Attempt.attempt_record_values(Attempt.decide_attempt(code, exception_name)), configuration, ordinal)

def execute_attempts(remaining: Nat, +ordinal: U32, +configuration: String) -> IO(Unit):
  match remaining:
    case 0n:
      IO.print("Experiment finished.")
    case 1n+rest:
      do IO<Unit>:
        result : U32 & (String & String) <- invoke_helper(["attempt", configuration, U32.show(ordinal)])
        output : String <- helper_output(result)
        finalize_attempt(U32.read(output), configuration, ordinal)
        execute_attempts(rest, (ordinal + 1 : U32), configuration)

def execute_prepared(count: Maybe<&2, U32>, configuration: String) -> IO(Unit):
  match count:
    case None{}:
      IO.die(Unit, 1, "Integration helper returned an invalid attempt count")
    case Some{number}:
      execute_attempts(U32.to_nat(number), 0, configuration)

def execute_comparison(allowed: Bool, count: String, configuration: String) -> IO(Unit):
  match allowed:
    case True{}:
      execute_prepared(U32.read(count), configuration)
    case False{}:
      do IO<Unit>:
        result : U32 & (String & String) <- invoke_helper(["discard-prepared", configuration])
        output : String <- helper_output(result)
        IO.die(Unit, 2, "A comparison must change only instructions or only skills")

def validate_comparison(facts: Maybe<&2, U32>, count: String, configuration: String) -> IO(Unit):
  match facts:
    case None{}:
      IO.die(Unit, 1, "Integration helper returned invalid comparison facts")
    case Some{code}:
      execute_comparison(Experiment.comparison_allowed(code), count, configuration)

def run_experiment(+configuration: String) -> IO(Unit):
  do IO<Unit>:
    result : U32 & (String & String) <- invoke_helper(["prepare", configuration])
    count : String <- helper_output(result)
    facts_result : U32 & (String & String) <- invoke_helper(["comparison-facts", configuration])
    facts : String <- helper_output(facts_result)
    validate_comparison(U32.read(facts), count, configuration)

def run_pending(+configuration: String, +ordinal: U32) -> IO(Unit):
  do IO<Unit>:
    result : U32 & (String & String) <- invoke_helper(["attempt", configuration, U32.show(ordinal)])
    evidence : String <- helper_output(result)
    finalize_attempt(U32.read(evidence), configuration, ordinal)

def retry_state(state: String, +configuration: String, +ordinal: U32) -> IO(Unit):
  match state:
    case "completed":
      IO.pure(Unit, Unit{})
    case "pending":
      run_pending(configuration, ordinal)
    case _:
      do IO<Unit>:
        result : U32 & (String & String) <- invoke_helper(["retry-attempt", configuration, U32.show(ordinal)])
        output : String <- helper_output(result)
        run_pending(configuration, ordinal)

def retry_unfinished(state: String, configuration: String, ordinal: U32, execute: Bool) -> IO(Unit):
  match execute:
    case True{}:
      retry_state(state, configuration, ordinal)
    case False{}:
      IO.pure(Unit, Unit{})

def resume_one(state: String, +configuration: String, +ordinal: U32, execute: Bool) -> IO(Unit):
  match state:
    case "completed":
      IO.pure(Unit, Unit{})
    case "running":
      do IO<Unit>:
        result : U32 & (String & String) <- invoke_helper(["recover-attempt", configuration, U32.show(ordinal)])
        evidence : String <- helper_output(result)
        finalize_attempt(U32.read(evidence), configuration, ordinal)
        result : U32 & (String & String) <- invoke_helper(["attempt-state", configuration, U32.show(ordinal)])
        next_state : String <- helper_output(result)
        retry_unfinished(next_state, configuration, ordinal, execute)
    case _:
      retry_unfinished(state, configuration, ordinal, execute)

def resume_attempts(remaining: Nat, +ordinal: U32, +configuration: String, +execute: Bool) -> IO(Unit):
  match remaining:
    case 0n:
      IO.print("Experiment evidence preserved.")
    case 1n+rest:
      do IO<Unit>:
        result : U32 & (String & String) <- invoke_helper(["attempt-state", configuration, U32.show(ordinal)])
        state : String <- helper_output(result)
        resume_one(state, configuration, ordinal, execute)
        resume_attempts(rest, (ordinal + 1 : U32), configuration, execute)

def resume_count(count: Maybe<&2, U32>, configuration: String, execute: Bool) -> IO(Unit):
  match count:
    case None{}:
      IO.die(Unit, 1, "Integration helper returned an invalid attempt count")
    case Some{number}:
      resume_attempts(U32.to_nat(number), 0, configuration, execute)

def resume_preparation(execute: Bool) -> String:
  match execute:
    case True{}:
      "prepare-resume"
    case False{}:
      "prepare-recovery"

def resume_experiment(+configuration: String, +execute: Bool) -> IO(Unit):
  do IO<Unit>:
    result : U32 & (String & String) <- invoke_helper([resume_preparation(execute), configuration])
    count : String <- helper_output(result)
    resume_count(U32.read(count), configuration, execute)

def finalize_review(confidence: Maybe<&2, U32>, +request: String, +identifier: String) -> IO(Unit):
  match confidence:
    case None{}:
      IO.die(Unit, 1, "Integration helper returned invalid review confidence")
    case Some{basis_points}:
      do IO<Unit>:
        result : U32 & (String & String) <- invoke_helper(["review-kind", request, identifier])
        kind : String <- helper_output(result)
        run_helper(["finalize-review", request, Review.review_status(basis_points, kind), identifier])

def review_attempt(+request: String) -> IO(Unit):
  do IO<Unit>:
    identifier_result : U32 & (String & String) <- invoke_helper(["review-identifier"])
    +identifier : String <- helper_output(identifier_result)
    result : U32 & (String & String) <- invoke_helper(["prepare-review", request, identifier])
    confidence : String <- helper_output(result)
    finalize_review(U32.read(confidence), request, identifier)

def label_attempt(+request: String) -> IO(Unit):
  do IO<Unit>:
    result : U32 & (String & String) <- invoke_helper(["label-action", request])
    action : String <- helper_output(result)
    run_helper(["label", request, Review.human_label_status(action)])

type ConfigurationCommand is Data:
  RunCommand{}
  ResumeCommand{}
  RecoverCommand{}
  PlanCommand{}
  SnapshotCommand{}
  VerifySnapshotCommand{}
  PublishSkillCommand{}
  ReviewCommand{}
  ReviewsCommand{}
  LabelCommand{}
  UnknownCommand{}

def configuration_command(name: String) -> ConfigurationCommand:
  table = Map.new(&2, ConfigurationCommand)
  table = Map.set(&2, ConfigurationCommand, table, "run", RunCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "resume", ResumeCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "recover", RecoverCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "plan", PlanCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "snapshot", SnapshotCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "verify-snapshot", VerifySnapshotCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "publish-skill", PublishSkillCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "review", ReviewCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "reviews", ReviewsCommand{})
  table = Map.set(&2, ConfigurationCommand, table, "label", LabelCommand{})
  Pair.snd(Map<&2, ConfigurationCommand>, ConfigurationCommand, Map.get(ConfigurationCommand, UnknownCommand{}, table, name))

def route_configuration(command: ConfigurationCommand, configuration: String) -> IO(Unit):
  match command:
    case RunCommand{}:
      run_experiment(configuration)
    case ResumeCommand{}:
      resume_experiment(configuration, True{})
    case RecoverCommand{}:
      resume_experiment(configuration, False{})
    case PlanCommand{}:
      run_helper(["plan", configuration])
    case SnapshotCommand{}:
      run_helper(["snapshot", configuration])
    case VerifySnapshotCommand{}:
      run_helper(["verify-snapshot", configuration])
    case PublishSkillCommand{}:
      run_helper(["publish-skill", configuration])
    case ReviewCommand{}:
      review_attempt(configuration)
    case ReviewsCommand{}:
      run_helper(["reviews", configuration])
    case LabelCommand{}:
      label_attempt(configuration)
    case UnknownCommand{}:
      IO.die(Unit, 2, "Unknown command. Use --help.")

def route_version(is_version: Bool) -> IO(Unit):
  match is_version:
    case True{}:
      run_helper(["version"])
    case False{}:
      IO.die(Unit, 2, "Unknown command. Use --help.")

def route_help(is_help: Bool, command: String) -> IO(Unit):
  match is_help:
    case True{}:
      print_help()
    case False{}:
      route_version(String.eq(command, "--version"))

def route_arguments(arguments: List<String>) -> IO(Unit):
  match arguments:
    case Nil{}:
      print_help()
    case Con{_, Nil{}}:
      print_help()
    case Con{_, Con{+command, Nil{}}}:
      route_help(String.eq(command, "--help"), command)
    case Con{_, Con{+command, Con{configuration, Nil{}}}}:
      route_configuration(configuration_command(command), configuration)
    case Con{_, Con{_, Con{_, Con{_, _}}}}:
      IO.die(Unit, 2, "Unexpected arguments. Use --help.")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    route_arguments(arguments)
