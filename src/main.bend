import Base

def print_help() -> IO(Unit):
  IO.print("TrueSWE\n\nUsage: trueswe --help | --version\n\nLocal coding-agent experiments with verified task outcomes.")

def finish_helper(result: U32 & (String & String)) -> IO(Unit):
  (status, (output, errors)) = result
  do IO<Unit>:
    IO.write(output)
    IO.print_err(errors)
    IO.exit(status)

def run_helper(arguments: List<String>) -> IO(Unit):
  do IO<Unit>:
    root : String <- IO.try(String, IO.get_env("TRUESWE_ROOT"))
    result : U32 & (String & String) <- IO.try(U32 & (String & String), Process.run("node", (root ++ "helpers/command-io.ts") <> arguments, "", 1048576, 3600000))
    finish_helper(result)

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
    case Con{_, Con{_, Con{_, _}}}:
      IO.die(Unit, 2, "Unexpected arguments. Use --help.")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    route_arguments(arguments)
