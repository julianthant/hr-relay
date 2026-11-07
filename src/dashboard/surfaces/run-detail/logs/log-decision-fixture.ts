import type { LogEntry } from "./log-feed-model.js";

/** Approved fictional examples; no command or transport authority. */
export const logDecisionExamples = [
  {
    "id": "parked",
    "label": "Uncertain submission",
    "category": "Write parked",
    "entry": {
      "id": "parked",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "File termination",
        "state": "parked",
        "message": "Clicked Save and Submit, but no confirmation returned.",
        "caution": "The result is unknown. Check UCPath before continuing.",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-form.svg",
            "alt": "Form after Submit",
            "time": "09:32:38",
            "width": 850,
            "height": 1050,
            "label": "Form after Submit",
            "kind": "form",
            "system": "UCPath"
          }
        ],
        "footer": "Alex Morgan · DEMO-1042",
        "actions": [
          {
            "id": "parked-check",
            "label": "Check again",
            "primary": false,
            "result": {
              "title": "Record check finished",
              "message": "The termination is still not where Relay looked. The run remains held.",
              "tone": "info",
              "continues": false
            }
          },
          {
            "id": "parked-0",
            "label": "Check result",
            "primary": true,
            "input": {
              "kind": "verification",
              "question": "Is the termination present in UCPath for Alex Morgan?"
            },
            "result": {
              "title": "Run continued",
              "message": "Continued from the held step.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "verification",
    "label": "Choose the result to continue",
    "category": "Write parked",
    "entry": {
      "id": "verification",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Continue the parked run",
        "state": "parked",
        "message": "Termination for Alex Morgan · effective 09/26/2026",
        "footer": "No further submission while held",
        "actions": [
          {
            "id": "verification-0",
            "label": "Check result",
            "primary": true,
            "input": {
              "kind": "verification",
              "question": "Is the termination present in UCPath for Alex Morgan?"
            },
            "result": {
              "title": "Run continued",
              "message": "Continued from the held step.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "write-present",
    "label": "Submitted · run continued",
    "category": "Write parked",
    "entry": {
      "id": "write-present",
      "kind": "note",
      "time": "09:51:04",
      "message": "Termination confirmed. Transaction SIM-042 is present. Continued to Finalize Kuali document.",
      "tone": "positive"
    }
  },
  {
    "id": "write-absent",
    "label": "Not submitted · retry offered",
    "category": "Write parked",
    "entry": {
      "id": "write-absent",
      "kind": "decision",
      "time": "09:51:04",
      "decision": {
        "title": "Termination not submitted",
        "state": "resolved",
        "message": "No matching termination was found. The transaction can be retried.",
        "footer": "Alex Morgan · DEMO-1042",
        "actions": [
          {
            "id": "write-absent-0",
            "label": "Retry termination",
            "primary": true,
            "result": {
              "title": "Termination retry started",
              "message": "Continued to File termination.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "park-unavailable",
    "label": "Result still unknown",
    "category": "Write parked",
    "entry": {
      "id": "park-unavailable",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Termination result unavailable",
        "state": "parked",
        "message": "UCPath could not be checked. The result is still unknown.",
        "footer": "Run remains held",
        "actions": [
          {
            "id": "park-unavailable-0",
            "label": "Check again",
            "primary": false,
            "result": {
              "title": "Record check finished",
              "message": "The record is still unavailable. The run remains held.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "failure-no-write",
    "label": "Source read failed",
    "category": "Failures",
    "entry": {
      "id": "failure-no-write",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Read separation document",
        "state": "failed",
        "message": "The document did not finish loading.",
        "attemptedAction": "read employee ID",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-job.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-form.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1150,
            "label": "Failed action",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ],
        "footer": "No write attempted",
        "actions": [
          {
            "id": "failure-no-write-0",
            "label": "Retry step",
            "primary": true,
            "result": {
              "title": "Step retry started",
              "message": "Continued from the failed action.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "employee-not-found",
    "label": "Employee not found",
    "category": "Failures",
    "entry": {
      "id": "employee-not-found",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Look up employee",
        "state": "failed",
        "message": "UCPath has no employee for Alex Morgan where Relay looked.",
        "attemptedAction": "find the employee",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-person.svg",
            "alt": "Employee search",
            "time": "09:32:39",
            "width": 850,
            "height": 340,
            "label": "Employee search",
            "kind": "browser",
            "system": "UCPath"
          }
        ],
        "footer": "No write attempted",
        "actions": [
          {
            "id": "employee-not-found-check",
            "label": "Check again",
            "primary": false,
            "result": {
              "title": "Step retry started",
              "message": "Looking up the employee again.",
              "tone": "info",
              "continues": false
            }
          },
          {
            "id": "employee-not-found-enter",
            "label": "Enter EID",
            "primary": true,
            "input": {
              "kind": "text",
              "label": "Employee ID",
              "placeholder": "8-digit EID from UCPath",
              "hint": "Relay reads this EID in UCPath before continuing",
              "pattern": "^\\d{8}$"
            },
            "result": {
              "title": "Employee ID entered",
              "message": "Reading this employee in UCPath.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "document-not-found",
    "label": "Document not found",
    "category": "Failures",
    "entry": {
      "id": "document-not-found",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Read separation document",
        "state": "failed",
        "message": "Kuali has no separation document 48216 where Relay looked.",
        "attemptedAction": "open the separation document",
        "footer": "No write attempted",
        "actions": [
          {
            "id": "document-not-found-check",
            "label": "Check again",
            "primary": false,
            "result": {
              "title": "Step retry started",
              "message": "Looking for the document again.",
              "tone": "info",
              "continues": false
            }
          },
          {
            "id": "document-not-found-enter",
            "label": "Enter document number",
            "primary": true,
            "input": {
              "kind": "text",
              "label": "Document number",
              "placeholder": "Kuali document number",
              "hint": "Relay opens this document in Kuali before continuing"
            },
            "result": {
              "title": "Document number entered",
              "message": "Opening this document in Kuali.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "failure-prepared",
    "label": "Filling a required field failed",
    "category": "Failures",
    "entry": {
      "id": "failure-prepared",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "File termination",
        "state": "failed",
        "message": "The date field could not be filled.",
        "attemptedAction": "enter last day worked",
        "lastCompleted": "Employee and employment record confirmed",
        "field": {
          "label": "Last day worked",
          "value": "09/25/2026",
          "outcome": "Not entered"
        },
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-failure.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1050,
            "label": "Failed action",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-request.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ],
        "footer": "Not submitted",
        "actions": [
          {
            "id": "failure-prepared-0",
            "label": "Correct date",
            "primary": true,
            "input": {
              "kind": "date",
              "label": "Last day worked"
            },
            "result": {
              "title": "Run continued",
              "message": "Continued from the held step.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "failure-attempting",
    "label": "Submit response lost",
    "category": "Failures",
    "entry": {
      "id": "failure-attempting",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "File termination",
        "state": "failed",
        "message": "UCPath disconnected before returning a result.",
        "attemptedAction": "click Save and Submit",
        "lastCompleted": "Required fields filled",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-failure.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1050,
            "label": "Failed action",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-request.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ],
        "footer": "Result unknown · do not submit again",
        "actions": [
          {
            "id": "failure-attempting-0",
            "label": "Check result",
            "primary": true,
            "input": {
              "kind": "verification",
              "question": "Is the termination present in UCPath for Alex Morgan?"
            },
            "result": {
              "title": "Run continued",
              "message": "Continued from the held step.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "failure-committed",
    "label": "Read-back failed after Submit",
    "category": "Failures",
    "entry": {
      "id": "failure-committed",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Verify termination",
        "state": "failed",
        "message": "The transaction page could not be opened.",
        "attemptedAction": "read submitted transaction SIM-042",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-failure.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1050,
            "label": "Failed action",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-request.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ],
        "footer": "Submitted · do not submit again",
        "actions": [
          {
            "id": "failure-committed-0",
            "label": "Retry verification",
            "primary": true,
            "result": {
              "title": "Verification retry started",
              "message": "Reading the submitted transaction again.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "failure-verified",
    "label": "Later Kuali step failed",
    "category": "Failures",
    "entry": {
      "id": "failure-verified",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Finalize Kuali document",
        "state": "failed",
        "message": "The comments field could not be found.",
        "attemptedAction": "fill timekeeper comments",
        "lastCompleted": "UCPath termination verified",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-job.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-form.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1150,
            "label": "Failed action",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ],
        "footer": "UCPath termination already verified",
        "actions": [
          {
            "id": "failure-verified-0",
            "label": "Retry Kuali step",
            "primary": true,
            "result": {
              "title": "Kuali retry started",
              "message": "Continued to Finalize Kuali document.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "failure-unknown",
    "label": "Write state missing",
    "category": "Failures",
    "entry": {
      "id": "failure-unknown",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Verify termination",
        "state": "failed",
        "message": "No reliable submission result is available.",
        "attemptedAction": "read transaction state",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-failure.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1050,
            "label": "Failed action",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-request.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ],
        "footer": "Result unknown · do not submit again",
        "actions": [
          {
            "id": "failure-unknown-0",
            "label": "Check result",
            "primary": true,
            "input": {
              "kind": "verification",
              "question": "Is the termination present in UCPath for Alex Morgan?"
            },
            "result": {
              "title": "Run continued",
              "message": "Continued from the held step.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "identity-mismatch",
    "label": "Unexpected employee",
    "category": "Failures",
    "entry": {
      "id": "identity-mismatch",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Confirm employee identity",
        "state": "failed",
        "message": "Expected DEMO-1042. The browser showed DEMO-2088.",
        "attemptedAction": "read employee ID",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-failure.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1050,
            "label": "Failed action",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-request.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ],
        "footer": "No write attempted",
        "actions": [
          {
            "id": "identity-mismatch-0",
            "label": "Select employee",
            "primary": true,
            "input": {
              "kind": "candidate",
              "question": "Which Alex Morgan should this run use?",
              "candidates": [
                {
                  "id": "DEMO-1042",
                  "name": "Morgan, Alex",
                  "description": "Campus Services · Student Assistant"
                },
                {
                  "id": "DEMO-2196",
                  "name": "Morgan, Alex",
                  "description": "Library · Student Assistant"
                },
                {
                  "id": "DEMO-3094",
                  "name": "Morgan, Alex",
                  "description": "Facilities · Staff"
                }
              ]
            },
            "result": {
              "title": "Run continued",
              "message": "Continued from the held step.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "configuration",
    "label": "System could not open",
    "category": "Failures",
    "entry": {
      "id": "configuration",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Open browser sessions",
        "state": "failed",
        "message": "The configured UCPath address is unavailable.",
        "attemptedAction": "open UCPath",
        "unavailableCapture": "UCPath did not open. No screenshot was captured.",
        "footer": "Run stopped before any write"
      }
    }
  },
  {
    "id": "implementation",
    "label": "Submit button unavailable",
    "category": "Failures",
    "entry": {
      "id": "implementation",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "File termination",
        "state": "failed",
        "message": "The Submit button was disabled.",
        "attemptedAction": "click Save and Submit",
        "lastCompleted": "Required fields filled",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-failure.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1050,
            "label": "Failed action",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-request.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ],
        "footer": "Not submitted",
        "actions": [
          {
            "id": "implementation-0",
            "label": "Retry step",
            "primary": true,
            "result": {
              "title": "Step retry started",
              "message": "Continued from the failed action.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "failure-unavailable",
    "label": "Failure capture unavailable",
    "category": "Failures",
    "entry": {
      "id": "failure-unavailable",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "File termination",
        "state": "failed",
        "message": "The recorded failure and browser captures could not be loaded.",
        "attemptedAction": "last action unavailable",
        "unavailableCapture": "The browser captures could not be loaded.",
        "footer": "Write state unavailable · run held",
        "actions": [
          {
            "id": "failure-unavailable-0",
            "label": "Refresh",
            "primary": false,
            "result": {
              "title": "Run refreshed",
              "message": "The retained result is still unavailable. The run remains held.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "review-identity",
    "label": "One matching person",
    "category": "Review",
    "entry": {
      "id": "review-identity",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Confirm the employee match",
        "state": "review",
        "comparison": [
          {
            "label": "Name",
            "expected": "Alex Morgan",
            "observed": "Morgan, Alex"
          },
          {
            "label": "Employee ID",
            "expected": "DEMO-1042",
            "observed": "DEMO-1042"
          },
          {
            "label": "Department",
            "expected": "Campus Services",
            "observed": "Campus Services"
          }
        ],
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-person.svg",
            "alt": "Matching employee",
            "time": "09:31:17",
            "width": 850,
            "height": 340,
            "label": "Matching employee",
            "kind": "person",
            "system": "UCPath"
          }
        ],
        "footer": "Run is waiting for the employee decision",
        "actions": [
          {
            "id": "review-identity-0",
            "label": "Continue with Alex",
            "primary": true,
            "result": {
              "title": "Employee match approved",
              "message": "Alex Morgan · DEMO-1042. Continued to Read Workforce Job Summary.",
              "tone": "positive",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "review-candidates",
    "label": "Multiple candidates",
    "category": "Review",
    "entry": {
      "id": "review-candidates",
      "kind": "decision",
      "time": "09:31:17",
      "decision": {
        "title": "Choose the employee",
        "state": "review",
        "message": "3 matches for Alex Morgan · Campus Services, Library and Facilities",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-person.svg",
            "alt": "Possible employee",
            "time": "09:31:17",
            "width": 850,
            "height": 340,
            "label": "Possible employee",
            "kind": "person",
            "system": "UCPath"
          }
        ],
        "footer": "Employee selection required",
        "actions": [
          {
            "id": "review-candidates-0",
            "label": "Choose employee",
            "primary": true,
            "input": {
              "kind": "candidate",
              "question": "Which Alex Morgan should this run use?",
              "candidates": [
                {
                  "id": "DEMO-1042",
                  "name": "Morgan, Alex",
                  "description": "Campus Services · Student Assistant"
                },
                {
                  "id": "DEMO-2196",
                  "name": "Morgan, Alex",
                  "description": "Library · Student Assistant"
                },
                {
                  "id": "DEMO-3094",
                  "name": "Morgan, Alex",
                  "description": "Facilities · Staff"
                }
              ]
            },
            "result": {
              "title": "Run continued",
              "message": "Continued from the held step.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "review-employment",
    "label": "Employment record differs",
    "category": "Review",
    "entry": {
      "id": "review-employment",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Confirm the employment record",
        "state": "review",
        "comparison": [
          {
            "label": "Employee ID",
            "expected": "DEMO-1042",
            "observed": "DEMO-1042"
          },
          {
            "label": "Record",
            "expected": "0",
            "observed": "0"
          },
          {
            "label": "Status",
            "expected": "Active",
            "observed": "Inactive"
          }
        ],
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-job.svg",
            "alt": "Employment record",
            "time": "09:31:23",
            "width": 850,
            "height": 300,
            "label": "Employment record",
            "kind": "browser",
            "system": "UCPath"
          }
        ],
        "footer": "Employment status differs from the request",
        "actions": [
          {
            "id": "review-employment-0",
            "label": "Use record 0",
            "primary": true,
            "result": {
              "title": "Employment record approved",
              "message": "Continued with employment record 0.",
              "tone": "positive",
              "continues": true
            }
          },
          {
            "id": "review-employment-1",
            "label": "Reject record",
            "primary": false,
            "result": {
              "title": "Employment record rejected",
              "message": "This run stopped before any write.",
              "tone": "danger",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "review-fields",
    "label": "A date is needed to continue",
    "category": "Review",
    "entry": {
      "id": "review-fields",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Confirm the last day worked",
        "state": "review",
        "message": "The last day worked is unclear on the request.",
        "screenshots": [
          {
            "src": "/logs-preview/kuali-request.svg",
            "alt": "Source request",
            "time": "09:31:10",
            "width": 850,
            "height": 300,
            "label": "Source request",
            "kind": "browser",
            "system": "Kuali"
          }
        ],
        "footer": "Kuali · source request",
        "actions": [
          {
            "id": "review-fields-0",
            "label": "Enter date",
            "primary": true,
            "input": {
              "kind": "date",
              "label": "Last day worked"
            },
            "result": {
              "title": "Run continued",
              "message": "Continued from the held step.",
              "tone": "info",
              "continues": true
            }
          }
        ]
      }
    }
  },
  {
    "id": "review-held",
    "label": "Decision currently unavailable",
    "category": "Review",
    "entry": {
      "id": "review-held",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Employee decision unavailable",
        "state": "review",
        "message": "The employee record could not be loaded. The run remains held.",
        "footer": "",
        "actions": [
          {
            "id": "review-held-0",
            "label": "Check again",
            "primary": false,
            "result": {
              "title": "Record check finished",
              "message": "The record is still unavailable. The run remains held.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "review-approved",
    "label": "Approved · run continued",
    "category": "Review",
    "entry": {
      "id": "review-approved",
      "kind": "note",
      "time": "09:49:02",
      "message": "Employee match approved. Alex Morgan · DEMO-1042. Continued to Read Workforce Job Summary.",
      "tone": "positive"
    }
  },
  {
    "id": "authority-changed",
    "label": "Record changed during review",
    "category": "Other states",
    "entry": {
      "id": "authority-changed",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Employee record changed",
        "state": "held",
        "message": "The record changed while you reviewed it. Your selection is preserved.",
        "footer": "Run remains held",
        "actions": [
          {
            "id": "authority-changed-0",
            "label": "Reload record",
            "primary": true,
            "result": {
              "title": "Record reloaded",
              "message": "The updated employee record is ready for review.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "transport-unknown",
    "label": "Continuation response uncertain",
    "category": "Other states",
    "entry": {
      "id": "transport-unknown",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Continuation not confirmed",
        "state": "unconfirmed",
        "message": "No response was received. Check the run before sending another decision.",
        "footer": "",
        "actions": [
          {
            "id": "transport-unknown-0",
            "label": "Refresh run",
            "primary": true,
            "result": {
              "title": "Run refreshed",
              "message": "Continuation is still unconfirmed. The run remains held.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "warning",
    "label": "Completed with warning",
    "category": "Other states",
    "entry": {
      "id": "warning",
      "kind": "note",
      "time": "09:33:36",
      "message": "Separation completed. Optional contact information was not supplied."
    }
  },
  {
    "id": "cancelled",
    "label": "Cancelled action",
    "category": "Other states",
    "entry": {
      "id": "cancelled",
      "kind": "note",
      "time": "09:31:24",
      "message": "Run cancelled. Stopped after Read Workforce Job Summary. No write attempted."
    }
  },
  {
    "id": "loading",
    "label": "Loading",
    "category": "Other states",
    "entry": {
      "id": "loading",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Loading employee record",
        "state": "loading"
      }
    }
  },
  {
    "id": "screenshot-unavailable",
    "label": "Screenshot unavailable",
    "category": "Other states",
    "entry": {
      "id": "screenshot-unavailable",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "File termination",
        "state": "failed",
        "message": "Last action · Click Save and Submit",
        "footer": "Result unknown · run held",
        "actions": [
          {
            "id": "screenshot-unavailable-0",
            "label": "Refresh",
            "primary": false,
            "result": {
              "title": "Run refreshed",
              "message": "The retained result is still unavailable. The run remains held.",
              "tone": "info",
              "continues": false
            }
          }
        ]
      }
    }
  },
  {
    "id": "screenshot-fields",
    "label": "Filled fields",
    "category": "Screenshots",
    "entry": {
      "id": "screenshot-fields",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Fill employment information",
        "state": "recorded",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-employment.svg",
            "alt": "All filled fields",
            "time": "09:32:32",
            "width": 850,
            "height": 390,
            "label": "All filled fields",
            "kind": "fields",
            "system": "UCPath"
          }
        ]
      }
    }
  },
  {
    "id": "screenshot-form",
    "label": "Tall form · scroll at readable width",
    "category": "Screenshots",
    "entry": {
      "id": "screenshot-form",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Save and Submit",
        "state": "recorded",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-form.svg",
            "alt": "Complete transaction form",
            "time": "09:32:38",
            "width": 850,
            "height": 1050,
            "label": "Complete transaction form",
            "kind": "form",
            "system": "UCPath"
          }
        ]
      }
    }
  },
  {
    "id": "screenshot-forms",
    "label": "Multiple forms · switch in the viewer",
    "category": "Screenshots",
    "entry": {
      "id": "screenshot-forms",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Compare captured forms",
        "state": "recorded",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-form.svg",
            "alt": "Termination form",
            "time": "09:32:38",
            "width": 850,
            "height": 1050,
            "label": "Termination form",
            "kind": "form",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-form.svg",
            "alt": "Separation request",
            "time": "09:33:29",
            "width": 850,
            "height": 1150,
            "label": "Separation request",
            "kind": "form",
            "system": "Kuali"
          }
        ]
      }
    }
  },
  {
    "id": "screenshot-browsers",
    "label": "All browsers at failure",
    "category": "Screenshots",
    "entry": {
      "id": "screenshot-browsers",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "File termination",
        "state": "failed",
        "message": "Last action · Click Save and Submit",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-failure.svg",
            "alt": "Failed action",
            "time": "09:32:39",
            "width": 850,
            "height": 1050,
            "label": "Failed action",
            "kind": "browser",
            "system": "UCPath"
          },
          {
            "src": "/logs-preview/kuali-request.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kuali"
          },
          {
            "src": "/logs-preview/kronos-timecard.svg",
            "alt": "Last browser view",
            "time": "09:32:39",
            "width": 850,
            "height": 300,
            "label": "Last browser view",
            "kind": "browser",
            "system": "Kronos"
          }
        ]
      }
    }
  },
  {
    "id": "screenshot-person",
    "label": "Identity check · person record",
    "category": "Screenshots",
    "entry": {
      "id": "screenshot-person",
      "kind": "decision",
      "time": "09:32:39",
      "decision": {
        "title": "Confirm employee identity",
        "state": "review",
        "screenshots": [
          {
            "src": "/logs-preview/ucpath-person.svg",
            "alt": "Possible employee",
            "time": "09:31:17",
            "width": 850,
            "height": 340,
            "label": "Possible employee",
            "kind": "person",
            "system": "UCPath"
          }
        ],
        "footer": "Alex Morgan · DEMO-1042",
        "actions": [
          {
            "id": "screenshot-person-0",
            "label": "Continue with Alex",
            "primary": true,
            "result": {
              "title": "Employee match approved",
              "message": "Alex Morgan · DEMO-1042. Continued to Read Workforce Job Summary.",
              "tone": "positive",
              "continues": true
            }
          }
        ]
      }
    }
  }
] as const satisfies readonly Readonly<{ id: string; label: string; category: string; entry: LogEntry }>[];
