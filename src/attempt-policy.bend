import Base

type AttemptDecision is Data:
  VerifiedPass{}
  VerifiedFailure{}
  ExecutionError{}
  Interrupted{}

def reward_exception_table() -> Map<&2, Bool>:
  table = Map.new(&2, Bool)
  table = Map.set(&2, Bool, table, "", True{})
  table = Map.set(&2, Bool, table, "AgentTimeoutError", True{})
  table = Map.set(&2, Bool, table, "ContextWindowExceededError", True{})
  table = Map.set(&2, Bool, table, "OutputTokenExceededError", True{})
  table = Map.set(&2, Bool, table, "ContextLengthExceededError", True{})
  table = Map.set(&2, Bool, table, "OutputLengthExceededError", True{})
  table = Map.set(&2, Bool, table, "AgentSafetyRefusalError", True{})
  Map.set(&2, Bool, table, "ContentPolicyViolationError", True{})

def exception_allows_reward(exception_name: String) -> Bool:
  Pair.snd(Map<&2, Bool>, Bool, Map.get(Bool, False{}, reward_exception_table(), exception_name))

def verified_decision(allowed: Bool, passed: Bool) -> AttemptDecision:
  match allowed passed:
    case True{} True{}:
      VerifiedPass{}
    case True{} False{}:
      VerifiedFailure{}
    case False{} _:
      ExecutionError{}

def decide_attempt(evidence_code: U32, exception_name: String) -> AttemptDecision:
  match evidence_code:
    case 1:
      verified_decision(exception_allows_reward(exception_name), True{})
    case 2:
      verified_decision(exception_allows_reward(exception_name), False{})
    case 3:
      Interrupted{}
    case _:
      ExecutionError{}

def attempt_record_values(decision: AttemptDecision) -> String & String:
  match decision:
    case VerifiedPass{}:
      ("completed", "pass")
    case VerifiedFailure{}:
      ("completed", "fail")
    case ExecutionError{}:
      ("execution-error", "none")
    case Interrupted{}:
      ("interrupted", "none")
