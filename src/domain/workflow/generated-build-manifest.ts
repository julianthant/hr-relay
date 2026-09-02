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
      "fingerprint": "c4e877f567ccbb567536c544502f5d95ce3a35597bc4794cebe4944c676d0f27",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "ecfebb3b8812283d1da105da7f2633139a7bdc296939a5bc7790a200a8bcd752"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "sha256": "9b10295b3b33a56c50ca3f179b3a56d71141a6ad90477f984b75759839e63044"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "4b7c954dbc4d878a7f0e1a6fa2eb8427dedb16f1c4dd39e5234132a90c6c26ba"
        },
        {
          "path": "src/domain/contracts/person-lookup/read-active-status.ts",
          "sha256": "f5de0bd85c4003781b84f616cc45a6b3c4e3d2c8df18acf2ce9030ed6601d000"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "dc99a590fb4c0d90982b368c3abbdcbd65fcbc86a4c22911cc205191456d2b6e"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "bdd4477136f6dbc5b31fe63809ec1009983a307e78dc658f15e1303d0340ddc7"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "2dd7a653d031f17c9ece8a94287c9212da9be96ad906e3a46f246b31d52c66b4"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "af5ec5480b764409e75b3f6cc249f75e689e2030f04bf9a244e0f68915009279"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "e247c8d94aabc266766e10627c2bc9ded6161d3f62d865060df63d2d0ff5ca30"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "2d62f6af877bed5baf39aeccfca6af97813d4d9b9354c5030ea949d9ef529319"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/workflows/person-lookup/descriptor.ts",
          "sha256": "b091cb8b494643c5d9287e3c2d6c7b4f8c87bc681b75a074ad1468d7692772b2"
        }
      ],
      "id": "person-lookup"
    },
    {
      "fingerprint": "ea47a1839f9d3bb89509962217203663d9e1ff422847d3abb8217723949bd417",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "ecfebb3b8812283d1da105da7f2633139a7bdc296939a5bc7790a200a8bcd752"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "d909b1be2c5e1f8743f4ad5dba5192b65183b54588cd625030c7de314407f98e"
        },
        {
          "path": "src/domain/contracts/kuali/save-separation-finalization.ts",
          "sha256": "fae33a72d2258a6d5f171af4789049c3ee37b7a6c75ee3aacccbb9f2e25f99e5"
        },
        {
          "path": "src/domain/contracts/kuali/search-separation-action.ts",
          "sha256": "ddf180d3b70e34ccfea12764bf2385d2522050a9e62c91fcd36f3cbd9d22465b"
        },
        {
          "path": "src/domain/contracts/kuali/stage-separation-finalization.ts",
          "sha256": "63d1de26e2e9c0d9f0b8debb7dbafe8d93eed3230cfae39e270f755098c9965b"
        },
        {
          "path": "src/domain/contracts/new-kronos/read-separation-timecard.ts",
          "sha256": "2cbb47661f5396c30cf09ac3569a1865cd20a86fddeda49e5003d0034bbe04df"
        },
        {
          "path": "src/domain/contracts/new-kronos/search-employee.ts",
          "sha256": "9d75cb50b3157edb07f11837943cc27309195629ce088b79488bb7988b872f00"
        },
        {
          "path": "src/domain/contracts/separations/match-active-employment.ts",
          "sha256": "bf8779778c4f66849aa8d5240d2f829090b853bb9594d716b6a7d87b603ff5af"
        },
        {
          "path": "src/domain/contracts/separations/match-department-option.ts",
          "sha256": "669f32766a8b55a71ebb50d6980f60ff4762d71a3c9fc1a5e5c3bc71566d6be5"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "6397ee718073f6edf0caa1c63ba32bb3fe615a7326164667ff4873d95cb66c4c"
        },
        {
          "path": "src/domain/contracts/separations/match-separation-subject.ts",
          "sha256": "4ee6e1f97f993c7ac4dc087d73a29091798851f63b1c349f2dd3af0a3e6e6596"
        },
        {
          "path": "src/domain/contracts/separations/match-termination-type.ts",
          "sha256": "db1923e232b77b505ae7b88d11c336490f719c30efb989da7e27b3cc6c8d84be"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-dates.ts",
          "sha256": "42ac66d26bc36718ed7265b103ec3e40b3e68b44b53d4c02669d3eea1f2b99f7"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-plan.ts",
          "sha256": "57c85049f82a4f32715458d2bee0bae450deed7be68843e2a85212cf5708fb03"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "95115b226bfa8fa535776f1b6695f70a51bad3c884c7d3c4e74dbdafba10bffc"
        },
        {
          "path": "src/domain/contracts/separations/verify-termination-receipt.ts",
          "sha256": "ea8af3da5c4e89507c1f2bca65434cba2278c9ca77a4de4dc1059b038e99c94d"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "26bab195012b72f86bd63a0512e6313b6f90df7553206798cbb5df8e701be226"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "98146527567a84ec50bf0696e71eada17ce6d56fed4a220a70414a49f12126fb"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "35b45912bed43b7b2f1361669574ae74413ba0c35e4976a9e5adfc58bddb6650"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "8b6280b4580ee562426dec821ad414b128dcce564296fd594f38bde3cd9670da"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-termination.ts",
          "sha256": "690c4bef38cfe52ce875203c27eb0bfb0a76ef6764b1019e58080d1c30f3aa7f"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "1832994b571082e94cadf3a61aef6ef8a670f5bb9022130be3c4d88380ff9e61"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "2dd7a653d031f17c9ece8a94287c9212da9be96ad906e3a46f246b31d52c66b4"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/department-option.ts",
          "sha256": "948b77621d7d7ac4c8adbd7379c324895ce50a7d19064ae1a6f14da272b967b8"
        },
        {
          "path": "src/domain/separations/employment-selection.ts",
          "sha256": "040b045b731d729545091c66044cb5ecc5bbeecb2b3b5a043b02e381d4203f72"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "daa28b605a59b08ba101f07569cf49b248614a4fa5d872e3bea5c7a5db802322"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "1659c2203d8bc5bbdd21c1b130ee869b3224689942fb990ef7e06cd9dbae492e"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "ec90161f322b4e06801448847520c3f2c92387c9374e89a263f491994af7da01"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "90c87aa616aa5d2183f0cf149a3da5494e4b485d1cb4a96a58eac65a0dde679c"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "b02284b61f40371150a7dfe260057f0a51a53e66c88744b0caccc74279ffc693"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "6b6fc1283cd98ef3e2a3450b1a31da66a20b54fd3fc71552de6b9ccb2513b594"
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
          "sha256": "49b728a8ef90f7bb8b8c7fc394a713073736928842b89d1f236efa5b22aece82"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "a49a456be6a6383d0a79a0444968d74874cfcd30b1bb67a16e304af0f975bb14"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/ui/new-kronos-timecard.ts",
          "sha256": "b9dffbe575a4e9999ee9d9179ba3c108b641f511bc6343153969033a5598b832"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "af5ec5480b764409e75b3f6cc249f75e689e2030f04bf9a244e0f68915009279"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "e247c8d94aabc266766e10627c2bc9ded6161d3f62d865060df63d2d0ff5ca30"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "2d62f6af877bed5baf39aeccfca6af97813d4d9b9354c5030ea949d9ef529319"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/workflows/separations/descriptor.ts",
          "sha256": "ad4efe53ae05909d4001a84ee74f524b1c4e859bbb8029a7da527669dcdd234e"
        },
        {
          "path": "src/workflows/separations/identity-check/node-ids.ts",
          "sha256": "25343dc8269bcd06d460a19f0ee6cbb7d38a4d4d15bb10cf5bf249c6d9158212"
        },
        {
          "path": "src/workflows/separations/identity-check/nodes.ts",
          "sha256": "e91e11d39c21f453733e0f9ba6696213bd1b21707ae8ec98d29dc7c9dd4a91c7"
        },
        {
          "path": "src/workflows/separations/identity-check/step.ts",
          "sha256": "e473a141b4d5f16ea89add578d48cb0b313d5ab37ac376d889ac1ac9a8923218"
        },
        {
          "path": "src/workflows/separations/job-summary/node-ids.ts",
          "sha256": "a6eebfc7749666fe0506139f87f044f080f31a26606884ebabe591207ab79ec9"
        },
        {
          "path": "src/workflows/separations/job-summary/nodes.ts",
          "sha256": "9bd042694c95767708e93c98fe03c7dbfe86b5544131ff3c6c7a4703df2aeada"
        },
        {
          "path": "src/workflows/separations/job-summary/step.ts",
          "sha256": "47379e21ab52901f3496c7a41724e73fc79cbc276a7e3c9407e63344c04cfbb6"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/node-ids.ts",
          "sha256": "165bc94ebb4ce3b6f49ee478a4c0867c2c5db0b589ceffef72ca9a91d14cd781"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/nodes.ts",
          "sha256": "7d600e2185e4936c734e70746823e2611e30dc09baa905e8b65377fccb38ba2b"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/omission.ts",
          "sha256": "73a9fe2bceeee1841f791d532a6193316fc314d4ee43ccfdab301ab6fa2e7639"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/step.ts",
          "sha256": "18dfd153e0a0b1dd62d053f955d61ae5fe1be35263e3a8cac39ced8de6ce8766"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/node-ids.ts",
          "sha256": "210c6edff6fc77b1a8c5e346bce2711913d8bbfe2b98b80267eecfad7293008e"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/nodes.ts",
          "sha256": "731d65a8e9630eb2cd536c83abaa9a8875002da2228a8258621bf18763787a42"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/step.ts",
          "sha256": "e3c3dbf33f0576db7c44d94436c8d8c41097211639cf8ccfa14ccde0708657ec"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/node-ids.ts",
          "sha256": "b97a476af2005ee1218327077913d2a84af656ddfcc7e928b55daf5de7d6417a"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/nodes.ts",
          "sha256": "8f2ec59b72e8510e7cadbd25ee0c59fc8bc48a4dd62051ce69d789ee7b0b2bc0"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/omission.ts",
          "sha256": "9e5e4e74d43b3a7b78db1d554e481aa7b538209092bc16267c4ece410103ceab"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/step.ts",
          "sha256": "d1271d8919a4b6ae5ef040686e040f9a825ff5c8138abbab560e64901db75302"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/node-ids.ts",
          "sha256": "62ad7c70ffbf39aee32e52f512303dcf6d2912b7f5cccd2b2d0b30940ded2e3a"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/nodes.ts",
          "sha256": "be6f0725a8f5ffab435089dc0becfbb42dab89287f2669ff06965fbdd9e7ab96"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/omission.ts",
          "sha256": "9e66c24ca8a73199442cb4218556c877793155d3082e946a663b64854f5181bf"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/step.ts",
          "sha256": "d87840f4fa594d28f524491a17a108cd351fc664966c34848c8820639f97e067"
        }
      ],
      "id": "separations"
    },
    {
      "fingerprint": "ae514fe8618a4eab2e0ce241897644ff01f4f1cfa1bb28386cbb45bfd5f68366",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "ecfebb3b8812283d1da105da7f2633139a7bdc296939a5bc7790a200a8bcd752"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "path": "src/domain/contracts/separations/match-active-employment.ts",
          "sha256": "bf8779778c4f66849aa8d5240d2f829090b853bb9594d716b6a7d87b603ff5af"
        },
        {
          "path": "src/domain/contracts/separations/match-department-option.ts",
          "sha256": "669f32766a8b55a71ebb50d6980f60ff4762d71a3c9fc1a5e5c3bc71566d6be5"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "6397ee718073f6edf0caa1c63ba32bb3fe615a7326164667ff4873d95cb66c4c"
        },
        {
          "path": "src/domain/contracts/separations/match-separation-subject.ts",
          "sha256": "4ee6e1f97f993c7ac4dc087d73a29091798851f63b1c349f2dd3af0a3e6e6596"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "95115b226bfa8fa535776f1b6695f70a51bad3c884c7d3c4e74dbdafba10bffc"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "35b45912bed43b7b2f1361669574ae74413ba0c35e4976a9e5adfc58bddb6650"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
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
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "2dd7a653d031f17c9ece8a94287c9212da9be96ad906e3a46f246b31d52c66b4"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/department-option.ts",
          "sha256": "948b77621d7d7ac4c8adbd7379c324895ce50a7d19064ae1a6f14da272b967b8"
        },
        {
          "path": "src/domain/separations/employment-selection.ts",
          "sha256": "040b045b731d729545091c66044cb5ecc5bbeecb2b3b5a043b02e381d4203f72"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "daa28b605a59b08ba101f07569cf49b248614a4fa5d872e3bea5c7a5db802322"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "1659c2203d8bc5bbdd21c1b130ee869b3224689942fb990ef7e06cd9dbae492e"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "90c87aa616aa5d2183f0cf149a3da5494e4b485d1cb4a96a58eac65a0dde679c"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "6b6fc1283cd98ef3e2a3450b1a31da66a20b54fd3fc71552de6b9ccb2513b594"
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
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "af5ec5480b764409e75b3f6cc249f75e689e2030f04bf9a244e0f68915009279"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "e247c8d94aabc266766e10627c2bc9ded6161d3f62d865060df63d2d0ff5ca30"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "2d62f6af877bed5baf39aeccfca6af97813d4d9b9354c5030ea949d9ef529319"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/workflows/separations/identity-check/descriptor.ts",
          "sha256": "634a36d559839dc9670c2ebf67dde2029210233da13b9fca67a04bd1d201cd33"
        },
        {
          "path": "src/workflows/separations/identity-check/node-ids.ts",
          "sha256": "25343dc8269bcd06d460a19f0ee6cbb7d38a4d4d15bb10cf5bf249c6d9158212"
        },
        {
          "path": "src/workflows/separations/identity-check/nodes.ts",
          "sha256": "e91e11d39c21f453733e0f9ba6696213bd1b21707ae8ec98d29dc7c9dd4a91c7"
        },
        {
          "path": "src/workflows/separations/identity-check/step.ts",
          "sha256": "e473a141b4d5f16ea89add578d48cb0b313d5ab37ac376d889ac1ac9a8923218"
        },
        {
          "path": "src/workflows/separations/job-summary/node-ids.ts",
          "sha256": "a6eebfc7749666fe0506139f87f044f080f31a26606884ebabe591207ab79ec9"
        },
        {
          "path": "src/workflows/separations/job-summary/nodes.ts",
          "sha256": "9bd042694c95767708e93c98fe03c7dbfe86b5544131ff3c6c7a4703df2aeada"
        },
        {
          "path": "src/workflows/separations/job-summary/step.ts",
          "sha256": "47379e21ab52901f3496c7a41724e73fc79cbc276a7e3c9407e63344c04cfbb6"
        }
      ],
      "id": "separations-identity-check"
    },
    {
      "fingerprint": "f630b5eda9f121687d44aae6b326eaa22c644b98312f6c6afb0c52124f622620",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "ecfebb3b8812283d1da105da7f2633139a7bdc296939a5bc7790a200a8bcd752"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "sha256": "2cbb47661f5396c30cf09ac3569a1865cd20a86fddeda49e5003d0034bbe04df"
        },
        {
          "path": "src/domain/contracts/new-kronos/search-employee.ts",
          "sha256": "9d75cb50b3157edb07f11837943cc27309195629ce088b79488bb7988b872f00"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-dates.ts",
          "sha256": "42ac66d26bc36718ed7265b103ec3e40b3e68b44b53d4c02669d3eea1f2b99f7"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-plan.ts",
          "sha256": "57c85049f82a4f32715458d2bee0bae450deed7be68843e2a85212cf5708fb03"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "dc99a590fb4c0d90982b368c3abbdcbd65fcbc86a4c22911cc205191456d2b6e"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "bdd4477136f6dbc5b31fe63809ec1009983a307e78dc658f15e1303d0340ddc7"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "1832994b571082e94cadf3a61aef6ef8a670f5bb9022130be3c4d88380ff9e61"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "2dd7a653d031f17c9ece8a94287c9212da9be96ad906e3a46f246b31d52c66b4"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "ec90161f322b4e06801448847520c3f2c92387c9374e89a263f491994af7da01"
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
          "sha256": "49b728a8ef90f7bb8b8c7fc394a713073736928842b89d1f236efa5b22aece82"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/new-kronos-timecard.ts",
          "sha256": "b9dffbe575a4e9999ee9d9179ba3c108b641f511bc6343153969033a5598b832"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "af5ec5480b764409e75b3f6cc249f75e689e2030f04bf9a244e0f68915009279"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "e247c8d94aabc266766e10627c2bc9ded6161d3f62d865060df63d2d0ff5ca30"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "2d62f6af877bed5baf39aeccfca6af97813d4d9b9354c5030ea949d9ef529319"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/descriptor.ts",
          "sha256": "7e20b5c7c2e1559f1ddbe0b750d21ecc16f760a8556086db0015bcdf21ff0555"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/node-ids.ts",
          "sha256": "165bc94ebb4ce3b6f49ee478a4c0867c2c5db0b589ceffef72ca9a91d14cd781"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/nodes.ts",
          "sha256": "7d600e2185e4936c734e70746823e2611e30dc09baa905e8b65377fccb38ba2b"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/omission.ts",
          "sha256": "73a9fe2bceeee1841f791d532a6193316fc314d4ee43ccfdab301ab6fa2e7639"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/step.ts",
          "sha256": "18dfd153e0a0b1dd62d053f955d61ae5fe1be35263e3a8cac39ced8de6ce8766"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/node-ids.ts",
          "sha256": "210c6edff6fc77b1a8c5e346bce2711913d8bbfe2b98b80267eecfad7293008e"
        }
      ],
      "id": "separations-kronos-timecard"
    },
    {
      "fingerprint": "7278bde6c518a3e7e782099db9b8dd3367f597f79528062eb9a4bc495aaffbcf",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "ecfebb3b8812283d1da105da7f2633139a7bdc296939a5bc7790a200a8bcd752"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/save-separation-finalization.ts",
          "sha256": "fae33a72d2258a6d5f171af4789049c3ee37b7a6c75ee3aacccbb9f2e25f99e5"
        },
        {
          "path": "src/domain/contracts/kuali/stage-separation-finalization.ts",
          "sha256": "63d1de26e2e9c0d9f0b8debb7dbafe8d93eed3230cfae39e270f755098c9965b"
        },
        {
          "path": "src/domain/contracts/separations/match-active-employment.ts",
          "sha256": "bf8779778c4f66849aa8d5240d2f829090b853bb9594d716b6a7d87b603ff5af"
        },
        {
          "path": "src/domain/contracts/separations/match-department-option.ts",
          "sha256": "669f32766a8b55a71ebb50d6980f60ff4762d71a3c9fc1a5e5c3bc71566d6be5"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "6397ee718073f6edf0caa1c63ba32bb3fe615a7326164667ff4873d95cb66c4c"
        },
        {
          "path": "src/domain/contracts/separations/match-separation-subject.ts",
          "sha256": "4ee6e1f97f993c7ac4dc087d73a29091798851f63b1c349f2dd3af0a3e6e6596"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "95115b226bfa8fa535776f1b6695f70a51bad3c884c7d3c4e74dbdafba10bffc"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "35b45912bed43b7b2f1361669574ae74413ba0c35e4976a9e5adfc58bddb6650"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
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
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "2dd7a653d031f17c9ece8a94287c9212da9be96ad906e3a46f246b31d52c66b4"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/department-option.ts",
          "sha256": "948b77621d7d7ac4c8adbd7379c324895ce50a7d19064ae1a6f14da272b967b8"
        },
        {
          "path": "src/domain/separations/employment-selection.ts",
          "sha256": "040b045b731d729545091c66044cb5ecc5bbeecb2b3b5a043b02e381d4203f72"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "daa28b605a59b08ba101f07569cf49b248614a4fa5d872e3bea5c7a5db802322"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "1659c2203d8bc5bbdd21c1b130ee869b3224689942fb990ef7e06cd9dbae492e"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "90c87aa616aa5d2183f0cf149a3da5494e4b485d1cb4a96a58eac65a0dde679c"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "6b6fc1283cd98ef3e2a3450b1a31da66a20b54fd3fc71552de6b9ccb2513b594"
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
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "a49a456be6a6383d0a79a0444968d74874cfcd30b1bb67a16e304af0f975bb14"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "af5ec5480b764409e75b3f6cc249f75e689e2030f04bf9a244e0f68915009279"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "e247c8d94aabc266766e10627c2bc9ded6161d3f62d865060df63d2d0ff5ca30"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "2d62f6af877bed5baf39aeccfca6af97813d4d9b9354c5030ea949d9ef529319"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/workflows/separations/identity-check/node-ids.ts",
          "sha256": "25343dc8269bcd06d460a19f0ee6cbb7d38a4d4d15bb10cf5bf249c6d9158212"
        },
        {
          "path": "src/workflows/separations/identity-check/nodes.ts",
          "sha256": "e91e11d39c21f453733e0f9ba6696213bd1b21707ae8ec98d29dc7c9dd4a91c7"
        },
        {
          "path": "src/workflows/separations/identity-check/step.ts",
          "sha256": "e473a141b4d5f16ea89add578d48cb0b313d5ab37ac376d889ac1ac9a8923218"
        },
        {
          "path": "src/workflows/separations/job-summary/node-ids.ts",
          "sha256": "a6eebfc7749666fe0506139f87f044f080f31a26606884ebabe591207ab79ec9"
        },
        {
          "path": "src/workflows/separations/job-summary/nodes.ts",
          "sha256": "9bd042694c95767708e93c98fe03c7dbfe86b5544131ff3c6c7a4703df2aeada"
        },
        {
          "path": "src/workflows/separations/job-summary/step.ts",
          "sha256": "47379e21ab52901f3496c7a41724e73fc79cbc276a7e3c9407e63344c04cfbb6"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/descriptor.ts",
          "sha256": "e1b9b976caa2081d263397a2ccc1da4fb0f69a8d1d74a23fcb34cdcab5ed0224"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/node-ids.ts",
          "sha256": "b97a476af2005ee1218327077913d2a84af656ddfcc7e928b55daf5de7d6417a"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/nodes.ts",
          "sha256": "8f2ec59b72e8510e7cadbd25ee0c59fc8bc48a4dd62051ce69d789ee7b0b2bc0"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/omission.ts",
          "sha256": "9e5e4e74d43b3a7b78db1d554e481aa7b538209092bc16267c4ece410103ceab"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/step.ts",
          "sha256": "d1271d8919a4b6ae5ef040686e040f9a825ff5c8138abbab560e64901db75302"
        }
      ],
      "id": "separations-kuali-finalization"
    },
    {
      "fingerprint": "b2778fa05492d39988642776210647c0ace95be9ca620787da99f8dc86974abc",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "ecfebb3b8812283d1da105da7f2633139a7bdc296939a5bc7790a200a8bcd752"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "sha256": "d909b1be2c5e1f8743f4ad5dba5192b65183b54588cd625030c7de314407f98e"
        },
        {
          "path": "src/domain/contracts/kuali/search-separation-action.ts",
          "sha256": "ddf180d3b70e34ccfea12764bf2385d2522050a9e62c91fcd36f3cbd9d22465b"
        },
        {
          "path": "src/domain/contracts/separations/match-termination-type.ts",
          "sha256": "db1923e232b77b505ae7b88d11c336490f719c30efb989da7e27b3cc6c8d84be"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-plan.ts",
          "sha256": "57c85049f82a4f32715458d2bee0bae450deed7be68843e2a85212cf5708fb03"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "2dd7a653d031f17c9ece8a94287c9212da9be96ad906e3a46f246b31d52c66b4"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "ec90161f322b4e06801448847520c3f2c92387c9374e89a263f491994af7da01"
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
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "af5ec5480b764409e75b3f6cc249f75e689e2030f04bf9a244e0f68915009279"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "e247c8d94aabc266766e10627c2bc9ded6161d3f62d865060df63d2d0ff5ca30"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "2d62f6af877bed5baf39aeccfca6af97813d4d9b9354c5030ea949d9ef529319"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/descriptor.ts",
          "sha256": "e4ef5279311215498b4c5814c8c16b34260b0ee361afab6fdf2304d5b127a09b"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/node-ids.ts",
          "sha256": "210c6edff6fc77b1a8c5e346bce2711913d8bbfe2b98b80267eecfad7293008e"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/nodes.ts",
          "sha256": "731d65a8e9630eb2cd536c83abaa9a8875002da2228a8258621bf18763787a42"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/step.ts",
          "sha256": "e3c3dbf33f0576db7c44d94436c8d8c41097211639cf8ccfa14ccde0708657ec"
        }
      ],
      "id": "separations-kuali-read"
    },
    {
      "fingerprint": "1d5f26e251a643759d8d5e83d85c22c98ffcffc0ce3f73059328482db63586a1",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "ecfebb3b8812283d1da105da7f2633139a7bdc296939a5bc7790a200a8bcd752"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "d909b1be2c5e1f8743f4ad5dba5192b65183b54588cd625030c7de314407f98e"
        },
        {
          "path": "src/domain/contracts/kuali/search-separation-action.ts",
          "sha256": "ddf180d3b70e34ccfea12764bf2385d2522050a9e62c91fcd36f3cbd9d22465b"
        },
        {
          "path": "src/domain/contracts/separations/match-active-employment.ts",
          "sha256": "bf8779778c4f66849aa8d5240d2f829090b853bb9594d716b6a7d87b603ff5af"
        },
        {
          "path": "src/domain/contracts/separations/match-department-option.ts",
          "sha256": "669f32766a8b55a71ebb50d6980f60ff4762d71a3c9fc1a5e5c3bc71566d6be5"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "6397ee718073f6edf0caa1c63ba32bb3fe615a7326164667ff4873d95cb66c4c"
        },
        {
          "path": "src/domain/contracts/separations/match-separation-subject.ts",
          "sha256": "4ee6e1f97f993c7ac4dc087d73a29091798851f63b1c349f2dd3af0a3e6e6596"
        },
        {
          "path": "src/domain/contracts/separations/match-termination-type.ts",
          "sha256": "db1923e232b77b505ae7b88d11c336490f719c30efb989da7e27b3cc6c8d84be"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-dates.ts",
          "sha256": "42ac66d26bc36718ed7265b103ec3e40b3e68b44b53d4c02669d3eea1f2b99f7"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-plan.ts",
          "sha256": "57c85049f82a4f32715458d2bee0bae450deed7be68843e2a85212cf5708fb03"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "95115b226bfa8fa535776f1b6695f70a51bad3c884c7d3c4e74dbdafba10bffc"
        },
        {
          "path": "src/domain/contracts/separations/verify-termination-receipt.ts",
          "sha256": "ea8af3da5c4e89507c1f2bca65434cba2278c9ca77a4de4dc1059b038e99c94d"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "26bab195012b72f86bd63a0512e6313b6f90df7553206798cbb5df8e701be226"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "98146527567a84ec50bf0696e71eada17ce6d56fed4a220a70414a49f12126fb"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "35b45912bed43b7b2f1361669574ae74413ba0c35e4976a9e5adfc58bddb6650"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "8b6280b4580ee562426dec821ad414b128dcce564296fd594f38bde3cd9670da"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-termination.ts",
          "sha256": "690c4bef38cfe52ce875203c27eb0bfb0a76ef6764b1019e58080d1c30f3aa7f"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "1832994b571082e94cadf3a61aef6ef8a670f5bb9022130be3c4d88380ff9e61"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "2dd7a653d031f17c9ece8a94287c9212da9be96ad906e3a46f246b31d52c66b4"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/department-option.ts",
          "sha256": "948b77621d7d7ac4c8adbd7379c324895ce50a7d19064ae1a6f14da272b967b8"
        },
        {
          "path": "src/domain/separations/employment-selection.ts",
          "sha256": "040b045b731d729545091c66044cb5ecc5bbeecb2b3b5a043b02e381d4203f72"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "daa28b605a59b08ba101f07569cf49b248614a4fa5d872e3bea5c7a5db802322"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "1659c2203d8bc5bbdd21c1b130ee869b3224689942fb990ef7e06cd9dbae492e"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "ec90161f322b4e06801448847520c3f2c92387c9374e89a263f491994af7da01"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "90c87aa616aa5d2183f0cf149a3da5494e4b485d1cb4a96a58eac65a0dde679c"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "b02284b61f40371150a7dfe260057f0a51a53e66c88744b0caccc74279ffc693"
        },
        {
          "path": "src/domain/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "6b6fc1283cd98ef3e2a3450b1a31da66a20b54fd3fc71552de6b9ccb2513b594"
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
          "sha256": "49b728a8ef90f7bb8b8c7fc394a713073736928842b89d1f236efa5b22aece82"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "af5ec5480b764409e75b3f6cc249f75e689e2030f04bf9a244e0f68915009279"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/completion.ts",
          "sha256": "e247c8d94aabc266766e10627c2bc9ded6161d3f62d865060df63d2d0ff5ca30"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "2d62f6af877bed5baf39aeccfca6af97813d4d9b9354c5030ea949d9ef529319"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/workflows/separations/identity-check/node-ids.ts",
          "sha256": "25343dc8269bcd06d460a19f0ee6cbb7d38a4d4d15bb10cf5bf249c6d9158212"
        },
        {
          "path": "src/workflows/separations/identity-check/nodes.ts",
          "sha256": "e91e11d39c21f453733e0f9ba6696213bd1b21707ae8ec98d29dc7c9dd4a91c7"
        },
        {
          "path": "src/workflows/separations/identity-check/step.ts",
          "sha256": "e473a141b4d5f16ea89add578d48cb0b313d5ab37ac376d889ac1ac9a8923218"
        },
        {
          "path": "src/workflows/separations/job-summary/node-ids.ts",
          "sha256": "a6eebfc7749666fe0506139f87f044f080f31a26606884ebabe591207ab79ec9"
        },
        {
          "path": "src/workflows/separations/job-summary/nodes.ts",
          "sha256": "9bd042694c95767708e93c98fe03c7dbfe86b5544131ff3c6c7a4703df2aeada"
        },
        {
          "path": "src/workflows/separations/job-summary/step.ts",
          "sha256": "47379e21ab52901f3496c7a41724e73fc79cbc276a7e3c9407e63344c04cfbb6"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/node-ids.ts",
          "sha256": "165bc94ebb4ce3b6f49ee478a4c0867c2c5db0b589ceffef72ca9a91d14cd781"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/node-ids.ts",
          "sha256": "210c6edff6fc77b1a8c5e346bce2711913d8bbfe2b98b80267eecfad7293008e"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/nodes.ts",
          "sha256": "731d65a8e9630eb2cd536c83abaa9a8875002da2228a8258621bf18763787a42"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/step.ts",
          "sha256": "e3c3dbf33f0576db7c44d94436c8d8c41097211639cf8ccfa14ccde0708657ec"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/descriptor.ts",
          "sha256": "6c32a7c6c01bee3688c27ec032a50f4934a0e65781ac0d57ce07ea89ae0bcb1b"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/node-ids.ts",
          "sha256": "62ad7c70ffbf39aee32e52f512303dcf6d2912b7f5cccd2b2d0b30940ded2e3a"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/nodes.ts",
          "sha256": "be6f0725a8f5ffab435089dc0becfbb42dab89287f2669ff06965fbdd9e7ab96"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/omission.ts",
          "sha256": "9e66c24ca8a73199442cb4218556c877793155d3082e946a663b64854f5181bf"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/step.ts",
          "sha256": "d87840f4fa594d28f524491a17a108cd351fc664966c34848c8820639f97e067"
        }
      ],
      "id": "separations-ucpath-termination"
    }
  ],
  "tasks": [
    {
      "fingerprint": "d04f1612765d978afc480e8f80f1c3652deb406f71f8b92223032f755ab02c57",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
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
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-dates.ts",
          "sha256": "9b10295b3b33a56c50ca3f179b3a56d71141a6ad90477f984b75759839e63044"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "4b7c954dbc4d878a7f0e1a6fa2eb8427dedb16f1c4dd39e5234132a90c6c26ba"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
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
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/crm/declaration.ts",
          "sha256": "f9475f41af20cfebe8753ed508d8701b2f27294e7ca4144870d88f4dc92a90cd"
        },
        {
          "path": "src/stores/crm/driver/interpreter.ts",
          "sha256": "69581eaa673c29bb9ee95706eda9ab57794d2794069622f1a76d3215fd43f9ab"
        },
        {
          "path": "src/stores/crm/driver/ui-registry.ts",
          "sha256": "33a2df58090f62e32a593f1ad97fe9e6dbf34e1aa8c813405b0280f88650d8f5"
        },
        {
          "path": "src/stores/crm/tasks/read-onboarding-dates.ts",
          "sha256": "b07573c720e5abeb91b5e3f7abf1c41afa4f601cd202b6bcff7ef6afa49a44c4"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "crm/read-onboarding-dates"
    },
    {
      "fingerprint": "7a6e6d3238a6676cb16f6b523be98227aa7b0e5d99f5f14b844f4a88b6889e70",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
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
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-dates.ts",
          "sha256": "9b10295b3b33a56c50ca3f179b3a56d71141a6ad90477f984b75759839e63044"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "4b7c954dbc4d878a7f0e1a6fa2eb8427dedb16f1c4dd39e5234132a90c6c26ba"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
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
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/crm/declaration.ts",
          "sha256": "f9475f41af20cfebe8753ed508d8701b2f27294e7ca4144870d88f4dc92a90cd"
        },
        {
          "path": "src/stores/crm/driver/interpreter.ts",
          "sha256": "69581eaa673c29bb9ee95706eda9ab57794d2794069622f1a76d3215fd43f9ab"
        },
        {
          "path": "src/stores/crm/driver/ui-registry.ts",
          "sha256": "33a2df58090f62e32a593f1ad97fe9e6dbf34e1aa8c813405b0280f88650d8f5"
        },
        {
          "path": "src/stores/crm/tasks/read-onboarding-record.ts",
          "sha256": "017ed4aaa5c44f789ecce9700627cd1af991828521e79860f76a93a90c66c377"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "crm/read-onboarding-record"
    },
    {
      "fingerprint": "d552096e1dd20650aa8747d270bfe71d5fa1d0110e3790e11ae4316ce56c9ddf",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/extraction/extract-pdf-pages.ts",
          "sha256": "b4436c352a26947c8f1aea212b27ed10b77c48e0586c4f4587cd1e59720a1fdd"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
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
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/extraction/tasks/extract-pdf-pages.ts",
          "sha256": "f5ed6f288ebfde47f0c6e51897ee7c86189e5f488b25533e7ca5979190db32c8"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "extraction/extract-pdf-pages"
    },
    {
      "fingerprint": "f3fe7ec05a95a7c06fe65383d44be1e71c357274d7728e1f7855ca29a0bc9ac4",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/extraction/extract-spreadsheet.ts",
          "sha256": "086083a5c7b40f43dea01335292ffb07271130785232c8105830855879b2426d"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "dc99a590fb4c0d90982b368c3abbdcbd65fcbc86a4c22911cc205191456d2b6e"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "bdd4477136f6dbc5b31fe63809ec1009983a307e78dc658f15e1303d0340ddc7"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/intake/header-discovery.ts",
          "sha256": "e579842b2f97aecc78a0ab1e4001393c5e299a7e20b42426a2f09be68dbcf1d8"
        },
        {
          "path": "src/domain/intake/mapping.ts",
          "sha256": "554890b53fddf118f57b35d2772c432f7d65a474af3bd811a360716004923490"
        },
        {
          "path": "src/domain/intake/projection.ts",
          "sha256": "a64d4cf08ebe8029084461a4a614e1c35e77c863dbedcccb091489d2c3baab67"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
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
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
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
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        }
      ],
      "id": "extraction/extract-spreadsheet"
    },
    {
      "fingerprint": "15f96661f3fc33b2896f22cbabdfd3c3bb4b248265e75e80db66b1300191bb8f",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/save-separation-finalization.ts",
          "sha256": "fae33a72d2258a6d5f171af4789049c3ee37b7a6c75ee3aacccbb9f2e25f99e5"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "a49a456be6a6383d0a79a0444968d74874cfcd30b1bb67a16e304af0f975bb14"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "3db476ce5ffae6c148df4b9fdcd836c68d96af7bba507e3585e8015df1ccd6b7"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "0b86b786387b7c1771836ca75908b30623b827ccc353ef16f593f02b6b842219"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "41b3debdad81890b91dd03ad77cf1d6af6850d136196668efeb5ac89948828ab"
        },
        {
          "path": "src/stores/kuali/finalization-verdict.ts",
          "sha256": "100e1d87c4e2b60b64721ca06f4b0c56701e64b42e012963d50479102a33859d"
        },
        {
          "path": "src/stores/kuali/tasks/match-separation-finalization.ts",
          "sha256": "15497c33458ca5fbd4cb44b53f046d79bcd5dd6cc62f82fdd78184c8323e9a3e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "kuali/match-separation-finalization"
    },
    {
      "fingerprint": "f8bdaa448a2106fcbeed65fe46dbfb24bf9c1815a8c46092c5a1e50f40512506",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "d909b1be2c5e1f8743f4ad5dba5192b65183b54588cd625030c7de314407f98e"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "a49a456be6a6383d0a79a0444968d74874cfcd30b1bb67a16e304af0f975bb14"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "0b86b786387b7c1771836ca75908b30623b827ccc353ef16f593f02b6b842219"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "41b3debdad81890b91dd03ad77cf1d6af6850d136196668efeb5ac89948828ab"
        },
        {
          "path": "src/stores/kuali/tasks/read-separation-document.ts",
          "sha256": "81bfd314d61596f517d7b3dc1901c3e7544b3b6d278cea0bf2e6ebba7ce6dcce"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "kuali/read-separation-document"
    },
    {
      "fingerprint": "11acdaea94c82b620a7a21402bb9a223704d99fac31eeddb2971e2cf6c2f7559",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/save-separation-finalization.ts",
          "sha256": "fae33a72d2258a6d5f171af4789049c3ee37b7a6c75ee3aacccbb9f2e25f99e5"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "a49a456be6a6383d0a79a0444968d74874cfcd30b1bb67a16e304af0f975bb14"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "0b86b786387b7c1771836ca75908b30623b827ccc353ef16f593f02b6b842219"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "41b3debdad81890b91dd03ad77cf1d6af6850d136196668efeb5ac89948828ab"
        },
        {
          "path": "src/stores/kuali/tasks/save-separation-finalization.ts",
          "sha256": "65fe9b98220a8e7f163e4a59d8ac7533b738bbb4a7f7c0f5bd6fcce8cea48dc4"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "kuali/save-separation-finalization"
    },
    {
      "fingerprint": "13111548085275500e96e7562b4e730a554117bc0e93127961a2d8019a18fa90",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/search-separation-action.ts",
          "sha256": "ddf180d3b70e34ccfea12764bf2385d2522050a9e62c91fcd36f3cbd9d22465b"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "a49a456be6a6383d0a79a0444968d74874cfcd30b1bb67a16e304af0f975bb14"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "0b86b786387b7c1771836ca75908b30623b827ccc353ef16f593f02b6b842219"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "41b3debdad81890b91dd03ad77cf1d6af6850d136196668efeb5ac89948828ab"
        },
        {
          "path": "src/stores/kuali/tasks/search-separation-action.ts",
          "sha256": "8687b3889c454d2494b570f90a152abff28960487b7b3852851b9158f6d86d86"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "kuali/search-separation-action"
    },
    {
      "fingerprint": "982bd2a409e0405add6a003cb4088f22426930a8840c3904af5943bf64c5382a",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/stage-separation-finalization.ts",
          "sha256": "63d1de26e2e9c0d9f0b8debb7dbafe8d93eed3230cfae39e270f755098c9965b"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "a49a456be6a6383d0a79a0444968d74874cfcd30b1bb67a16e304af0f975bb14"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "0b86b786387b7c1771836ca75908b30623b827ccc353ef16f593f02b6b842219"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "41b3debdad81890b91dd03ad77cf1d6af6850d136196668efeb5ac89948828ab"
        },
        {
          "path": "src/stores/kuali/tasks/stage-separation-finalization.ts",
          "sha256": "bae0d58530a668b831bb990285efc4cdd10fce5c44d4121a392b1efcbca4228b"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "kuali/stage-separation-finalization"
    },
    {
      "fingerprint": "cfaa7ed4cfd98db6cc72db8de819d6a53ee307da9beea78e9cfeeb9176d7a9d2",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/save-separation-finalization.ts",
          "sha256": "fae33a72d2258a6d5f171af4789049c3ee37b7a6c75ee3aacccbb9f2e25f99e5"
        },
        {
          "path": "src/domain/contracts/kuali/verify-separation-finalization.ts",
          "sha256": "7675f848b53b4ba183f011fdb5fcfbb806fa4d5e54d686199684d6ad1cff9ed0"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "4c16a8711133cc12b29a7e7bccba089e499692124d9925a6cfca7cd9c1633ebe"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-rrss-document.ts",
          "sha256": "a49a456be6a6383d0a79a0444968d74874cfcd30b1bb67a16e304af0f975bb14"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "3db476ce5ffae6c148df4b9fdcd836c68d96af7bba507e3585e8015df1ccd6b7"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "0b86b786387b7c1771836ca75908b30623b827ccc353ef16f593f02b6b842219"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "41b3debdad81890b91dd03ad77cf1d6af6850d136196668efeb5ac89948828ab"
        },
        {
          "path": "src/stores/kuali/finalization-verdict.ts",
          "sha256": "100e1d87c4e2b60b64721ca06f4b0c56701e64b42e012963d50479102a33859d"
        },
        {
          "path": "src/stores/kuali/tasks/verify-separation-finalization.ts",
          "sha256": "584fa42c60589703c6bb9095669960593839a2ee45c8702d303d78f4f396fe6c"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "kuali/verify-separation-finalization"
    },
    {
      "fingerprint": "fa54a9e10c5b2eedcbfd87c350d4b3324cc354c79f75564e2401287ec6c29ea6",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
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
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/new-kronos/read-separation-timecard.ts",
          "sha256": "2cbb47661f5396c30cf09ac3569a1865cd20a86fddeda49e5003d0034bbe04df"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "1832994b571082e94cadf3a61aef6ef8a670f5bb9022130be3c4d88380ff9e61"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "49b728a8ef90f7bb8b8c7fc394a713073736928842b89d1f236efa5b22aece82"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/new-kronos-timecard.ts",
          "sha256": "b9dffbe575a4e9999ee9d9179ba3c108b641f511bc6343153969033a5598b832"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/new-kronos/declaration.ts",
          "sha256": "8af55a6559c2b38b06a1483dbd6393dbc11967b5aabe9a2a6b8b61a8741667c5"
        },
        {
          "path": "src/stores/new-kronos/driver/grid-scroll.ts",
          "sha256": "010fe3d947631d4d90964bbf06a0cdec3ff4b10aca2c0cac65999cddf49a8112"
        },
        {
          "path": "src/stores/new-kronos/driver/interpreter.ts",
          "sha256": "98008e7a3c74a64142f37e1aab641a4fd012b880567dd13f9cd1fd6a89c91147"
        },
        {
          "path": "src/stores/new-kronos/driver/search-render.ts",
          "sha256": "031b18899f489a8f5e6f529d54c4a50ab3e960517fcd1e5a7d867dfbdb9d3d2b"
        },
        {
          "path": "src/stores/new-kronos/driver/ui-registry.ts",
          "sha256": "2f511ebb737772ead0feeae793e29c56448a7f6150e9a84b8c528321df4d3600"
        },
        {
          "path": "src/stores/new-kronos/tasks/read-separation-timecard.ts",
          "sha256": "596ec4cad3e080bf7736baf876314f27bd5162e01dc4f94747afb10753fe7f5a"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "new-kronos/read-separation-timecard"
    },
    {
      "fingerprint": "52ecf21ea08e0aadf780840a5cedd2f5eb60f390717243360b2baf73d2438cde",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
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
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/new-kronos/search-employee.ts",
          "sha256": "9d75cb50b3157edb07f11837943cc27309195629ce088b79488bb7988b872f00"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "1832994b571082e94cadf3a61aef6ef8a670f5bb9022130be3c4d88380ff9e61"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "49b728a8ef90f7bb8b8c7fc394a713073736928842b89d1f236efa5b22aece82"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/new-kronos-timecard.ts",
          "sha256": "b9dffbe575a4e9999ee9d9179ba3c108b641f511bc6343153969033a5598b832"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/new-kronos/declaration.ts",
          "sha256": "8af55a6559c2b38b06a1483dbd6393dbc11967b5aabe9a2a6b8b61a8741667c5"
        },
        {
          "path": "src/stores/new-kronos/driver/grid-scroll.ts",
          "sha256": "010fe3d947631d4d90964bbf06a0cdec3ff4b10aca2c0cac65999cddf49a8112"
        },
        {
          "path": "src/stores/new-kronos/driver/interpreter.ts",
          "sha256": "98008e7a3c74a64142f37e1aab641a4fd012b880567dd13f9cd1fd6a89c91147"
        },
        {
          "path": "src/stores/new-kronos/driver/search-render.ts",
          "sha256": "031b18899f489a8f5e6f529d54c4a50ab3e960517fcd1e5a7d867dfbdb9d3d2b"
        },
        {
          "path": "src/stores/new-kronos/driver/ui-registry.ts",
          "sha256": "2f511ebb737772ead0feeae793e29c56448a7f6150e9a84b8c528321df4d3600"
        },
        {
          "path": "src/stores/new-kronos/tasks/search-employee.ts",
          "sha256": "6ed912d5861bbe26a1228017e04b3694d181976a2c6bf6bbc5c1d1cb977684c0"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "new-kronos/search-employee"
    },
    {
      "fingerprint": "fd99dd47d2d7ad2e51c6d8a4ce04b8ce92180733f81db64908b33241ac71f779",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/normalization/normalize-contact.ts",
          "sha256": "e1a7d3d0bbacb29449fdcaa2a0a521d9735de13d4e7570a0a23fc90a81f0e0fc"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "dc99a590fb4c0d90982b368c3abbdcbd65fcbc86a4c22911cc205191456d2b6e"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "bdd4477136f6dbc5b31fe63809ec1009983a307e78dc658f15e1303d0340ddc7"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/normalization/contact-rules.ts",
          "sha256": "e19de6185325f74247f3b822b3519537f2e4aa3287e23d3dd33544f4402de311"
        },
        {
          "path": "src/domain/normalization/geocode.ts",
          "sha256": "e6c31995055622742f3a255b83ea0b1e36b8fe7ac24b2fab0836136fdfa9218a"
        },
        {
          "path": "src/domain/normalization/street-safety.ts",
          "sha256": "feaac03f30def7334a5b15024719e3fbd62d2c0c58fd319bc48c550ae52c991c"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/advisory.ts",
          "sha256": "b183bbd47a48a4b65854599cce9748fd309120691d8e96bac818e2cb5055f3f0"
        },
        {
          "path": "src/domain/trust/failure.ts",
          "sha256": "ebe20f31efbc346c3acc26811cc55441127d6bd278197c0a9987b210e0d1731d"
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
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/normalization/tasks/read-contact-advice.ts",
          "sha256": "cf23c8e2c61acae24779c45da96513bae6fcc9aefed19b027352de5a9e521620"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "normalization/read-contact-advice"
    },
    {
      "fingerprint": "7e01ad9fe22ee776eec58da143cf36fa3ceb6a5c9c147281cea5ee6aa60409cb",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
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
          "sha256": "dc99a590fb4c0d90982b368c3abbdcbd65fcbc86a4c22911cc205191456d2b6e"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "bdd4477136f6dbc5b31fe63809ec1009983a307e78dc658f15e1303d0340ddc7"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/ocr/extraction.ts",
          "sha256": "9009e07f8cc9ad9e4588b4ae8d86ff8b3d2fe18b0ffc1a2e9a0adddd71fe14f0"
        },
        {
          "path": "src/domain/ocr/form-registry.ts",
          "sha256": "0154d6e2b3cac5fd2cbc980807a9b719300a6a82c8d32f4aac53498f28427a5c"
        },
        {
          "path": "src/domain/ocr/instruction.ts",
          "sha256": "22c6857bbc0d56bccbd5185aa1eb00a6991580ec4dee74e590a5cbc6a5255f8e"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
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
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/ocr/tasks/extract-form-page.ts",
          "sha256": "91f0af761b3ff45a40997de0d1329218000f9047e47492a9469c3f9e449f6f55"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ocr/extract-form-page"
    },
    {
      "fingerprint": "1fcd0df297318df8339a6137438acd9508311f84a30d505e9ef9247012c88af7",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/roster/match-spreadsheet.ts",
          "sha256": "90c1ea6c27b0cfe388ae5184f88f7130b9febfc08a34d67c090a67395e357f14"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/fields/cell-coercion.ts",
          "sha256": "dc99a590fb4c0d90982b368c3abbdcbd65fcbc86a4c22911cc205191456d2b6e"
        },
        {
          "path": "src/domain/fields/registry.ts",
          "sha256": "bdd4477136f6dbc5b31fe63809ec1009983a307e78dc658f15e1303d0340ddc7"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/intake/mapping.ts",
          "sha256": "554890b53fddf118f57b35d2772c432f7d65a474af3bd811a360716004923490"
        },
        {
          "path": "src/domain/intake/projection.ts",
          "sha256": "a64d4cf08ebe8029084461a4a614e1c35e77c863dbedcccb091489d2c3baab67"
        },
        {
          "path": "src/domain/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/domain/matching/match-confidence.ts",
          "sha256": "11ba724a0f3af0e3c5805daf6b3241af132c0739871fd33c90a02a60f0f3e850"
        },
        {
          "path": "src/domain/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/matching/roster-match.ts",
          "sha256": "3c6a55f2d8f0a63560e1954014506a3d174471958ab7b37836c0c7fbde6bbeb5"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
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
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/common/spreadsheet-grid.ts",
          "sha256": "2ad5b8423d46c88ca446e70e8450816bb38728eaa78797fab35cddd95adbf456"
        },
        {
          "path": "src/stores/roster/tasks/match-spreadsheet.ts",
          "sha256": "5cb813df2754d7e63663aadeb18c9a5963dc1b3033ae5af71808abe811fc2bcc"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        }
      ],
      "id": "roster/match-spreadsheet"
    },
    {
      "fingerprint": "42f19d04abd1eca82fcaad45290d1f3097b2c84a30a0ead62bed70cf84fe7869",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "26bab195012b72f86bd63a0512e6313b6f90df7553206798cbb5df8e701be226"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "98146527567a84ec50bf0696e71eada17ce6d56fed4a220a70414a49f12126fb"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "a0202fb71cdd58eb1d8a70f790a804df2843c7f60e149c39899f7f56e7a296a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "3db476ce5ffae6c148df4b9fdcd836c68d96af7bba507e3585e8015df1ccd6b7"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/create-termination.ts",
          "sha256": "7c0e9fbc8b63fb8f051999fc19a83f6d2c7bd62cf9099493d7943502d933d1fb"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "85bf1da019e30a0ea6a268742e4092cb5201670a11458e6a4800794b1dc59bc6"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/create-termination"
    },
    {
      "fingerprint": "cc1695049ab7f0f80a474c011d79a4adc7f632bdceb79067302235280594d1c3",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "26bab195012b72f86bd63a0512e6313b6f90df7553206798cbb5df8e701be226"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "98146527567a84ec50bf0696e71eada17ce6d56fed4a220a70414a49f12126fb"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "a0202fb71cdd58eb1d8a70f790a804df2843c7f60e149c39899f7f56e7a296a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "3db476ce5ffae6c148df4b9fdcd836c68d96af7bba507e3585e8015df1ccd6b7"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/delete-pending-terminations.ts",
          "sha256": "36168c4080cd3353f1bfbbfd1d46ae888b75b6ed11a000a4e355c2a8c053ceed"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "85bf1da019e30a0ea6a268742e4092cb5201670a11458e6a4800794b1dc59bc6"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/delete-pending-terminations"
    },
    {
      "fingerprint": "8dee5a44eacc31fc031d6408d09005d530932728d35e94862773c28a2dc2d7fa",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "26bab195012b72f86bd63a0512e6313b6f90df7553206798cbb5df8e701be226"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "98146527567a84ec50bf0696e71eada17ce6d56fed4a220a70414a49f12126fb"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "a0202fb71cdd58eb1d8a70f790a804df2843c7f60e149c39899f7f56e7a296a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "3db476ce5ffae6c148df4b9fdcd836c68d96af7bba507e3585e8015df1ccd6b7"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/match-existing-termination.ts",
          "sha256": "eafee896d3331295d5079b3acdcfe5a21ff3b3b62a9ba4008ce7fcdd265f222c"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "85bf1da019e30a0ea6a268742e4092cb5201670a11458e6a4800794b1dc59bc6"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/match-existing-termination"
    },
    {
      "fingerprint": "8fe337d47968008d196d3dca92c63bdeee5e0dd9e29f6d8163aae13d81123e97",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "26bab195012b72f86bd63a0512e6313b6f90df7553206798cbb5df8e701be226"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "98146527567a84ec50bf0696e71eada17ce6d56fed4a220a70414a49f12126fb"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "a0202fb71cdd58eb1d8a70f790a804df2843c7f60e149c39899f7f56e7a296a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "3db476ce5ffae6c148df4b9fdcd836c68d96af7bba507e3585e8015df1ccd6b7"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/match-pending-terminations.ts",
          "sha256": "48e10bbceff4d9c8f813c5bfa965f1f263353fa864aa14c8e92f4d8d2f849ed6"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "85bf1da019e30a0ea6a268742e4092cb5201670a11458e6a4800794b1dc59bc6"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/match-pending-terminations"
    },
    {
      "fingerprint": "4eb7aa1a724c0e860fac410c5fb88eb94ecb2742c9203282134d67f9b8a3e4bb",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "35b45912bed43b7b2f1361669574ae74413ba0c35e4976a9e5adfc58bddb6650"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/read-job-summary.ts",
          "sha256": "cc9929f19a9fca5a73a55f1b91c0a4fd2d7863d19687d4b0468e5b6477aaa391"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/read-job-summary"
    },
    {
      "fingerprint": "721fc3bec187d8121f3caea49de449b1ecb4c9b14d322c7304d71c58ab07721d",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/search-person-org.ts",
          "sha256": "066bf3389a8e050f8774a3829651b6a3fe328cc12760bd321d12a157557fac20"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/search-person-org"
    },
    {
      "fingerprint": "9694951a1b221886c579e7004e923362b73f0eed914fb0cc5e9992e5b09b16d5",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "8b6280b4580ee562426dec821ad414b128dcce564296fd594f38bde3cd9670da"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/stage-pending-termination-sweep.ts",
          "sha256": "bb7a86c8fef8ce3fa958d24a0843f27acf3d151747841816f62bb40701905b5d"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/stage-pending-termination-sweep"
    },
    {
      "fingerprint": "aec759f669d550ec329d512c5c60fd8d3a74cb617b6ddc3b1076784eb30a63e5",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-termination.ts",
          "sha256": "690c4bef38cfe52ce875203c27eb0bfb0a76ef6764b1019e58080d1c30f3aa7f"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/stage-termination.ts",
          "sha256": "40ee01bf7b67ecf01900e461987fbb4f5d82b3d174b6645ce8e645c0de724f30"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/stage-termination"
    },
    {
      "fingerprint": "291c6894fa53cc5a171796e845ba97e687cddb2327a2c79518aa1774a303f3f4",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "26bab195012b72f86bd63a0512e6313b6f90df7553206798cbb5df8e701be226"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "98146527567a84ec50bf0696e71eada17ce6d56fed4a220a70414a49f12126fb"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "a0202fb71cdd58eb1d8a70f790a804df2843c7f60e149c39899f7f56e7a296a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
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
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "3db476ce5ffae6c148df4b9fdcd836c68d96af7bba507e3585e8015df1ccd6b7"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/verify-pending-terminations-cleared.ts",
          "sha256": "b5527414439345e4523b7f300c1354cdf5d190cc0eec4bdddedcf20c63b7572b"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "85bf1da019e30a0ea6a268742e4092cb5201670a11458e6a4800794b1dc59bc6"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/verify-pending-terminations-cleared"
    },
    {
      "fingerprint": "8f787c176a9e6a65bab446aa3dcc9fc7e0f52ee15747ee9494246eb592c28baa",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7f8cb8bb6135aada79670b7bc5e1d24ae835548d0642cc3232812937960b9901"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "b6ea76a857a3ac9be50bfa6388773b22b3a52b988bf56dd62816faf77187074e"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "ca2f88ff24960907f0beee06f41e909f9c5540f2d7440dcb8c4ad5e1948877ad"
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/ucpath/create-termination.ts",
          "sha256": "26bab195012b72f86bd63a0512e6313b6f90df7553206798cbb5df8e701be226"
        },
        {
          "path": "src/domain/contracts/ucpath/delete-pending-terminations.ts",
          "sha256": "98146527567a84ec50bf0696e71eada17ce6d56fed4a220a70414a49f12126fb"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "a0202fb71cdd58eb1d8a70f790a804df2843c7f60e149c39899f7f56e7a296a4"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/verify-termination.ts",
          "sha256": "ceb3357a9453253dd9f898314a295cb12bdccce8a975334a200413a1ea31752d"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "5b3d8d134fdce07bb68b0e4e5935fa66d277290da9a7ba4ba426c3eab59b7d8b"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "b1d6ff577fca95685a0efa90555d28c67f4c7484c1085a9698228dd77295f5ae"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "c584d8d1e21e9075b5f37285ec3cea0318f11994de804a5c3e3cafef55ffc725"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "841c4e39f0c1a0f3e5464caa6bfae6a4a5283986aaa3c50009ba69099d5fe5cc"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "31fb6946536898c9b0613667b078c15d5e4656b79db98a68353019b8137702d3"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/domain/write-safety.ts",
          "sha256": "3db476ce5ffae6c148df4b9fdcd836c68d96af7bba507e3585e8015df1ccd6b7"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "2da0b8a9a30fc583c24400ef514c05b837df86cf9fcbed035f6ec643aa3d525e"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "989aed5faedeb35545933d2272ad7197885bc8f88b36b6ec05198422db6c43c4"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "e33bb340e88ad19db61221c1a594fee81551d205555daeecf1ca1e5c654f8a9e"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/verify-termination.ts",
          "sha256": "ba1e23e6a2bf11ab5b9e449c2ecfc25050e0ca7f686a071d0f680793931bac6f"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "85bf1da019e30a0ea6a268742e4092cb5201670a11458e6a4800794b1dc59bc6"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/verify-termination"
    },
    {
      "fingerprint": "0408409a061826b6ce541f9d3b557bcaf135019ceb25788cc44eb7dc801351e3",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "4b7c954dbc4d878a7f0e1a6fa2eb8427dedb16f1c4dd39e5234132a90c6c26ba"
        },
        {
          "path": "src/domain/contracts/person-lookup/read-active-status.ts",
          "sha256": "f5de0bd85c4003781b84f616cc45a6b3c4e3d2c8df18acf2ce9030ed6601d000"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
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
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/person-lookup/tasks/read-active-status.ts",
          "sha256": "9a25f866280ca593b19a149102dbf26697828e89550e8f6b26e99622807af8f4"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:person-lookup/read-active-status"
    },
    {
      "fingerprint": "79aac6ba79ea368d892802894dbb91289c7624e4d70e2fc24a832b2bd1ba0e6b",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-active-employment.ts",
          "sha256": "bf8779778c4f66849aa8d5240d2f829090b853bb9594d716b6a7d87b603ff5af"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/employment-selection.ts",
          "sha256": "040b045b731d729545091c66044cb5ecc5bbeecb2b3b5a043b02e381d4203f72"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/match-active-employment.ts",
          "sha256": "d51ca5cbfb4940f3ebd5cbf38c5d216e5eaab29026baaee5caaa571d6a7d58f2"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/match-active-employment"
    },
    {
      "fingerprint": "e120d72e42e876529e9edf73fd08fa2b9b574b280fd1eddc912577fad5f002d9",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-department-option.ts",
          "sha256": "669f32766a8b55a71ebb50d6980f60ff4762d71a3c9fc1a5e5c3bc71566d6be5"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/department-option.ts",
          "sha256": "948b77621d7d7ac4c8adbd7379c324895ce50a7d19064ae1a6f14da272b967b8"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/kuali-separation-finalization.ts",
          "sha256": "b9a889be1d09efb8cdcdb51e8d90a1fa76a203fb64ea8c3f2873db6a1a44322c"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/match-department-option.ts",
          "sha256": "678567c7ee54f4dfd8ae9ea45393cfada8b2d975fdd98216d8c644f55671af7f"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/match-department-option"
    },
    {
      "fingerprint": "57ab115326429622804c8204357dc7c4714e47944abda7d40f7f9834c5b1691d",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "6397ee718073f6edf0caa1c63ba32bb3fe615a7326164667ff4873d95cb66c4c"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
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
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "1659c2203d8bc5bbdd21c1b130ee869b3224689942fb990ef7e06cd9dbae492e"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "6b6fc1283cd98ef3e2a3450b1a31da66a20b54fd3fc71552de6b9ccb2513b594"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/match-identity.ts",
          "sha256": "f02c16000005fa44bcda5959246e5c4ea35e0298c4a5356bf45f82677453431b"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/match-identity"
    },
    {
      "fingerprint": "a7d43f2a6f633a8a3333dbb038bf5040d93e0982114ade7f121eadcc158be406",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-separation-subject.ts",
          "sha256": "4ee6e1f97f993c7ac4dc087d73a29091798851f63b1c349f2dd3af0a3e6e6596"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
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
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "1659c2203d8bc5bbdd21c1b130ee869b3224689942fb990ef7e06cd9dbae492e"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "90c87aa616aa5d2183f0cf149a3da5494e4b485d1cb4a96a58eac65a0dde679c"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "6b6fc1283cd98ef3e2a3450b1a31da66a20b54fd3fc71552de6b9ccb2513b594"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/match-separation-subject.ts",
          "sha256": "c713b0de3670adfe2d1f277f8b9558b422c2b7a9ecb67f3a26de16c8c38b1951"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/match-separation-subject"
    },
    {
      "fingerprint": "87ee486fe9d23d97b6e1f4eab2dea385bfbcbda4e88977d6e63f16a1be0d8735",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/match-termination-type.ts",
          "sha256": "db1923e232b77b505ae7b88d11c336490f719c30efb989da7e27b3cc6c8d84be"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/match-termination-type.ts",
          "sha256": "6cb79cda9e89b88c175c43da6f9dff40b9a5c5b695a49d59ecead0aa81d48092"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/match-termination-type"
    },
    {
      "fingerprint": "171e29dfd1bbafeda69122b72b2329cc47a6405c64efb521a92e2cd8adfd4daa",
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
          "path": "src/domain/clock.ts",
          "sha256": "72c239b7dc373d95f08332f922efd9338e4ab17b0aee2ac07676af22d7810979"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-dates.ts",
          "sha256": "42ac66d26bc36718ed7265b103ec3e40b3e68b44b53d4c02669d3eea1f2b99f7"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/kronos/separation-timecard.ts",
          "sha256": "1832994b571082e94cadf3a61aef6ef8a670f5bb9022130be3c4d88380ff9e61"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "ec90161f322b4e06801448847520c3f2c92387c9374e89a263f491994af7da01"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "49b728a8ef90f7bb8b8c7fc394a713073736928842b89d1f236efa5b22aece82"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/read-separation-dates.ts",
          "sha256": "c27e43dca514fe3a3ea8f3f0743deae61aa4e219de6f492d63630cb045a167c6"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/read-separation-dates"
    },
    {
      "fingerprint": "7111f77bff2e6abf583f68bfee2be98ef8d0247e6e1a8601d65bda129f1a093a",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/read-separation-plan.ts",
          "sha256": "57c85049f82a4f32715458d2bee0bae450deed7be68843e2a85212cf5708fb03"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "ec90161f322b4e06801448847520c3f2c92387c9374e89a263f491994af7da01"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/read-separation-plan.ts",
          "sha256": "60433bb4e5b68868a2788958c294efbc2ca5b8bf3e9c0c74d3c95f660111c742"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/read-separation-plan"
    },
    {
      "fingerprint": "3fd4db2223a5a4642c9d18f2c2665414a09e066954a52b1133d4b50819969e67",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "95115b226bfa8fa535776f1b6695f70a51bad3c884c7d3c4e74dbdafba10bffc"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
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
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "daa28b605a59b08ba101f07569cf49b248614a4fa5d872e3bea5c7a5db802322"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "1659c2203d8bc5bbdd21c1b130ee869b3224689942fb990ef7e06cd9dbae492e"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "6b6fc1283cd98ef3e2a3450b1a31da66a20b54fd3fc71552de6b9ccb2513b594"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "7454b4e954b1ab67ca0d206d63c345d8befd72ca6654c52332cbe896d0b887ea"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/verify-identity-approval.ts",
          "sha256": "2c61c1b48bdb1b071e0ed25b1398d028b545fc0f4db03b5b09b38d776e5a0b9b"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/verify-identity-approval"
    },
    {
      "fingerprint": "ee83eab5050c3da2026363c0cf06aa0c746ec405c8b36244444c6e82fd47d488",
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
          "sha256": "d3cc30107f109138ee96f7f76c75709b42b4648712cafa2fe76ebfdad77cc8ec"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
        },
        {
          "path": "src/domain/contracts/separations/verify-termination-receipt.ts",
          "sha256": "ea8af3da5c4e89507c1f2bca65434cba2278c9ca77a4de4dc1059b038e99c94d"
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
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/provider-admission.ts",
          "sha256": "4a96c13fea16706f037219d938ba9eea721e3734545ebccd1d27524ef25e2ece"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "b56a84b984d86a72e1fc46a801fb3690151a0ca5ddb3cf970abcdae88056445a"
        },
        {
          "path": "src/domain/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/domain/redaction.ts",
          "sha256": "d0cac35017b54b2fbac9b7944d29d53dd1954997de701733f6764fca598753a5"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "e2aac9cd9d217716d729a5fce2729a7cb1618d586cdce6b9612b9e42782798d8"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "7dad2496d3a8593725be92415fc5d39304f0ee7c9ad51eb36095dbc028708189"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "b02284b61f40371150a7dfe260057f0a51a53e66c88744b0caccc74279ffc693"
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
          "sha256": "d0c7ede9e932f380b08d282ae1810326cccf2956036694b5d2cc328df2017ace"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "83b6eca1986e126b53f59f86155b5c9086f69fd97b480af59e185455feedee06"
        },
        {
          "path": "src/domain/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "adde9aa54b78f72f9033edb384db07022b82943ee51784d8a5aa3815193c8bdf"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "9c816e8f9113329156c82fe5275132c6d02d2bcb50a5808d6dfa7542743d7c4b"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/verify-termination-receipt.ts",
          "sha256": "27e97f44b50caa6a00f7a380bf9ba8bbe380426522eb2f162e10d11bc9d638dd"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/verify-termination-receipt"
    }
  ]
} as const;
