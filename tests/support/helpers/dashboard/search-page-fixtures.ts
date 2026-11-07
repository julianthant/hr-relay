export function zeroMatchSearchPage() {
return {
          wireVersion: 1,
          generatedAt: "2026-08-28T16:00:00.000Z",
          snapshot: {
            authorityGeneration: 19,
            order: "match-strength/enqueued-desc/run-id-asc:v2",
            token: "test-snapshot-token",
          },
          totalMatches: 0,
          coverage:{matched:0,subjectUnavailable:0,actorUnavailable:0,candidateLimit:10000},
          results: [],
          nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
        };
}
