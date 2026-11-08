import Base

def comparison_allowed(facts: U32) -> Bool:
  match facts:
    case 2:
      True{}
    case 3:
      True{}
    case 5:
      True{}
    case 7:
      True{}
    case _:
      False{}
