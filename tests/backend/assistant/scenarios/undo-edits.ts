export const undoEditScenarios = [
  { name: "undo the tracker change", laterValue: null, expectedValue: "04/23/2031", largestRequest: 4_900, total: 19_400 },
  { name: "refuse undo after a later change", laterValue: "04/25/2031", expectedValue: "04/25/2031", largestRequest: 4_900, total: 19_400 },
] as const;
