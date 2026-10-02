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
      "fingerprint": "98d85df05779fe41f9a01bbb9cfe1eefb397ff81322ca958859d0f66d51e514b",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "7df55c8f36ab61ea20a93441acd8dc2f4712d9f34c618a06a2a261313ad1681e"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "067f2790801ab2590512bea3075b02f39b8957269f44e21184539958bcd249bc"
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
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
          "path": "src/domain/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/rerun-values.ts",
          "sha256": "06544d1d9a808bd5d5efb7a40eac1439f8001e9000f68261c6b5103cf8c3c311"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "979dfacb2be8245363d70fc9a05ebd93b52fa5e71034eb4f2d67f40327f3489c"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
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
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
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
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
          "path": "src/workflows/person-lookup/workflow.ts",
          "sha256": "db443bff1b3924a5a734d78a3c5241a798915ee9710ef174c53a39a43cdc708b"
        }
      ],
      "id": "person-lookup"
    },
    {
      "fingerprint": "684b99d4009e5777f9b030db8a6e34fcfe82f34ea96cf9ba09a40b2330547c58",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "7df55c8f36ab61ea20a93441acd8dc2f4712d9f34c618a06a2a261313ad1681e"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "067f2790801ab2590512bea3075b02f39b8957269f44e21184539958bcd249bc"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "edcb248b1c704cd28204a056cb3f742bb49a729d256c0f4baa8efe3ece9f6c24"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "14e4aab50ffed9af54124276e242abe9fb79fdacf6c054eeb3e0adddfef10d39"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "e579479349de809fff0077c3a00e5ee1e25126e7aae9a434756f81023b11a8f1"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/rerun-values.ts",
          "sha256": "06544d1d9a808bd5d5efb7a40eac1439f8001e9000f68261c6b5103cf8c3c311"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "979dfacb2be8245363d70fc9a05ebd93b52fa5e71034eb4f2d67f40327f3489c"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
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
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
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
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "75d795cf74a630a4ebfa021ae07d2df188553110bd15b06d6f9b2652cc799bab"
        }
      ],
      "id": "separations"
    },
    {
      "fingerprint": "cdf1704832253d65d397d34efcbf5d6ebb279c603180b255e521225cb9bffb33",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "7df55c8f36ab61ea20a93441acd8dc2f4712d9f34c618a06a2a261313ad1681e"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "067f2790801ab2590512bea3075b02f39b8957269f44e21184539958bcd249bc"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "edcb248b1c704cd28204a056cb3f742bb49a729d256c0f4baa8efe3ece9f6c24"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "14e4aab50ffed9af54124276e242abe9fb79fdacf6c054eeb3e0adddfef10d39"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "e579479349de809fff0077c3a00e5ee1e25126e7aae9a434756f81023b11a8f1"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/rerun-values.ts",
          "sha256": "06544d1d9a808bd5d5efb7a40eac1439f8001e9000f68261c6b5103cf8c3c311"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "979dfacb2be8245363d70fc9a05ebd93b52fa5e71034eb4f2d67f40327f3489c"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
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
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
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
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
      "fingerprint": "ee5c47aa5f1df883ac4078840fed2a31d717132039af3060f45d09608e19bf8b",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "7df55c8f36ab61ea20a93441acd8dc2f4712d9f34c618a06a2a261313ad1681e"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "067f2790801ab2590512bea3075b02f39b8957269f44e21184539958bcd249bc"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "edcb248b1c704cd28204a056cb3f742bb49a729d256c0f4baa8efe3ece9f6c24"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "14e4aab50ffed9af54124276e242abe9fb79fdacf6c054eeb3e0adddfef10d39"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "e579479349de809fff0077c3a00e5ee1e25126e7aae9a434756f81023b11a8f1"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/rerun-values.ts",
          "sha256": "06544d1d9a808bd5d5efb7a40eac1439f8001e9000f68261c6b5103cf8c3c311"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "979dfacb2be8245363d70fc9a05ebd93b52fa5e71034eb4f2d67f40327f3489c"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
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
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
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
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
      "fingerprint": "bd1673ea7b7333f93fc9ac6da8a4c5479743586557ad22f497883d65ef96b169",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "7df55c8f36ab61ea20a93441acd8dc2f4712d9f34c618a06a2a261313ad1681e"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "067f2790801ab2590512bea3075b02f39b8957269f44e21184539958bcd249bc"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "edcb248b1c704cd28204a056cb3f742bb49a729d256c0f4baa8efe3ece9f6c24"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "14e4aab50ffed9af54124276e242abe9fb79fdacf6c054eeb3e0adddfef10d39"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "e579479349de809fff0077c3a00e5ee1e25126e7aae9a434756f81023b11a8f1"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/rerun-values.ts",
          "sha256": "06544d1d9a808bd5d5efb7a40eac1439f8001e9000f68261c6b5103cf8c3c311"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "979dfacb2be8245363d70fc9a05ebd93b52fa5e71034eb4f2d67f40327f3489c"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
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
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
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
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
      "fingerprint": "a870be3ac394b81bb3beedd976f936f0d4bd123f24575b4166befb356c49a136",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "7df55c8f36ab61ea20a93441acd8dc2f4712d9f34c618a06a2a261313ad1681e"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "067f2790801ab2590512bea3075b02f39b8957269f44e21184539958bcd249bc"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "edcb248b1c704cd28204a056cb3f742bb49a729d256c0f4baa8efe3ece9f6c24"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "14e4aab50ffed9af54124276e242abe9fb79fdacf6c054eeb3e0adddfef10d39"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "e579479349de809fff0077c3a00e5ee1e25126e7aae9a434756f81023b11a8f1"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/rerun-values.ts",
          "sha256": "06544d1d9a808bd5d5efb7a40eac1439f8001e9000f68261c6b5103cf8c3c311"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "979dfacb2be8245363d70fc9a05ebd93b52fa5e71034eb4f2d67f40327f3489c"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
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
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
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
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
      "fingerprint": "ecd7b24eb9b6272ec3faf44b8d2d6de4dfd87cf456e2b1399adbc3b68498f361",
      "sources": [
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "7df55c8f36ab61ea20a93441acd8dc2f4712d9f34c618a06a2a261313ad1681e"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "067f2790801ab2590512bea3075b02f39b8957269f44e21184539958bcd249bc"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "edcb248b1c704cd28204a056cb3f742bb49a729d256c0f4baa8efe3ece9f6c24"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "14e4aab50ffed9af54124276e242abe9fb79fdacf6c054eeb3e0adddfef10d39"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
        },
        {
          "path": "src/domain/separations/separation-dates.ts",
          "sha256": "2caaeeb52116f706086f6865478de405b7510f396602aed9e3cb51f6fd12abff"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "e579479349de809fff0077c3a00e5ee1e25126e7aae9a434756f81023b11a8f1"
        },
        {
          "path": "src/domain/separations/termination-receipt.ts",
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/rerun-values.ts",
          "sha256": "06544d1d9a808bd5d5efb7a40eac1439f8001e9000f68261c6b5103cf8c3c311"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/build-manifest.ts",
          "sha256": "92469ad2a164322adc2ba9315fb49b9db76834fede1c958d78c75b35d5a45418"
        },
        {
          "path": "src/domain/workflow/canonical-input.ts",
          "sha256": "979dfacb2be8245363d70fc9a05ebd93b52fa5e71034eb4f2d67f40327f3489c"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
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
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
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
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
      "fingerprint": "e8680047202f168bd8a5d1dacaabcaaa1a9444b3c7daaa6f2f1c001a86baa571",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/crm/driver-declaration.ts",
          "sha256": "056910108fd526e6e16d8174dc0c784b9dd9157e63f05a2fd796f71177cfcb7f"
        },
        {
          "path": "src/backend/systems/crm/driver/interpreter.ts",
          "sha256": "0d58c639e9b9a401d511a8125efa4e7bf2d1841444c1605046af32f9a6331e90"
        },
        {
          "path": "src/backend/systems/crm/driver/ui-registry.ts",
          "sha256": "96326d8a687f99e9e7e22000dba90b843d19dc22cedb26fd2642d20af9ff5aa0"
        },
        {
          "path": "src/backend/systems/crm/tasks/read-onboarding-dates.ts",
          "sha256": "0cef05af8f6d9fc5ef351d4b5ee64f11827d75eaa8b4bb994205c5a16396614c"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "crm/read-onboarding-dates"
    },
    {
      "fingerprint": "de479598ac7b014e7f7aa5fd6635e681d537e0c349ccef11854f3c72d26649f0",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/crm/driver-declaration.ts",
          "sha256": "056910108fd526e6e16d8174dc0c784b9dd9157e63f05a2fd796f71177cfcb7f"
        },
        {
          "path": "src/backend/systems/crm/driver/interpreter.ts",
          "sha256": "0d58c639e9b9a401d511a8125efa4e7bf2d1841444c1605046af32f9a6331e90"
        },
        {
          "path": "src/backend/systems/crm/driver/ui-registry.ts",
          "sha256": "96326d8a687f99e9e7e22000dba90b843d19dc22cedb26fd2642d20af9ff5aa0"
        },
        {
          "path": "src/backend/systems/crm/tasks/read-onboarding-record.ts",
          "sha256": "2801d13389886ef87becb161a39b8b104c3896c754b82196a621ca56d65d8430"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "crm/read-onboarding-record"
    },
    {
      "fingerprint": "8ee3250a336ea3c5bf047bff0e8d36e83757e5929898c4cc7e86548341726322",
      "sources": [
        {
          "path": "src/backend/processing/extraction/tasks/extract-pdf-pages.ts",
          "sha256": "616046eddb013a016361e07b524f2a54ec0a8713c532dcfbc081ff75f53222d1"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "extraction/extract-pdf-pages"
    },
    {
      "fingerprint": "fbd7e0be19f959ca774f549ba92b636e7a284ad9a40b4e022e4cae479a80434f",
      "sources": [
        {
          "path": "src/backend/processing/extraction/tasks/extract-spreadsheet.ts",
          "sha256": "137b8623bdf2603074aea06cd3935ac532a95d86cb44ca3610ba24e5b5137078"
        },
        {
          "path": "src/backend/processing/spreadsheet/spreadsheet-grid.ts",
          "sha256": "5180dc6c485f397fcd5dc6b95702b25f079542868e177ac418e9d9e4dc86f356"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "extraction/extract-spreadsheet"
    },
    {
      "fingerprint": "ef88b86f0b93b2c2117e13ffd4721ed930ff645bf158fbd1868e83fabf74c057",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "d4b7d2f917583779cc31f189e4c7a21a611bd59011c4ab4940d9936e7ad9c08e"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "db7f984404516f60362f63dd60018d66ba5151f9ee894d9f1455843302f7566e"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "be990863d5d426aed41eb8398683f83cc1203a1957c83d2623c342baab408af2"
        },
        {
          "path": "src/backend/systems/kuali/finalization-verdict.ts",
          "sha256": "f538b52c2dfcb78928d07d7c9e8f465546bbe7b7310f184cc21cab20fe8d0721"
        },
        {
          "path": "src/backend/systems/kuali/tasks/match-separation-finalization.ts",
          "sha256": "19cfb07ca8e6574497b236f277752710478e25bf313e24808f48f1726d0298c2"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "kuali/match-separation-finalization"
    },
    {
      "fingerprint": "e231cafd4624916669f185c2c65306d7374a2e5821345a3ed1679af404250b99",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "d4b7d2f917583779cc31f189e4c7a21a611bd59011c4ab4940d9936e7ad9c08e"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "db7f984404516f60362f63dd60018d66ba5151f9ee894d9f1455843302f7566e"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "be990863d5d426aed41eb8398683f83cc1203a1957c83d2623c342baab408af2"
        },
        {
          "path": "src/backend/systems/kuali/tasks/read-separation-document.ts",
          "sha256": "201ff5d6df193764efc75e1454da7722371d044bd66c65ff91a404e9f6853666"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "kuali/read-separation-document"
    },
    {
      "fingerprint": "e6006ad873a095435a69989b362ae4f5729763c2eb7cfa3201644639cffae960",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "d4b7d2f917583779cc31f189e4c7a21a611bd59011c4ab4940d9936e7ad9c08e"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "db7f984404516f60362f63dd60018d66ba5151f9ee894d9f1455843302f7566e"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "be990863d5d426aed41eb8398683f83cc1203a1957c83d2623c342baab408af2"
        },
        {
          "path": "src/backend/systems/kuali/tasks/save-separation-finalization.ts",
          "sha256": "1693038ce04a7a0c11f75e24c65f78b7c99bc37f2188f3f42e98ab4accd954af"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "kuali/save-separation-finalization"
    },
    {
      "fingerprint": "276e708245b9c855b4ee8007c11974a7776e0e5fa5f333a102dd1f596fa3ede7",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "d4b7d2f917583779cc31f189e4c7a21a611bd59011c4ab4940d9936e7ad9c08e"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "db7f984404516f60362f63dd60018d66ba5151f9ee894d9f1455843302f7566e"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "be990863d5d426aed41eb8398683f83cc1203a1957c83d2623c342baab408af2"
        },
        {
          "path": "src/backend/systems/kuali/tasks/search-separation-action.ts",
          "sha256": "6d7f607a35bb847cbbf4cb3ed3d4ba7b9b01c37279585b2aef8d3219cc99763b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "kuali/search-separation-action"
    },
    {
      "fingerprint": "8798a886ffbcc4f25f12df574393fb61a7d38770e6cf3c98883b3814eb9fac9a",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "d4b7d2f917583779cc31f189e4c7a21a611bd59011c4ab4940d9936e7ad9c08e"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "db7f984404516f60362f63dd60018d66ba5151f9ee894d9f1455843302f7566e"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "be990863d5d426aed41eb8398683f83cc1203a1957c83d2623c342baab408af2"
        },
        {
          "path": "src/backend/systems/kuali/tasks/stage-separation-finalization.ts",
          "sha256": "c533a9596054388747e764772f0f883cf9e1787ad0c489a1d3246c2baa51c7ab"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
        },
        {
          "path": "src/domain/contracts/kuali/match-separation-finalization.ts",
          "sha256": "f2a942d586c48aecfe443c726b3912008a17f5c3084e3c9fada4f932258316d9"
        },
        {
          "path": "src/domain/contracts/kuali/stage-separation-finalization.ts",
          "sha256": "edcb248b1c704cd28204a056cb3f742bb49a729d256c0f4baa8efe3ece9f6c24"
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
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "kuali/stage-separation-finalization"
    },
    {
      "fingerprint": "b960033cb7707c1eb0d7333087c73b6f861997fd593af63f90d25d0df82027bf",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "d4b7d2f917583779cc31f189e4c7a21a611bd59011c4ab4940d9936e7ad9c08e"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "db7f984404516f60362f63dd60018d66ba5151f9ee894d9f1455843302f7566e"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "be990863d5d426aed41eb8398683f83cc1203a1957c83d2623c342baab408af2"
        },
        {
          "path": "src/backend/systems/kuali/finalization-verdict.ts",
          "sha256": "f538b52c2dfcb78928d07d7c9e8f465546bbe7b7310f184cc21cab20fe8d0721"
        },
        {
          "path": "src/backend/systems/kuali/tasks/verify-separation-finalization.ts",
          "sha256": "d24b3af941201f7e1ffbdf7f7eb08995f4bca567f84ac55dbe6bdc03920b84ab"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/kuali-action-list.ts",
          "sha256": "dd2634d0988e9d9e172377e5b9a565d8f6c484c8340dfb54c728eb3f91967707"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "kuali/verify-separation-finalization"
    },
    {
      "fingerprint": "e864bdcf63104d3556ce912cccec98c87c8c8169c7c6dd44b0241849e67ff5d0",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/new-kronos/driver-declaration.ts",
          "sha256": "4e9d5fb1698365ad456a55b399dca4bfc67978c77963c9ce169e2474a6ed4b3c"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/grid-scroll.ts",
          "sha256": "76833bd69585ab300f19ad475b183662fbbee0c22427723f7fc6591b05040e97"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/interpreter.ts",
          "sha256": "cbc30a341c9deb7ea3323d0ecc7c0a26cb4ae7119edc321333e3bc0ba8bc3250"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/search-render.ts",
          "sha256": "031b18899f489a8f5e6f529d54c4a50ab3e960517fcd1e5a7d867dfbdb9d3d2b"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/ui-registry.ts",
          "sha256": "ba37abf1df427a0ba488eb426895bb671f6971359a0fa8fd3d0c6c56c989d959"
        },
        {
          "path": "src/backend/systems/new-kronos/tasks/read-separation-timecard.ts",
          "sha256": "69495545635501d3d383977fd8441f57e246161bca5f5221f9413e701ee3ceab"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "new-kronos/read-separation-timecard"
    },
    {
      "fingerprint": "15ec5c3c159510a03e976151ba043304dd88b0e70f07b33456db56bee536e02b",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/new-kronos/driver-declaration.ts",
          "sha256": "4e9d5fb1698365ad456a55b399dca4bfc67978c77963c9ce169e2474a6ed4b3c"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/grid-scroll.ts",
          "sha256": "76833bd69585ab300f19ad475b183662fbbee0c22427723f7fc6591b05040e97"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/interpreter.ts",
          "sha256": "cbc30a341c9deb7ea3323d0ecc7c0a26cb4ae7119edc321333e3bc0ba8bc3250"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/search-render.ts",
          "sha256": "031b18899f489a8f5e6f529d54c4a50ab3e960517fcd1e5a7d867dfbdb9d3d2b"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/ui-registry.ts",
          "sha256": "ba37abf1df427a0ba488eb426895bb671f6971359a0fa8fd3d0c6c56c989d959"
        },
        {
          "path": "src/backend/systems/new-kronos/tasks/search-employee.ts",
          "sha256": "c139d25f767dca0e23cc9a19bc6a869fafb417bcdf35b3fe36667b8834b65a2b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "new-kronos/search-employee"
    },
    {
      "fingerprint": "844f5220c3dc93e43482d638e736c944e33f86d38a55c72c0e20a5f36dc05159",
      "sources": [
        {
          "path": "src/backend/processing/normalization/tasks/read-contact-advice.ts",
          "sha256": "e8f4b5037db0b3397db0afcbefa2c4188062fe9422703a603865e32b34855cd3"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
        },
        {
          "path": "src/domain/contracts/normalization/normalize-contact.ts",
          "sha256": "b7e2b4b7782e5e9103ff81b4cf4986cfafe1c5f6d2e38bc201bef76dde7624d3"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/trust/advisory.ts",
          "sha256": "12168c4bdbe897c64a22921d0ccb28b6303acbb5c51f27b2fc26047b18af256e"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-authority-reason.ts",
          "sha256": "1505d6b23aa38a628965ef867dacbc2402d58cf4a5801dd96efb04c147493ad1"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "normalization/read-contact-advice"
    },
    {
      "fingerprint": "596de58e91c2b241a9e10ffe51f82e4372cd0e13345528720a9c85947fc605c0",
      "sources": [
        {
          "path": "src/backend/processing/ocr/tasks/extract-form-page.ts",
          "sha256": "ae8fe2a6d2a4983860fe63d132783d32271121ac06a6e80099f81603b4e9b459"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "ocr/extract-form-page"
    },
    {
      "fingerprint": "d567c5a6d12df2629bdae801ea501aa11913c199795552d2925d594cb1805731",
      "sources": [
        {
          "path": "src/backend/processing/roster/tasks/match-spreadsheet.ts",
          "sha256": "33a29951ee065a5f2ef8b96047efa663398a8b535c9497676b7abfd7f1225c85"
        },
        {
          "path": "src/backend/processing/spreadsheet/spreadsheet-grid.ts",
          "sha256": "5180dc6c485f397fcd5dc6b95702b25f079542868e177ac418e9d9e4dc86f356"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "858265acd8d3592fa97af123c8e47917ccbe987800a89e9631ec08c71846d07e"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/validation/schema-path.ts",
          "sha256": "7bf900c9a0f131be0b389df22e5793dc9ef194e6edb521b85d3b68c29023689e"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "roster/match-spreadsheet"
    },
    {
      "fingerprint": "c9fc20a38dbe894b66625d9fe95548dbaa1a5ff2879a0bffe567b7926b652f90",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/create-termination.ts",
          "sha256": "4e20cb345352f7e5ff1c999e2db20aff888f5bed79610b4483d308931aa51c95"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/create-termination"
    },
    {
      "fingerprint": "93aaea59e4bd6396605a94f51079c73bc5cdaa65aea0e60f51838c7150dae0da",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/delete-pending-terminations.ts",
          "sha256": "3cf4d286deabaaa26a5914484f13acf3813845b795c04a5eda3dfe04dadd41ce"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/delete-pending-terminations"
    },
    {
      "fingerprint": "4b63e264d0b8b66a9ab6ef81072ccb41b7402ad932076a118af1693cc79defe3",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/match-existing-termination.ts",
          "sha256": "f53aafe35b4c76e009b3eca3ef8dd9a37a7c131b60e6c0fd9fb88e57bab757d7"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/match-existing-termination"
    },
    {
      "fingerprint": "af47a83b1165d92f155d93c6b5c8a1b09eef284131b4bb4f359eb08009765f8d",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/match-pending-terminations.ts",
          "sha256": "fd7a69d53764198ae803891cfca5e1f2f51b9912ed8afa3a6d6df7d499289fcc"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/match-pending-terminations"
    },
    {
      "fingerprint": "099a4585a4b614955372a653ae729618181bc359546957264ed0fb12bd1f9107",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/read-job-summary.ts",
          "sha256": "f979426930eb7d3ddbb021f9db85f44281c609e2751927ecc8aec4df0ecc8d6d"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/read-job-summary"
    },
    {
      "fingerprint": "1409be6a5f44001d70e3a7bdc0242d6ea389ec0a8b7aeb6a38851574f6aba1ce",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/read-pending-termination-set.ts",
          "sha256": "5e3ad849234363ba677dd22cf7f78bd60d1e8f1cc7f3bf99b53f59407e3cdf8f"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/read-pending-termination-set"
    },
    {
      "fingerprint": "7ade8cdd1e24cd53621312b3d230855add86bb6ffa066792b3fcb4c0da867dfe",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/search-person-org.ts",
          "sha256": "9a0e717400aec51cd5f1b3dbc78e2c0abe86c86d24de0d9ec78f26157a0e3e92"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/search-person-org"
    },
    {
      "fingerprint": "9b0806dca3a7ad3c3747e2cbe6d2df92f8fc78e8aa247e81f0e20947a70dbfda",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/stage-pending-termination-sweep.ts",
          "sha256": "324a121416d78a973faa0dc99fcc6efb82306efe147b0620d8c809b16880340e"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/stage-pending-termination-sweep"
    },
    {
      "fingerprint": "a773dbbc46fbd6c018f06e9f52bf7ca23e42d5cfbd0057f091a3560c510a8cff",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/stage-termination.ts",
          "sha256": "db6e7af720770dd7673a1f5cc240dddb6fdb2fd373a1b49897c26e582a60d9f6"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/stage-termination"
    },
    {
      "fingerprint": "c2e2f664c8aa7356f66e84782db8bccdc2e677bc12641cc041361676419e634e",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/verify-pending-terminations-cleared.ts",
          "sha256": "8e21f2a5ee3d7140eea228400218b630f2183fd48fb4f8eabae515cf0c13f8e4"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/verify-pending-terminations-cleared"
    },
    {
      "fingerprint": "88bf574de8d31e23ecd616188a31a3344b6c5a24c60ba49450d670adde7d6f8b",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/verify-termination.ts",
          "sha256": "993cce9aab45fefc1268d86c6938f402d10e5cfa2bc774e63fd6323a0fda33cc"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/verify-termination"
    },
    {
      "fingerprint": "ef46b2b1329d946af8f3c32810d5dad781d79348e0e3d52f0d7101f426b97cae",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "6eef344f8a25af87f9fe21e145d38cdca95910218dde8661ca54a6c4f1ea2ad9"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "e29ca10d260c8552806f27dddc41c8f0f9791d4619b276b90ba19b6815f08a73"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "76ce4c3043afac3e06aac3aaa707acdcae0c81b9e8e065c899b7b7b63098de36"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "6488d8303a8c3da4e99086630722c2fd1d992e642626daef4a266b7f11521825"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c8a6e8b89bda3d9b7520ebc66b956d4b7533736290117eb61522c4243c5eb1ba"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "838995ab517ebc58360185fbae13dabceda9752a5ced32f4c4dafc3e186c85ea"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "dfc1a76d1ee3d79728140a2c3c0692849a87748d26b5613d2c63fdd037c5e373"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/verify-termination-filing-present.ts",
          "sha256": "138cbcfa8bab946c6b479192ae1800e3103a23d4c7ac76ccdeec2b9f107b02ac"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "5e9e62a2214964d28f63a16140b03fb6ade09186b34a219e2df5833089c6eb8b"
        },
        {
          "path": "src/base/artifacts.ts",
          "sha256": "3ab98962effb0f9c0a2d3070b78f3d8bfe1dcf1cad266750b0f45a2b08dcdb7d"
        },
        {
          "path": "src/base/duo-ceremony-lease.ts",
          "sha256": "7c7f40f2ce520e1eea008cc8ec36e0ee1296b209a996b7a7e83457386375cbbb"
        },
        {
          "path": "src/base/errors.ts",
          "sha256": "d37463c6bfda7181c29d764275b99d553fc4dfa124846cdb29dec7ce853b2802"
        },
        {
          "path": "src/base/mutation-capability.ts",
          "sha256": "98838a9a6509b1e731ddf429a1f3e7c551c54defe32c3b18171da2b8092c9f14"
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/envelope.ts",
          "sha256": "b2e293e177b56913e22fca8a0d758959b5ebd2f944ddb0d7d7c06a345f602b31"
        },
        {
          "path": "src/domain/run/rerun.ts",
          "sha256": "cb1dc2351131e4d3f32c2ab198328e97c43077ea83d7115a523b811caf69e565"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "b4dc772c1c271392eaefaabce0170d25b4df73b58c51175cfa4afd5835efcf62"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a10e354b8d25de70987b932afb07818988bbbef0fc5e2abc0dbe240426efa53d"
        },
        {
          "path": "src/domain/ui/ucpath-smart-hr-termination.ts",
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
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
        }
      ],
      "id": "ucpath/verify-termination-filing-present"
    },
    {
      "fingerprint": "800b1f23a2fb1f9cc11c813ffec911e2847024ee417ab898bab12ad7dad3c6d6",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/person-lookup/tasks/read-active-status.ts",
          "sha256": "8c1b60d7343578b8c909461c8d70f2195133d70dff84ec1d184fcf0bc112eda9"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:person-lookup/read-active-status"
    },
    {
      "fingerprint": "5a3fc0a8aee36207f8cba39da9eb57898581d75804bf13810d3d534e4f22faf8",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/match-active-employment.ts",
          "sha256": "4499e006703ff03f663e35a74bcb7b9b73a1ddaf4e8193f50645c17b4d78a3bb"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/match-active-employment"
    },
    {
      "fingerprint": "5fb0f6b037e5e7878f1e0ea8c04d4b492b9802b5c9eb2e662c2c5e026ee4cf89",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/match-department-option.ts",
          "sha256": "c20b23b3d3a5173a2027798d83552f5875cd75d2c7f719de121c28ba7045ceee"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/match-department-option"
    },
    {
      "fingerprint": "f0d172b5ff5e1580ac23dac0c31877bb79af8c1472a2f2c3fe995821bec478a0",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/match-identity.ts",
          "sha256": "9673b608ccdfd243d8c6adc70cfeecd8d2d1e52c09f87ddc64e5dad8dee3920c"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
        },
        {
          "path": "src/domain/contracts/separations/match-identity.ts",
          "sha256": "ec551365357711e7f9016d7766746d08dd571d55a651135be81ccf7ef78d2aee"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/match-identity"
    },
    {
      "fingerprint": "726851a1b6d66666bbc8e38d8c24645adc928ca7ab1b50ae3cdc95e533fe6134",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/match-separation-subject.ts",
          "sha256": "4a94a644c66df66c0f3c9072cdbff02c388de1b08c9b34705f0c3586b53c8459"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
        },
        {
          "path": "src/domain/contracts/separations/match-separation-subject.ts",
          "sha256": "4ee6e1f97f993c7ac4dc087d73a29091798851f63b1c349f2dd3af0a3e6e6596"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
        },
        {
          "path": "src/domain/separations/separation-subject.ts",
          "sha256": "e579479349de809fff0077c3a00e5ee1e25126e7aae9a434756f81023b11a8f1"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/match-separation-subject"
    },
    {
      "fingerprint": "5856e10ea1b42fc9702f108e1922588d7feace7e515ddfda898b94b80e5b3e5e",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/match-termination-type.ts",
          "sha256": "211e7f79c5cefab9ad8570cafb26efc2214d75e363d2b4ac0df13bf5bc346369"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/match-termination-type"
    },
    {
      "fingerprint": "bded8380460f41695d869d4189c450235ca6a7955b6ff24a92c663b77b863ce0",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/read-separation-dates.ts",
          "sha256": "f037b84932837a2426e5602f81401ad12595bfdab9b807909e7b745144f4b97d"
        },
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
          "sha256": "c41cc3d49cc04d9d8a538808214f73fece23bdda2d03d2857d571ec88006d371"
        },
        {
          "path": "src/domain/config/catalog.ts",
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/read-separation-dates"
    },
    {
      "fingerprint": "fca925375231ba44d4a9573d6261399c1dae67fee3883c117a994ec743947142",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/read-separation-plan.ts",
          "sha256": "18ad1023a113f8209fbdf684a2852ab66009e457cb8c797dd597be7dfedf9e63"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/read-separation-plan"
    },
    {
      "fingerprint": "8b99ba757b83092dd8aed59dd47af2d0ec1d93defc14cb6a464348cc09202b5c",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/verify-identity-approval.ts",
          "sha256": "6840e3ca8729fb4f988d276dcf72dba624476a91c6e955f7a69218c8b94d9eef"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
        },
        {
          "path": "src/domain/contracts/separations/verify-identity-approval.ts",
          "sha256": "95115b226bfa8fa535776f1b6695f70a51bad3c884c7d3c4e74dbdafba10bffc"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "1405785184cbf903b62fa82aff8c8a4635b51e4ec720d7c7b60aa71f29ba2ea1"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "14e4aab50ffed9af54124276e242abe9fb79fdacf6c054eeb3e0adddfef10d39"
        },
        {
          "path": "src/domain/separations/identity-evidence.ts",
          "sha256": "8a0f3be72e482a59cc3362d421238f7533814703e6d6c09f559d3ead992aa31d"
        },
        {
          "path": "src/domain/separations/job-summary-classification.ts",
          "sha256": "79c775ea73ebbd75ac10c9abf749dcd4d8a2832a6e4a80a35e3430d6bb728c4d"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "1e6462b5d4120e9be3cdb780696f7ce42c967769163c286fda73ca32f01b0043"
        },
        {
          "path": "src/domain/ui/ucpath-job-summary.ts",
          "sha256": "05bf265762b8fb5107802997fddc94a70c0377f247c761f8ebe6c4de8939b4cd"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/verify-identity-approval"
    },
    {
      "fingerprint": "f133e200280ecd1f989fabea9b12f81af92f3bf86aef9618faf3f16fbebf4dd9",
      "sources": [
        {
          "path": "src/backend/workflow-tasks/separations/tasks/verify-termination-receipt.ts",
          "sha256": "8549df4d0f3ed930dc23272f8a07ea27d748e9b0139f79fa3ec062d111aa50aa"
        },
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
          "sha256": "7eab89768faff6fc1f71eddcd98bcaa9d7a329be3f042eee066f6e05c3fa64ab"
        },
        {
          "path": "src/domain/config/schema.ts",
          "sha256": "a63f2e0d7ef1c0317120f89d6bdbc0f8202211a6916f2a9574d1eebc872ff185"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "1d6cf9ecbfe1887839cc03f7701cb57facd8b25978e4d75f945d7fa3742b885b"
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
          "sha256": "0ce1b3da7c34b576979b8aa2da3d8738690b5be599a727cc1d55c61348ac4d9b"
        },
        {
          "path": "src/domain/run/result.ts",
          "sha256": "3db3dc6dc326f107e668bc68c715ece5db56970316a315da0c000c43351cb936"
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
          "sha256": "99a9d6764d56b0041383966103ef48d6babf60c81feeafdbcfb57cba400077a9"
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
          "sha256": "cd799f13e09649b148ee35962d6f61d73068d54b64732444c2680e7a9df66554"
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
          "sha256": "3a45fce8a3e10011d0836fd945720e180eff0319593051d0c2123adb2874d047"
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
          "path": "src/domain/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "54a3c757cc218e400f0fc6aaa09ce343c6ab36f522f2affc492fc30940cb0f5f"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "327ee508f38652d7f0b2e803fd11b64f998b0d8dc2bd4d325fb6977eaa42dcf2"
        },
        {
          "path": "src/domain/workflow/node-condition.ts",
          "sha256": "f1c529d5de2edd37b73a006871890504891556c22d2f14fc85c6138bdf2566c5"
        },
        {
          "path": "src/domain/workflow/operation-action-identity.ts",
          "sha256": "a47d8f2f386e232fc863a667d68e21857316727341e939fe84a956aa830e410c"
        },
        {
          "path": "src/domain/workflow/operation-display-snapshot.ts",
          "sha256": "b4015d4c8ca0d2acda45a53f98dd1b64cb54e4415e66a714f1cc13904d3a7558"
        },
        {
          "path": "src/domain/workflow/operation-display.ts",
          "sha256": "be1c69fad290802ae23a7801b4b37a9323230fee7dea260c43eba4b545684dc5"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "a555666140133d18e3b5dfc9b41cf8b3b70f6e0de2df05812f6126d83a442c5e"
        }
      ],
      "id": "workflow:separations/verify-termination-receipt"
    }
  ]
} as const;
