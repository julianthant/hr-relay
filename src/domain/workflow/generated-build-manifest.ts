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
      "fingerprint": "7da87507bc1ba9d8de74df498d019fc267bbc43d34e7efe062af3d3c022465c0",
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
          "path": "src/base/flow.ts",
          "sha256": "d801b0d635450908722e0f804b5ac42114f49dd9fe3ce63a0fae448cec7fe4a8"
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
          "path": "src/base/workflow-definition.ts",
          "sha256": "da608a566baa012ea175f6a1945486b536419d6c6f8e53a499f21e887174f2f8"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "path": "src/domain/contracts/person-lookup/read-active-status.ts",
          "sha256": "f5de0bd85c4003781b84f616cc45a6b3c4e3d2c8df18acf2ce9030ed6601d000"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
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
          "path": "src/domain/run/envelope.ts",
          "sha256": "7df250d461fe4f7a28efb3a66e08d98a42ca76b51cf4068bc4128807bac90614"
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
          "path": "src/domain/workflow/module-role.ts",
          "sha256": "ba18c71fe72dfff420194ea83b047e1819f1c5843a1725266577576e056b10d6"
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
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/person-lookup/workflow.ts",
          "sha256": "a80d85bcb780c114fc251f2e2b52ee33002a3c85b993b0ff4394e2afc4512ada"
        }
      ],
      "id": "person-lookup"
    },
    {
      "fingerprint": "c61d72c1614b415323917cc073b9ec246cc2465cdc5f9266e4d57cb100fe4408",
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
          "path": "src/base/flow.ts",
          "sha256": "d801b0d635450908722e0f804b5ac42114f49dd9fe3ce63a0fae448cec7fe4a8"
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
          "path": "src/base/workflow-definition.ts",
          "sha256": "da608a566baa012ea175f6a1945486b536419d6c6f8e53a499f21e887174f2f8"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3ba50424f2be84dd3c85fa80375f1efc1bd8e7e3245bbf5db903ef3bedc4d4de"
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "35b45912bed43b7b2f1361669574ae74413ba0c35e4976a9e5adfc58bddb6650"
        },
        {
          "path": "src/domain/contracts/ucpath/read-pending-termination-set.ts",
          "sha256": "62dc86544642509dea24ccadbcf1998c42ce8ae5290665f30649c0742d52a59b"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "8dd45da996cd3fa6f8cba1f92ce72bcde69de8e3069567978d6617c03614ffc9"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-termination.ts",
          "sha256": "690c4bef38cfe52ce875203c27eb0bfb0a76ef6764b1019e58080d1c30f3aa7f"
        },
        {
          "path": "src/domain/contracts/ucpath/verify-termination-filing-present.ts",
          "sha256": "59851bd1e59c29e6b7d0d615055337b50e0ebc33ecb5333825642a3bf7eb88b2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
        },
        {
          "path": "src/domain/duo-ceremony-lease.ts",
          "sha256": "2ad55e89212e0fa85422a6aa9fae16bc52536df0bc218b64d10825bea77a5b54"
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
          "path": "src/domain/intake/projection.ts",
          "sha256": "a64d4cf08ebe8029084461a4a614e1c35e77c863dbedcccb091489d2c3baab67"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "path": "src/domain/workflow/module-role.ts",
          "sha256": "ba18c71fe72dfff420194ea83b047e1819f1c5843a1725266577576e056b10d6"
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
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/separations/identity-check/node-ids.ts",
          "sha256": "25343dc8269bcd06d460a19f0ee6cbb7d38a4d4d15bb10cf5bf249c6d9158212"
        },
        {
          "path": "src/workflows/separations/identity-check/nodes.ts",
          "sha256": "65fa2595ccef6bae4205060cd3231579544f61a2100fae4de73fe7f623c449cc"
        },
        {
          "path": "src/workflows/separations/identity-check/step.ts",
          "sha256": "c2d7870064aee20e81b463c46496c14e2a1c3a0a609d839fa8464b299926e1bb"
        },
        {
          "path": "src/workflows/separations/job-summary/node-ids.ts",
          "sha256": "a6eebfc7749666fe0506139f87f044f080f31a26606884ebabe591207ab79ec9"
        },
        {
          "path": "src/workflows/separations/job-summary/nodes.ts",
          "sha256": "86e08f2adbee824675e902c9b1f77c218bce378c217b5fb7aa57434e4a9881b7"
        },
        {
          "path": "src/workflows/separations/job-summary/step.ts",
          "sha256": "3dc381b2c55d9133047abb0f50d2f134dd0e704a965be358bb7efc3b4b8b58df"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/node-ids.ts",
          "sha256": "165bc94ebb4ce3b6f49ee478a4c0867c2c5db0b589ceffef72ca9a91d14cd781"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/nodes.ts",
          "sha256": "90cdd0b37498572db4f2480f2bcd52a208760398acb4d3f54184faf8b3e7ac73"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/omission.ts",
          "sha256": "73a9fe2bceeee1841f791d532a6193316fc314d4ee43ccfdab301ab6fa2e7639"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/step.ts",
          "sha256": "3931befc6a43df640c3725eddacb1c66bc1971cc9490a183a0298fc542b47af3"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/node-ids.ts",
          "sha256": "210c6edff6fc77b1a8c5e346bce2711913d8bbfe2b98b80267eecfad7293008e"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/nodes.ts",
          "sha256": "753192a3e593845138459280b449191647591caca6de033a3dbdb0da1341b839"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/step.ts",
          "sha256": "1f03593ca2f01fe59b61b6a6acd6b5d19e5f0dd8a999ab2dfc45b61e096b50c5"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/node-ids.ts",
          "sha256": "2df19de7ace2501cb06710dd1b688e47d54353f310d09ab61719d9b08177a1b5"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/nodes.ts",
          "sha256": "4f21ba9f89da2f51c649fa9608334a155be04f1d512a2e27effc6387974e75df"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/omission.ts",
          "sha256": "9e5e4e74d43b3a7b78db1d554e481aa7b538209092bc16267c4ece410103ceab"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/step.ts",
          "sha256": "0cea40a4ff5955e6960b65524b031a37dc3ac0f881312b6b9ea385323225751a"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/node-ids.ts",
          "sha256": "754bb8309372a6624aaf93b1c71c1f9b129c35c2509e0cb94df38baa950b1a82"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/nodes.ts",
          "sha256": "e3d14e056257e7d85ad6fd421e9d4edfa3d6debd3e9ae8d18000c7eabe22cf4a"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/omission.ts",
          "sha256": "9e66c24ca8a73199442cb4218556c877793155d3082e946a663b64854f5181bf"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/step.ts",
          "sha256": "28f668aa97dff9cc4a53f4e68f96075f40a04270909f29a97553bec83248d8bb"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "f000ae91c2b12d5a036b5dcdbcd8680c9dd0aba4ef2f51f68234771f71f31c90"
        }
      ],
      "id": "separations"
    },
    {
      "fingerprint": "ccfc06fd2ee3309fdadf2f759094db17bd4cc2d9b8e61842dd59ae3e007b6f8c",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "d801b0d635450908722e0f804b5ac42114f49dd9fe3ce63a0fae448cec7fe4a8"
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "sha256": "65fa2595ccef6bae4205060cd3231579544f61a2100fae4de73fe7f623c449cc"
        },
        {
          "path": "src/workflows/separations/identity-check/step.ts",
          "sha256": "c2d7870064aee20e81b463c46496c14e2a1c3a0a609d839fa8464b299926e1bb"
        },
        {
          "path": "src/workflows/separations/job-summary/node-ids.ts",
          "sha256": "a6eebfc7749666fe0506139f87f044f080f31a26606884ebabe591207ab79ec9"
        },
        {
          "path": "src/workflows/separations/job-summary/nodes.ts",
          "sha256": "86e08f2adbee824675e902c9b1f77c218bce378c217b5fb7aa57434e4a9881b7"
        },
        {
          "path": "src/workflows/separations/job-summary/step.ts",
          "sha256": "3dc381b2c55d9133047abb0f50d2f134dd0e704a965be358bb7efc3b4b8b58df"
        }
      ],
      "id": "separations-identity-check"
    },
    {
      "fingerprint": "0214e7a8c0012fe3cf6b11850465dc675f40e20ab18337fc3697e1a61d326212",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "d801b0d635450908722e0f804b5ac42114f49dd9fe3ce63a0fae448cec7fe4a8"
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
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "sha256": "90cdd0b37498572db4f2480f2bcd52a208760398acb4d3f54184faf8b3e7ac73"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/step.ts",
          "sha256": "3931befc6a43df640c3725eddacb1c66bc1971cc9490a183a0298fc542b47af3"
        }
      ],
      "id": "separations-kronos-timecard"
    },
    {
      "fingerprint": "00875ba4caf5558987194f4d4543ca3c2648398cd4f1455c643d7f52f2d890a3",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "d801b0d635450908722e0f804b5ac42114f49dd9fe3ce63a0fae448cec7fe4a8"
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
          "path": "src/domain/contracts/ucpath/verify-termination-filing-present.ts",
          "sha256": "59851bd1e59c29e6b7d0d615055337b50e0ebc33ecb5333825642a3bf7eb88b2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "65fa2595ccef6bae4205060cd3231579544f61a2100fae4de73fe7f623c449cc"
        },
        {
          "path": "src/workflows/separations/identity-check/step.ts",
          "sha256": "c2d7870064aee20e81b463c46496c14e2a1c3a0a609d839fa8464b299926e1bb"
        },
        {
          "path": "src/workflows/separations/job-summary/node-ids.ts",
          "sha256": "a6eebfc7749666fe0506139f87f044f080f31a26606884ebabe591207ab79ec9"
        },
        {
          "path": "src/workflows/separations/job-summary/nodes.ts",
          "sha256": "86e08f2adbee824675e902c9b1f77c218bce378c217b5fb7aa57434e4a9881b7"
        },
        {
          "path": "src/workflows/separations/job-summary/step.ts",
          "sha256": "3dc381b2c55d9133047abb0f50d2f134dd0e704a965be358bb7efc3b4b8b58df"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/descriptor.ts",
          "sha256": "c87fa066af2ee65248d484579ce1a480a3faa6e99a63f84a970a1f6f501d9d2a"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/node-ids.ts",
          "sha256": "2df19de7ace2501cb06710dd1b688e47d54353f310d09ab61719d9b08177a1b5"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/nodes.ts",
          "sha256": "4f21ba9f89da2f51c649fa9608334a155be04f1d512a2e27effc6387974e75df"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/step.ts",
          "sha256": "0cea40a4ff5955e6960b65524b031a37dc3ac0f881312b6b9ea385323225751a"
        }
      ],
      "id": "separations-kuali-finalization"
    },
    {
      "fingerprint": "a0fe7b0b1b7dae41dab366f42ad2554872447b6629aa01a91715f9a3ec2a6256",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "d801b0d635450908722e0f804b5ac42114f49dd9fe3ce63a0fae448cec7fe4a8"
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "sha256": "753192a3e593845138459280b449191647591caca6de033a3dbdb0da1341b839"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/step.ts",
          "sha256": "1f03593ca2f01fe59b61b6a6acd6b5d19e5f0dd8a999ab2dfc45b61e096b50c5"
        }
      ],
      "id": "separations-kuali-read"
    },
    {
      "fingerprint": "b89ff69d67797a3b1580e8ddbff6cbd65e0efd79e094888853ec483314389ca4",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "d801b0d635450908722e0f804b5ac42114f49dd9fe3ce63a0fae448cec7fe4a8"
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/read-job-summary.ts",
          "sha256": "35b45912bed43b7b2f1361669574ae74413ba0c35e4976a9e5adfc58bddb6650"
        },
        {
          "path": "src/domain/contracts/ucpath/read-pending-termination-set.ts",
          "sha256": "62dc86544642509dea24ccadbcf1998c42ce8ae5290665f30649c0742d52a59b"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "8dd45da996cd3fa6f8cba1f92ce72bcde69de8e3069567978d6617c03614ffc9"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-termination.ts",
          "sha256": "690c4bef38cfe52ce875203c27eb0bfb0a76ef6764b1019e58080d1c30f3aa7f"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "65fa2595ccef6bae4205060cd3231579544f61a2100fae4de73fe7f623c449cc"
        },
        {
          "path": "src/workflows/separations/identity-check/step.ts",
          "sha256": "c2d7870064aee20e81b463c46496c14e2a1c3a0a609d839fa8464b299926e1bb"
        },
        {
          "path": "src/workflows/separations/job-summary/node-ids.ts",
          "sha256": "a6eebfc7749666fe0506139f87f044f080f31a26606884ebabe591207ab79ec9"
        },
        {
          "path": "src/workflows/separations/job-summary/nodes.ts",
          "sha256": "86e08f2adbee824675e902c9b1f77c218bce378c217b5fb7aa57434e4a9881b7"
        },
        {
          "path": "src/workflows/separations/job-summary/step.ts",
          "sha256": "3dc381b2c55d9133047abb0f50d2f134dd0e704a965be358bb7efc3b4b8b58df"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/node-ids.ts",
          "sha256": "210c6edff6fc77b1a8c5e346bce2711913d8bbfe2b98b80267eecfad7293008e"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/nodes.ts",
          "sha256": "753192a3e593845138459280b449191647591caca6de033a3dbdb0da1341b839"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/step.ts",
          "sha256": "1f03593ca2f01fe59b61b6a6acd6b5d19e5f0dd8a999ab2dfc45b61e096b50c5"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/descriptor.ts",
          "sha256": "6db5bb1f7f2bc7d83dd75f6b625d3d40aeb96d5eb6e06cd1ca177ece7090347c"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/node-ids.ts",
          "sha256": "754bb8309372a6624aaf93b1c71c1f9b129c35c2509e0cb94df38baa950b1a82"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/nodes.ts",
          "sha256": "e3d14e056257e7d85ad6fd421e9d4edfa3d6debd3e9ae8d18000c7eabe22cf4a"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/step.ts",
          "sha256": "28f668aa97dff9cc4a53f4e68f96075f40a04270909f29a97553bec83248d8bb"
        }
      ],
      "id": "separations-ucpath-termination"
    }
  ],
  "tasks": [
    {
      "fingerprint": "fbad3a7694c6cd7fde6b83c8f2b43349375dd20e8b1187348548e708429ed1c9",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "d8e8d2f9b4c80587c0fff270c9ce7312d99f0dfd3d3a4f02c65006703b8f3cb4",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "78f0792a2a34e44077c84f3c0f8a4062219efed1bdb193a8024968422c03a349",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "f8431f2a461eb5b7d5fa0d11e503be68f875cd57bb32ef07ea1e58cc75bdb898",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "53541c050db5678331b09ab35dba95ff2194a4796d9f865c3c8c0873ec5b196c",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "ed7fa8e7a26549d2ef845ef5d514d5b0f48361fbf9c5e902dbcb75b5ae19cd6b",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "1ef1ed26c13e4029b7b50283346bf03ffce11509f5f18e7db8edc0f07d56da28",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "c373c305764a9ef1d53e1e4dd607b50209770d12c3b9c7dda367cc922258d3a2",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "4f782733a46ca48bebc7ee793e868388103bd03a2cb80c1507b00ec4b54916fe",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "7e33e80183866328060418441a4c187f184d0c5d17bbf7253e181d5946c73faa",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "7ee4c18f7e1ed107ca379d84bfb4a5251b986323dcbecb8518123978d0cdae8b",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "13ed9f8b361b8b2db20514e1d927cfb37f414e50cce7c526e1bf2f4616a8c0f3",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "1d8370d0644e54f5784e6fef97226cdd3ccfe6d7bd918ed9fbc859b431016e21",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "39edd26f4bf6d8c31da3cc81d9182f880d36fc7546b869f973709fdca41ead1b",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "7246758d8f3cdaaf4f3fc4d8938173c5ee8335117f828f25f8ec326de06a1883",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "83b508613ae7c99a648b4137ffcf154f2efe8694a63d4aba073568c5705b9c45",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/create-termination"
    },
    {
      "fingerprint": "ad73fdec4e79c10eb92c8fcc8c032fb9f26f3dd62f6b3e7de4e1c8c6efc6a32e",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/delete-pending-terminations"
    },
    {
      "fingerprint": "73785c6169e750a6b20ccfb56ca44ad96f5e0d9f801a87bdae6f366f22b72bc2",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/match-existing-termination"
    },
    {
      "fingerprint": "ec1373f49c73e8f85516b994cab9887b9de4126f30b5384b67b538f06e85d34d",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/match-pending-terminations"
    },
    {
      "fingerprint": "5ce1b310df8370e778316f4ce47f481928cd20f7f864b1d4151742ed6adeeec6",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/read-job-summary"
    },
    {
      "fingerprint": "4fef4433307be01ccc2adc6ae2a7f718735622f19b5c380ad2fb201bb1c2d078",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/read-pending-termination-set.ts",
          "sha256": "62dc86544642509dea24ccadbcf1998c42ce8ae5290665f30649c0742d52a59b"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/read-pending-termination-set.ts",
          "sha256": "bd9ef0db0b26c8f57b5bb61c484cb2cc97934ef0ff29d41019320b2d856fafe4"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/read-pending-termination-set"
    },
    {
      "fingerprint": "522dc702e5c18e80aab867ef8f0f89deaeb9374a43974213da3fbc36504d54b2",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/search-person-org"
    },
    {
      "fingerprint": "58485e5cd3f75b9e59285ea7fae0752d231814f9c579bea10abc07067eef313e",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "8dd45da996cd3fa6f8cba1f92ce72bcde69de8e3069567978d6617c03614ffc9"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/stage-pending-termination-sweep"
    },
    {
      "fingerprint": "b84c019e89b97d2eb6cbc68f2a9e6d561ce708601806556c5938832e59d0006d",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/stage-termination"
    },
    {
      "fingerprint": "73bce7cc6726fb234ce87ffb4a8af3dc89b7b47d656f3f27a1392347f577b3fb",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/verify-pending-terminations-cleared.ts",
          "sha256": "644ac660bfde464d950b7fe955878bfce22a43ea077c0007308460b39f411c36"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/verify-pending-terminations-cleared"
    },
    {
      "fingerprint": "4567c192bc908c32b25dc43dff8156abfb6d97b887107cd458ad155d43b3dba1",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
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
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/verify-termination"
    },
    {
      "fingerprint": "dd63bfabda3d6d3070e78ca0673d3f1a7e4f0899955a52bf8b57e64e650fe00a",
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
          "sha256": "a30a0f1a67ef471537879856e289085f929a9ffdb5774c4f6b7b7ff20378ec26"
        },
        {
          "path": "src/domain/contracts/ucpath/match-existing-termination.ts",
          "sha256": "5a4d659961c9ef56d4d28d19d3101ff1c90a21d799f250790191369cfb2d957d"
        },
        {
          "path": "src/domain/contracts/ucpath/match-pending-terminations.ts",
          "sha256": "4bda5e3de3449735d325c76a52e4e9ad2ed4d4783d7ce7b274426377b4ea9f4d"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "cb2e6a84899f512fa0d7169a252884db7cf03cb57663197995b2b675dfb2fdb2"
        },
        {
          "path": "src/domain/contracts/ucpath/verify-termination-filing-present.ts",
          "sha256": "59851bd1e59c29e6b7d0d615055337b50e0ebc33ecb5333825642a3bf7eb88b2"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "path": "src/domain/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/domain/ui/kuali-separation-document.ts",
          "sha256": "64d495c361d3853b38255e23ee7605fbddc12b3d06e8394b84e07551fad1d2dd"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
          "sha256": "bc0ffb0b409de675a376a34e30eb3c550f910a80d3f2821633d308bfdf24e912"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/verify-termination-filing-present.ts",
          "sha256": "e1d5313ba9b4b6e04c5a2ed7c792aee8d942933335ebcee7fbd0b515f0cf9f8d"
        },
        {
          "path": "src/stores/ucpath/termination-verdict.ts",
          "sha256": "5fab1c75cd46bacdd76b1cb862a4ae558f05b6575425076dc36cab15cf24f5c5"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "ucpath/verify-termination-filing-present"
    },
    {
      "fingerprint": "576d8089d006d75f15ced559762d619130629773df8e124045ed318a3fa27698",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "656858fd9cac0d7e975d1c396eec3ba02fc3915a0b6ace46b92c95c7cab602ec",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "0bea8a24984c820b3fec0735716e1c7b127922a79ff3db25c6be921da6685ed3",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "ce59e983e438c7bc3e960e2ebbdbce867fe11dae2a64b277fa42df4eca807a96",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "ca25c452f86fcb72f37bd967f48cd64e3565e1de7a6425c71d28c3a6078cc6a8",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "ce26d9aaab49edec741ef1df1af8eac3ed615ca5b811a1f16f3ca25eab7a3e83",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "88756bbffb3fbda4f7db8079770f01132e21930a2734a58da7a4f6f85b8d2bc9",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "sha256": "c2db75e1f81780c8873b40f623fff646ca6c32eb2f547c47ee12997d351bcc9e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/read-separation-dates"
    },
    {
      "fingerprint": "a576f18c7973be7a1e44c352cb1cba68cbf8c1692ce16e2aa0a4a16aad344f39",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "71c26a8f19c077e5578423b34244cbbb000d808d641dab1ed43a79b5947f26e7",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
      "fingerprint": "bfcfde0a18fa4d4953c7aec3a64e91cb99eb34ae82438c88fc77bdcc4f1faaf3",
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
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
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
          "sha256": "7ce97ee36963927cf7bb045cd1775b15d544ac557d26d78ad2fa3eb7fb020f47"
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
