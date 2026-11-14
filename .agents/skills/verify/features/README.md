# Verify feature map

One file per feature. Each gives the entry point, how to drive it and what a passing dry run shows. Source status is `config/dashboard-workflow-sources.json`: a `mock` workflow has nothing to prove in the served app; verify its UI only through unit tests and `/ui-mock` frames.

| Feature | Source | File |
| --- | --- | --- |
| Person Lookup | served | [person-lookup.md](person-lookup.md) |
| Separations | served | [separations.md](separations.md) |
| I-9 Check and child Lookup | served parent; live acceptance blocked | [i9-check.md](i9-check.md) |
| Emergency Contact (OCR) | OCR served, EC mock | [emergency-contact-ocr.md](emergency-contact-ocr.md) |
| Assistant | served | [assistant.md](assistant.md) |
| Sign-up | served | [sign-up.md](sign-up.md) |
