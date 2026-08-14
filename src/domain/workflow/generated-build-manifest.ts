/**
 * GENERATED — run `npm run build:manifest`. Do not edit by hand.
 *
 * Descriptor and task-impl fingerprints over canonical (path, content)
 * tuples plus the locked toolchain. `descriptor-coverage` regenerates this
 * file and fails on any diff.
 */

export const GENERATED_BUILD_MANIFEST = {
  "kind": "hrauto-rebuild-build-manifest",
  "manifestVersion": 1,
  "toolchain": {
    "typescript": "5.9.3",
    "zod": "4.4.3"
  },
  "workflows": [
    {
      "fingerprint": "5a13154780463e6668e8d7e959cac578874cb32707a27b521fd906cdb49b268d",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "4db473ffb5976e0541ff9c05324f98d870ce41a9090853ad8f62139d8fa9aca4"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3a9502314577f90e73abe5b5e67e3338d718cbf27e5d7110483b1ace0c201755"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/fill-timekeeper-annotation.ts",
          "sha256": "9d99db2a28da81908420bb2963f9d9a4e16172d06837d99e7a4f5995305e1fd8"
        },
        {
          "path": "src/domain/contracts/kuali/read-timekeeper-annotation.ts",
          "sha256": "62a9d6e547a6738d1c1cd93da4bbaeee46d9a731852e5532c9fb6525778068f1"
        },
        {
          "path": "src/domain/contracts/kuali/save-timekeeper-annotation.ts",
          "sha256": "5bdc53c6428f38fca6fede796d95457b5e0b38cb58d175f09f7af1218b0489bd"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "4c45e0fa2df7723ae0a4d2fa9e31201c3f7467d7f133bcf631a575a9f9a70f00"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "51fcbae563d643a54254b93245bbb359d656883c87da1edd5f5fc35683a52bd2"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "96c7b2c3d1c9fef6b791a0eb77ddf40b1210fa69837ef913f918b657df3fa6d1"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "e3ee87bdec7d447005c59b230b8b09f6cee22efcb547071165e75b90ea7a1891"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "41f4c321829665233ce03b629e1419df967af544f2ec62ba46089f46f6375539"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "ef46b48c06678d9ad96cdded7b48c4e2aae243b076a2015d3852ac66494ce9fe"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "2f4b9423010165287992cf8378983a54019d0fc41fb696c14f7c1d9e20f5f030"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "cbc65b12be8aefd81c2b9defaa0a4f976611b2d8bdf32b7d66eea4cc815ed41f"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "fce909fc454399bd15b1d0fd3c4c3a49851e862a5ada6549f37be5f8ccdec53e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        },
        {
          "path": "src/workflows/kuali-timekeeper-annotation/descriptor.ts",
          "sha256": "ac0ed6e625fef2428eda65350baf6dacb7d8d65e7f2031d236d96c727de39d18"
        }
      ],
      "id": "kuali-timekeeper-annotation"
    },
    {
      "fingerprint": "99fd17f6d99aec03099f464e4d019fb2235018899692fc6873df2fe76db61dd0",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "4db473ffb5976e0541ff9c05324f98d870ce41a9090853ad8f62139d8fa9aca4"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3a9502314577f90e73abe5b5e67e3338d718cbf27e5d7110483b1ace0c201755"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-dates.ts",
          "sha256": "2beb8b4e8cfeee172d304842221118dea3484ecbb31b1290077762fb3cf2afab"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "a258963c198dd0284e29c8c733897c891b9f3a6fada25eb49cc48f37e3887bb3"
        },
        {
          "path": "src/domain/contracts/person-lookup/read-active-status.ts",
          "sha256": "b7087817e1d96092ebc8ece8ff6b8a0ddf57ff067c7e599f5fc96dae4cc370d7"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "bdf71a7a45c41815cf442c10a6b525b222ad198596feb1e504b7b1b787c0e057"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "f04671bcc5ed1450618c1052ee5ce1c9afcfa386618df343e1fbc22aa0dea296"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "e49b5183bd01cb27c148d3a783cec246ae755cce8f8f01453b7029ec47781892"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "4c45e0fa2df7723ae0a4d2fa9e31201c3f7467d7f133bcf631a575a9f9a70f00"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "96c7b2c3d1c9fef6b791a0eb77ddf40b1210fa69837ef913f918b657df3fa6d1"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "e3ee87bdec7d447005c59b230b8b09f6cee22efcb547071165e75b90ea7a1891"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "41f4c321829665233ce03b629e1419df967af544f2ec62ba46089f46f6375539"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "ef46b48c06678d9ad96cdded7b48c4e2aae243b076a2015d3852ac66494ce9fe"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "2f4b9423010165287992cf8378983a54019d0fc41fb696c14f7c1d9e20f5f030"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "cbc65b12be8aefd81c2b9defaa0a4f976611b2d8bdf32b7d66eea4cc815ed41f"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "fce909fc454399bd15b1d0fd3c4c3a49851e862a5ada6549f37be5f8ccdec53e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        },
        {
          "path": "src/workflows/person-lookup/descriptor.ts",
          "sha256": "94da5a85f074ff7c75f02df7f57aab8e0c8c268a3c38aeee322cc5547d1254fa"
        }
      ],
      "id": "person-lookup"
    },
    {
      "fingerprint": "d4040792777df44e1ac5935be377edb1ad26a73d635320ada256e49c2b7895d1",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "4db473ffb5976e0541ff9c05324f98d870ce41a9090853ad8f62139d8fa9aca4"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3a9502314577f90e73abe5b5e67e3338d718cbf27e5d7110483b1ace0c201755"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "7292ff9035806a885d70b992d4e9abbda6fa0a746f1e2e81aebfaeab4eb50bcf"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "e4e4b726d6034ad9a4d3f1f1e6f488868520d7ff18fb4776d141ee9bd9fce5f5"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "c1919e13f8a55f9d0d0a5a9fb530e5610e9d4892b3a84b1edf82f98fc3dd1b2a"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "25360b5b5632265af1a7d158f5399ef9d9337f2a6e3920f3c1280add8b21e577"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "4c45e0fa2df7723ae0a4d2fa9e31201c3f7467d7f133bcf631a575a9f9a70f00"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "b40363ce7b11193964b1fea1cb0a4459dc305d9623ed6a728bfde4307a74730a"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "7bb482e51bab10e44b95187e54e99bc40d4957f72ca25b3c77fce04a58e4409f"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "b5f0aa03957ce1b889416ee971cf0e9d4e7e1d08657613231b33d7a62b099bf9"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "96c7b2c3d1c9fef6b791a0eb77ddf40b1210fa69837ef913f918b657df3fa6d1"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "e3ee87bdec7d447005c59b230b8b09f6cee22efcb547071165e75b90ea7a1891"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "41f4c321829665233ce03b629e1419df967af544f2ec62ba46089f46f6375539"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "ef46b48c06678d9ad96cdded7b48c4e2aae243b076a2015d3852ac66494ce9fe"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "2f4b9423010165287992cf8378983a54019d0fc41fb696c14f7c1d9e20f5f030"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "cbc65b12be8aefd81c2b9defaa0a4f976611b2d8bdf32b7d66eea4cc815ed41f"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "fce909fc454399bd15b1d0fd3c4c3a49851e862a5ada6549f37be5f8ccdec53e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        },
        {
          "path": "src/workflows/separations-identity-check/descriptor.ts",
          "sha256": "253e162f5121c7225828e1d2597a24f6a6a9f2a54f51a1780ee0ae018aa18483"
        }
      ],
      "id": "separations-identity-check"
    },
    {
      "fingerprint": "cef2a35e0d5fab106c3902bb208421b26b07086e5a9e3aac2a21c3d5987c2c2b",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "4db473ffb5976e0541ff9c05324f98d870ce41a9090853ad8f62139d8fa9aca4"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3a9502314577f90e73abe5b5e67e3338d718cbf27e5d7110483b1ace0c201755"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/new-kronos/read-separation-timecard.ts",
          "sha256": "5da05fe2f4cd89c2fbc5c6e8a165ece9efc25cd481983210b94d489e2b474a2e"
        },
        {
          "path": "src/domain/contracts/new-kronos/search-employee.ts",
          "sha256": "f0f2e652b5139eeec9ffb6f9fa038be804787785497be449f71709880fd30551"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "bdf71a7a45c41815cf442c10a6b525b222ad198596feb1e504b7b1b787c0e057"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "f04671bcc5ed1450618c1052ee5ce1c9afcfa386618df343e1fbc22aa0dea296"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "3f59beb26ff0b60e5e4c7dce3016a47dcac9bb0eac599b6ede8dcb05166630dc"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "25360b5b5632265af1a7d158f5399ef9d9337f2a6e3920f3c1280add8b21e577"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "e49b5183bd01cb27c148d3a783cec246ae755cce8f8f01453b7029ec47781892"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "4c45e0fa2df7723ae0a4d2fa9e31201c3f7467d7f133bcf631a575a9f9a70f00"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "e84b77a149818ce2829ef6ae3ee97cc916f1759d5396a601223fd6e2ac294223"
        },
        {
          "path": "src/domain/ui/new-kronos-timecard.ts",
          "sha256": "d4c680fd092a3c0ad19cfa79799ebd7bd838341767ad66e272bbcd5a76ac4754"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "96c7b2c3d1c9fef6b791a0eb77ddf40b1210fa69837ef913f918b657df3fa6d1"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "e3ee87bdec7d447005c59b230b8b09f6cee22efcb547071165e75b90ea7a1891"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "41f4c321829665233ce03b629e1419df967af544f2ec62ba46089f46f6375539"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "ef46b48c06678d9ad96cdded7b48c4e2aae243b076a2015d3852ac66494ce9fe"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "2f4b9423010165287992cf8378983a54019d0fc41fb696c14f7c1d9e20f5f030"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "cbc65b12be8aefd81c2b9defaa0a4f976611b2d8bdf32b7d66eea4cc815ed41f"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "fce909fc454399bd15b1d0fd3c4c3a49851e862a5ada6549f37be5f8ccdec53e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        },
        {
          "path": "src/workflows/separations-kronos-timecard/descriptor.ts",
          "sha256": "1b06814bbee24fb74f8d9ebc9802945b07ce050ad1f760189bdcd63d7fedc253"
        }
      ],
      "id": "separations-kronos-timecard"
    },
    {
      "fingerprint": "b4fda93a2e8e30b2abdd2808524034ec6e56b8c432583c8dc7787cddeba91614",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "4db473ffb5976e0541ff9c05324f98d870ce41a9090853ad8f62139d8fa9aca4"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3a9502314577f90e73abe5b5e67e3338d718cbf27e5d7110483b1ace0c201755"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "2e19de0c41721d7eab617ba92cc7ffba92a8e6074295cd8535b2b3ec89a0e0a7"
        },
        {
          "path": "src/domain/contracts/separations/match-termination-type.ts",
          "sha256": "e7791dc398d44b3271adca0a15d5a973e36c5305c44423bff60255f5cbadad0e"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "4c45e0fa2df7723ae0a4d2fa9e31201c3f7467d7f133bcf631a575a9f9a70f00"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "96c7b2c3d1c9fef6b791a0eb77ddf40b1210fa69837ef913f918b657df3fa6d1"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "e3ee87bdec7d447005c59b230b8b09f6cee22efcb547071165e75b90ea7a1891"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "41f4c321829665233ce03b629e1419df967af544f2ec62ba46089f46f6375539"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "ef46b48c06678d9ad96cdded7b48c4e2aae243b076a2015d3852ac66494ce9fe"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "2f4b9423010165287992cf8378983a54019d0fc41fb696c14f7c1d9e20f5f030"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "cbc65b12be8aefd81c2b9defaa0a4f976611b2d8bdf32b7d66eea4cc815ed41f"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "fce909fc454399bd15b1d0fd3c4c3a49851e862a5ada6549f37be5f8ccdec53e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        },
        {
          "path": "src/workflows/separations-kuali-read/descriptor.ts",
          "sha256": "bfe85fa2fea8a4fe5265654bc06745aa4e146c906e13b4057b49a0d52480cbff"
        }
      ],
      "id": "separations-kuali-read"
    },
    {
      "fingerprint": "8e0a47336508fb536c7cdb4ecb8f13fa1bfafb7486e2491d0444cd941e1a96f2",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "4db473ffb5976e0541ff9c05324f98d870ce41a9090853ad8f62139d8fa9aca4"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3a9502314577f90e73abe5b5e67e3338d718cbf27e5d7110483b1ace0c201755"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "7292ff9035806a885d70b992d4e9abbda6fa0a746f1e2e81aebfaeab4eb50bcf"
        },
        {
          "path": "src/domain/contracts/separations/match-termination-type.ts",
          "sha256": "e7791dc398d44b3271adca0a15d5a973e36c5305c44423bff60255f5cbadad0e"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "e4e4b726d6034ad9a4d3f1f1e6f488868520d7ff18fb4776d141ee9bd9fce5f5"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "91b0a29c6826ee0f971b2bc0f22749df9dbbfe928a73b16f6f87f6af388c2666"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "1cb5e9a21bc893e7ab65e75cef2d9446a63e2d1cd9a3730490aa96df5a84c5e5"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "c1919e13f8a55f9d0d0a5a9fb530e5610e9d4892b3a84b1edf82f98fc3dd1b2a"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "43f784178a1f6690d2e9a0847b8261cd6f817da8ca7dbefd687ff823a0c02277"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-termination.ts",
          "sha256": "fd44c55fad09e93f22d1e17f0fc425f6726a952c3a7687006b78acf20d2c1fa0"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "25360b5b5632265af1a7d158f5399ef9d9337f2a6e3920f3c1280add8b21e577"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "4c45e0fa2df7723ae0a4d2fa9e31201c3f7467d7f133bcf631a575a9f9a70f00"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "b40363ce7b11193964b1fea1cb0a4459dc305d9623ed6a728bfde4307a74730a"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "7bb482e51bab10e44b95187e54e99bc40d4957f72ca25b3c77fce04a58e4409f"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "b5f0aa03957ce1b889416ee971cf0e9d4e7e1d08657613231b33d7a62b099bf9"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "96c7b2c3d1c9fef6b791a0eb77ddf40b1210fa69837ef913f918b657df3fa6d1"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "e3ee87bdec7d447005c59b230b8b09f6cee22efcb547071165e75b90ea7a1891"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "41f4c321829665233ce03b629e1419df967af544f2ec62ba46089f46f6375539"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "ef46b48c06678d9ad96cdded7b48c4e2aae243b076a2015d3852ac66494ce9fe"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "2f4b9423010165287992cf8378983a54019d0fc41fb696c14f7c1d9e20f5f030"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "cbc65b12be8aefd81c2b9defaa0a4f976611b2d8bdf32b7d66eea4cc815ed41f"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "fce909fc454399bd15b1d0fd3c4c3a49851e862a5ada6549f37be5f8ccdec53e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        },
        {
          "path": "src/workflows/separations-ucpath-termination/descriptor.ts",
          "sha256": "155f574ec9e7af1b542eed33ce9607bf78915b6a0ed79cc8d6caa98169c339fb"
        }
      ],
      "id": "separations-ucpath-termination"
    }
  ],
  "tasks": [
    {
      "fingerprint": "ec4a3fa512f80df6985c6f1d504c5c57e40dd26f944285c9076e0ebee9ab75bd",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-dates.ts",
          "sha256": "2beb8b4e8cfeee172d304842221118dea3484ecbb31b1290077762fb3cf2afab"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "a258963c198dd0284e29c8c733897c891b9f3a6fada25eb49cc48f37e3887bb3"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/crm-onboarding.ts",
          "sha256": "5b5c06d9d6fd7355d7137caac6ab664a79fdc56eea0eec891cacbcc6789a34cd"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/crm/declaration.ts",
          "sha256": "f9475f41af20cfebe8753ed508d8701b2f27294e7ca4144870d88f4dc92a90cd"
        },
        {
          "path": "src/stores/crm/driver/interpreter.ts",
          "sha256": "e576a48c645e143c56191aa721bb91c5da7cc7016be1883c0e342b2ae71e91de"
        },
        {
          "path": "src/stores/crm/driver/ui-registry.ts",
          "sha256": "33a2df58090f62e32a593f1ad97fe9e6dbf34e1aa8c813405b0280f88650d8f5"
        },
        {
          "path": "src/stores/crm/tasks/read-onboarding-dates.ts",
          "sha256": "623f01d3d8746a51b37c1c63c8611aaaaa6a0a70a78d09f1103e868514289ce7"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "crm/read-onboarding-dates"
    },
    {
      "fingerprint": "74f98420c12a4b07dc332fa96c43488fc78b30c3111252f69cc2f985e8129210",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-dates.ts",
          "sha256": "2beb8b4e8cfeee172d304842221118dea3484ecbb31b1290077762fb3cf2afab"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "a258963c198dd0284e29c8c733897c891b9f3a6fada25eb49cc48f37e3887bb3"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/crm-onboarding.ts",
          "sha256": "5b5c06d9d6fd7355d7137caac6ab664a79fdc56eea0eec891cacbcc6789a34cd"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/crm/declaration.ts",
          "sha256": "f9475f41af20cfebe8753ed508d8701b2f27294e7ca4144870d88f4dc92a90cd"
        },
        {
          "path": "src/stores/crm/driver/interpreter.ts",
          "sha256": "e576a48c645e143c56191aa721bb91c5da7cc7016be1883c0e342b2ae71e91de"
        },
        {
          "path": "src/stores/crm/driver/ui-registry.ts",
          "sha256": "33a2df58090f62e32a593f1ad97fe9e6dbf34e1aa8c813405b0280f88650d8f5"
        },
        {
          "path": "src/stores/crm/tasks/read-onboarding-record.ts",
          "sha256": "279fdbbcee24d51fb45f745b483ee46cdfd0051bb3be694a5c70dc27cf498c9d"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "crm/read-onboarding-record"
    },
    {
      "fingerprint": "5d3aeb11ad0123486a2bbd8748b24f067d9f861f62f8b099bf6142ac7cf87b53",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/extraction/extract-pdf-pages.ts",
          "sha256": "923323559586881672a7eb83c176d885e6b67f568c17dbb14144b8b17086e37d"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/extraction/tasks/extract-pdf-pages.ts",
          "sha256": "f5ed6f288ebfde47f0c6e51897ee7c86189e5f488b25533e7ca5979190db32c8"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "extraction/extract-pdf-pages"
    },
    {
      "fingerprint": "4c3bbc20f1e5a8042deac5bf4510c265e9a2c147a24650267a31d3351c30459a",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/extraction/extract-spreadsheet.ts",
          "sha256": "b75b87151f4389c93fe58ddfd7ee1b2084f8d2a9704519fa59261daaa62ebff6"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "bdf71a7a45c41815cf442c10a6b525b222ad198596feb1e504b7b1b787c0e057"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "f04671bcc5ed1450618c1052ee5ce1c9afcfa386618df343e1fbc22aa0dea296"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/intake/header-discovery.ts",
          "sha256": "f4a0d4802efd722b27379ecfaf3f0af10e14d6ce3330d41f9284337541c57517"
        },
        {
          "path": "src/domain/intake/mapping.ts",
          "sha256": "7a15e27e70f00710ccb4b6aeab64b4059e63edf007c6186de03b292cbac20a32"
        },
        {
          "path": "src/domain/intake/projection.ts",
          "sha256": "5e3e5af571237bc01090c16a7bfc095da00570b58cde0be14939490585a9dda5"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "e49b5183bd01cb27c148d3a783cec246ae755cce8f8f01453b7029ec47781892"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/common/spreadsheet-grid.ts",
          "sha256": "2ad5b8423d46c88ca446e70e8450816bb38728eaa78797fab35cddd95adbf456"
        },
        {
          "path": "src/stores/extraction/tasks/extract-spreadsheet.ts",
          "sha256": "a13a410cf23c5e219989341c335fda46f067d6b329120774ab91fb2a2662424e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "a97671960ac5b84a3c05630dd2ee980e920ffcc4318a79725f381d0ed68947ea"
        }
      ],
      "id": "extraction/extract-spreadsheet"
    },
    {
      "fingerprint": "65a1b404adb85da93494a6d4ba4c157b4719e98bcceeb01fb078f229bd4c5189",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/fill-timekeeper-annotation.ts",
          "sha256": "9d99db2a28da81908420bb2963f9d9a4e16172d06837d99e7a4f5995305e1fd8"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "51fcbae563d643a54254b93245bbb359d656883c87da1edd5f5fc35683a52bd2"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "cf5295273a78e6f0e55ddb39ded2d54a05586191c2b7cca40db10bde9bc9f384"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "4a8bb8424682a7465bfb8decc5aee351c3e83c66283bd60c4af1adfb2e57f074"
        },
        {
          "path": "src/stores/kuali/tasks/fill-timekeeper-annotation.ts",
          "sha256": "248fc3a6c706b68d9ac2d14c4f0994cae5c5ebe716e2bf9e64b65b418103f1ec"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "kuali/fill-timekeeper-annotation"
    },
    {
      "fingerprint": "ce0961fffdf3d99f32fdf08b8c5ec4b5c2f7590270d628c5e19fe0b13adebd2a",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "2e19de0c41721d7eab617ba92cc7ffba92a8e6074295cd8535b2b3ec89a0e0a7"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "51fcbae563d643a54254b93245bbb359d656883c87da1edd5f5fc35683a52bd2"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "cf5295273a78e6f0e55ddb39ded2d54a05586191c2b7cca40db10bde9bc9f384"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "4a8bb8424682a7465bfb8decc5aee351c3e83c66283bd60c4af1adfb2e57f074"
        },
        {
          "path": "src/stores/kuali/tasks/read-separation-document.ts",
          "sha256": "81bfd314d61596f517d7b3dc1901c3e7544b3b6d278cea0bf2e6ebba7ce6dcce"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "kuali/read-separation-document"
    },
    {
      "fingerprint": "994f7367e16253cf05a95e77bae68516f5efd0f1e1bf8af613fdcd6fc97c0535",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/read-timekeeper-annotation.ts",
          "sha256": "62a9d6e547a6738d1c1cd93da4bbaeee46d9a731852e5532c9fb6525778068f1"
        },
        {
          "path": "src/domain/contracts/kuali/save-timekeeper-annotation.ts",
          "sha256": "5bdc53c6428f38fca6fede796d95457b5e0b38cb58d175f09f7af1218b0489bd"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "51fcbae563d643a54254b93245bbb359d656883c87da1edd5f5fc35683a52bd2"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "a131d575df83c6d7880506a218d9590ba2cdf961c8b8c59b5eb61d78b0f7c813"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "cf5295273a78e6f0e55ddb39ded2d54a05586191c2b7cca40db10bde9bc9f384"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "4a8bb8424682a7465bfb8decc5aee351c3e83c66283bd60c4af1adfb2e57f074"
        },
        {
          "path": "src/stores/kuali/tasks/read-timekeeper-annotation.ts",
          "sha256": "2d877acdbbb0800bfb018cdda060f06c9862cb91ee5db7565abb6a25e0d1e0f8"
        },
        {
          "path": "src/stores/kuali/timekeeper-verdict.ts",
          "sha256": "b25cf2dd00253c54f2d6e54cd2ff53cb6d21dfae841d88236dfb522887129094"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "kuali/read-timekeeper-annotation"
    },
    {
      "fingerprint": "21b0764b677faf5a063a21d934db6f6c20595c12f334e417ad45ab0de57e70e7",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/read-timekeeper-annotation.ts",
          "sha256": "62a9d6e547a6738d1c1cd93da4bbaeee46d9a731852e5532c9fb6525778068f1"
        },
        {
          "path": "src/domain/contracts/kuali/save-timekeeper-annotation.ts",
          "sha256": "5bdc53c6428f38fca6fede796d95457b5e0b38cb58d175f09f7af1218b0489bd"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "51fcbae563d643a54254b93245bbb359d656883c87da1edd5f5fc35683a52bd2"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "cf5295273a78e6f0e55ddb39ded2d54a05586191c2b7cca40db10bde9bc9f384"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "4a8bb8424682a7465bfb8decc5aee351c3e83c66283bd60c4af1adfb2e57f074"
        },
        {
          "path": "src/stores/kuali/tasks/save-timekeeper-annotation.ts",
          "sha256": "bd1e17010f59e4c1ff363324e6624ed9f66aebc0359c3c4caa8eff04df8c209e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "kuali/save-timekeeper-annotation"
    },
    {
      "fingerprint": "720464de9085e22f951600797c9ed1ee1b1c6140b239c7f100a3bb389002e059",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/read-timekeeper-annotation.ts",
          "sha256": "62a9d6e547a6738d1c1cd93da4bbaeee46d9a731852e5532c9fb6525778068f1"
        },
        {
          "path": "src/domain/contracts/kuali/save-timekeeper-annotation.ts",
          "sha256": "5bdc53c6428f38fca6fede796d95457b5e0b38cb58d175f09f7af1218b0489bd"
        },
        {
          "path": "src/domain/contracts/kuali/verify-timekeeper-annotation.ts",
          "sha256": "027471b2447c8204eacf08a5af3bede9cccda674ed749383b0305c3cdbe9f1f1"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "51fcbae563d643a54254b93245bbb359d656883c87da1edd5f5fc35683a52bd2"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "a131d575df83c6d7880506a218d9590ba2cdf961c8b8c59b5eb61d78b0f7c813"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "cf5295273a78e6f0e55ddb39ded2d54a05586191c2b7cca40db10bde9bc9f384"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "4a8bb8424682a7465bfb8decc5aee351c3e83c66283bd60c4af1adfb2e57f074"
        },
        {
          "path": "src/stores/kuali/tasks/verify-timekeeper-annotation.ts",
          "sha256": "d0678c2734f6e1e61f9af5e8e7012ffce33b6140c1f95489216f81061721e14f"
        },
        {
          "path": "src/stores/kuali/timekeeper-verdict.ts",
          "sha256": "b25cf2dd00253c54f2d6e54cd2ff53cb6d21dfae841d88236dfb522887129094"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "kuali/verify-timekeeper-annotation"
    },
    {
      "fingerprint": "381deb1128a9ce37eb54518e9c4120fe57c1908facf40720c75f7a1c34636eff",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/new-kronos/read-separation-timecard.ts",
          "sha256": "5da05fe2f4cd89c2fbc5c6e8a165ece9efc25cd481983210b94d489e2b474a2e"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "3f59beb26ff0b60e5e4c7dce3016a47dcac9bb0eac599b6ede8dcb05166630dc"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "e84b77a149818ce2829ef6ae3ee97cc916f1759d5396a601223fd6e2ac294223"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/new-kronos-timecard.ts",
          "sha256": "d4c680fd092a3c0ad19cfa79799ebd7bd838341767ad66e272bbcd5a76ac4754"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/new-kronos/declaration.ts",
          "sha256": "8af55a6559c2b38b06a1483dbd6393dbc11967b5aabe9a2a6b8b61a8741667c5"
        },
        {
          "path": "src/stores/new-kronos/driver/grid-scroll.ts",
          "sha256": "25780d2a97bf293f4ba80edb08572062b16f4338ff02d3bd6fc885e9b41cbd59"
        },
        {
          "path": "src/stores/new-kronos/driver/interpreter.ts",
          "sha256": "bb8d5dd7d6cc7635f9fb36858ba5da36cc8f8ddf85536037a2562589f5f02610"
        },
        {
          "path": "src/stores/new-kronos/driver/ui-registry.ts",
          "sha256": "21ca8b40599c6710da120eff45e3eb21088e198558bfcf5b8ee629eedcf9fe16"
        },
        {
          "path": "src/stores/new-kronos/tasks/read-separation-timecard.ts",
          "sha256": "2096dd5d7c6596d60aee9be684f74b738ba29973b8478f343d0dd60efab8f367"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "new-kronos/read-separation-timecard"
    },
    {
      "fingerprint": "f439910c1b1b277343dd4ab4deb5e53ef6cfeb9fbf163e012d2d3a27c2e24163",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/new-kronos/search-employee.ts",
          "sha256": "f0f2e652b5139eeec9ffb6f9fa038be804787785497be449f71709880fd30551"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "3f59beb26ff0b60e5e4c7dce3016a47dcac9bb0eac599b6ede8dcb05166630dc"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "e84b77a149818ce2829ef6ae3ee97cc916f1759d5396a601223fd6e2ac294223"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/new-kronos-timecard.ts",
          "sha256": "d4c680fd092a3c0ad19cfa79799ebd7bd838341767ad66e272bbcd5a76ac4754"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/new-kronos/declaration.ts",
          "sha256": "8af55a6559c2b38b06a1483dbd6393dbc11967b5aabe9a2a6b8b61a8741667c5"
        },
        {
          "path": "src/stores/new-kronos/driver/grid-scroll.ts",
          "sha256": "25780d2a97bf293f4ba80edb08572062b16f4338ff02d3bd6fc885e9b41cbd59"
        },
        {
          "path": "src/stores/new-kronos/driver/interpreter.ts",
          "sha256": "bb8d5dd7d6cc7635f9fb36858ba5da36cc8f8ddf85536037a2562589f5f02610"
        },
        {
          "path": "src/stores/new-kronos/driver/ui-registry.ts",
          "sha256": "21ca8b40599c6710da120eff45e3eb21088e198558bfcf5b8ee629eedcf9fe16"
        },
        {
          "path": "src/stores/new-kronos/tasks/search-employee.ts",
          "sha256": "9ce779b4e2e2196c661ac98fb9b99cba9214cfe5ea8997ceb1df344555d8e622"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "new-kronos/search-employee"
    },
    {
      "fingerprint": "c9bcfbfb20a58f495ee18673e2037ef85a6ab688c0f07b3802a067c0979d63b5",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/normalization/normalize-contact.ts",
          "sha256": "6b19c6510efec367c91bd892ae51798e137e2db7ec2a2072c721d2ed5df71ac2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "bdf71a7a45c41815cf442c10a6b525b222ad198596feb1e504b7b1b787c0e057"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "f04671bcc5ed1450618c1052ee5ce1c9afcfa386618df343e1fbc22aa0dea296"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/normalization/contact-rules.ts",
          "sha256": "1d5638af90366be34be4f9ed13f9db1dd5e6b800ee70eb155f79713d875fe1e6"
        },
        {
          "path": "src/domain/normalization/geocode.ts",
          "sha256": "2a9d1afcf953d7fd32c2ebc0ab7aadcd6c6f9b0000c7271aec0abe4bc53dc4c7"
        },
        {
          "path": "src/domain/normalization/street-safety.ts",
          "sha256": "feaac03f30def7334a5b15024719e3fbd62d2c0c58fd319bc48c550ae52c991c"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "e49b5183bd01cb27c148d3a783cec246ae755cce8f8f01453b7029ec47781892"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/advisory.ts",
          "sha256": "d645d42c93719da664301525bda528aa6f1852c0c82b7c073090c54cb0831ee6"
        },
        {
          "path": "src/domain/trust/failure.ts",
          "sha256": "0b6edd64ab1d9ec006f217e7c323d83439dfb294f0dfcef7c14bdd7846490f38"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/normalization/tasks/read-contact-advice.ts",
          "sha256": "cf23c8e2c61acae24779c45da96513bae6fcc9aefed19b027352de5a9e521620"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "normalization/read-contact-advice"
    },
    {
      "fingerprint": "2924560a90c22d581af924deba6bba58ee4b38dac3a7a3f4f6dba3352bfcd8b3",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ocr/extract-form-page.ts",
          "sha256": "b3fc3f7dff2b5721d3318558ba97d3f289d5fa52248f73234ccfde0730f15c74"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "bdf71a7a45c41815cf442c10a6b525b222ad198596feb1e504b7b1b787c0e057"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "f04671bcc5ed1450618c1052ee5ce1c9afcfa386618df343e1fbc22aa0dea296"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/ocr/extraction.ts",
          "sha256": "8717c07a1e8885e1927420461614a4e5bd20b7835f3b93f31a73574a2948c43c"
        },
        {
          "path": "src/domain/ocr/form-registry.ts",
          "sha256": "bac6e996bc939f0d1e4cdd9408558e4f9b9d07be7cbdade03dec5a15b09e9b9a"
        },
        {
          "path": "src/domain/ocr/instruction.ts",
          "sha256": "22c6857bbc0d56bccbd5185aa1eb00a6991580ec4dee74e590a5cbc6a5255f8e"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "e49b5183bd01cb27c148d3a783cec246ae755cce8f8f01453b7029ec47781892"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/ocr/tasks/extract-form-page.ts",
          "sha256": "91f0af761b3ff45a40997de0d1329218000f9047e47492a9469c3f9e449f6f55"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ocr/extract-form-page"
    },
    {
      "fingerprint": "3ea6a3eff93bd42d16103740feeab1dc77acf8b93f5b053bf698f9626b85a225",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/roster/match-spreadsheet.ts",
          "sha256": "f70a46db81f8eb355561d3714fbcbc23a2cf931670f161cdc0377a4befeae669"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "bdf71a7a45c41815cf442c10a6b525b222ad198596feb1e504b7b1b787c0e057"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "f04671bcc5ed1450618c1052ee5ce1c9afcfa386618df343e1fbc22aa0dea296"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/intake/mapping.ts",
          "sha256": "7a15e27e70f00710ccb4b6aeab64b4059e63edf007c6186de03b292cbac20a32"
        },
        {
          "path": "src/domain/intake/projection.ts",
          "sha256": "5e3e5af571237bc01090c16a7bfc095da00570b58cde0be14939490585a9dda5"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/match-confidence.ts",
          "sha256": "6d9a8a22b3f69230348ba19de873ca03f7e3570ae6f399c2348cba6ec728323b"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "25360b5b5632265af1a7d158f5399ef9d9337f2a6e3920f3c1280add8b21e577"
        },
        {
          "path": "src/domain/matching/roster-match.ts",
          "sha256": "73ff86b911571d47adf6ccf60d4f69f1ee447405cfd95890ade313f93d689e71"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "e49b5183bd01cb27c148d3a783cec246ae755cce8f8f01453b7029ec47781892"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/common/spreadsheet-grid.ts",
          "sha256": "2ad5b8423d46c88ca446e70e8450816bb38728eaa78797fab35cddd95adbf456"
        },
        {
          "path": "src/stores/roster/tasks/match-spreadsheet.ts",
          "sha256": "76a387b40d1da95e87b28eda68139ef1004be18e0907370b4b74f28551bbc971"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "a97671960ac5b84a3c05630dd2ee980e920ffcc4318a79725f381d0ed68947ea"
        }
      ],
      "id": "roster/match-spreadsheet"
    },
    {
      "fingerprint": "e43fd2752fd4c409b3fcbd06a07a191ff74c7c0ec777e323d7f6c27367311978",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "91b0a29c6826ee0f971b2bc0f22749df9dbbfe928a73b16f6f87f6af388c2666"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "1cb5e9a21bc893e7ab65e75cef2d9446a63e2d1cd9a3730490aa96df5a84c5e5"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5c6c035f82ec760a047039a38806ba03de8eefd50c2afa099d7830c8eb46234b"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "1f408efbb22eab627ffa060a32b27edfc9db692d162a55793b8aabe963db61f0"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "a131d575df83c6d7880506a218d9590ba2cdf961c8b8c59b5eb61d78b0f7c813"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/create-termination.ts",
          "sha256": "3c6917cae1f58d358fefad8ea752c6da09fe4d3a89e16e90b43458da2df8bf09"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "fa0c1ecf5218c0264984b3b2466ab3110320b9b9f12cf15657f77eedb53c9431"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/create-termination"
    },
    {
      "fingerprint": "24cd8a33f0a0e268eb9c5deb1d08ee8bfca60217d3ec91e704b210d56b20bad8",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "91b0a29c6826ee0f971b2bc0f22749df9dbbfe928a73b16f6f87f6af388c2666"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "1cb5e9a21bc893e7ab65e75cef2d9446a63e2d1cd9a3730490aa96df5a84c5e5"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5c6c035f82ec760a047039a38806ba03de8eefd50c2afa099d7830c8eb46234b"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "1f408efbb22eab627ffa060a32b27edfc9db692d162a55793b8aabe963db61f0"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "a131d575df83c6d7880506a218d9590ba2cdf961c8b8c59b5eb61d78b0f7c813"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/delete-pending-terminations.ts",
          "sha256": "c2e466b901e4c41db1350d21039151c6dd94b1858b35fc73c1612398d1267e81"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "fa0c1ecf5218c0264984b3b2466ab3110320b9b9f12cf15657f77eedb53c9431"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/delete-pending-terminations"
    },
    {
      "fingerprint": "b35e6862eebc03fe9e0a3ae3c41bef3ddf9ac399cd627e97320ae8f1e9be8e5e",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "91b0a29c6826ee0f971b2bc0f22749df9dbbfe928a73b16f6f87f6af388c2666"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "1cb5e9a21bc893e7ab65e75cef2d9446a63e2d1cd9a3730490aa96df5a84c5e5"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5c6c035f82ec760a047039a38806ba03de8eefd50c2afa099d7830c8eb46234b"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "1f408efbb22eab627ffa060a32b27edfc9db692d162a55793b8aabe963db61f0"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "a131d575df83c6d7880506a218d9590ba2cdf961c8b8c59b5eb61d78b0f7c813"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/match-existing-termination.ts",
          "sha256": "a97d8c4f16df80fd90dc2ada76e35b17554dea1cb4979d5625e6f397ebda32e1"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "fa0c1ecf5218c0264984b3b2466ab3110320b9b9f12cf15657f77eedb53c9431"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/match-existing-termination"
    },
    {
      "fingerprint": "6638f70d272b50d14bbba766873cead33b89ce72da9a0fff3e79f9f9aa91a30f",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "91b0a29c6826ee0f971b2bc0f22749df9dbbfe928a73b16f6f87f6af388c2666"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "1cb5e9a21bc893e7ab65e75cef2d9446a63e2d1cd9a3730490aa96df5a84c5e5"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5c6c035f82ec760a047039a38806ba03de8eefd50c2afa099d7830c8eb46234b"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "1f408efbb22eab627ffa060a32b27edfc9db692d162a55793b8aabe963db61f0"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "a131d575df83c6d7880506a218d9590ba2cdf961c8b8c59b5eb61d78b0f7c813"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/match-pending-terminations.ts",
          "sha256": "fdd618f2893d23e6f7abf3958129c689b87791683d931fd74ef52eeb464cc4aa"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "fa0c1ecf5218c0264984b3b2466ab3110320b9b9f12cf15657f77eedb53c9431"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/match-pending-terminations"
    },
    {
      "fingerprint": "3b94a7445213c3662d556b2a5f7114f191129bd8946862f85630a7812b4377b3",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "c1919e13f8a55f9d0d0a5a9fb530e5610e9d4892b3a84b1edf82f98fc3dd1b2a"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/read-job-summary.ts",
          "sha256": "eba28832c98731cdbfc17802dde880746ce3b5092a64492f439c8ccaa8510096"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/read-job-summary"
    },
    {
      "fingerprint": "710b55c36b4a120f91eb1f97677f8b919238ac1a0325c031f656c03195c5736e",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/search-person-org.ts",
          "sha256": "066bf3389a8e050f8774a3829651b6a3fe328cc12760bd321d12a157557fac20"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/search-person-org"
    },
    {
      "fingerprint": "4b0311063116f17ffb855c0747b7175d24e3ce84f21c1c906f4ff72a157809c9",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "43f784178a1f6690d2e9a0847b8261cd6f817da8ca7dbefd687ff823a0c02277"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/stage-pending-termination-sweep.ts",
          "sha256": "ef071b5d1f1443dcf460a6a686e353ef0623011e82523f9ff293d8aeecdb0ca2"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/stage-pending-termination-sweep"
    },
    {
      "fingerprint": "9c8e772d6e7e26dfaa7c48f3fbdbd5e78f6a3c6d70a386be4bfa823cc0077384",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-termination.ts",
          "sha256": "fd44c55fad09e93f22d1e17f0fc425f6726a952c3a7687006b78acf20d2c1fa0"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/stage-termination.ts",
          "sha256": "e0af6fdde85fa9ca046d6a000e25cf7fa7c014ae3ac27ea942e087d16fb781fe"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/stage-termination"
    },
    {
      "fingerprint": "bf8987c1f7aebe960d6cf95686b02e965207777c7ee8f9e862a932b01506ae27",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "91b0a29c6826ee0f971b2bc0f22749df9dbbfe928a73b16f6f87f6af388c2666"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "1cb5e9a21bc893e7ab65e75cef2d9446a63e2d1cd9a3730490aa96df5a84c5e5"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5c6c035f82ec760a047039a38806ba03de8eefd50c2afa099d7830c8eb46234b"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "1f408efbb22eab627ffa060a32b27edfc9db692d162a55793b8aabe963db61f0"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/ucpath/verify-pending-terminations-cleared.ts",
          "sha256": "1bb597188eef26f75d7d69316e6ea2e6d5f3a43e31311f0234a9a150c7d47704"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "a131d575df83c6d7880506a218d9590ba2cdf961c8b8c59b5eb61d78b0f7c813"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/verify-pending-terminations-cleared.ts",
          "sha256": "64282670b5e9be55889ede2be10d4d09a74022acb31422859dd3d2b180e4038e"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "fa0c1ecf5218c0264984b3b2466ab3110320b9b9f12cf15657f77eedb53c9431"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/verify-pending-terminations-cleared"
    },
    {
      "fingerprint": "221bdc5f0fce1f7c715c08f054eac5ad1c77c51608f9698f70015bd87ed77dd3",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "8d67673ca3be462b2358aa256139f3d27c0801bf4e5c579f9edfec6f1733a7e3"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "c463d8765c86b231a2425339d6e9dc9cad601a13cc3cf6d7769f5c8771299bf2"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "e8aa4c0f6b4ffc32e3b8b85d404dc25fbba6ea9369401fac0fc20d54a05f296c"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "91b0a29c6826ee0f971b2bc0f22749df9dbbfe928a73b16f6f87f6af388c2666"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "1cb5e9a21bc893e7ab65e75cef2d9446a63e2d1cd9a3730490aa96df5a84c5e5"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5c6c035f82ec760a047039a38806ba03de8eefd50c2afa099d7830c8eb46234b"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "1f408efbb22eab627ffa060a32b27edfc9db692d162a55793b8aabe963db61f0"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/ucpath/verify-termination.ts",
          "sha256": "6b9f5fe86ebddbca9d52b77623e4cf53b86765a3bd5b7bb46f9b6f7564be8d2b"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "d48be467dfa66a7725a7706c00bed7a1df224f9642feffc11184bfc9248b9fba"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "6c0f000bfb7a1e81a5cb1e951eed0cdd0b7f51b2eb38fbf3b30b37fef759ed07"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "c53af126d52e06544c683ad0af45f459c96821e148420effef87964186ccec90"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "e7cb425b4191e437878250677c590c9f588d598e9eea3f1438cad8bd7c64566e"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "8aa13e47594683cd4ceb15b47e839d8ca012fabffe5f901146650a4a76f4a011"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "a131d575df83c6d7880506a218d9590ba2cdf961c8b8c59b5eb61d78b0f7c813"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "40591c399e30f7f91fac589e04cefa40b879a98fb7bd43eb3e3472eea2d0d6eb"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "d6b47365ce8b734d103385b2d700f7f363c71849c3dbd7e488926ef288483fb9"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "301ce4e63c48c8d464b2454be5dee3d16254a05315aca28bb6edc4820f1c930b"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "251f1643453b6d373758f186fae644dd8338c556f4c6288e2d09a719039b0098"
        },
        {
          "path": "src/stores/ucpath/tasks/verify-termination.ts",
          "sha256": "ce246d5bc2c5c5e2c3eb1279cffc6c7783e5ce66f26c21d8b3bba18c792c8a43"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "fa0c1ecf5218c0264984b3b2466ab3110320b9b9f12cf15657f77eedb53c9431"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/verify-termination"
    },
    {
      "fingerprint": "ec796a2eb38b4e0a565e91e11d96e4bd7b4f4c5eaeccbc49a270f076610c1988",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "a258963c198dd0284e29c8c733897c891b9f3a6fada25eb49cc48f37e3887bb3"
        },
        {
          "path": "src/domain/contracts/person-lookup/read-active-status.ts",
          "sha256": "b7087817e1d96092ebc8ece8ff6b8a0ddf57ff067c7e599f5fc96dae4cc370d7"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/person-lookup/tasks/read-active-status.ts",
          "sha256": "e43018f575b623f3c44fd1e3306e879139865fb33b2a209390df76d213ceb3b2"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "workflow:person-lookup/read-active-status"
    },
    {
      "fingerprint": "31856fdbbe116e1574336593b8f29b1c3e4328f7773561682ea0a66b233fe194",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "7292ff9035806a885d70b992d4e9abbda6fa0a746f1e2e81aebfaeab4eb50bcf"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "25360b5b5632265af1a7d158f5399ef9d9337f2a6e3920f3c1280add8b21e577"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "7bb482e51bab10e44b95187e54e99bc40d4957f72ca25b3c77fce04a58e4409f"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "b5f0aa03957ce1b889416ee971cf0e9d4e7e1d08657613231b33d7a62b099bf9"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/separations/tasks/match-identity.ts",
          "sha256": "ce38e458f9e93000469d8c646067b87822abaf8b9410f3fc551f10dc97a0b924"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "workflow:separations/match-identity"
    },
    {
      "fingerprint": "d42cc056801bbb9ac22295a0c15735a3b7e2675fa30bcfbef9c040a341386ef2",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-termination-type.ts",
          "sha256": "e7791dc398d44b3271adca0a15d5a973e36c5305c44423bff60255f5cbadad0e"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "162a172789595c9974885b371ea6e2ea305b6106650ae6a694dc68eebc88a8e3"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "cee2181b327d03299b78df06e233fbd6ad87929a6ddb84583c8d143a5c00c7c4"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/separations/tasks/match-termination-type.ts",
          "sha256": "6cb79cda9e89b88c175c43da6f9dff40b9a5c5b695a49d59ecead0aa81d48092"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "workflow:separations/match-termination-type"
    },
    {
      "fingerprint": "22effe270eb3938240c62472018408d44ebb840f3d08ea9517a375ad01c3a1f1",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "eccf6455d192541e66dfebcd9b22b678370e58fa59df8062ffe7cc6ff3c876e2"
        },
        {
          "path": "src/domain/artifacts.ts",
          "sha256": "5c16b212bcfccb56b6eb9a4be9e2037adb9af155e627c82915a2f2c8e898fabb"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "c3da673bb88832cad9f5645037bf03b536a404c0e6a2ab5c555220ebeeb5c40b"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "e4e4b726d6034ad9a4d3f1f1e6f488868520d7ff18fb4776d141ee9bd9fce5f5"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "77f432dc92d89aa2921158dfc341d1449766c5eea08d16f91a591a7fe45357ea"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "9dcb9cf4e188f05fdc64e82c4a4e7c8bab18ec91355d66d718581040c1ae881a"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "25360b5b5632265af1a7d158f5399ef9d9337f2a6e3920f3c1280add8b21e577"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "c843923d15f4ea4730f458faf53da92c2c732b8ce9cdd69431089e62b84a3899"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "80b28527add643e9520ad47f4f2e98b6737451f73f2712d6185c5e8f5ca35394"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "39f481fde372cac95ca154c4a56396e5d8f35e3a1611ccc7ecf55e98faabbdb7"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "b40363ce7b11193964b1fea1cb0a4459dc305d9623ed6a728bfde4307a74730a"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "7bb482e51bab10e44b95187e54e99bc40d4957f72ca25b3c77fce04a58e4409f"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "b5f0aa03957ce1b889416ee971cf0e9d4e7e1d08657613231b33d7a62b099bf9"
        },
        {
          "path": "src/domain/session.ts",
          "sha256": "0c9a7ec1c680518b49c6de6e03975f03932aece4eb8c12f304928e5c72f6499b"
        },
        {
          "path": "src/domain/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/domain/task-provenance.ts",
          "sha256": "7592360b7b1b52bf65f654b26f66444bd230710e037154a5da6333dbaf82793d"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "1bec68004adb73eda4de737854a1ab032395fad101930fe640cf27134b855022"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "7bce5ef2a46f85b6ef55c8f4efbb1fa5157693660011cbe3e61a56e0ffd81aae"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "fc228f48b1cd04ebdd50e69e9846c54289924f26327deb69961235b7997d5a62"
        },
        {
          "path": "src/stores/separations/tasks/verify-identity-approval.ts",
          "sha256": "5e036c0ef9bc5b4e3db2dfae3dfa165a5c5bd894bcce69054cbda43188fbf0f1"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "workflow:separations/verify-identity-approval"
    }
  ]
} as const;
