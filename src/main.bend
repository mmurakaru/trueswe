import Base
import ./attempt-policy.bend as Attempt
import ./experiment-policy.bend as Experiment

def print_help() -> IO(Unit):
  IO.print("TrueSWE\n\nUsage: trueswe --help | --version | plan CONFIG | run CONFIG | snapshot REQUEST | verify-snapshot DIRECTORY | publish-skill REQUEST\n\nLocal coding-agent experiments with verified task outcomes.")

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

def route_skill_publication(is_publication: Bool, request: String) -> IO(Unit):
  match is_publication:
    case True{}:
      run_helper(["publish-skill", request])
    case False{}:
      IO.die(Unit, 2, "Unknown command. Use --help.")

def route_snapshot_verification(is_verification: Bool, command: String, directory: String) -> IO(Unit):
  match is_verification:
    case True{}:
      run_helper(["verify-snapshot", directory])
    case False{}:
      route_skill_publication(String.eq(command, "publish-skill"), directory)

def route_snapshot(is_snapshot: Bool, +command: String, configuration: String) -> IO(Unit):
  match is_snapshot:
    case True{}:
      run_helper(["snapshot", configuration])
    case False{}:
      route_snapshot_verification(String.eq(command, "verify-snapshot"), command, configuration)

def route_plan(is_plan: Bool, +command: String, configuration: String) -> IO(Unit):
  match is_plan:
    case True{}:
      run_helper(["plan", configuration])
    case False{}:
      route_snapshot(String.eq(command, "snapshot"), command, configuration)

def route_run(is_run: Bool, +command: String, configuration: String) -> IO(Unit):
  match is_run:
    case True{}:
      run_experiment(configuration)
    case False{}:
      route_plan(String.eq(command, "plan"), command, configuration)

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
      route_run(String.eq(command, "run"), command, configuration)
    case Con{_, Con{_, Con{_, Con{_, _}}}}:
      IO.die(Unit, 2, "Unexpected arguments. Use --help.")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    route_arguments(arguments)
