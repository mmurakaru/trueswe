import Base

def status_from_confidence(qualifies: Bool) -> String:
  match qualifies:
    case True{}:
      "suggested"
    case False{}:
      "manual-review"

def review_status(confidence_basis_points: U32, category: String) -> String:
  table = Map.new(&2, Bool)
  table = Map.set(&2, Bool, table, "tool-failure", True{})
  table = Map.set(&2, Bool, table, "wrong-path", True{})
  table = Map.set(&2, Bool, table, "missing-context", True{})
  table = Map.set(&2, Bool, table, "task-misunderstanding", True{})
  supported = Pair.snd(Map<&2, Bool>, Bool, Map.get(Bool, False{}, table, category))
  status_from_confidence(supported && U32.is_ge(confidence_basis_points, 7000))

def human_label_status(action: String) -> String:
  table = Map.new(&2, String)
  table = Map.set(&2, String, table, "accept", "accepted")
  table = Map.set(&2, String, table, "change", "accepted")
  table = Map.set(&2, String, table, "reject", "rejected")
  Pair.snd(Map<&2, String>, String, Map.get(String, "invalid", table, action))
