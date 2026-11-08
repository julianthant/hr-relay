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
        "served": {
          "type": "write-parked",
          "title": "File termination",
          "options": [
            {
              "id": "parked-check",
              "label": "Check again",
              "hint": "The termination is still not where Relay looked. The run remains held.",
              "send": {
                "via": "action",
                "actionKey": "parked-check"
              }
            },
            {
              "id": "parked-0",
              "label": "Check result",
              "hint": "Continued from the held step.",
              "recommended": true,
              "input": {
                "kind": "verification",
                "question": "Is the termination present in UCPath for Alex Morgan?"
              },
              "send": {
                "via": "verification",
                "presentActionKey": "recheck-write",
                "absentActionKey": "resolve-write-absent",
                "transactionPattern": "^[A-Za-z0-9-]+$"
              }
            }
          ]
        }
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
        "served": {
          "type": "write-parked",
          "title": "Continue the parked run",
          "options": [
            {
              "id": "verification-0",
              "label": "Check result",
              "hint": "Continued from the held step.",
              "recommended": true,
              "input": {
                "kind": "verification",
                "question": "Is the termination present in UCPath for Alex Morgan?"
              },
              "send": {
                "via": "verification",
                "presentActionKey": "recheck-write",
                "absentActionKey": "resolve-write-absent",
                "transactionPattern": "^[A-Za-z0-9-]+$"
              }
            }
          ]
        }
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
        "served": {
          "type": "paused",
          "title": "Termination not submitted",
          "options": [
            {
              "id": "write-absent-0",
              "label": "Retry termination",
              "hint": "Continued to File termination.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "write-absent-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "write-parked",
          "title": "Termination result unavailable",
          "options": [
            {
              "id": "park-unavailable-0",
              "label": "Check again",
              "hint": "The record is still unavailable. The run remains held.",
              "send": {
                "via": "action",
                "actionKey": "park-unavailable-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "Read separation document",
          "options": [
            {
              "id": "failure-no-write-0",
              "label": "Retry step",
              "hint": "Continued from the failed action.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "failure-no-write-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "correct-value",
          "title": "Look up employee",
          "options": [
            {
              "id": "employee-not-found-check",
              "label": "Check again",
              "hint": "Looking up the employee again.",
              "send": {
                "via": "action",
                "actionKey": "employee-not-found-check"
              }
            },
            {
              "id": "employee-not-found-enter",
              "label": "Enter EID",
              "hint": "Reading this employee in UCPath.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "employee-not-found-enter"
              },
              "input": {
                "kind": "text",
                "label": "Employee ID",
                "placeholder": "8-digit EID from UCPath",
                "pattern": "^\\d{8}$"
              }
            }
          ]
        }
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
        "served": {
          "type": "correct-value",
          "title": "Read separation document",
          "options": [
            {
              "id": "document-not-found-check",
              "label": "Check again",
              "hint": "Looking for the document again.",
              "send": {
                "via": "action",
                "actionKey": "document-not-found-check"
              }
            },
            {
              "id": "document-not-found-enter",
              "label": "Enter document number",
              "hint": "Opening this document in Kuali.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "document-not-found-enter"
              },
              "input": {
                "kind": "text",
                "label": "Document number",
                "placeholder": "Kuali document number"
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "File termination",
          "options": [
            {
              "id": "failure-prepared-0",
              "label": "Correct date",
              "hint": "Continued from the held step.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "failure-prepared-0"
              },
              "input": {
                "kind": "date",
                "label": "Last day worked"
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "File termination",
          "options": [
            {
              "id": "failure-attempting-0",
              "label": "Check result",
              "hint": "Continued from the held step.",
              "recommended": true,
              "input": {
                "kind": "verification",
                "question": "Is the termination present in UCPath for Alex Morgan?"
              },
              "send": {
                "via": "verification",
                "presentActionKey": "recheck-write",
                "absentActionKey": "resolve-write-absent",
                "transactionPattern": "^[A-Za-z0-9-]+$"
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "Verify termination",
          "options": [
            {
              "id": "failure-committed-0",
              "label": "Retry verification",
              "hint": "Reading the submitted transaction again.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "failure-committed-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "Finalize Kuali document",
          "options": [
            {
              "id": "failure-verified-0",
              "label": "Retry Kuali step",
              "hint": "Continued to Finalize Kuali document.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "failure-verified-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "Verify termination",
          "options": [
            {
              "id": "failure-unknown-0",
              "label": "Check result",
              "hint": "Continued from the held step.",
              "recommended": true,
              "input": {
                "kind": "verification",
                "question": "Is the termination present in UCPath for Alex Morgan?"
              },
              "send": {
                "via": "verification",
                "presentActionKey": "recheck-write",
                "absentActionKey": "resolve-write-absent",
                "transactionPattern": "^[A-Za-z0-9-]+$"
              }
            }
          ]
        }
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
        "served": {
          "type": "pick-person",
          "title": "Confirm employee identity",
          "options": [
            {
              "id": "identity-mismatch-0",
              "label": "Select employee",
              "hint": "Continued from the held step.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "identity-mismatch-0"
              },
              "input": {
                "kind": "candidate",
                "table": {
                  "title": "Search results",
                  "columns": [
                    {
                      "id": "name",
                      "label": "Name"
                    },
                    {
                      "id": "detail",
                      "label": "Details"
                    }
                  ],
                  "rows": [
                    {
                      "id": "DEMO-1042",
                      "name": "Morgan, Alex",
                      "cells": [
                        {
                          "columnId": "name",
                          "value": "Morgan, Alex"
                        },
                        {
                          "columnId": "detail",
                          "value": "Campus Services · Student Assistant"
                        }
                      ]
                    },
                    {
                      "id": "DEMO-2196",
                      "name": "Morgan, Alex",
                      "cells": [
                        {
                          "columnId": "name",
                          "value": "Morgan, Alex"
                        },
                        {
                          "columnId": "detail",
                          "value": "Library · Student Assistant"
                        }
                      ]
                    },
                    {
                      "id": "DEMO-3094",
                      "name": "Morgan, Alex",
                      "cells": [
                        {
                          "columnId": "name",
                          "value": "Morgan, Alex"
                        },
                        {
                          "columnId": "detail",
                          "value": "Facilities · Staff"
                        }
                      ]
                    }
                  ]
                }
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "File termination",
          "options": [
            {
              "id": "implementation-0",
              "label": "Retry step",
              "hint": "Continued from the failed action.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "implementation-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "File termination",
          "options": [
            {
              "id": "failure-unavailable-0",
              "label": "Refresh",
              "hint": "The retained result is still unavailable. The run remains held.",
              "send": {
                "via": "action",
                "actionKey": "failure-unavailable-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "identity-mismatch",
          "title": "Confirm the employee match",
          "options": [
            {
              "id": "review-identity-0",
              "label": "Continue with Alex",
              "hint": "Alex Morgan · DEMO-1042. Continued to Read Workforce Job Summary.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "review-identity-0"
              }
            }
          ]
        }
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
        "title": "Which Alex Morgan is this run about?",
        "state": "review",
        "message": "UCPath found 3 people with this name.",
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
        "served": {
          "type": "pick-person",
          "title": "Which Alex Morgan is this run about?",
          "options": [
            {
              "id": "review-candidates-0",
              "label": "Confirm",
              "hint": "Continue with the picked person.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "review-candidates-0"
              },
              "input": {
                "kind": "candidate",
                "table": {
                  "title": "Search results",
                  "columns": [
                    {
                      "id": "name",
                      "label": "Name"
                    },
                    {
                      "id": "eid",
                      "label": "Employee ID"
                    },
                    {
                      "id": "department",
                      "label": "Department"
                    },
                    {
                      "id": "status",
                      "label": "HR status"
                    }
                  ],
                  "rows": [
                    {
                      "id": "10000001",
                      "name": "Morgan, Alex A.",
                      "eid": "10000001",
                      "cells": [
                        {
                          "columnId": "name",
                          "value": "Morgan, Alex A."
                        },
                        {
                          "columnId": "eid",
                          "value": "10000001"
                        },
                        {
                          "columnId": "department",
                          "value": "Campus Dining Operations"
                        },
                        {
                          "columnId": "status",
                          "value": "Active"
                        }
                      ]
                    },
                    {
                      "id": "10000042",
                      "name": "Morgan, Alex",
                      "eid": "10000042",
                      "cells": [
                        {
                          "columnId": "name",
                          "value": "Morgan, Alex"
                        },
                        {
                          "columnId": "eid",
                          "value": "10000042"
                        },
                        {
                          "columnId": "department",
                          "value": "Housing Operations"
                        },
                        {
                          "columnId": "status",
                          "value": "Active"
                        }
                      ]
                    },
                    {
                      "id": "10000077",
                      "name": "Morgan, Alexis",
                      "eid": "10000077",
                      "cells": [
                        {
                          "columnId": "name",
                          "value": "Morgan, Alexis"
                        },
                        {
                          "columnId": "eid",
                          "value": "10000077"
                        },
                        {
                          "columnId": "department",
                          "value": "HDH Catering"
                        },
                        {
                          "columnId": "status",
                          "value": "On leave",
                          "tone": "attention"
                        }
                      ]
                    }
                  ],
                  "typed": {
                    "label": "Enter employee ID",
                    "placeholder": "8 digits",
                    "pattern": "^\\d{8}$"
                  }
                }
              }
            },
            {
              "id": "cancel-run",
              "label": "Cancel run",
              "hint": "Stop this run. Nothing more is written.",
              "send": {
                "via": "row-action",
                "actionKey": "cancel"
              }
            }
          ]
        }
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
        "served": {
          "type": "identity-mismatch",
          "title": "Confirm the employment record",
          "options": [
            {
              "id": "review-employment-0",
              "label": "Use record 0",
              "hint": "Continued with employment record 0.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "review-employment-0"
              }
            },
            {
              "id": "review-employment-1",
              "label": "Reject record",
              "hint": "This run stopped before any write.",
              "send": {
                "via": "action",
                "actionKey": "review-employment-1"
              }
            }
          ]
        }
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
        "served": {
          "type": "identity-mismatch",
          "title": "Confirm the last day worked",
          "options": [
            {
              "id": "review-fields-0",
              "label": "Enter date",
              "hint": "Continued from the held step.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "review-fields-0"
              },
              "input": {
                "kind": "date",
                "label": "Last day worked"
              }
            }
          ]
        }
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
        "served": {
          "type": "identity-mismatch",
          "title": "Employee decision unavailable",
          "options": [
            {
              "id": "review-held-0",
              "label": "Check again",
              "hint": "The record is still unavailable. The run remains held.",
              "send": {
                "via": "action",
                "actionKey": "review-held-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "paused",
          "title": "Employee record changed",
          "options": [
            {
              "id": "authority-changed-0",
              "label": "Reload record",
              "hint": "The updated employee record is ready for review.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "authority-changed-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "write-unknown",
          "title": "Continuation not confirmed",
          "options": [
            {
              "id": "transport-unknown-0",
              "label": "Refresh run",
              "hint": "Continuation is still unconfirmed. The run remains held.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "transport-unknown-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "failed-retryable",
          "title": "File termination",
          "options": [
            {
              "id": "screenshot-unavailable-0",
              "label": "Refresh",
              "hint": "The retained result is still unavailable. The run remains held.",
              "send": {
                "via": "action",
                "actionKey": "screenshot-unavailable-0"
              }
            }
          ]
        }
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
        "served": {
          "type": "identity-mismatch",
          "title": "Confirm employee identity",
          "options": [
            {
              "id": "screenshot-person-0",
              "label": "Continue with Alex",
              "hint": "Alex Morgan · DEMO-1042. Continued to Read Workforce Job Summary.",
              "recommended": true,
              "send": {
                "via": "action",
                "actionKey": "screenshot-person-0"
              }
            }
          ]
        }
      }
    }
  }
] as const satisfies readonly Readonly<{ id: string; label: string; category: string; entry: LogEntry }>[];
