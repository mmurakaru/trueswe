import Base

type AttemptDecision is Data:
  VerifiedPass{}
  VerifiedFailure{}
  ExecutionError{}
  Interrupted{}

def decide_attempt(evidence_code: U32) -> AttemptDecision:
  match evidence_code:
    case 1:
      VerifiedPass{}
    case 2:
      VerifiedFailure{}
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
