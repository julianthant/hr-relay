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
      "fingerprint": "144121e6bcc8686ccde2fd1fdaad47471341aec5d32f5694b5b6a7449e15dfcf",
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
          "sha256": "7b7045d7c7e856f2f2c4fbb7c8f8779423f77f94c590d514802ebcb431342cdf"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "sha256": "af443c6f3ed31e93679b41f67556b61fa0385703b7bf1a4b94612bd46c8c95c0"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "29cc215c3d354fafa783caeecbf0d2824e413ce520fef22043ed682151a6c876"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "c29a756b7169962cfbbf0146ad6b58e9edde2565161bb6e1406956a386f6f7c8"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
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
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/rerun-values.ts",
          "sha256": "2373ff840cabd7abb3f5cf97be017ba87923611daadc0416ff1f763cc396795d"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "path": "src/validation/rerun-values.ts",
          "sha256": "84fd345b5673251174c9b96cda3739133afc92eb562c7349c7d06fc894d006f8"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/person-lookup/workflow.ts",
          "sha256": "db443bff1b3924a5a734d78a3c5241a798915ee9710ef174c53a39a43cdc708b"
        }
      ],
      "id": "person-lookup"
    },
    {
      "fingerprint": "0f4040d25e3855ed2b3bdd4a63344acbd88c421c794de01a82a0d8d410ebd250",
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
          "sha256": "7b7045d7c7e856f2f2c4fbb7c8f8779423f77f94c590d514802ebcb431342cdf"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "sha256": "af443c6f3ed31e93679b41f67556b61fa0385703b7bf1a4b94612bd46c8c95c0"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "29cc215c3d354fafa783caeecbf0d2824e413ce520fef22043ed682151a6c876"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "f5d1c012e0d15b74ec27ddd83a652bca9f8a07ae819d54a8842a1dc98391757f"
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
          "sha256": "ec551365357711e7f9016d7766746d08dd571d55a651135be81ccf7ef78d2aee"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "c29a756b7169962cfbbf0146ad6b58e9edde2565161bb6e1406956a386f6f7c8"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "377fbdc543d17d89e944ae665297653297a867718e776b8d28fb449e60580489"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
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
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
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
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/rerun-values.ts",
          "sha256": "2373ff840cabd7abb3f5cf97be017ba87923611daadc0416ff1f763cc396795d"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "path": "src/validation/rerun-values.ts",
          "sha256": "84fd345b5673251174c9b96cda3739133afc92eb562c7349c7d06fc894d006f8"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "75d795cf74a630a4ebfa021ae07d2df188553110bd15b06d6f9b2652cc799bab"
        }
      ],
      "id": "separations"
    },
    {
      "fingerprint": "de93e2db1f28bf88f710ba07e0527329a1cdc3e77bcb2bc4f43b12d26e56e2fc",
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
          "sha256": "7b7045d7c7e856f2f2c4fbb7c8f8779423f77f94c590d514802ebcb431342cdf"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "sha256": "af443c6f3ed31e93679b41f67556b61fa0385703b7bf1a4b94612bd46c8c95c0"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "29cc215c3d354fafa783caeecbf0d2824e413ce520fef22043ed682151a6c876"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "f5d1c012e0d15b74ec27ddd83a652bca9f8a07ae819d54a8842a1dc98391757f"
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
          "sha256": "ec551365357711e7f9016d7766746d08dd571d55a651135be81ccf7ef78d2aee"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "c29a756b7169962cfbbf0146ad6b58e9edde2565161bb6e1406956a386f6f7c8"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "377fbdc543d17d89e944ae665297653297a867718e776b8d28fb449e60580489"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
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
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
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
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/rerun-values.ts",
          "sha256": "2373ff840cabd7abb3f5cf97be017ba87923611daadc0416ff1f763cc396795d"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "path": "src/validation/rerun-values.ts",
          "sha256": "84fd345b5673251174c9b96cda3739133afc92eb562c7349c7d06fc894d006f8"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/separations/identity-check/workflow.ts",
          "sha256": "d52fd66872552a9e917c161041ccbc7fef416afd0ac682fc145e1e63003e7c14"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "75d795cf74a630a4ebfa021ae07d2df188553110bd15b06d6f9b2652cc799bab"
        }
      ],
      "id": "separations-identity-check"
    },
    {
      "fingerprint": "bd298bb5123dd7e42e96eadb49c6269ec8a4e44c07bb3c390879fe8703823c86",
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
          "sha256": "7b7045d7c7e856f2f2c4fbb7c8f8779423f77f94c590d514802ebcb431342cdf"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "sha256": "af443c6f3ed31e93679b41f67556b61fa0385703b7bf1a4b94612bd46c8c95c0"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "29cc215c3d354fafa783caeecbf0d2824e413ce520fef22043ed682151a6c876"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "f5d1c012e0d15b74ec27ddd83a652bca9f8a07ae819d54a8842a1dc98391757f"
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
          "sha256": "ec551365357711e7f9016d7766746d08dd571d55a651135be81ccf7ef78d2aee"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "c29a756b7169962cfbbf0146ad6b58e9edde2565161bb6e1406956a386f6f7c8"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "377fbdc543d17d89e944ae665297653297a867718e776b8d28fb449e60580489"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
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
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
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
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/rerun-values.ts",
          "sha256": "2373ff840cabd7abb3f5cf97be017ba87923611daadc0416ff1f763cc396795d"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "path": "src/validation/rerun-values.ts",
          "sha256": "84fd345b5673251174c9b96cda3739133afc92eb562c7349c7d06fc894d006f8"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/separations/kronos-timecard/workflow.ts",
          "sha256": "0bceb187bbe2d57e957d5ac0819e33412cbaf24ed69070047c0057d01f78cc46"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "75d795cf74a630a4ebfa021ae07d2df188553110bd15b06d6f9b2652cc799bab"
        }
      ],
      "id": "separations-kronos-timecard"
    },
    {
      "fingerprint": "593df7252718ff76ef90bbfa753325f22c68dfc112bc01cee29544c1c1c0d0fd",
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
          "sha256": "7b7045d7c7e856f2f2c4fbb7c8f8779423f77f94c590d514802ebcb431342cdf"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "sha256": "af443c6f3ed31e93679b41f67556b61fa0385703b7bf1a4b94612bd46c8c95c0"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "29cc215c3d354fafa783caeecbf0d2824e413ce520fef22043ed682151a6c876"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "f5d1c012e0d15b74ec27ddd83a652bca9f8a07ae819d54a8842a1dc98391757f"
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
          "sha256": "ec551365357711e7f9016d7766746d08dd571d55a651135be81ccf7ef78d2aee"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "c29a756b7169962cfbbf0146ad6b58e9edde2565161bb6e1406956a386f6f7c8"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "377fbdc543d17d89e944ae665297653297a867718e776b8d28fb449e60580489"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
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
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
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
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/rerun-values.ts",
          "sha256": "2373ff840cabd7abb3f5cf97be017ba87923611daadc0416ff1f763cc396795d"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "path": "src/validation/rerun-values.ts",
          "sha256": "84fd345b5673251174c9b96cda3739133afc92eb562c7349c7d06fc894d006f8"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/separations/kuali-finalization/workflow.ts",
          "sha256": "aca70eceff1856a48ab54764ebcf6178b60c1f1a878d5ee0be738fd06f7a2d2f"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "75d795cf74a630a4ebfa021ae07d2df188553110bd15b06d6f9b2652cc799bab"
        }
      ],
      "id": "separations-kuali-finalization"
    },
    {
      "fingerprint": "6499de928266a1513aa30199a52e7a20f3f8f57b51b1edeb6e7988124d258d29",
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
          "sha256": "7b7045d7c7e856f2f2c4fbb7c8f8779423f77f94c590d514802ebcb431342cdf"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "sha256": "af443c6f3ed31e93679b41f67556b61fa0385703b7bf1a4b94612bd46c8c95c0"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "29cc215c3d354fafa783caeecbf0d2824e413ce520fef22043ed682151a6c876"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "f5d1c012e0d15b74ec27ddd83a652bca9f8a07ae819d54a8842a1dc98391757f"
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
          "sha256": "ec551365357711e7f9016d7766746d08dd571d55a651135be81ccf7ef78d2aee"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "c29a756b7169962cfbbf0146ad6b58e9edde2565161bb6e1406956a386f6f7c8"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "377fbdc543d17d89e944ae665297653297a867718e776b8d28fb449e60580489"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
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
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
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
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/rerun-values.ts",
          "sha256": "2373ff840cabd7abb3f5cf97be017ba87923611daadc0416ff1f763cc396795d"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "path": "src/validation/rerun-values.ts",
          "sha256": "84fd345b5673251174c9b96cda3739133afc92eb562c7349c7d06fc894d006f8"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/separations/kuali-extraction/workflow.ts",
          "sha256": "eed5cdcf0cc0672bf09079ee454c7df1d2243ea113807d8c3722a86a7dab7a64"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "75d795cf74a630a4ebfa021ae07d2df188553110bd15b06d6f9b2652cc799bab"
        }
      ],
      "id": "separations-kuali-read"
    },
    {
      "fingerprint": "685eec21f94ecc2501630cdd9f4f4b6e6392752e175c0fa05200e7ff6839b0e6",
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
          "sha256": "7b7045d7c7e856f2f2c4fbb7c8f8779423f77f94c590d514802ebcb431342cdf"
        },
        {
          "path": "src/base/providers.ts",
          "sha256": "acd9e09a3e75476c9f372c45d168153025da085932bcc86381110c3f92dc6043"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "sha256": "af443c6f3ed31e93679b41f67556b61fa0385703b7bf1a4b94612bd46c8c95c0"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "29cc215c3d354fafa783caeecbf0d2824e413ce520fef22043ed682151a6c876"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "f5d1c012e0d15b74ec27ddd83a652bca9f8a07ae819d54a8842a1dc98391757f"
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
          "sha256": "ec551365357711e7f9016d7766746d08dd571d55a651135be81ccf7ef78d2aee"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "c29a756b7169962cfbbf0146ad6b58e9edde2565161bb6e1406956a386f6f7c8"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "377fbdc543d17d89e944ae665297653297a867718e776b8d28fb449e60580489"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
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
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
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
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/rerun-values.ts",
          "sha256": "2373ff840cabd7abb3f5cf97be017ba87923611daadc0416ff1f763cc396795d"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "38955a88e1011bc911fb150c7963bbb6f817239153c4e543afb62bc81a47a504"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "path": "src/validation/rerun-values.ts",
          "sha256": "84fd345b5673251174c9b96cda3739133afc92eb562c7349c7d06fc894d006f8"
        },
        {
          "path": "src/validation/schema-path.ts",
          "sha256": "3abe34025d4db6b41564ebae55bdfd95d2b8fc5d9cc333d38ee4352b16f56c2f"
        },
        {
          "path": "src/workflows/separations/ucpath-transaction/workflow.ts",
          "sha256": "0f2da837ca3bf55a7e85240958f39f2e291a221c6adf8972fd91d23825ebd29d"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "75d795cf74a630a4ebfa021ae07d2df188553110bd15b06d6f9b2652cc799bab"
        }
      ],
      "id": "separations-ucpath-termination"
    }
  ],
  "tasks": [
    {
      "fingerprint": "79f4faa56990d237c003e0d630ba874cedd3dbc69a51dc907cc5d061661460f5",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/crm/declaration.ts",
          "sha256": "f9475f41af20cfebe8753ed508d8701b2f27294e7ca4144870d88f4dc92a90cd"
        },
        {
          "path": "src/stores/crm/driver/interpreter.ts",
          "sha256": "2d5ef0ecba0428d239b11b67838a48eb5cb0f95b056f68a492104deb8748d867"
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
      "fingerprint": "a4a66bab7e3328896a58883712b3721ea2c68bdfe1a3eb7fe4c8b06b3b0d4dd9",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/crm/declaration.ts",
          "sha256": "f9475f41af20cfebe8753ed508d8701b2f27294e7ca4144870d88f4dc92a90cd"
        },
        {
          "path": "src/stores/crm/driver/interpreter.ts",
          "sha256": "2d5ef0ecba0428d239b11b67838a48eb5cb0f95b056f68a492104deb8748d867"
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
      "fingerprint": "d13623b9f5a4a67b28879ffce9b119554bdea54d929824038a63925422f2c57d",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "bdb81d79e678a4d758dde818c686dafd40c39b64c0501b3ce8a3df86b94bdd49",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "2acec0577a9cc29cbc4e2e1c1b20fba9778fee115b1580f74f71c729016e8252",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "dd7a99825a76b41125588987eab323c3dc2cbdb6b0db7557b6760a776fd0c05b"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "41b3debdad81890b91dd03ad77cf1d6af6850d136196668efeb5ac89948828ab"
        },
        {
          "path": "src/stores/kuali/finalization-verdict.ts",
          "sha256": "f3f66f054052a953160a26e882f5c72f48a301ae51f9a6b03c5ba1dac6a0bd53"
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
      "fingerprint": "93e446e0078b7f16b74f4eabf0ab53c3d13e6f1b77b235df242d1943521fbc1d",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/kuali/read-separation-document.ts",
          "sha256": "f5d1c012e0d15b74ec27ddd83a652bca9f8a07ae819d54a8842a1dc98391757f"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "dd7a99825a76b41125588987eab323c3dc2cbdb6b0db7557b6760a776fd0c05b"
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
      "fingerprint": "3b2389ccd079b23a8bc57b5335696e9c8a757d2bc32f82ff6097d6323d04a63e",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "dd7a99825a76b41125588987eab323c3dc2cbdb6b0db7557b6760a776fd0c05b"
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
      "fingerprint": "171cc5723479e71114a67c9fba344709c3fbe7f438f74b5609760552f04e7398",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "dd7a99825a76b41125588987eab323c3dc2cbdb6b0db7557b6760a776fd0c05b"
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
      "fingerprint": "2c2b39745c298a89eb66ed6b859fca01380c18022285bc8cdb350dfebcb7ad5b",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "dd7a99825a76b41125588987eab323c3dc2cbdb6b0db7557b6760a776fd0c05b"
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
      "fingerprint": "62ffff9782daaf1ff018a14e369e631aae6070b20b68da429d41e91f21ff2a31",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/kuali/declaration.ts",
          "sha256": "cf8def89a53cb7a3e9fe5565256a2a979b351aba360096d881cc8dbf1d3925bc"
        },
        {
          "path": "src/stores/kuali/driver/interpreter.ts",
          "sha256": "dd7a99825a76b41125588987eab323c3dc2cbdb6b0db7557b6760a776fd0c05b"
        },
        {
          "path": "src/stores/kuali/driver/ui-registry.ts",
          "sha256": "41b3debdad81890b91dd03ad77cf1d6af6850d136196668efeb5ac89948828ab"
        },
        {
          "path": "src/stores/kuali/finalization-verdict.ts",
          "sha256": "f3f66f054052a953160a26e882f5c72f48a301ae51f9a6b03c5ba1dac6a0bd53"
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
      "fingerprint": "3ab40ac1aa882f75c2c80ec367636b4101b8463c1dffaf4637c40f6052885612",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
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
          "sha256": "1aefcc421844dca79ed06b29f61543503ea41c5adf10a6fa9b290768d1c8e16c"
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
      "fingerprint": "85f10b115fd25db9b0fd42a4b344c89e663e25b6f708b6e4e32ba8fe9f3bfd09",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
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
          "sha256": "1aefcc421844dca79ed06b29f61543503ea41c5adf10a6fa9b290768d1c8e16c"
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
      "fingerprint": "624ae91fdf7a5382ef29c50bc5f9ea387233024ac27e8b50b3423ce274febe7f",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "d17a5b9244f540e3596641c6d5e417a28696b123bd4c1be3b753be99bec6e3df"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "600e366f6ead717bc2b5169e89962e5688c8f2c9a17ac98d24527d13153e09c2",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "d11e136fd9e4c6c61f1b9feeda6e6e481085ea45377fb0ccc591409c4f1c21d9",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "7656d393fc47c51d251b24749e1c35effd445d99125ccf096fec3876412a12d9",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "d0234cac71b510125845d5b8103f10416417d5d943b34f5c1295e86dac8b0a88",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "33e532f425539eb0a4caec7e6c1758b1cb05ab11dfda6092795c8418e2886b6f",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "ffebd53694307fbbbc314636130a40f4b1cf8bf7bdd86bfe08d00b483f65f69a",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "5a071a4d302a9624b25fd8a41029e176f12db790d748bfe60557487a5369d09d",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "bf3318d36c0a80b80f808d350cc8d4e283b3730724b27d70215ab8cdda21303d",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "41808cedfb5e5a5d8f9f151f200cbfa790a96f25396e80b825aa3fe8a6955606"
        },
        {
          "path": "src/stores/ucpath/tasks/read-pending-termination-set.ts",
          "sha256": "54fada97d735e15499381ac8c20db628d5d0afa8e9621e4dbfe9969a83e794d6"
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
      "fingerprint": "608877ef277cb9bac31918e35b0273555c1faf740f18efb569d0bc0c12a7544e",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "6a8631a7316805b026df2c096affdec0548c0c55484090821616486f23fda356",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "c59dbdf3593e288b4b9d27796d9f877e4e54b3fa7fe42167c69efcc0bbee3dba",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "2f3d0ed5dae84e7d003be6ab75a3a90beaef0ee49cbdae0acfc24e39dfc854fc",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "36a65c13e5ea12329c8a059a99a6e4dbc8f23547ac029a6b235b4a54b3339b5a",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "eed18922a8402e57f77d5f16d54beb3e5406154f248226cbb5bdcd6376f98a87",
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
          "sha256": "02dfbffcb966060aa171f4c819d994322d99587f26034992c0082c720df8b9e1"
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "955f69796b2f253191aa92bb9eadc7d445c36e997e514de123bb7297ec40ba98"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "21971f6f565bc63ae70e827f6f036e4020d72c1eef82b66a0021dd08792825a2"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "39880d81159ffaec04dbce36b43a9cd236312ac027be5e5c0f0ff2c91cc7dd8f"
        },
        {
          "path": "src/domain/workflow/step-omission.ts",
          "sha256": "92d8843ab0e7b1b88d2214034a8cc86f9833964a85bd840dc35be8bd7ac27576"
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
          "sha256": "fcc03116450c4ba4643baa93e273ba0ab52857dc73f54eee73fb2c3941146379"
        },
        {
          "path": "src/infra/browser/action-notes.ts",
          "sha256": "a2d682168cba5d95a2c8bafacb7b772898ef58c734ae809932a66f5a20c6af52"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "1082f7f3bb71c82790923ddf51058fae080d67b6ce9e4ba70afd87ccc2b12e30"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "88cd02879ace83d6da6319bb5b74693b7e5caa735ed76818fe0ffa6aa4ea7595"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "8438b4b1268716be3dfe3faf417169fb631b23e7561df7b0ce84504533ac8945"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "01bc084c5ee4163bde98168f089b8cf847242da1efcac6da90d778674521c585"
        },
        {
          "path": "src/stores/ucpath/driver/smart-hr-operation.ts",
          "sha256": "c5b89f72ecd626543e54c4ef76d1344716e3edeb83b8203e6f6d3551f8ce0a89"
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
      "fingerprint": "86e758af0bab3e28122a409bf00b1c40073cae51531c6f29cdeef0e691e85f95",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "2ee4629f56d11bd017cf7c8021af54825ce4e0c43a02f1fe2c94839182d01cde",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "13fd10bb4294677e87da7d6a7b1f3e9b3e8a77a7dec03d6e7face8038c38c886",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "d076eb3ae7b2041df11b7b1427f2f1aa99fa7dd92a749f817dfc2a05a901b624"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "448faf801882cda4e1dbb0d068c10e50ba485666e1530b66104e30158ce77cd1",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "ec551365357711e7f9016d7766746d08dd571d55a651135be81ccf7ef78d2aee"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        },
        {
          "path": "src/stores/separations/tasks/match-identity.ts",
          "sha256": "75850847f9297d40fe6e1af6d2f3f582246c6fe8fe33dd6199b2e18824d0bb7e"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "f91c6f3705a7e645e9f16c608e2416ccbc70aa8629c9c425f59199bd2d8cfc8c"
        }
      ],
      "id": "workflow:separations/match-identity"
    },
    {
      "fingerprint": "c52c9edbe8b546b04cb02a9f7e9cb659c05801288fac488491db8887ba2041d1",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/separations/match-separation-subject.ts",
          "sha256": "4ee6e1f97f993c7ac4dc087d73a29091798851f63b1c349f2dd3af0a3e6e6596"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
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
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "aec50ac37a0fd15b1ea1261dd367b0f6b6598bb16d750678e177d497042588e3",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "2ac24be5c164087ba4336c80c43fbf50f15c59be5191ea28d20562d4eb8a9f74",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "f5a4156b3500f354f81f36b124449c5bbc439b0f76750c9e923cb424426de6cb",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "4a30ce5b64a782e3726f1cdfbc39e74c8fba84fb2a157c5a2edfabce9f88cb99",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "95115b226bfa8fa535776f1b6695f70a51bad3c884c7d3c4e74dbdafba10bffc"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "db01c58ba8ff7ba8b5a70327fbfd6a80beedd12fe97e64cf23610d3a3fb6cff3"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "b94b24f98934e37ad7c8fc57655bb060054b87cfc5a68a09b14e51ac0da43f51"
        },
        {
          "path": "src/domain/gates.ts",
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/domain/separations/identity-approval.ts",
          "sha256": "377fbdc543d17d89e944ae665297653297a867718e776b8d28fb449e60580489"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "ded59e3854d20de4ed1fc06cf64b75a5bac493c4c2cae695c982ff4e52df90fb"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "2a03719bacd79f31d54d443224d4a812fd5a1be1a8b0ca25a50354ae3b9188b8"
        },
        {
          "path": "src/domain/separations/write-plan.ts",
          "sha256": "7f22027685ef5eaf19530f03231833a3407944f3a7a54805724dd384c5214e34"
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
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
      "fingerprint": "332a5523054d6a09d5dd47c2bc8d40a9dbbde4deb58f9518fe101eadd09b066f",
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
          "path": "src/domain/config/catalog.ts",
          "sha256": "655a8b9db18c46a61ef2189a54b705220ff2d22aae0f14276768b95a9d6e3332"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "2ffbac2404a41d672f1f5978a54a5a7c0bef6e17de83bca399f91b09e56e00d1"
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
          "sha256": "90bae6683c1cffcb534fc8765c0074e08a4c59d0b320273ee295cc45c88f4c49"
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
          "path": "src/domain/protected-input.ts",
          "sha256": "4c9482e755486ea24795911dd4eaa8202d446bf790d3c3d6685248df68eafb5e"
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
          "sha256": "9cc937302cc7418c846e3da1e846642bb8de58af769ca10d03d2b516efabb26b"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "3e8d673029a6fcc0016f61592eef183b8119d4e92123a13b7cb76167b6a7f76e"
        },
        {
          "path": "src/domain/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
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
          "sha256": "3af202af97d251c9694f160f56ab584099444dea031daf461998456b46194c00"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "f5066d09381252b078ab26ea1787d7d17a0a2f555b35c6a52841d4569c2f4c17"
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
