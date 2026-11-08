import Base

def status_from_confidence(qualifies: Bool) -> String:
  match qualifies:
    case True{}:
      "suggested"
    case False{}:
      "manual-review"

def review_status(confidence_basis_points: U32) -> String:
  status_from_confidence(U32.is_ge(confidence_basis_points, 7000))

def human_label_status(action: String) -> String:
  table = Map.new(&2, String)
  table = Map.set(&2, String, table, "accept", "accepted")
  table = Map.set(&2, String, table, "change", "accepted")
  table = Map.set(&2, String, table, "reject", "rejected")
  Pair.snd(Map<&2, String>, String, Map.get(String, "invalid", table, action))
