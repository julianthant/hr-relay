# Match actual executions to this runner's share of an unfiltered Playwright listing.
def specs: .suites[] | recurse(.suites[]?) | .specs[];
$expectedIds[0] as $expected
| [specs | .id as $id | .tests[] | .expectedStatus as $status | .results[]
   | if .status == $status and (.status == "passed" or .status == "failed") then $id else error($id + " " + .status) end] as $executed
| if ($expected | length) == 0 then error("empty smoke shard")
  elif ($expected | unique) != $expected then error("duplicate Playwright case ID in discovery")
  elif ($executed | sort) != $expected then
    error("missing: " + (($expected - $executed) | tostring) +
          ", extra: " + (($executed - $expected) | tostring) +
          ", repeated: " + ([$executed | group_by(.)[] | select(length > 1) | first] | tostring))
  else "\($executed | length) discovered cases ran exactly once with their expected outcome" end
