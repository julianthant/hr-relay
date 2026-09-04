# R01 coverage proof excerpts

Source: `test-coverage.log`; numbers below are physical log line numbers.

## admits v29 through
Matched lines: 3
```text
1200:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > admits v29 through storage-backup-read-only-no-migrate without migrating or changing its bytes 23ms
1201:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > admits v29 through storage-doctor-read-only-no-migrate without migrating or changing its bytes 25ms
1202:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > admits v29 through storage-upgrade-preflight-read-only-no-migrate without migrating or changing its bytes 22ms
```

## admits the frozen integrated
Matched lines: 3
```text
1204:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > admits the frozen integrated v27 layout for upgrade preflight 21ms
1205:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > admits the frozen integrated v28 layout for upgrade preflight 18ms
1207:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > admits the frozen integrated v29 layout for upgrade preflight 20ms
```

## releases its acquired server process record
Matched lines: 2
```text
910:  ✓ |unit| tests/unit/server/compose-real-port.test.ts > composed dashboard runtime over an owned loopback socket > releases its acquired server process record when authority v29 refuses open 103ms
911:  ✓ |unit| tests/unit/server/compose-real-port.test.ts > composed dashboard runtime over an owned loopback socket > releases its acquired server process record when authority v31 refuses open 35ms
```

## creates a fresh authority at the v30 floor
Matched lines: 1
```text
1198:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > creates a fresh authority at the v30 floor with one baseline journal row 37ms
```

## refuses an ordinary v29 open
Matched lines: 1
```text
1203:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > refuses an ordinary v29 open with upgrade-required before any migration 22ms
```

## creates the complete v30 schema floor
Matched lines: 1
```text
1208:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > creates the complete v30 schema floor and preserves journal append semantics 43ms
```

## refuses an at-floor authority
Matched lines: 1
```text
1199:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > refuses an at-floor authority whose immutable baseline claims another target 29ms
```

## refuses a v27 authority whose table set
Matched lines: 1
```text
1213:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > refuses a v27 authority whose table set is no longer the exact integrated lineage 16ms
```

## keeps the released v28 phone-capture
Matched lines: 1
```text
1212:  ✓ |unit| tests/unit/sqlite-authority-database.test.ts > native SQLite authority schema > keeps the released v28 phone-capture retirement over an empty exact v27 authority 32ms
```

## storage-backup-command.test.ts
Matched lines: 3
```text
2886:  ✓ |unit| tests/unit/storage-backup-command.test.ts > cli storage backup (D322) > writes exactly one verified backup and manifest at the live generation 91ms
2887:  ✓ |unit| tests/unit/storage-backup-command.test.ts > cli storage backup (D322) > refuses when no authority database exists and creates nothing 1ms
2888:  ✓ |unit| tests/unit/storage-backup-command.test.ts > cli storage backup (D322) > lets the doctor exit 0 on a healthy reconciled authority with no backup, reporting it missing 84ms
```

## storage-restore-drill.test.ts
Matched lines: 20
```text
1361:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > reports post-swap failures without claiming the live authority was untouched 2ms
1370:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > names the corruption read-only, restores the named backup, and keeps every authority family 657ms
1377:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > refuses while a live process holds a runtime lock, and touches nothing 599ms
1381:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > admits concurrent worker processes under one aggregate restore lock 127ms
1385:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > unwinds a worker that loses the check/write race to restore admission 147ms
1386:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > refuses malformed restore admission and archives crashed ownership 55ms
1387:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > advances the aggregate generation whenever a worker starts or restarts 42ms
1395:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > retries release after its first durable write attempt fails 31ms
1396:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > retries singleton release after its first durable write attempt fails 27ms
1397:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > reads the old root-level workers lock forward into the aggregate 5ms
1400:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > refuses restore while any worker process is alive 135ms
1401:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > fails loud on a malformed worker process-lock record 1ms
1409:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > observes a crashed holder as stopped rather than bricking recovery 235ms
1410:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > refuses a second live holder of one role lock 61ms
1434:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > admits exactly one singleton under 16-process contention and never observes it stopped 1357ms
1435:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > keeps one live process identity stable when the caller timezone changes 39ms
1436:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > treats a reused pid with a different OS start identity as a crashed owner 8ms
1437:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > archives restore admission when its pid was reused by a different process birth 31ms
1438:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > names every storage-doctor exit-zero condition in command help 1ms
1443:  ✓ |unit| tests/unit/storage-restore-drill.test.ts > 2j — corruption → degraded → restore → rebuild, through the CLI > refuses restore without an exact named manifest 76ms
```

## storage-span-authority-reconciliation.test.ts
Matched lines: 31
```text
1931:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names a current run whose individual queued root is missing alongside an unaccounted root 53ms
1932:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names every missing current root in an existing empty span directory 37ms
1939:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > deduplicates exact malformed rows while withholding mixed-snapshot absence claims 50ms
1940:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > does not invent missing-span findings around unreadable evidence 32ms
1941:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names duplicate run.queued roots instead of reconciling the run-id set 39ms
1948:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > rejects a root tuple that conflicts with its exact current authority row 45ms
1949:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > compares resolved instances canonically rather than by insertion order 43ms
1950:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > reconciles non-increasing requeue allocation against exact authority 40ms
1954:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > reconciles skipped allocation requeue allocation against exact authority 44ms
1955:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > reconciles foreign skipped allocation requeue allocation against exact authority 42ms
1956:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names foreign workflow instead of accepting a matching run-id set 38ms
1960:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names foreign trace instead of accepting a matching run-id set 37ms
1961:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names out-of-order attempt instead of accepting a matching run-id set 43ms
1962:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names foreign task root instead of accepting a matching run-id set 39ms
1967:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names task end before start instead of accepting a matching run-id set 40ms
1968:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > rejects a queued root whose span path is not its exact trace root 40ms
1969:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > requires the exact run-root task parent rather than undefined 36ms
1975:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > requires the exact run-root task parent rather than pl-120000-0000/nested 44ms
1976:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names a task event before its run root as malformed ordering 34ms
1977:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > reconciles a late queued root only when it carries authority-reconstruction evidence 35ms
1983:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > keeps an unmarked late queued root malformed 33ms
1984:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > refuses a malformed authority-reconstruction marker before reconciliation 36ms
1985:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > replays pre-root identity defects against a repaired queued root 45ms
1989:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > replays pre-root timestamp defects against a repaired queued root 38ms
1990:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > replays pre-root task span defects against a repaired queued root 35ms
1991:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > names malformed authority with no queued root before classifying absence 37ms
1999:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > accounts a deleted run's surviving queued root instead of reporting missing authority 36ms
2000:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > still names a root with neither authority row nor tombstone as missing 40ms
2001:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > refuses a tombstone whose workflow contradicts the span root it would account for 35ms
2002:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > refuses a tombstone whose traceId contradicts the span root it would account for 40ms
2003:  ✓ |unit| tests/unit/storage-span-authority-reconciliation.test.ts > storage doctor span/authority reconciliation > preserves the queue projection's exact refusal for a span-only run 7ms
```

## storage-span-root-repair.test.ts
Matched lines: 2
```text
2746:  ✓ |unit| tests/unit/storage-span-root-repair.test.ts > offline missing run.queued recovery > appends one authority-derived marked root without changing prior stream bytes 135ms
2747:  ✓ |unit| tests/unit/storage-span-root-repair.test.ts > offline missing run.queued recovery > refuses when a required start-plan authority binding is absent 82ms
```

## storage-diagnostic-redaction.test.ts
Matched lines: 56
```text
1376:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'private-path' from 'root' / 'spanPath' while naming the field 180ms
1380:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'private-path' from 'root' / 'parentSpanPath' while naming the field 129ms
1384:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'private-path' from 'task' / 'spanPath' while naming the field 169ms
1391:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'private-path' from 'task' / 'parentSpanPath' while naming the field 150ms
1392:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'secret-marker' from 'root' / 'spanPath' while naming the field 75ms
1398:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'secret-marker' from 'root' / 'parentSpanPath' while naming the field 68ms
1399:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'secret-marker' from 'task' / 'spanPath' while naming the field 62ms
1407:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'secret-marker' from 'task' / 'parentSpanPath' while naming the field 74ms
1408:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'person-marker' from 'root' / 'spanPath' while naming the field 87ms
1414:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'person-marker' from 'root' / 'parentSpanPath' while naming the field 110ms
1415:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'person-marker' from 'task' / 'spanPath' while naming the field 59ms
1419:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'person-marker' from 'task' / 'parentSpanPath' while naming the field 61ms
1420:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'raw-read-EIO' from 'read' / 'span corpus' while naming the field 162ms
1423:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'raw-read-hostile-code' from 'read' / 'span corpus' while naming the field 214ms
1428:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'invalid-filename' from 'invalid-file' / 'stream file' while naming the field 426ms
1430:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'valid-filename' from 'valid-file' / 'workflow' while naming the field 278ms
1431:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'schema-key' from 'schema-key' / 'strict span schema' while naming the field 98ms
1439:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'schema-field' from 'schema-field' / 'notRunReason' while naming the field 99ms
1440:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at doctor > withholds 'nested-root' from 'nested-root' / 'path component 1' while naming the field 72ms
1444:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'private-path' from 'root' / 'spanPath' while naming the field 78ms
1445:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'private-path' from 'root' / 'parentSpanPath' while naming the field 39ms
1450:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'private-path' from 'task' / 'spanPath' while naming the field 62ms
1451:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'private-path' from 'task' / 'parentSpanPath' while naming the field 35ms
1452:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'secret-marker' from 'root' / 'spanPath' while naming the field 41ms
1459:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'secret-marker' from 'root' / 'parentSpanPath' while naming the field 37ms
1460:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'secret-marker' from 'task' / 'spanPath' while naming the field 44ms
1461:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'secret-marker' from 'task' / 'parentSpanPath' while naming the field 39ms
1469:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'person-marker' from 'root' / 'spanPath' while naming the field 38ms
1470:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'person-marker' from 'root' / 'parentSpanPath' while naming the field 41ms
1471:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'person-marker' from 'task' / 'spanPath' while naming the field 43ms
1475:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'person-marker' from 'task' / 'parentSpanPath' while naming the field 33ms
1476:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'raw-read-EIO' from 'read' / 'span corpus' while naming the field 39ms
1477:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'raw-read-hostile-code' from 'read' / 'span corpus' while naming the field 36ms
1478:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'invalid-filename' from 'invalid-file' / 'stream file' while naming the field 35ms
1479:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'valid-filename' from 'valid-file' / 'workflow' while naming the field 33ms
1480:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'schema-key' from 'schema-key' / 'strict span schema' while naming the field 36ms
1484:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'schema-field' from 'schema-field' / 'notRunReason' while naming the field 32ms
1485:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at browser-wire > withholds 'nested-root' from 'nested-root' / 'path component 1' while naming the field 33ms
1486:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'private-path' from 'root' / 'spanPath' while naming the field 37ms
1487:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'private-path' from 'root' / 'parentSpanPath' while naming the field 38ms
1488:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'private-path' from 'task' / 'spanPath' while naming the field 44ms
1489:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'private-path' from 'task' / 'parentSpanPath' while naming the field 49ms
1493:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'secret-marker' from 'root' / 'spanPath' while naming the field 41ms
1494:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'secret-marker' from 'root' / 'parentSpanPath' while naming the field 44ms
1496:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'secret-marker' from 'task' / 'spanPath' while naming the field 58ms
1497:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'secret-marker' from 'task' / 'parentSpanPath' while naming the field 40ms
1498:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'person-marker' from 'root' / 'spanPath' while naming the field 44ms
1499:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'person-marker' from 'root' / 'parentSpanPath' while naming the field 36ms
1500:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'person-marker' from 'task' / 'spanPath' while naming the field 36ms
1501:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'person-marker' from 'task' / 'parentSpanPath' while naming the field 37ms
1502:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'raw-read-EIO' from 'read' / 'span corpus' while naming the field 30ms
1503:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'raw-read-hostile-code' from 'read' / 'span corpus' while naming the field 29ms
1504:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'invalid-filename' from 'invalid-file' / 'stream file' while naming the field 29ms
1505:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'valid-filename' from 'valid-file' / 'workflow' while naming the field 31ms
1506:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'schema-key' from 'schema-key' / 'strict span schema' while naming the field 32ms
1507:  ✓ |unit| tests/unit/storage-diagnostic-redaction.test.ts > storage diagnostic redaction at cli-json > withholds 'schema-field' from 'schema-field' / 'notRunReason' while naming the field 30ms
```

## storage-summary.test.ts
Matched lines: 4
```text
2678:  ✓ |unit| tests/unit/storage-summary.test.ts > summarizeBackupHealth > reads missing with no directory, and current right after a real verified backup 67ms
2683:  ✓ |unit| tests/unit/storage-summary.test.ts > summarizeBackupHealth > reads stale on ANY authority-generation gap, and current again after the next backup 91ms
2684:  ✓ |unit| tests/unit/storage-summary.test.ts > summarizeBackupHealth > reads stale past the age bound even with no gap, and judges by age alone when the live generation is unknown 107ms
2685:  ✓ |unit| tests/unit/storage-summary.test.ts > summarizeBackupHealth > treats an unparseable manifest as no usable backup — missing, never a guessed state 21ms
```

## bootstrap-storage-arms.test.ts
Matched lines: 5
```text
3866:  ✓ |unit| tests/unit/server/bootstrap-storage-arms.test.ts > bootstrap storage summary > projects the retained strict preflight report in registry order 6ms
3867:  ✓ |unit| tests/unit/server/bootstrap-storage-arms.test.ts > bootstrap storage summary > projects retained preflight failures with their exact blocks and remediation 2ms
3868:  ✓ |unit| tests/unit/server/bootstrap-storage-arms.test.ts > bootstrap storage summary > emits every authority arm the wire declares 2ms
3869:  ✓ |unit| tests/unit/server/bootstrap-storage-arms.test.ts > bootstrap storage summary > emits every backup arm the wire declares 2ms
3870:  ✓ |unit| tests/unit/server/bootstrap-storage-arms.test.ts > bootstrap storage summary > an unreachable authority still serves the backup indicator 1ms
```

## architecture/storage-recovery.test.ts
Matched lines: 94
```text
9:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > verified native online backups > backs up and restores an exact v7 authority only after the immutable released migration chain 140ms
10:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > verified native online backups > backs up through the private native handle and self-observes the completed copy 67ms
11:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > verified native online backups > coalesces concurrent requests and performs one generation follow-up 79ms
12:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > verified native online backups > fails loud and removes its unique temporary target when native backup fails 28ms
13:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > verified native online backups > rejects tampered backup bytes and a tampered manifest 114ms
14:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > verified native online backups > rejects a native backup whose JSON-valid command record fails its strict schema 34ms
15:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > returns span resolutions with the authority identity from their read snapshot 36ms
16:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > prepares the three span authority lookup statements once for the whole root batch 29ms
17:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > resolves a span root whose run carries a D308 tombstone as deleted 32ms
18:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a tombstone whose stored record fails its strict schema 29ms
19:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses archived authority whose required retained task is missing 29ms
20:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses archived authority whose required retained task is malformed 31ms
21:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > returns one authority identity when a commit lands between metadata and fingerprint reads 31ms
22:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a missing span corpus when exact authority proves runs already exist 32ms
23:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > accepts a missing span corpus only for the exact never-produced authority baseline 38ms
24:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > serves only a safe span file identifier and sanitized issue for malformed JSON 30ms
25:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a symlinked span corpus file instead of following it 28ms
26:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a symlinked span corpus directory before enumeration 28ms
27:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a symlinked state-root parent before span enumeration 29ms
28:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > closes an acquired corpus descriptor when its post-open identity check fails 35ms
29:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > keeps the original corpus across a transient regular-directory swap during leaf open 32ms
30:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses an intermediate state-root component replaced by a symlink while the doctor awaits 29ms
31:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a span file beyond the explicit byte bound before parsing it 27ms
32:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses the span corpus when its declared files exceed the total byte bound 275ms
33:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses one span line beyond the explicit byte bound 43ms
34:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a span corpus beyond the explicit line-count bound 2299ms
35:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a span corpus beyond the explicit run-ID bound 248ms
36:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a non-contract span filename without enumerating around it 29ms
37:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > stops span directory enumeration before retaining more than the file cap 37ms
38:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a doctor report assembled across different authority snapshots 78ms
39:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > performs one broad authority inspection and one span snapshot per doctor run 26ms
40:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses a transient A-to-B-to-A authority swap during span resolution 75ms
41:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses when an initially degraded authority changes during external verification 59ms
42:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > preserves a failed final identity read as named transition evidence 27ms
43:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > preserves both failed identity reads when degraded evidence changes 23ms
44:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > names a span-known run missing from exact live and archived authority 28ms
45:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses archived authority paired with a retained queued task 30ms
46:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > reconciles an archive paired with its exact terminal retained task 33ms
47:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > reconciles an archived failure bound to its exact retained and frozen identity tuple 38ms
48:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses an archived failure whose frozen run identity is foreign 42ms
49:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses an archived failure whose frozen trace identity is foreign 39ms
50:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses an archived failure whose frozen attempt identity is foreign 37ms
51:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses an archived failure whose frozen workflow identity is foreign 39ms
52:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses terminal retained authority whose outcome contradicts the archive 33ms
53:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses terminal retained authority whose end instant contradicts the archive 32ms
54:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses archived authority paired with a retained claimed task 33ms
55:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses archived authority paired with a retained validating task 32ms
56:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses archived authority paired with a retained running task 34ms
57:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses archived authority paired with a retained parked-gate task 32ms
58:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > refuses archived authority paired with a retained parked-write task 33ms
59:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies a retained task tuple that contradicts its paired archive root 32ms
60:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies priority drift in the exact live task tuple 30ms
61:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies priority drift in the exact archived tuple 33ms
62:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies a full queued-root tuple that disagrees with its exact live authority 29ms
63:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies a queued root whose span path is not its frozen trace root 33ms
64:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies task identity that does not remain beneath its exact queued root 30ms
65:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies duplicate run.queued roots instead of collapsing them to one live run id 30ms
66:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies queued roots whose item attempts appear out of authority order 32ms
67:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies a requeue whose next item attempt does not strictly increase 31ms
68:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > accepts a requeue gap consumed by a sibling while binding both exact authority tuples 34ms
69:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > classifies a sibling root that appears after a later requeue allocation 32ms
70:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > names malformed exact task authority instead of selecting another row 32ms
80:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > rejects NULL/nonterminal partial authorization, failure, result, and outbox settlements read-only 113ms
81:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > degrades read-only for every schema-valid authorization/consequence mismatch in both arms 533ms
82:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > degrades read-only for every authorization column and arm-specific authority mismatch 397ms
83:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > opens corrupt, truncated, newer, foreign-key-invalid, invariant-invalid, and record-invalid files degraded 138ms
84:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > reports counts, backup freshness/gap, candidates, and a newer bad manifest without mutation 119ms
85:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > fail-closed degraded boot and read-only doctor > reports a verified restore candidate even when the live authority becomes corrupt 55ms
86:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > consumes the exact issued proof when the wall clock advances before exclusive verification 109ms
87:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > preserves nonempty failure, result, terminal-outbox, and authorization authority 127ms
88:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > preserves the suspect DB, rebuilds projections only, and atomically restores authority 124ms
89:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > refuses restore without the explicit stopped-system proof before preserving or swapping 81ms
90:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > refuses when a worker starts after the stopped proof was issued 97ms
91:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > refuses a never-run proof after the first singleton starts and releases 98ms
92:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > holds exclusive admission through verification and authority replacement 104ms
93:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > does not fall back when the exact newest manifest is bad 60ms
94:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > keeps live and suspect recoverable when projection rebuild fails 110ms
95:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > leaves live authority untouched on an injected atomic-swap failure 140ms
96:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > restores a companion when its displacement rename throws after moving it 115ms
97:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > reports authority replaced when atomic swap throws after replacing it 107ms
98:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > reports cleanup-only failure after authority replacement and names the staged path 113ms
99:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > preserves primary failure before staged cleanup failure 97ms
100:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > reports uncertain companion state when rollback 'rename' fails 97ms
102:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > reports uncertain companion state when rollback 'fsync' fails 108ms
112:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > reports uncertain companion state when rollback 'unlink' fails 99ms
113:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > refuses when verified backup bytes mutate during the staged copy 104ms
114:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > classifies post-swap directory fsync failure as authority replaced 110ms
115:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > classifies post-swap report validation failure as authority replaced 102ms
116:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > classifies exclusive-admission release failure after swap as authority replaced 113ms
117:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > rejects stale, replayed, generation-mismatched, and currently-active process-lock proofs 266ms
118:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > offline exact-backup restore > rejects a checksum-valid restore copy whose authority record is schema-invalid 62ms
119:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > authority.health preflight and static recovery boundary > fails authority.health when a span-known run has no exact authority 59ms
120:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > authority.health preflight and static recovery boundary > projects doctor health through the registered authority.health runner 74ms
121:  ✓ |architecture| tests/unit/architecture/storage-recovery.test.ts > authority.health preflight and static recovery boundary > keeps the native handle private and bans live-copy or VACUUM backup fallbacks 101ms
```

## migration-history-immutability.test.ts
Matched lines: 4
```text
709:  ✓ |architecture| tests/unit/architecture/migration-history-immutability.test.ts > immutable SQLite migration history > pins every released migration's metadata, order, and ordered statement bytes 2ms
710:  ✓ |architecture| tests/unit/architecture/migration-history-immutability.test.ts > immutable SQLite migration history > preserves the original DCC1 v19-v21 statement bytes as source-lineage evidence 0ms
711:  ✓ |architecture| tests/unit/architecture/migration-history-immutability.test.ts > immutable SQLite migration history > preserves the superseded DCC4 v19 statement bytes as source-lineage evidence 0ms
712:  ✓ |architecture| tests/unit/architecture/migration-history-immutability.test.ts > immutable SQLite migration history > changes its digest for metadata, statement edits, insertion, deletion, and reorder 0ms
```

## Test Files
Matched lines: 1
```text
5112:  Test Files  411 passed (411)
```

## Tests  5032
Matched lines: 1
```text
5113:       Tests  5032 passed (5032)
```

## All files
Matched lines: 1
```text
5121: All files          |   85.61 |    76.52 |   89.47 |   87.56 |
```
