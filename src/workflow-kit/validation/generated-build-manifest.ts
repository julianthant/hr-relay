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
      "fingerprint": "e0d7dccd6d5771028a166ca5bf056e5272a2d6bc784b3d91ae6e6231301fb931",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/crm/read-onboarding-dates.ts",
          "sha256": "6f80dfb3e080aa54cd4eba8b3cfabe45f5edd6b6adb1db6308c886ee3ea9a058"
        },
        {
          "path": "src/models/systems/crm/read-onboarding-record.ts",
          "sha256": "a45f021bbc7804c234c7989497c7f38f47d1329607cef27c1a1acbc9b7623a2d"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/rerun-values.ts",
          "sha256": "36ff889a98870c3f22f9321e194b503a6f2824fd9edbea01c461c67ac282d9f0"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/canonical-input.ts",
          "sha256": "d298fc5a612e184b96362c0fe859da736dd4a3b0196fcceeb3144b9195043b85"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/completion.ts",
          "sha256": "a65d859659fc6accdf4fa2b7d4c8da242fa073187d05d18480ecd9a331201b98"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/ingress.ts",
          "sha256": "9c58280f1e53f440586628cc5f0870328b3c38bc73237f751fc9b8e13fb6d438"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/rerun-values.ts",
          "sha256": "554434417067c9702503b8c5e1d8b6a838ce2da7163dd60f473a33cf8a25025a"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/workflows/person-lookup/read-active-status.ts",
          "sha256": "bd0e6043e5903a478d0ec183d604bf42463d859f80d8babad3113ee52adf08d1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/flow.ts",
          "sha256": "07d26a20963ef90eada13f456bbde8129a3de038940972df19b82909814b9789"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflow-kit/validation/build-manifest.ts",
          "sha256": "35d6b4f2b9c2d7a7d08109304fd71226d0891840b3adba70ef1572037efe458e"
        },
        {
          "path": "src/workflow-kit/validation/module-role.ts",
          "sha256": "e1f963f9f2cfa319ad137a32f8303a8b31b06e2fa54a9f0eff1c9c474fd78758"
        },
        {
          "path": "src/workflow-kit/validation/scenario-coverage.ts",
          "sha256": "0c4d3374cea3e931e337806761f775302a1024d0e794c55890b02e7952191e85"
        },
        {
          "path": "src/workflow-kit/workflow-definition.ts",
          "sha256": "9f175147793eadd17aaf669972fd67cccda32d2f15515e96550853ea47a7baab"
        },
        {
          "path": "src/workflow-kit/workflow.ts",
          "sha256": "0793e7f363d2a950398194c98ec33ea9e7030735d31a26d1f0fb5aa362ec6217"
        },
        {
          "path": "src/workflows/person-lookup/workflow.ts",
          "sha256": "7739dfb29b4b4d855bf4cd57d383966fd8038efcaa21feac57b441d9e1920ecc"
        }
      ],
      "id": "person-lookup"
    },
    {
      "fingerprint": "e5ac4b6bdd15b759fca78c2aa27fb712c4d2fdcaf5b465faf8f2f6d43877e201",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/read-separation-document.ts",
          "sha256": "819f659cb964c6de48b8900d7794d6a8f009b8a362bd41f9ebc7ecfefbe0f530"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/systems/kuali/search-separation-action.ts",
          "sha256": "d5947d4f2b6ac967fee4729e73960b03c28044fc1c01543b737d8c44ffae1532"
        },
        {
          "path": "src/models/systems/kuali/stage-separation-finalization.ts",
          "sha256": "c666c289bb0eda2749f0f4179ee3bb77dd68580f45020f6392ba6febdef3050d"
        },
        {
          "path": "src/models/systems/new-kronos/read-separation-timecard.ts",
          "sha256": "60b6cf0adce09dfa60452469c08fba6b7db7c8a356fb76d77145a51247bbd142"
        },
        {
          "path": "src/models/systems/new-kronos/search-employee.ts",
          "sha256": "f69ea49823248af329cdbf699117f494d65a5b0fee4535200660090816bd8322"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/read-job-summary.ts",
          "sha256": "8f588366b419bd78989f2efbc6410d34256a8f6adbc178f948d8c9ecde5faff3"
        },
        {
          "path": "src/models/systems/ucpath/read-pending-termination-set.ts",
          "sha256": "46dd5fd5d73339b92dbb60338326e018a46329ad99ca52e2022051a031a32bea"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "03d0a2d1b48c6b753d24befa869994cb0ec8fdef41c4c844c346b320cbe5f3d0"
        },
        {
          "path": "src/models/systems/ucpath/stage-termination.ts",
          "sha256": "62a6d55587286ad683d26d1715248721ca00d8ef15986ae9f46a7211d91aa020"
        },
        {
          "path": "src/models/systems/ucpath/verify-termination-filing-present.ts",
          "sha256": "84f3e69a9f4d79ecaaab020be5d863ebcd6381ab1b3de63f678d73595293cc13"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/ui/new-kronos-timecard.ts",
          "sha256": "36317ed94b5b444880ecaeb3133faced6d2f37d7adb714dd26c937d43e1d7e18"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/rerun-values.ts",
          "sha256": "36ff889a98870c3f22f9321e194b503a6f2824fd9edbea01c461c67ac282d9f0"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/canonical-input.ts",
          "sha256": "d298fc5a612e184b96362c0fe859da736dd4a3b0196fcceeb3144b9195043b85"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/completion.ts",
          "sha256": "a65d859659fc6accdf4fa2b7d4c8da242fa073187d05d18480ecd9a331201b98"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/ingress.ts",
          "sha256": "9c58280f1e53f440586628cc5f0870328b3c38bc73237f751fc9b8e13fb6d438"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/rerun-values.ts",
          "sha256": "554434417067c9702503b8c5e1d8b6a838ce2da7163dd60f473a33cf8a25025a"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/workflows/separations/match-active-employment.ts",
          "sha256": "179ba0ffb0a1c35a9366d14de547dc72a169b913813ade2d6cffe4f1ffa784c6"
        },
        {
          "path": "src/models/workflows/separations/match-department-option.ts",
          "sha256": "df73dae460e38d9342feab960071c18229f07721f70c2270d75df0cc91991125"
        },
        {
          "path": "src/models/workflows/separations/match-identity.ts",
          "sha256": "1e3722c25a33c0aad02762df50af02830903aa929ae18bcb2c2b85425437fe03"
        },
        {
          "path": "src/models/workflows/separations/match-separation-subject.ts",
          "sha256": "10931bfd20166b6fa3cae2217b6ee98cad88653f904b68d0e92a60ed41d61f74"
        },
        {
          "path": "src/models/workflows/separations/match-termination-type.ts",
          "sha256": "bc73b2bb8b22d6235cdcc51a3a971734f694b8887595216233d17e2d83a4cf51"
        },
        {
          "path": "src/models/workflows/separations/read-separation-dates.ts",
          "sha256": "058c544106ec714fb1599529f24e066fc3726fe870f0e179a3deb6a560d22657"
        },
        {
          "path": "src/models/workflows/separations/read-separation-plan.ts",
          "sha256": "b1de9e7e5eac60d27024a1d8130717699709dab14e8f37c986fa49287ff2a780"
        },
        {
          "path": "src/models/workflows/separations/verify-identity-approval.ts",
          "sha256": "46f796d9b5357e53ff3e2d4bfeaaf5449b743acd4f99e5726727d36b2ea1f8f4"
        },
        {
          "path": "src/models/workflows/separations/verify-termination-receipt.ts",
          "sha256": "6614296aa8215f35f6a77c2e7bbbd8b322ee008c48ef21865570470ee48834e1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/department-option.ts",
          "sha256": "c1b27b6a4c52bc64c483ebd0832918076784e53d37c2773c7c43dbee32320d84"
        },
        {
          "path": "src/rules/separations/employment-selection.ts",
          "sha256": "4b8a286c8e4ce8d4707f705e8b86bc130f822d6f4b373abc214bdac0e6869f7e"
        },
        {
          "path": "src/rules/separations/identity-approval.ts",
          "sha256": "727e60dc73177a36cf4dcbb7952ea3673822e859d2b6c3225416c8dbec9eddd5"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/separation-dates.ts",
          "sha256": "f5404eb462ff236827b58e69cdd2558b3077dfc42edc680ee69156dae89f0bbf"
        },
        {
          "path": "src/rules/separations/separation-subject.ts",
          "sha256": "bb1def903b4dd76b947e05890e958f83519625232fa99a27d5214e12896d5320"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/flow.ts",
          "sha256": "07d26a20963ef90eada13f456bbde8129a3de038940972df19b82909814b9789"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflow-kit/validation/build-manifest.ts",
          "sha256": "35d6b4f2b9c2d7a7d08109304fd71226d0891840b3adba70ef1572037efe458e"
        },
        {
          "path": "src/workflow-kit/validation/module-role.ts",
          "sha256": "e1f963f9f2cfa319ad137a32f8303a8b31b06e2fa54a9f0eff1c9c474fd78758"
        },
        {
          "path": "src/workflow-kit/validation/scenario-coverage.ts",
          "sha256": "0c4d3374cea3e931e337806761f775302a1024d0e794c55890b02e7952191e85"
        },
        {
          "path": "src/workflow-kit/workflow-definition.ts",
          "sha256": "9f175147793eadd17aaf669972fd67cccda32d2f15515e96550853ea47a7baab"
        },
        {
          "path": "src/workflow-kit/workflow.ts",
          "sha256": "0793e7f363d2a950398194c98ec33ea9e7030735d31a26d1f0fb5aa362ec6217"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "663cc40d44ef81fa18ae7055d4c671034f7e5fc24e3e87463a3343f34d2625fa"
        }
      ],
      "id": "separations"
    },
    {
      "fingerprint": "33c7fccc562fb95736b744f53f792f7beceda64d3f293c5b4ea8c000e6955724",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/read-separation-document.ts",
          "sha256": "819f659cb964c6de48b8900d7794d6a8f009b8a362bd41f9ebc7ecfefbe0f530"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/systems/kuali/search-separation-action.ts",
          "sha256": "d5947d4f2b6ac967fee4729e73960b03c28044fc1c01543b737d8c44ffae1532"
        },
        {
          "path": "src/models/systems/kuali/stage-separation-finalization.ts",
          "sha256": "c666c289bb0eda2749f0f4179ee3bb77dd68580f45020f6392ba6febdef3050d"
        },
        {
          "path": "src/models/systems/new-kronos/read-separation-timecard.ts",
          "sha256": "60b6cf0adce09dfa60452469c08fba6b7db7c8a356fb76d77145a51247bbd142"
        },
        {
          "path": "src/models/systems/new-kronos/search-employee.ts",
          "sha256": "f69ea49823248af329cdbf699117f494d65a5b0fee4535200660090816bd8322"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/read-job-summary.ts",
          "sha256": "8f588366b419bd78989f2efbc6410d34256a8f6adbc178f948d8c9ecde5faff3"
        },
        {
          "path": "src/models/systems/ucpath/read-pending-termination-set.ts",
          "sha256": "46dd5fd5d73339b92dbb60338326e018a46329ad99ca52e2022051a031a32bea"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "03d0a2d1b48c6b753d24befa869994cb0ec8fdef41c4c844c346b320cbe5f3d0"
        },
        {
          "path": "src/models/systems/ucpath/stage-termination.ts",
          "sha256": "62a6d55587286ad683d26d1715248721ca00d8ef15986ae9f46a7211d91aa020"
        },
        {
          "path": "src/models/systems/ucpath/verify-termination-filing-present.ts",
          "sha256": "84f3e69a9f4d79ecaaab020be5d863ebcd6381ab1b3de63f678d73595293cc13"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/ui/new-kronos-timecard.ts",
          "sha256": "36317ed94b5b444880ecaeb3133faced6d2f37d7adb714dd26c937d43e1d7e18"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/rerun-values.ts",
          "sha256": "36ff889a98870c3f22f9321e194b503a6f2824fd9edbea01c461c67ac282d9f0"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/canonical-input.ts",
          "sha256": "d298fc5a612e184b96362c0fe859da736dd4a3b0196fcceeb3144b9195043b85"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/completion.ts",
          "sha256": "a65d859659fc6accdf4fa2b7d4c8da242fa073187d05d18480ecd9a331201b98"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/ingress.ts",
          "sha256": "9c58280f1e53f440586628cc5f0870328b3c38bc73237f751fc9b8e13fb6d438"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/rerun-values.ts",
          "sha256": "554434417067c9702503b8c5e1d8b6a838ce2da7163dd60f473a33cf8a25025a"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/workflows/separations/match-active-employment.ts",
          "sha256": "179ba0ffb0a1c35a9366d14de547dc72a169b913813ade2d6cffe4f1ffa784c6"
        },
        {
          "path": "src/models/workflows/separations/match-department-option.ts",
          "sha256": "df73dae460e38d9342feab960071c18229f07721f70c2270d75df0cc91991125"
        },
        {
          "path": "src/models/workflows/separations/match-identity.ts",
          "sha256": "1e3722c25a33c0aad02762df50af02830903aa929ae18bcb2c2b85425437fe03"
        },
        {
          "path": "src/models/workflows/separations/match-separation-subject.ts",
          "sha256": "10931bfd20166b6fa3cae2217b6ee98cad88653f904b68d0e92a60ed41d61f74"
        },
        {
          "path": "src/models/workflows/separations/match-termination-type.ts",
          "sha256": "bc73b2bb8b22d6235cdcc51a3a971734f694b8887595216233d17e2d83a4cf51"
        },
        {
          "path": "src/models/workflows/separations/read-separation-dates.ts",
          "sha256": "058c544106ec714fb1599529f24e066fc3726fe870f0e179a3deb6a560d22657"
        },
        {
          "path": "src/models/workflows/separations/read-separation-plan.ts",
          "sha256": "b1de9e7e5eac60d27024a1d8130717699709dab14e8f37c986fa49287ff2a780"
        },
        {
          "path": "src/models/workflows/separations/verify-identity-approval.ts",
          "sha256": "46f796d9b5357e53ff3e2d4bfeaaf5449b743acd4f99e5726727d36b2ea1f8f4"
        },
        {
          "path": "src/models/workflows/separations/verify-termination-receipt.ts",
          "sha256": "6614296aa8215f35f6a77c2e7bbbd8b322ee008c48ef21865570470ee48834e1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/department-option.ts",
          "sha256": "c1b27b6a4c52bc64c483ebd0832918076784e53d37c2773c7c43dbee32320d84"
        },
        {
          "path": "src/rules/separations/employment-selection.ts",
          "sha256": "4b8a286c8e4ce8d4707f705e8b86bc130f822d6f4b373abc214bdac0e6869f7e"
        },
        {
          "path": "src/rules/separations/identity-approval.ts",
          "sha256": "727e60dc73177a36cf4dcbb7952ea3673822e859d2b6c3225416c8dbec9eddd5"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/separation-dates.ts",
          "sha256": "f5404eb462ff236827b58e69cdd2558b3077dfc42edc680ee69156dae89f0bbf"
        },
        {
          "path": "src/rules/separations/separation-subject.ts",
          "sha256": "bb1def903b4dd76b947e05890e958f83519625232fa99a27d5214e12896d5320"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/flow.ts",
          "sha256": "07d26a20963ef90eada13f456bbde8129a3de038940972df19b82909814b9789"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflow-kit/validation/build-manifest.ts",
          "sha256": "35d6b4f2b9c2d7a7d08109304fd71226d0891840b3adba70ef1572037efe458e"
        },
        {
          "path": "src/workflow-kit/validation/module-role.ts",
          "sha256": "e1f963f9f2cfa319ad137a32f8303a8b31b06e2fa54a9f0eff1c9c474fd78758"
        },
        {
          "path": "src/workflow-kit/validation/scenario-coverage.ts",
          "sha256": "0c4d3374cea3e931e337806761f775302a1024d0e794c55890b02e7952191e85"
        },
        {
          "path": "src/workflow-kit/workflow-definition.ts",
          "sha256": "9f175147793eadd17aaf669972fd67cccda32d2f15515e96550853ea47a7baab"
        },
        {
          "path": "src/workflow-kit/workflow.ts",
          "sha256": "0793e7f363d2a950398194c98ec33ea9e7030735d31a26d1f0fb5aa362ec6217"
        },
        {
          "path": "src/workflows/separations/steps/identity-check/step.ts",
          "sha256": "b9ee25bb54e99f85999234ec2e4f68d772d9fac72bdb2ba1a254f92443c9d976"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "663cc40d44ef81fa18ae7055d4c671034f7e5fc24e3e87463a3343f34d2625fa"
        }
      ],
      "id": "separations-identity-check"
    },
    {
      "fingerprint": "6c4391b021f0e74b80b74087a187d2cda69c3821ba781a20da0c5a2079107043",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/read-separation-document.ts",
          "sha256": "819f659cb964c6de48b8900d7794d6a8f009b8a362bd41f9ebc7ecfefbe0f530"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/systems/kuali/search-separation-action.ts",
          "sha256": "d5947d4f2b6ac967fee4729e73960b03c28044fc1c01543b737d8c44ffae1532"
        },
        {
          "path": "src/models/systems/kuali/stage-separation-finalization.ts",
          "sha256": "c666c289bb0eda2749f0f4179ee3bb77dd68580f45020f6392ba6febdef3050d"
        },
        {
          "path": "src/models/systems/new-kronos/read-separation-timecard.ts",
          "sha256": "60b6cf0adce09dfa60452469c08fba6b7db7c8a356fb76d77145a51247bbd142"
        },
        {
          "path": "src/models/systems/new-kronos/search-employee.ts",
          "sha256": "f69ea49823248af329cdbf699117f494d65a5b0fee4535200660090816bd8322"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/read-job-summary.ts",
          "sha256": "8f588366b419bd78989f2efbc6410d34256a8f6adbc178f948d8c9ecde5faff3"
        },
        {
          "path": "src/models/systems/ucpath/read-pending-termination-set.ts",
          "sha256": "46dd5fd5d73339b92dbb60338326e018a46329ad99ca52e2022051a031a32bea"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "03d0a2d1b48c6b753d24befa869994cb0ec8fdef41c4c844c346b320cbe5f3d0"
        },
        {
          "path": "src/models/systems/ucpath/stage-termination.ts",
          "sha256": "62a6d55587286ad683d26d1715248721ca00d8ef15986ae9f46a7211d91aa020"
        },
        {
          "path": "src/models/systems/ucpath/verify-termination-filing-present.ts",
          "sha256": "84f3e69a9f4d79ecaaab020be5d863ebcd6381ab1b3de63f678d73595293cc13"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/ui/new-kronos-timecard.ts",
          "sha256": "36317ed94b5b444880ecaeb3133faced6d2f37d7adb714dd26c937d43e1d7e18"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/rerun-values.ts",
          "sha256": "36ff889a98870c3f22f9321e194b503a6f2824fd9edbea01c461c67ac282d9f0"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/canonical-input.ts",
          "sha256": "d298fc5a612e184b96362c0fe859da736dd4a3b0196fcceeb3144b9195043b85"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/completion.ts",
          "sha256": "a65d859659fc6accdf4fa2b7d4c8da242fa073187d05d18480ecd9a331201b98"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/ingress.ts",
          "sha256": "9c58280f1e53f440586628cc5f0870328b3c38bc73237f751fc9b8e13fb6d438"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/rerun-values.ts",
          "sha256": "554434417067c9702503b8c5e1d8b6a838ce2da7163dd60f473a33cf8a25025a"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/workflows/separations/match-active-employment.ts",
          "sha256": "179ba0ffb0a1c35a9366d14de547dc72a169b913813ade2d6cffe4f1ffa784c6"
        },
        {
          "path": "src/models/workflows/separations/match-department-option.ts",
          "sha256": "df73dae460e38d9342feab960071c18229f07721f70c2270d75df0cc91991125"
        },
        {
          "path": "src/models/workflows/separations/match-identity.ts",
          "sha256": "1e3722c25a33c0aad02762df50af02830903aa929ae18bcb2c2b85425437fe03"
        },
        {
          "path": "src/models/workflows/separations/match-separation-subject.ts",
          "sha256": "10931bfd20166b6fa3cae2217b6ee98cad88653f904b68d0e92a60ed41d61f74"
        },
        {
          "path": "src/models/workflows/separations/match-termination-type.ts",
          "sha256": "bc73b2bb8b22d6235cdcc51a3a971734f694b8887595216233d17e2d83a4cf51"
        },
        {
          "path": "src/models/workflows/separations/read-separation-dates.ts",
          "sha256": "058c544106ec714fb1599529f24e066fc3726fe870f0e179a3deb6a560d22657"
        },
        {
          "path": "src/models/workflows/separations/read-separation-plan.ts",
          "sha256": "b1de9e7e5eac60d27024a1d8130717699709dab14e8f37c986fa49287ff2a780"
        },
        {
          "path": "src/models/workflows/separations/verify-identity-approval.ts",
          "sha256": "46f796d9b5357e53ff3e2d4bfeaaf5449b743acd4f99e5726727d36b2ea1f8f4"
        },
        {
          "path": "src/models/workflows/separations/verify-termination-receipt.ts",
          "sha256": "6614296aa8215f35f6a77c2e7bbbd8b322ee008c48ef21865570470ee48834e1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/department-option.ts",
          "sha256": "c1b27b6a4c52bc64c483ebd0832918076784e53d37c2773c7c43dbee32320d84"
        },
        {
          "path": "src/rules/separations/employment-selection.ts",
          "sha256": "4b8a286c8e4ce8d4707f705e8b86bc130f822d6f4b373abc214bdac0e6869f7e"
        },
        {
          "path": "src/rules/separations/identity-approval.ts",
          "sha256": "727e60dc73177a36cf4dcbb7952ea3673822e859d2b6c3225416c8dbec9eddd5"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/separation-dates.ts",
          "sha256": "f5404eb462ff236827b58e69cdd2558b3077dfc42edc680ee69156dae89f0bbf"
        },
        {
          "path": "src/rules/separations/separation-subject.ts",
          "sha256": "bb1def903b4dd76b947e05890e958f83519625232fa99a27d5214e12896d5320"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/flow.ts",
          "sha256": "07d26a20963ef90eada13f456bbde8129a3de038940972df19b82909814b9789"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflow-kit/validation/build-manifest.ts",
          "sha256": "35d6b4f2b9c2d7a7d08109304fd71226d0891840b3adba70ef1572037efe458e"
        },
        {
          "path": "src/workflow-kit/validation/module-role.ts",
          "sha256": "e1f963f9f2cfa319ad137a32f8303a8b31b06e2fa54a9f0eff1c9c474fd78758"
        },
        {
          "path": "src/workflow-kit/validation/scenario-coverage.ts",
          "sha256": "0c4d3374cea3e931e337806761f775302a1024d0e794c55890b02e7952191e85"
        },
        {
          "path": "src/workflow-kit/workflow-definition.ts",
          "sha256": "9f175147793eadd17aaf669972fd67cccda32d2f15515e96550853ea47a7baab"
        },
        {
          "path": "src/workflow-kit/workflow.ts",
          "sha256": "0793e7f363d2a950398194c98ec33ea9e7030735d31a26d1f0fb5aa362ec6217"
        },
        {
          "path": "src/workflows/separations/steps/kronos-timecard/step.ts",
          "sha256": "a380031038e2ebe1e704ffb4195cd96816bc62dd7f7977a9e4a389175747bf19"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "663cc40d44ef81fa18ae7055d4c671034f7e5fc24e3e87463a3343f34d2625fa"
        }
      ],
      "id": "separations-kronos-timecard"
    },
    {
      "fingerprint": "3400ea558026b2fa984a846703d492a6fd7c6275d402f852aca8fcaa0e5fa31e",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/read-separation-document.ts",
          "sha256": "819f659cb964c6de48b8900d7794d6a8f009b8a362bd41f9ebc7ecfefbe0f530"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/systems/kuali/search-separation-action.ts",
          "sha256": "d5947d4f2b6ac967fee4729e73960b03c28044fc1c01543b737d8c44ffae1532"
        },
        {
          "path": "src/models/systems/kuali/stage-separation-finalization.ts",
          "sha256": "c666c289bb0eda2749f0f4179ee3bb77dd68580f45020f6392ba6febdef3050d"
        },
        {
          "path": "src/models/systems/new-kronos/read-separation-timecard.ts",
          "sha256": "60b6cf0adce09dfa60452469c08fba6b7db7c8a356fb76d77145a51247bbd142"
        },
        {
          "path": "src/models/systems/new-kronos/search-employee.ts",
          "sha256": "f69ea49823248af329cdbf699117f494d65a5b0fee4535200660090816bd8322"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/read-job-summary.ts",
          "sha256": "8f588366b419bd78989f2efbc6410d34256a8f6adbc178f948d8c9ecde5faff3"
        },
        {
          "path": "src/models/systems/ucpath/read-pending-termination-set.ts",
          "sha256": "46dd5fd5d73339b92dbb60338326e018a46329ad99ca52e2022051a031a32bea"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "03d0a2d1b48c6b753d24befa869994cb0ec8fdef41c4c844c346b320cbe5f3d0"
        },
        {
          "path": "src/models/systems/ucpath/stage-termination.ts",
          "sha256": "62a6d55587286ad683d26d1715248721ca00d8ef15986ae9f46a7211d91aa020"
        },
        {
          "path": "src/models/systems/ucpath/verify-termination-filing-present.ts",
          "sha256": "84f3e69a9f4d79ecaaab020be5d863ebcd6381ab1b3de63f678d73595293cc13"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/ui/new-kronos-timecard.ts",
          "sha256": "36317ed94b5b444880ecaeb3133faced6d2f37d7adb714dd26c937d43e1d7e18"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/rerun-values.ts",
          "sha256": "36ff889a98870c3f22f9321e194b503a6f2824fd9edbea01c461c67ac282d9f0"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/canonical-input.ts",
          "sha256": "d298fc5a612e184b96362c0fe859da736dd4a3b0196fcceeb3144b9195043b85"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/completion.ts",
          "sha256": "a65d859659fc6accdf4fa2b7d4c8da242fa073187d05d18480ecd9a331201b98"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/ingress.ts",
          "sha256": "9c58280f1e53f440586628cc5f0870328b3c38bc73237f751fc9b8e13fb6d438"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/rerun-values.ts",
          "sha256": "554434417067c9702503b8c5e1d8b6a838ce2da7163dd60f473a33cf8a25025a"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/workflows/separations/match-active-employment.ts",
          "sha256": "179ba0ffb0a1c35a9366d14de547dc72a169b913813ade2d6cffe4f1ffa784c6"
        },
        {
          "path": "src/models/workflows/separations/match-department-option.ts",
          "sha256": "df73dae460e38d9342feab960071c18229f07721f70c2270d75df0cc91991125"
        },
        {
          "path": "src/models/workflows/separations/match-identity.ts",
          "sha256": "1e3722c25a33c0aad02762df50af02830903aa929ae18bcb2c2b85425437fe03"
        },
        {
          "path": "src/models/workflows/separations/match-separation-subject.ts",
          "sha256": "10931bfd20166b6fa3cae2217b6ee98cad88653f904b68d0e92a60ed41d61f74"
        },
        {
          "path": "src/models/workflows/separations/match-termination-type.ts",
          "sha256": "bc73b2bb8b22d6235cdcc51a3a971734f694b8887595216233d17e2d83a4cf51"
        },
        {
          "path": "src/models/workflows/separations/read-separation-dates.ts",
          "sha256": "058c544106ec714fb1599529f24e066fc3726fe870f0e179a3deb6a560d22657"
        },
        {
          "path": "src/models/workflows/separations/read-separation-plan.ts",
          "sha256": "b1de9e7e5eac60d27024a1d8130717699709dab14e8f37c986fa49287ff2a780"
        },
        {
          "path": "src/models/workflows/separations/verify-identity-approval.ts",
          "sha256": "46f796d9b5357e53ff3e2d4bfeaaf5449b743acd4f99e5726727d36b2ea1f8f4"
        },
        {
          "path": "src/models/workflows/separations/verify-termination-receipt.ts",
          "sha256": "6614296aa8215f35f6a77c2e7bbbd8b322ee008c48ef21865570470ee48834e1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/department-option.ts",
          "sha256": "c1b27b6a4c52bc64c483ebd0832918076784e53d37c2773c7c43dbee32320d84"
        },
        {
          "path": "src/rules/separations/employment-selection.ts",
          "sha256": "4b8a286c8e4ce8d4707f705e8b86bc130f822d6f4b373abc214bdac0e6869f7e"
        },
        {
          "path": "src/rules/separations/identity-approval.ts",
          "sha256": "727e60dc73177a36cf4dcbb7952ea3673822e859d2b6c3225416c8dbec9eddd5"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/separation-dates.ts",
          "sha256": "f5404eb462ff236827b58e69cdd2558b3077dfc42edc680ee69156dae89f0bbf"
        },
        {
          "path": "src/rules/separations/separation-subject.ts",
          "sha256": "bb1def903b4dd76b947e05890e958f83519625232fa99a27d5214e12896d5320"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/flow.ts",
          "sha256": "07d26a20963ef90eada13f456bbde8129a3de038940972df19b82909814b9789"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflow-kit/validation/build-manifest.ts",
          "sha256": "35d6b4f2b9c2d7a7d08109304fd71226d0891840b3adba70ef1572037efe458e"
        },
        {
          "path": "src/workflow-kit/validation/module-role.ts",
          "sha256": "e1f963f9f2cfa319ad137a32f8303a8b31b06e2fa54a9f0eff1c9c474fd78758"
        },
        {
          "path": "src/workflow-kit/validation/scenario-coverage.ts",
          "sha256": "0c4d3374cea3e931e337806761f775302a1024d0e794c55890b02e7952191e85"
        },
        {
          "path": "src/workflow-kit/workflow-definition.ts",
          "sha256": "9f175147793eadd17aaf669972fd67cccda32d2f15515e96550853ea47a7baab"
        },
        {
          "path": "src/workflow-kit/workflow.ts",
          "sha256": "0793e7f363d2a950398194c98ec33ea9e7030735d31a26d1f0fb5aa362ec6217"
        },
        {
          "path": "src/workflows/separations/steps/kuali-finalization/step.ts",
          "sha256": "41d14c70536e829d9919ed119bf2c551c78ea4f05f4d7f59b4b321f2e4e80bc6"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "663cc40d44ef81fa18ae7055d4c671034f7e5fc24e3e87463a3343f34d2625fa"
        }
      ],
      "id": "separations-kuali-finalization"
    },
    {
      "fingerprint": "75fdbd39e06702d4d387996939919fb2e0a0e7ec7bc5a9e95760516600f6c717",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/read-separation-document.ts",
          "sha256": "819f659cb964c6de48b8900d7794d6a8f009b8a362bd41f9ebc7ecfefbe0f530"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/systems/kuali/search-separation-action.ts",
          "sha256": "d5947d4f2b6ac967fee4729e73960b03c28044fc1c01543b737d8c44ffae1532"
        },
        {
          "path": "src/models/systems/kuali/stage-separation-finalization.ts",
          "sha256": "c666c289bb0eda2749f0f4179ee3bb77dd68580f45020f6392ba6febdef3050d"
        },
        {
          "path": "src/models/systems/new-kronos/read-separation-timecard.ts",
          "sha256": "60b6cf0adce09dfa60452469c08fba6b7db7c8a356fb76d77145a51247bbd142"
        },
        {
          "path": "src/models/systems/new-kronos/search-employee.ts",
          "sha256": "f69ea49823248af329cdbf699117f494d65a5b0fee4535200660090816bd8322"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/read-job-summary.ts",
          "sha256": "8f588366b419bd78989f2efbc6410d34256a8f6adbc178f948d8c9ecde5faff3"
        },
        {
          "path": "src/models/systems/ucpath/read-pending-termination-set.ts",
          "sha256": "46dd5fd5d73339b92dbb60338326e018a46329ad99ca52e2022051a031a32bea"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "03d0a2d1b48c6b753d24befa869994cb0ec8fdef41c4c844c346b320cbe5f3d0"
        },
        {
          "path": "src/models/systems/ucpath/stage-termination.ts",
          "sha256": "62a6d55587286ad683d26d1715248721ca00d8ef15986ae9f46a7211d91aa020"
        },
        {
          "path": "src/models/systems/ucpath/verify-termination-filing-present.ts",
          "sha256": "84f3e69a9f4d79ecaaab020be5d863ebcd6381ab1b3de63f678d73595293cc13"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/ui/new-kronos-timecard.ts",
          "sha256": "36317ed94b5b444880ecaeb3133faced6d2f37d7adb714dd26c937d43e1d7e18"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/rerun-values.ts",
          "sha256": "36ff889a98870c3f22f9321e194b503a6f2824fd9edbea01c461c67ac282d9f0"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/canonical-input.ts",
          "sha256": "d298fc5a612e184b96362c0fe859da736dd4a3b0196fcceeb3144b9195043b85"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/completion.ts",
          "sha256": "a65d859659fc6accdf4fa2b7d4c8da242fa073187d05d18480ecd9a331201b98"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/ingress.ts",
          "sha256": "9c58280f1e53f440586628cc5f0870328b3c38bc73237f751fc9b8e13fb6d438"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/rerun-values.ts",
          "sha256": "554434417067c9702503b8c5e1d8b6a838ce2da7163dd60f473a33cf8a25025a"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/workflows/separations/match-active-employment.ts",
          "sha256": "179ba0ffb0a1c35a9366d14de547dc72a169b913813ade2d6cffe4f1ffa784c6"
        },
        {
          "path": "src/models/workflows/separations/match-department-option.ts",
          "sha256": "df73dae460e38d9342feab960071c18229f07721f70c2270d75df0cc91991125"
        },
        {
          "path": "src/models/workflows/separations/match-identity.ts",
          "sha256": "1e3722c25a33c0aad02762df50af02830903aa929ae18bcb2c2b85425437fe03"
        },
        {
          "path": "src/models/workflows/separations/match-separation-subject.ts",
          "sha256": "10931bfd20166b6fa3cae2217b6ee98cad88653f904b68d0e92a60ed41d61f74"
        },
        {
          "path": "src/models/workflows/separations/match-termination-type.ts",
          "sha256": "bc73b2bb8b22d6235cdcc51a3a971734f694b8887595216233d17e2d83a4cf51"
        },
        {
          "path": "src/models/workflows/separations/read-separation-dates.ts",
          "sha256": "058c544106ec714fb1599529f24e066fc3726fe870f0e179a3deb6a560d22657"
        },
        {
          "path": "src/models/workflows/separations/read-separation-plan.ts",
          "sha256": "b1de9e7e5eac60d27024a1d8130717699709dab14e8f37c986fa49287ff2a780"
        },
        {
          "path": "src/models/workflows/separations/verify-identity-approval.ts",
          "sha256": "46f796d9b5357e53ff3e2d4bfeaaf5449b743acd4f99e5726727d36b2ea1f8f4"
        },
        {
          "path": "src/models/workflows/separations/verify-termination-receipt.ts",
          "sha256": "6614296aa8215f35f6a77c2e7bbbd8b322ee008c48ef21865570470ee48834e1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/department-option.ts",
          "sha256": "c1b27b6a4c52bc64c483ebd0832918076784e53d37c2773c7c43dbee32320d84"
        },
        {
          "path": "src/rules/separations/employment-selection.ts",
          "sha256": "4b8a286c8e4ce8d4707f705e8b86bc130f822d6f4b373abc214bdac0e6869f7e"
        },
        {
          "path": "src/rules/separations/identity-approval.ts",
          "sha256": "727e60dc73177a36cf4dcbb7952ea3673822e859d2b6c3225416c8dbec9eddd5"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/separation-dates.ts",
          "sha256": "f5404eb462ff236827b58e69cdd2558b3077dfc42edc680ee69156dae89f0bbf"
        },
        {
          "path": "src/rules/separations/separation-subject.ts",
          "sha256": "bb1def903b4dd76b947e05890e958f83519625232fa99a27d5214e12896d5320"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/flow.ts",
          "sha256": "07d26a20963ef90eada13f456bbde8129a3de038940972df19b82909814b9789"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflow-kit/validation/build-manifest.ts",
          "sha256": "35d6b4f2b9c2d7a7d08109304fd71226d0891840b3adba70ef1572037efe458e"
        },
        {
          "path": "src/workflow-kit/validation/module-role.ts",
          "sha256": "e1f963f9f2cfa319ad137a32f8303a8b31b06e2fa54a9f0eff1c9c474fd78758"
        },
        {
          "path": "src/workflow-kit/validation/scenario-coverage.ts",
          "sha256": "0c4d3374cea3e931e337806761f775302a1024d0e794c55890b02e7952191e85"
        },
        {
          "path": "src/workflow-kit/workflow-definition.ts",
          "sha256": "9f175147793eadd17aaf669972fd67cccda32d2f15515e96550853ea47a7baab"
        },
        {
          "path": "src/workflow-kit/workflow.ts",
          "sha256": "0793e7f363d2a950398194c98ec33ea9e7030735d31a26d1f0fb5aa362ec6217"
        },
        {
          "path": "src/workflows/separations/steps/kuali-extraction/step.ts",
          "sha256": "07b36c7b0a4e2b91c1f0a43fa827e6209406212646c3007f8a2dba13e3af1001"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "663cc40d44ef81fa18ae7055d4c671034f7e5fc24e3e87463a3343f34d2625fa"
        }
      ],
      "id": "separations-kuali-read"
    },
    {
      "fingerprint": "cc58dd7263b21007ad1653118f60799cf3fa72c96789b016c1ad0ca5db46df02",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/read-separation-document.ts",
          "sha256": "819f659cb964c6de48b8900d7794d6a8f009b8a362bd41f9ebc7ecfefbe0f530"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/systems/kuali/search-separation-action.ts",
          "sha256": "d5947d4f2b6ac967fee4729e73960b03c28044fc1c01543b737d8c44ffae1532"
        },
        {
          "path": "src/models/systems/kuali/stage-separation-finalization.ts",
          "sha256": "c666c289bb0eda2749f0f4179ee3bb77dd68580f45020f6392ba6febdef3050d"
        },
        {
          "path": "src/models/systems/new-kronos/read-separation-timecard.ts",
          "sha256": "60b6cf0adce09dfa60452469c08fba6b7db7c8a356fb76d77145a51247bbd142"
        },
        {
          "path": "src/models/systems/new-kronos/search-employee.ts",
          "sha256": "f69ea49823248af329cdbf699117f494d65a5b0fee4535200660090816bd8322"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/read-job-summary.ts",
          "sha256": "8f588366b419bd78989f2efbc6410d34256a8f6adbc178f948d8c9ecde5faff3"
        },
        {
          "path": "src/models/systems/ucpath/read-pending-termination-set.ts",
          "sha256": "46dd5fd5d73339b92dbb60338326e018a46329ad99ca52e2022051a031a32bea"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "03d0a2d1b48c6b753d24befa869994cb0ec8fdef41c4c844c346b320cbe5f3d0"
        },
        {
          "path": "src/models/systems/ucpath/stage-termination.ts",
          "sha256": "62a6d55587286ad683d26d1715248721ca00d8ef15986ae9f46a7211d91aa020"
        },
        {
          "path": "src/models/systems/ucpath/verify-termination-filing-present.ts",
          "sha256": "84f3e69a9f4d79ecaaab020be5d863ebcd6381ab1b3de63f678d73595293cc13"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/ui/new-kronos-timecard.ts",
          "sha256": "36317ed94b5b444880ecaeb3133faced6d2f37d7adb714dd26c937d43e1d7e18"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/canonical-input-schema.ts",
          "sha256": "de6647236fff16461b900633852d98bd6ea39fe9214769761ba872862a620944"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/rerun-values.ts",
          "sha256": "36ff889a98870c3f22f9321e194b503a6f2824fd9edbea01c461c67ac282d9f0"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/canonical-input.ts",
          "sha256": "d298fc5a612e184b96362c0fe859da736dd4a3b0196fcceeb3144b9195043b85"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/completion.ts",
          "sha256": "a65d859659fc6accdf4fa2b7d4c8da242fa073187d05d18480ecd9a331201b98"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/ingress.ts",
          "sha256": "9c58280f1e53f440586628cc5f0870328b3c38bc73237f751fc9b8e13fb6d438"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/rerun-values.ts",
          "sha256": "554434417067c9702503b8c5e1d8b6a838ce2da7163dd60f473a33cf8a25025a"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/workflows/separations/match-active-employment.ts",
          "sha256": "179ba0ffb0a1c35a9366d14de547dc72a169b913813ade2d6cffe4f1ffa784c6"
        },
        {
          "path": "src/models/workflows/separations/match-department-option.ts",
          "sha256": "df73dae460e38d9342feab960071c18229f07721f70c2270d75df0cc91991125"
        },
        {
          "path": "src/models/workflows/separations/match-identity.ts",
          "sha256": "1e3722c25a33c0aad02762df50af02830903aa929ae18bcb2c2b85425437fe03"
        },
        {
          "path": "src/models/workflows/separations/match-separation-subject.ts",
          "sha256": "10931bfd20166b6fa3cae2217b6ee98cad88653f904b68d0e92a60ed41d61f74"
        },
        {
          "path": "src/models/workflows/separations/match-termination-type.ts",
          "sha256": "bc73b2bb8b22d6235cdcc51a3a971734f694b8887595216233d17e2d83a4cf51"
        },
        {
          "path": "src/models/workflows/separations/read-separation-dates.ts",
          "sha256": "058c544106ec714fb1599529f24e066fc3726fe870f0e179a3deb6a560d22657"
        },
        {
          "path": "src/models/workflows/separations/read-separation-plan.ts",
          "sha256": "b1de9e7e5eac60d27024a1d8130717699709dab14e8f37c986fa49287ff2a780"
        },
        {
          "path": "src/models/workflows/separations/verify-identity-approval.ts",
          "sha256": "46f796d9b5357e53ff3e2d4bfeaaf5449b743acd4f99e5726727d36b2ea1f8f4"
        },
        {
          "path": "src/models/workflows/separations/verify-termination-receipt.ts",
          "sha256": "6614296aa8215f35f6a77c2e7bbbd8b322ee008c48ef21865570470ee48834e1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/department-option.ts",
          "sha256": "c1b27b6a4c52bc64c483ebd0832918076784e53d37c2773c7c43dbee32320d84"
        },
        {
          "path": "src/rules/separations/employment-selection.ts",
          "sha256": "4b8a286c8e4ce8d4707f705e8b86bc130f822d6f4b373abc214bdac0e6869f7e"
        },
        {
          "path": "src/rules/separations/identity-approval.ts",
          "sha256": "727e60dc73177a36cf4dcbb7952ea3673822e859d2b6c3225416c8dbec9eddd5"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/separation-dates.ts",
          "sha256": "f5404eb462ff236827b58e69cdd2558b3077dfc42edc680ee69156dae89f0bbf"
        },
        {
          "path": "src/rules/separations/separation-subject.ts",
          "sha256": "bb1def903b4dd76b947e05890e958f83519625232fa99a27d5214e12896d5320"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/flow.ts",
          "sha256": "07d26a20963ef90eada13f456bbde8129a3de038940972df19b82909814b9789"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflow-kit/validation/build-manifest.ts",
          "sha256": "35d6b4f2b9c2d7a7d08109304fd71226d0891840b3adba70ef1572037efe458e"
        },
        {
          "path": "src/workflow-kit/validation/module-role.ts",
          "sha256": "e1f963f9f2cfa319ad137a32f8303a8b31b06e2fa54a9f0eff1c9c474fd78758"
        },
        {
          "path": "src/workflow-kit/validation/scenario-coverage.ts",
          "sha256": "0c4d3374cea3e931e337806761f775302a1024d0e794c55890b02e7952191e85"
        },
        {
          "path": "src/workflow-kit/workflow-definition.ts",
          "sha256": "9f175147793eadd17aaf669972fd67cccda32d2f15515e96550853ea47a7baab"
        },
        {
          "path": "src/workflow-kit/workflow.ts",
          "sha256": "0793e7f363d2a950398194c98ec33ea9e7030735d31a26d1f0fb5aa362ec6217"
        },
        {
          "path": "src/workflows/separations/steps/ucpath-transaction/step.ts",
          "sha256": "97e1917cde43a4ddacf8a371662f1afead1934531d9f0518e315c573d973e61d"
        },
        {
          "path": "src/workflows/separations/workflow.ts",
          "sha256": "663cc40d44ef81fa18ae7055d4c671034f7e5fc24e3e87463a3343f34d2625fa"
        }
      ],
      "id": "separations-ucpath-termination"
    }
  ],
  "tasks": [
    {
      "fingerprint": "f887dc03a4f33f3c39b8d7b8c2d49bbcd4ec112cbc551d699c1f433b78015a1f",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/crm/driver-declaration.ts",
          "sha256": "286969d3cdda96323e12f652234ba2f4f6a3de94d7ea49a363b275f6a607265b"
        },
        {
          "path": "src/backend/systems/crm/driver/interpreter.ts",
          "sha256": "514f6068ec0e0ae76419ea35cbdb6840c5455ff1fd2d0d491afe3f6c39f20470"
        },
        {
          "path": "src/backend/systems/crm/driver/ui-registry.ts",
          "sha256": "22a14d0dcbb418887e637ee1cddff5fab7ab2703c80da5de154e521e7c136e46"
        },
        {
          "path": "src/backend/systems/crm/tasks/read-onboarding-dates.ts",
          "sha256": "116a030e7dc6c4706167dfa7beff75dcba3222a7dbbd59a11f024f0a905cf645"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/crm/read-onboarding-dates.ts",
          "sha256": "6f80dfb3e080aa54cd4eba8b3cfabe45f5edd6b6adb1db6308c886ee3ea9a058"
        },
        {
          "path": "src/models/systems/crm/read-onboarding-record.ts",
          "sha256": "a45f021bbc7804c234c7989497c7f38f47d1329607cef27c1a1acbc9b7623a2d"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/crm-onboarding.ts",
          "sha256": "525d3fd49aa9b7275f34aaf5bab25486a1acbf3f0925285d976e2855932b0b58"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "crm/read-onboarding-dates"
    },
    {
      "fingerprint": "0fc103b91f167304b0d628db19b1537026cb101270538b911d020165bc5db096",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/crm/driver-declaration.ts",
          "sha256": "286969d3cdda96323e12f652234ba2f4f6a3de94d7ea49a363b275f6a607265b"
        },
        {
          "path": "src/backend/systems/crm/driver/interpreter.ts",
          "sha256": "514f6068ec0e0ae76419ea35cbdb6840c5455ff1fd2d0d491afe3f6c39f20470"
        },
        {
          "path": "src/backend/systems/crm/driver/ui-registry.ts",
          "sha256": "22a14d0dcbb418887e637ee1cddff5fab7ab2703c80da5de154e521e7c136e46"
        },
        {
          "path": "src/backend/systems/crm/tasks/read-onboarding-record.ts",
          "sha256": "895f141703762d8b2a3f4aabae30713c84b65838c2052e87b143e29fc7151500"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/crm/read-onboarding-dates.ts",
          "sha256": "6f80dfb3e080aa54cd4eba8b3cfabe45f5edd6b6adb1db6308c886ee3ea9a058"
        },
        {
          "path": "src/models/systems/crm/read-onboarding-record.ts",
          "sha256": "a45f021bbc7804c234c7989497c7f38f47d1329607cef27c1a1acbc9b7623a2d"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/crm-onboarding.ts",
          "sha256": "525d3fd49aa9b7275f34aaf5bab25486a1acbf3f0925285d976e2855932b0b58"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "crm/read-onboarding-record"
    },
    {
      "fingerprint": "2d212decbba1c9727d3d9537e4aba52f2337b674b75c56787a3b4ab895c24a3f",
      "sources": [
        {
          "path": "src/backend/processing/extraction/tasks/extract-pdf-pages.ts",
          "sha256": "b40ef8051c7bf4c1f404077370b9de28ebb66068d53e8c0a1cd5eab7bb0b7213"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/processing/extraction/extract-pdf-pages.ts",
          "sha256": "f0cd6508b4c0ce03caadf5bb53702cf7107de4c7e07b3e38c841fbe0c86c7a3c"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "extraction/extract-pdf-pages"
    },
    {
      "fingerprint": "e85d86e1b049e1e1cc603d85d4f122e9ea5ce87bca1aa35148897ffc5c3773d0",
      "sources": [
        {
          "path": "src/backend/processing/extraction/tasks/extract-spreadsheet.ts",
          "sha256": "0f9ab841af37e3bcf8aec0f4d49ad22026dd48d4815df083541b9262c5323f7a"
        },
        {
          "path": "src/backend/processing/spreadsheet/spreadsheet-grid.ts",
          "sha256": "5180dc6c485f397fcd5dc6b95702b25f079542868e177ac418e9d9e4dc86f356"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/mapping.ts",
          "sha256": "27186b204fd5b05e9e2822b35137aeb6f9c4692fa397f3d9f1bf95c1976b38bb"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/processing/extraction/extract-spreadsheet.ts",
          "sha256": "7c62d07e1dbe4e000b13b58d36db4359c419c96eb552a348967a1a7277860b75"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/intake/header-discovery.ts",
          "sha256": "b34896de30dadbd2e8390bc2acd883b2255e80007144497e51d1a7ffd8f26e03"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "extraction/extract-spreadsheet"
    },
    {
      "fingerprint": "d05842773d1694de753cfde62a83359bb30644c7d2e577fe5926d7ceaba14c45",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "5c492f599612d1d0d5eca0808143f588ce53d35e729012ec6d9fc91d61949e33"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "05c3c824b0a4a55caf1a52acabaa4cf100e428cb9b424ed45cd842af3c6240de"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "e237c25643006f6f971158b3e4c07e1698f37f3dde31b210847053beaf7ba9cf"
        },
        {
          "path": "src/backend/systems/kuali/finalization-verdict.ts",
          "sha256": "1e0bb4aceedff8d83b3352a82254d0fa04d7a6d2b37e452156dc03c92f7d37c8"
        },
        {
          "path": "src/backend/systems/kuali/tasks/match-separation-finalization.ts",
          "sha256": "670b91afbabeb3acc9fe93bb3cf50d56d3bfdc708597e354e886d6b1bac8fa6d"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "kuali/match-separation-finalization"
    },
    {
      "fingerprint": "7d2ec85b6d437677428ff36e51d30845dc9eb2a91fa37276ce32fe1eddd1f000",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "5c492f599612d1d0d5eca0808143f588ce53d35e729012ec6d9fc91d61949e33"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "05c3c824b0a4a55caf1a52acabaa4cf100e428cb9b424ed45cd842af3c6240de"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "e237c25643006f6f971158b3e4c07e1698f37f3dde31b210847053beaf7ba9cf"
        },
        {
          "path": "src/backend/systems/kuali/tasks/read-separation-document.ts",
          "sha256": "2a631c2dc489fea42bdc214e3bb7e7089f6cbae22f0cc99fed8b4948d7773bee"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/read-separation-document.ts",
          "sha256": "819f659cb964c6de48b8900d7794d6a8f009b8a362bd41f9ebc7ecfefbe0f530"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "kuali/read-separation-document"
    },
    {
      "fingerprint": "6c7036eafd93b333b5dd2411259c990d8dc67eedb7b00235b7c90d12773ee441",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "5c492f599612d1d0d5eca0808143f588ce53d35e729012ec6d9fc91d61949e33"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "05c3c824b0a4a55caf1a52acabaa4cf100e428cb9b424ed45cd842af3c6240de"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "e237c25643006f6f971158b3e4c07e1698f37f3dde31b210847053beaf7ba9cf"
        },
        {
          "path": "src/backend/systems/kuali/tasks/save-separation-finalization.ts",
          "sha256": "1b41e51db971b234ac87e7676f21e74f696983f7e3d2b94b9b11c4e49cac8da1"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "kuali/save-separation-finalization"
    },
    {
      "fingerprint": "4d9b723d3db2dca007e78f6a1c54de4704bf172e0af5d0719ac83f20647963c3",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "5c492f599612d1d0d5eca0808143f588ce53d35e729012ec6d9fc91d61949e33"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "05c3c824b0a4a55caf1a52acabaa4cf100e428cb9b424ed45cd842af3c6240de"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "e237c25643006f6f971158b3e4c07e1698f37f3dde31b210847053beaf7ba9cf"
        },
        {
          "path": "src/backend/systems/kuali/tasks/search-separation-action.ts",
          "sha256": "08530f4209c06627a3fd18fc58f612df088c911acb8f8779727fb9c51d7fcca9"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/search-separation-action.ts",
          "sha256": "d5947d4f2b6ac967fee4729e73960b03c28044fc1c01543b737d8c44ffae1532"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "kuali/search-separation-action"
    },
    {
      "fingerprint": "b54cd8e0cfd00c813b5b576deaee5dfcce84efe70cf686f58871967015859df8",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "5c492f599612d1d0d5eca0808143f588ce53d35e729012ec6d9fc91d61949e33"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "05c3c824b0a4a55caf1a52acabaa4cf100e428cb9b424ed45cd842af3c6240de"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "e237c25643006f6f971158b3e4c07e1698f37f3dde31b210847053beaf7ba9cf"
        },
        {
          "path": "src/backend/systems/kuali/tasks/stage-separation-finalization.ts",
          "sha256": "10fc04c6beb31e87b0828c295b0c65869bf5c708979771276858e63ca9ad189a"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/stage-separation-finalization.ts",
          "sha256": "c666c289bb0eda2749f0f4179ee3bb77dd68580f45020f6392ba6febdef3050d"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "kuali/stage-separation-finalization"
    },
    {
      "fingerprint": "a6e8dbd57d24935e4442d8d3300f235899bc611237d76fc57d5f825175b9bdb7",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/kuali/driver-declaration.ts",
          "sha256": "5c492f599612d1d0d5eca0808143f588ce53d35e729012ec6d9fc91d61949e33"
        },
        {
          "path": "src/backend/systems/kuali/driver/interpreter.ts",
          "sha256": "05c3c824b0a4a55caf1a52acabaa4cf100e428cb9b424ed45cd842af3c6240de"
        },
        {
          "path": "src/backend/systems/kuali/driver/ui-registry.ts",
          "sha256": "e237c25643006f6f971158b3e4c07e1698f37f3dde31b210847053beaf7ba9cf"
        },
        {
          "path": "src/backend/systems/kuali/finalization-verdict.ts",
          "sha256": "1e0bb4aceedff8d83b3352a82254d0fa04d7a6d2b37e452156dc03c92f7d37c8"
        },
        {
          "path": "src/backend/systems/kuali/tasks/verify-separation-finalization.ts",
          "sha256": "880d35e4d5ec51f405bec40126acffc9a6128e7857468cf3213c42025fc50246"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/kuali/match-separation-finalization.ts",
          "sha256": "6698fd70208d71ae45e06eb39c7e1279b81f3d33e29fa027c31a1f4270bd7d67"
        },
        {
          "path": "src/models/systems/kuali/save-separation-finalization.ts",
          "sha256": "9df36abd51a7697bf82d8c966f73b6fab962b6b496e95207e3bfa8b6ffacaa23"
        },
        {
          "path": "src/models/systems/kuali/verify-separation-finalization.ts",
          "sha256": "ce90d99bf57c1af9295e052ec8c5570e5b8eb5bf04e59a5e9c8989d626ae5bd6"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-action-list.ts",
          "sha256": "450dd97a89eda25ba8ea90cccd2ec6b07ad0748580bf07c3052b4674fa9118c1"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-rrss-document.ts",
          "sha256": "22bf991070be71280c8ddec67fe91b0883b7e1c89d4b3c69a9a70139fa0fe2d8"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "kuali/verify-separation-finalization"
    },
    {
      "fingerprint": "9f3553705eb377908b0ec1afaa9d2027601e4fc62772e1e827a18ded353f9dc0",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/new-kronos/driver-declaration.ts",
          "sha256": "cec01f107c070f61ed721285b586262ce9b311d8e3131963f4d8320f67b30fcb"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/grid-scroll.ts",
          "sha256": "76344a4b728491f0c6dd04cba7fc540965a2d4c83e5c77c8dfcb6190e5d0c6ac"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/interpreter.ts",
          "sha256": "2ced7567d29c2e609303cc45815009feeae68d6158cd23c72cb192d83e41095c"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/search-render.ts",
          "sha256": "031b18899f489a8f5e6f529d54c4a50ab3e960517fcd1e5a7d867dfbdb9d3d2b"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/ui-registry.ts",
          "sha256": "abdb8a3bf81f03d1bd55d7410c55d7d45004d1e436338dfdfc0c02b739594e88"
        },
        {
          "path": "src/backend/systems/new-kronos/tasks/read-separation-timecard.ts",
          "sha256": "9b6c1088f9a5def5b38919de0127bef7cbd72c323b1cbe7f288561fa4d98e7bf"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/new-kronos/read-separation-timecard.ts",
          "sha256": "60b6cf0adce09dfa60452469c08fba6b7db7c8a356fb76d77145a51247bbd142"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/new-kronos-timecard.ts",
          "sha256": "36317ed94b5b444880ecaeb3133faced6d2f37d7adb714dd26c937d43e1d7e18"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "new-kronos/read-separation-timecard"
    },
    {
      "fingerprint": "07b33dd1558950d0c87652b4b6334bae65d0b88e19048d440755eda47a35d089",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/new-kronos/driver-declaration.ts",
          "sha256": "cec01f107c070f61ed721285b586262ce9b311d8e3131963f4d8320f67b30fcb"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/grid-scroll.ts",
          "sha256": "76344a4b728491f0c6dd04cba7fc540965a2d4c83e5c77c8dfcb6190e5d0c6ac"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/interpreter.ts",
          "sha256": "2ced7567d29c2e609303cc45815009feeae68d6158cd23c72cb192d83e41095c"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/search-render.ts",
          "sha256": "031b18899f489a8f5e6f529d54c4a50ab3e960517fcd1e5a7d867dfbdb9d3d2b"
        },
        {
          "path": "src/backend/systems/new-kronos/driver/ui-registry.ts",
          "sha256": "abdb8a3bf81f03d1bd55d7410c55d7d45004d1e436338dfdfc0c02b739594e88"
        },
        {
          "path": "src/backend/systems/new-kronos/tasks/search-employee.ts",
          "sha256": "6a567da327070ec6689b3005cac433649aef7798f5a1adf8e6cea6d4a9e52722"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/new-kronos/search-employee.ts",
          "sha256": "f69ea49823248af329cdbf699117f494d65a5b0fee4535200660090816bd8322"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/new-kronos-timecard.ts",
          "sha256": "36317ed94b5b444880ecaeb3133faced6d2f37d7adb714dd26c937d43e1d7e18"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "new-kronos/search-employee"
    },
    {
      "fingerprint": "80723183e5ef4da066e0fe2123adb9e6c8b103758a6d6260d6a2ecc909218110",
      "sources": [
        {
          "path": "src/backend/processing/normalization/tasks/read-contact-advice.ts",
          "sha256": "bb95b7bf8e25bd50c4303f51076100fe281aceb4744edab2839ce2330177f2e5"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/processing/normalization/normalize-contact.ts",
          "sha256": "716a7adb783838145fd139647d8a1fb81bd7a024ba45923f7f4b5b933bab1cb1"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/advisory.ts",
          "sha256": "e1f03c4d21e054fd53ce33587115e3c793722b708b5e8e7f5e17f038305cf266"
        },
        {
          "path": "src/models/trust/failure.ts",
          "sha256": "85ca36fd8eaafcba4f9823c6053fb1fa27a0a86da63bb712467cb4ce6b48ccd4"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/normalization/contact-rules.ts",
          "sha256": "e19de6185325f74247f3b822b3519537f2e4aa3287e23d3dd33544f4402de311"
        },
        {
          "path": "src/rules/normalization/geocode.ts",
          "sha256": "e6c31995055622742f3a255b83ea0b1e36b8fe7ac24b2fab0836136fdfa9218a"
        },
        {
          "path": "src/rules/normalization/street-safety.ts",
          "sha256": "feaac03f30def7334a5b15024719e3fbd62d2c0c58fd319bc48c550ae52c991c"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "normalization/read-contact-advice"
    },
    {
      "fingerprint": "e7cfc77e795110aa69928aa1ddb4c900e208981c7703167bba64075f4f9fc2c7",
      "sources": [
        {
          "path": "src/backend/processing/ocr/tasks/extract-form-page.ts",
          "sha256": "8bba993736397dfcf1a5e20ebe0e9777a4307ebcade0c9136fa04bf03420eae6"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/ocr/extraction.ts",
          "sha256": "cb8719a0676054f5b033d006176dfea67cdf5117606ba94a294dc01f7c5e0c3c"
        },
        {
          "path": "src/models/ocr/form-registry.ts",
          "sha256": "0154d6e2b3cac5fd2cbc980807a9b719300a6a82c8d32f4aac53498f28427a5c"
        },
        {
          "path": "src/models/ocr/instruction.ts",
          "sha256": "91a08b3873354c9cb962383fc3b6e66623676d072f2a64e34b1183cc491f335e"
        },
        {
          "path": "src/models/processing/ocr/extract-form-page.ts",
          "sha256": "3315ef0416ce862b18b2b6c97833c04388fad83ebfd6dc689ccc86f9208128b4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ocr/extract-form-page"
    },
    {
      "fingerprint": "9692116ea9cfcac566bda738fe8327d714e8a4ea9866c8cee1710e5d278990ea",
      "sources": [
        {
          "path": "src/backend/processing/roster/tasks/match-spreadsheet.ts",
          "sha256": "9f34eee44f299782c87543bf7e325d2e7f821a5913b4f359c090659ba72ffd7e"
        },
        {
          "path": "src/backend/processing/spreadsheet/spreadsheet-grid.ts",
          "sha256": "5180dc6c485f397fcd5dc6b95702b25f079542868e177ac418e9d9e4dc86f356"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/fields/cell-coercion.ts",
          "sha256": "dfe59f9816f0411e6dfc612581ce3cac9a96f619b717fb8ec525749828944cac"
        },
        {
          "path": "src/models/fields/registry.ts",
          "sha256": "73dd05da2ea2b38f9d9fd140489db6086de2fe5a7e9c4b8297070efa92e4c393"
        },
        {
          "path": "src/models/intake/mapping.ts",
          "sha256": "27186b204fd5b05e9e2822b35137aeb6f9c4692fa397f3d9f1bf95c1976b38bb"
        },
        {
          "path": "src/models/intake/projection.ts",
          "sha256": "d7b2db3272659685b8c144979a54e02a817ad11aed89d70490a109e706adadab"
        },
        {
          "path": "src/models/processing/roster/match-spreadsheet.ts",
          "sha256": "1aa782cca1ef3a93fa8f5ecb094d9847467700e8d6a5169cb8b15fd7937f59b1"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/validation/schema-path.ts",
          "sha256": "19f46c6caf4d2fb477d5bd9b4ec0a80d584b3e4891ab5a741c71761c1eb05b07"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/match-confidence.ts",
          "sha256": "11ba724a0f3af0e3c5805daf6b3241af132c0739871fd33c90a02a60f0f3e850"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/matching/roster-match.ts",
          "sha256": "f189d4c7ec093bf4ab9ee6903be7b4b7497aaed22a155facc06470ce08fa7520"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "roster/match-spreadsheet"
    },
    {
      "fingerprint": "71eda089b7879b9d469b326107d0b92949ae75e65562f0ee6eae400cbc0d83e5",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/create-termination.ts",
          "sha256": "eb0430757c31b67c42a79c268d977223a8e962b7fd6db07c2dea509eda4687af"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/create-termination"
    },
    {
      "fingerprint": "90ae97f8e1b401addc939057a92ce14140f3bf525b39227029e75f28aa28ec56",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/delete-pending-terminations.ts",
          "sha256": "e5a14367bd29a3eff41f43f9e0c56b23eb23383007e1fafb973e67905b3cc9ec"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/delete-pending-terminations"
    },
    {
      "fingerprint": "37e178fbb250b97b25fca47c4498e6fb28f2db46b3e22d8eef017235a9f5718f",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/match-existing-termination.ts",
          "sha256": "48b923c8f4158e799db225fa2ce6042e718b4777d86edc46ef2fd78db50eb804"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/match-existing-termination"
    },
    {
      "fingerprint": "65452a1543e8bcbc60e9af80486e66a4500bfec6f801124d8bee2b4c02201e01",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/match-pending-terminations.ts",
          "sha256": "f1c4bee71305436b28904948de03a3452206d15666f086a56161025284154fef"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/match-pending-terminations"
    },
    {
      "fingerprint": "c223e5bed7100ff2f798bc64ab167abc8718972630d9a7fe1ff9bfa7a280f805",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/read-job-summary.ts",
          "sha256": "69270eda5113503a4d6ec838ceb0930529d729a6caf66eda92e25a8b7e108e24"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/read-job-summary.ts",
          "sha256": "8f588366b419bd78989f2efbc6410d34256a8f6adbc178f948d8c9ecde5faff3"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/read-job-summary"
    },
    {
      "fingerprint": "eb7ed15486e195114f57a25d60cabb5086de7c03f1d5072c572d31eb62be92bc",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/read-pending-termination-set.ts",
          "sha256": "15138833a86fbf91f6f4199abadab61931d9e08fb9b0ccc49456251eb88110bb"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/read-pending-termination-set.ts",
          "sha256": "46dd5fd5d73339b92dbb60338326e018a46329ad99ca52e2022051a031a32bea"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/read-pending-termination-set"
    },
    {
      "fingerprint": "9326fbd3404d4e7289afabd0627ec4e477b7c144d9f2f268c525e064e243d8c4",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/search-person-org.ts",
          "sha256": "ec8a9fee34f5ee8ea66dc8759eaf97e15da6b7d2f499a27e37006adc12ee8f92"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/search-person-org"
    },
    {
      "fingerprint": "b810b11c52f6461a5ad2bd5ee9850aa2e2004bab3ee6c8971cf10c082669fa3a",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/stage-pending-termination-sweep.ts",
          "sha256": "48f5fa53d069b7866c25c9bbd82e4d4fbe0bd9e8c0a011330ec3506160b4d3e3"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/stage-pending-termination-sweep.ts",
          "sha256": "03d0a2d1b48c6b753d24befa869994cb0ec8fdef41c4c844c346b320cbe5f3d0"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/stage-pending-termination-sweep"
    },
    {
      "fingerprint": "aaaa5c13fd0bc03f93190b0567f830bc28cad78835c82876183c5e0934e03600",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/stage-termination.ts",
          "sha256": "f90c2b0e9515881d2defae5e684013e315dce086df05100977d4eb96867f449e"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/stage-termination.ts",
          "sha256": "62a6d55587286ad683d26d1715248721ca00d8ef15986ae9f46a7211d91aa020"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/stage-termination"
    },
    {
      "fingerprint": "a89bc274c7a71d0e4d6120c7bd4b6ba4742342e41f2b5cc48d9eeb80f8f4da98",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/verify-pending-terminations-cleared.ts",
          "sha256": "61c6b815b1f83ce64ccf82b1dced141e01e3eb0e42c27561b4a3211246cffba6"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/verify-pending-terminations-cleared.ts",
          "sha256": "88c2ea3b29cfcb451d9c5365fa6d146a6ad1255eee651584e63e8e7efa96fe7e"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/verify-pending-terminations-cleared"
    },
    {
      "fingerprint": "b19ad69171e91ce6f8fb2c623676223fe89228722b093082abb12944f298b9e5",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/verify-termination.ts",
          "sha256": "f2c42f20e01300075d0b6d8788a24beb66e55e71f6679855d86bb6b0e66edce7"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/verify-termination.ts",
          "sha256": "e3e122a33625d77d7d171ac9f0954b6bcb72c9f236f965998b9d07d6bdab669b"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/verify-termination"
    },
    {
      "fingerprint": "b42f65fc0994c49e873a47db4a72d73d748df2c9393f8b51bda0f617263a061a",
      "sources": [
        {
          "path": "src/backend/systems/browser-shared/action-notes.ts",
          "sha256": "3782941831c27756fbdf4efba16690a37f933c24377f9b4dc991c59c65ee3c6c"
        },
        {
          "path": "src/backend/systems/ucpath/driver-declaration.ts",
          "sha256": "04d5e333a9d031b8f9b793f9c29123921fed117301921e961316bffa64379deb"
        },
        {
          "path": "src/backend/systems/ucpath/driver/interpreter.ts",
          "sha256": "b912ff38e1a943dc7558ad8867ed8422f069944fa16497f6f2cec93511f66387"
        },
        {
          "path": "src/backend/systems/ucpath/driver/person-org-operation.ts",
          "sha256": "8539124cb2c183ef7b1a5b8fe649618901f2e4e47ece2ace18b2098f11362de1"
        },
        {
          "path": "src/backend/systems/ucpath/driver/registry-locators.ts",
          "sha256": "c3038efa6fd83af5dcdd53295049a011b72e4139da34c7f65b456c886194076a"
        },
        {
          "path": "src/backend/systems/ucpath/driver/smart-hr-operation.ts",
          "sha256": "70f43e80a454d0f58b1ac59fed5ad606def4858a5f7585ecdf72ae4abfe2ffda"
        },
        {
          "path": "src/backend/systems/ucpath/driver/ui-registry.ts",
          "sha256": "27c7714213383c53d31e4c0b87999d3d7e333c7271701c30952c22dce7e82b29"
        },
        {
          "path": "src/backend/systems/ucpath/tasks/verify-termination-filing-present.ts",
          "sha256": "131cdf4fb36ab9d69b5b2865fda9d2e94cbc992e81bd61de8744dbfe09980d88"
        },
        {
          "path": "src/backend/systems/ucpath/termination-verdict.ts",
          "sha256": "6cb1b8d9ddbbd99e19e7cb23ae1b06f9db14e9928df338c3a141a46540298aa4"
        },
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/envelope.ts",
          "sha256": "e156327d1b5b14ac68a72f39e69d48b2e6d997a8e7bfc36d3d5fb77bdffa637e"
        },
        {
          "path": "src/models/run/rerun.ts",
          "sha256": "4a31f4dd59a7b40924261955c403a9077368b452c8e4a35a19e2265baf21f147"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/create-termination.ts",
          "sha256": "eb4ea44ec4a5e7300997758351915ff6eb3594dc065681b6a06efcde4ac716f6"
        },
        {
          "path": "src/models/systems/ucpath/delete-pending-terminations.ts",
          "sha256": "366ae32df6986137f6ed11f86f8d72fe2bb429d686ae6846781ee82c2faaec33"
        },
        {
          "path": "src/models/systems/ucpath/match-existing-termination.ts",
          "sha256": "977c5db1b304c0b2deedd1ed78d19f2c05b1b1435f07f078d5c9581f269ce28f"
        },
        {
          "path": "src/models/systems/ucpath/match-pending-terminations.ts",
          "sha256": "569d5c95fcfaa560ef9fd887959ea2b8eb60fb219644267e94e0d5270f18275a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/systems/ucpath/verify-termination-filing-present.ts",
          "sha256": "84f3e69a9f4d79ecaaab020be5d863ebcd6381ab1b3de63f678d73595293cc13"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/trust/preflight-scenarios.ts",
          "sha256": "d1128972858ff63d759e20f2509664ab5588f6c72342815ad837dd2379f994cf"
        },
        {
          "path": "src/models/trust/scenario.ts",
          "sha256": "74956dd71130bbf7ae4393db9ead0665d11799fd096d0836cf960831f5e00c18"
        },
        {
          "path": "src/models/ui/contracts.ts",
          "sha256": "f1ab70499817fbdcc51fc6e9d847232e65769619547191db4cc1b616640321c0"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-driver.ts",
          "sha256": "4dea7d199ddb472e535b56b8e0586582378e05c36364a4b6a08d144be8dc75ae"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflow/presentation.ts",
          "sha256": "7dd892d65080d2a3b344b6190aa3679e883627d3012ae74baac68d38b84e13d7"
        },
        {
          "path": "src/models/workflow/step-omission.ts",
          "sha256": "9153b6c14370d308e09157eee5ca5a3c45022565ef0e43d928303e3db50610c2"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/sessions/duo-ceremony-lease.ts",
          "sha256": "fd07bed0c7952992b72d6d126adfd9b7fbe4e3f81d36fac7363fea1348419966"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-authority-reason.ts",
          "sha256": "7f1afa8fac3dd9f999070cfa9fe814c71bf3f227e65d7a26a9d253512d196f68"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/rules/write-safety/write-safety.ts",
          "sha256": "a7c291846e538f7cea294d47dab94f044668c07e9c2a29a1d5e332f1b6b55566"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/duo-ceremony-lease.ts",
          "sha256": "343e2a44962cfc4de7fd2d0bd0c08e66789f940c7c59ced8177b1fb761943357"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/mutation-capability.ts",
          "sha256": "218d66cc0ef2c4a86d159ad148308b853c8f8d3b4cdf0e06b778c89e61a6bfd2"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/session.ts",
          "sha256": "e362ed5922d79071724c5040cf085be2e72e1d905ff09259fcc869f554fbd686"
        },
        {
          "path": "src/workflow-kit/task-registry.ts",
          "sha256": "0d0a33918b07aea22c04cc0821228a8213de0a484e84534f4b3b51bfa009398f"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        }
      ],
      "id": "ucpath/verify-termination-filing-present"
    },
    {
      "fingerprint": "4526fa87d431a57976d26db568e8ee95f0ce64ced06b30b3758f33ea5db777be",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/crm/read-onboarding-record.ts",
          "sha256": "a45f021bbc7804c234c7989497c7f38f47d1329607cef27c1a1acbc9b7623a2d"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/person-lookup/read-active-status.ts",
          "sha256": "bd0e6043e5903a478d0ec183d604bf42463d859f80d8babad3113ee52adf08d1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/person-lookup/tasks/read-active-status.ts",
          "sha256": "30b4f73991eb941604b7a5b7edc734f528dbbca5155fe8e1f8bfc7d470092ea0"
        }
      ],
      "id": "workflow:person-lookup/read-active-status"
    },
    {
      "fingerprint": "e1098037bf2e8c9ceb361d340a2bf67eb71ccc4ffd01fbd6c314123a19e6f5df",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/match-active-employment.ts",
          "sha256": "179ba0ffb0a1c35a9366d14de547dc72a169b913813ade2d6cffe4f1ffa784c6"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/separations/employment-selection.ts",
          "sha256": "4b8a286c8e4ce8d4707f705e8b86bc130f822d6f4b373abc214bdac0e6869f7e"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/match-active-employment.ts",
          "sha256": "155d5181ee2a4b1b89b6a82f1c53873e5ee908db3f0edc4a2234d9325f641083"
        }
      ],
      "id": "workflow:separations/match-active-employment"
    },
    {
      "fingerprint": "a9f8effad7c00407919fdbdd1fb44420aeb9e063c23a1c38818711d570937412",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/kuali-separation-finalization.ts",
          "sha256": "dbfc677bf3197ee8b5bd8c2513f98db0dd230324483a4dba518c9854a514e632"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/match-department-option.ts",
          "sha256": "df73dae460e38d9342feab960071c18229f07721f70c2270d75df0cc91991125"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/separations/department-option.ts",
          "sha256": "c1b27b6a4c52bc64c483ebd0832918076784e53d37c2773c7c43dbee32320d84"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/match-department-option.ts",
          "sha256": "35046dfd0137186971bdeaa9d24f74aec550194a8839cfb1e5fbffe497c8612e"
        }
      ],
      "id": "workflow:separations/match-department-option"
    },
    {
      "fingerprint": "7f2163cc92e82d7461629da199435e02baab141d7c9449dabd7fccc75fa2728d",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/match-identity.ts",
          "sha256": "1e3722c25a33c0aad02762df50af02830903aa929ae18bcb2c2b85425437fe03"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/match-identity.ts",
          "sha256": "9d22534129180501214b97ec42678f6aaa4042a021385f0d13760a5197cd5859"
        }
      ],
      "id": "workflow:separations/match-identity"
    },
    {
      "fingerprint": "7a21b5de229026a81029caa11c3eb3f80d78ce4c5ed2333135e87ce6ba975009",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/match-separation-subject.ts",
          "sha256": "10931bfd20166b6fa3cae2217b6ee98cad88653f904b68d0e92a60ed41d61f74"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/separation-subject.ts",
          "sha256": "bb1def903b4dd76b947e05890e958f83519625232fa99a27d5214e12896d5320"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/match-separation-subject.ts",
          "sha256": "019e99397922be390b94211a741d7e62878da4568b9ed748473f15521306587f"
        }
      ],
      "id": "workflow:separations/match-separation-subject"
    },
    {
      "fingerprint": "e203b675c4d7ed80393d9fa182631d21f9e9dd2ef88f8ca39b9b9dc01e1e9cd9",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/match-termination-type.ts",
          "sha256": "bc73b2bb8b22d6235cdcc51a3a971734f694b8887595216233d17e2d83a4cf51"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/match-termination-type.ts",
          "sha256": "b8ef7cf4bd1c6de447f28d0ddec7c6f412c3111445fc4dc61cfab1e809ccf0a2"
        }
      ],
      "id": "workflow:separations/match-termination-type"
    },
    {
      "fingerprint": "8b5c696d3088e628c3833ab888f8f5d378f742ff7f2e3cc167b76c5c6cc2f083",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/read-separation-dates.ts",
          "sha256": "058c544106ec714fb1599529f24e066fc3726fe870f0e179a3deb6a560d22657"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/kronos/separation-timecard.ts",
          "sha256": "f1005c362ffcb465a46ca38c62b6b7a94e71c120da474e466c17627b3675fbf2"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/separations/separation-dates.ts",
          "sha256": "f5404eb462ff236827b58e69cdd2558b3077dfc42edc680ee69156dae89f0bbf"
        },
        {
          "path": "src/rules/time/clock.ts",
          "sha256": "9631a8b2ee11f36a717a81da75eb2c874421a3565c9818a421058471b87b579d"
        },
        {
          "path": "src/rules/time/timecard-period.ts",
          "sha256": "31261c64d393fc54e911c8e6758d6cc74114b325c1c8e0277bbb4cbb9dfd852a"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/read-separation-dates.ts",
          "sha256": "af5eb9d33b06ab8c2e18f4c45ce2812b27288230b3fd62665a975f182b71c419"
        }
      ],
      "id": "workflow:separations/read-separation-dates"
    },
    {
      "fingerprint": "6f486bdfb7b0aed8835d3a9f8c624eb36c4e34f25823257904f2ce9a44c4fa98",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/read-separation-plan.ts",
          "sha256": "b1de9e7e5eac60d27024a1d8130717699709dab14e8f37c986fa49287ff2a780"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/separations/separation-dates.ts",
          "sha256": "f5404eb462ff236827b58e69cdd2558b3077dfc42edc680ee69156dae89f0bbf"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/read-separation-plan.ts",
          "sha256": "7f46faab4c6415918eec21317dea6a96a07e350f4d707c16a949877356bd8072"
        }
      ],
      "id": "workflow:separations/read-separation-plan"
    },
    {
      "fingerprint": "bd27a49d429f1be926c6454ed593d0b95a5e014261d1e9dfb1d9ff6c39a00609",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/systems/ucpath/search-person-org.ts",
          "sha256": "87f722068e57d61449987ac2749679f8b8ed720650e7c222641d1fd8f77133b7"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/ucpath-job-summary.ts",
          "sha256": "44812ce5552496299808c114084ed47221b5ab7f2d6bdea1c1d5f2714e51e383"
        },
        {
          "path": "src/models/ui/ucpath-person-org.ts",
          "sha256": "c5e3a0cd3cc16d9ec0cfa725b988f07bd18bfb6431e873e9197d8362031fb366"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/verify-identity-approval.ts",
          "sha256": "46f796d9b5357e53ff3e2d4bfeaaf5449b743acd4f99e5726727d36b2ea1f8f4"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/matching/levenshtein.ts",
          "sha256": "f3f15ca0398c45461c0bab20c947adc4ecd745f6e9e1956fcbe7c7a68df14d48"
        },
        {
          "path": "src/rules/matching/name-match.ts",
          "sha256": "830baad1b128dcb693950a3ac3268011fd0f3c2599ca012cf22c6d92bca9b83a"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/identity-approval.ts",
          "sha256": "727e60dc73177a36cf4dcbb7952ea3673822e859d2b6c3225416c8dbec9eddd5"
        },
        {
          "path": "src/rules/separations/identity-evidence.ts",
          "sha256": "11491a01fd98753d3580a904a074b05297ce7619918ac63f97be1edf4728fe5a"
        },
        {
          "path": "src/rules/separations/job-summary-classification.ts",
          "sha256": "630f4b4f3e8399a0a4db02c7d4b396eb2acc35cba2a0e9ea8346f4cc0efb4ee4"
        },
        {
          "path": "src/rules/separations/write-plan.ts",
          "sha256": "04b4528cc2377fc8af86930e2aca02e4c2a18927af88392cc853ef9a8bc1a4f5"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/verify-identity-approval.ts",
          "sha256": "ed0afe8f0ad289f1698eb4ef237e48e1c5735d224fad1fc7898db51d2d4501d8"
        }
      ],
      "id": "workflow:separations/verify-identity-approval"
    },
    {
      "fingerprint": "b3ec0c38676ebecfe7ca90753d8e0fb2bd2a4fb9b11c7c00c0d3aa2a4c4d3e4e",
      "sources": [
        {
          "path": "src/models/artifacts/artifacts.ts",
          "sha256": "a5c9d5ee28706b2e759dd859898d97248546a0c2634e5eb5f81aadbdef48a3dc"
        },
        {
          "path": "src/models/config/catalog.ts",
          "sha256": "8ee95bd0fe6c117584e17346ee9e12982e533e0ff0e095601ba6558585ce24f3"
        },
        {
          "path": "src/models/config/schema.ts",
          "sha256": "a664f296601fe3e1a6f6758575d55f08343806f8a85f80be1afdf56e971c2743"
        },
        {
          "path": "src/models/config/secret-names.ts",
          "sha256": "9995675f85f506f40cab870013d393ffaeef8ff6df5ff4b672de5a7d867c02ae"
        },
        {
          "path": "src/models/events/confirmed-action.ts",
          "sha256": "f4e6ac0bd065411d711c0c3c162af2b37f4e36926ec654e2fb8a62bfb8b074d4"
        },
        {
          "path": "src/models/providers/providers.ts",
          "sha256": "fb4decc3cc73b8c6db0d0fce45b746f1524fc0a05f8de8857125a7c5dd8742ad"
        },
        {
          "path": "src/models/run/result.ts",
          "sha256": "1232a7c57b09319d538a7637eef468462cc06066f1921ef0ba450c4a81a15ff7"
        },
        {
          "path": "src/models/sessions/session.ts",
          "sha256": "442833c0025202680e5d72a8ba339599e3e29f36d87a5ce681cb1c9dbd90e74a"
        },
        {
          "path": "src/models/task/task-contract.ts",
          "sha256": "c6000a7b955839418153559c843abc0de7b994c289b79a6b57148261182d9572"
        },
        {
          "path": "src/models/task/write-safety.ts",
          "sha256": "d9c67368c1db2ae8805e1154270a9f61f22d735feae253942f0d0034715d0f0b"
        },
        {
          "path": "src/models/ui/driver.ts",
          "sha256": "1f69a796c4ee7279d34439efbb6bf8c73a2a8e5161daecfec763c84a4f325f84"
        },
        {
          "path": "src/models/ui/kuali-document-identity.ts",
          "sha256": "ec9c603820afd8c5bb98f4c633afba66e04e8c46dc5ae9f91da9446f2fa0d266"
        },
        {
          "path": "src/models/ui/kuali-separation-document.ts",
          "sha256": "7f3b3664850a3d7251e907bdf0330cedf49b68601c5e77fa981b93807b9b9b55"
        },
        {
          "path": "src/models/ui/ucpath-smart-hr-termination.ts",
          "sha256": "d4a0470517cfb8afcd09acf18678609ca0ea5c656003b69eaffefd6e41d019ae"
        },
        {
          "path": "src/models/ui/ucpath-ss-smart-hr.ts",
          "sha256": "55a5c20bbfb256eb77264ed4f862035de6ba8fffe7ffc3b3917436a7a11bc5f3"
        },
        {
          "path": "src/models/validation/contract-boundary.ts",
          "sha256": "ada133341a95b679f436945b45fa1b8480689c467825792d89ce5886fa25585a"
        },
        {
          "path": "src/models/validation/schema-bound-value.ts",
          "sha256": "1f5685611f0ef56185bd1d2b049f36ff910cb88ab050e64ca248152c58ef91f7"
        },
        {
          "path": "src/models/workflow/checkpoint.ts",
          "sha256": "e76b029993d9c812d9b2c74fef90fd34814d812e70e20d19e999e660a3e8187d"
        },
        {
          "path": "src/models/workflow/delegation-policy.ts",
          "sha256": "e034aeb57fd3f97dff1872023c736de320f115760d47c5ae0e623dc77de8eb45"
        },
        {
          "path": "src/models/workflow/gates.ts",
          "sha256": "c0df33125657489785894fef7d60fe91e8b150608ae9d28da968fd4d027475b2"
        },
        {
          "path": "src/models/workflow/graph.ts",
          "sha256": "c3dbdba3c1cdad84c39b750ec9569b04371d54b3e04e8883d6b6c128a9d0c027"
        },
        {
          "path": "src/models/workflow/node-condition.ts",
          "sha256": "d63cfe2c6de77787a73c009254377d623dfcbc9493072ae199973fbe485d77ea"
        },
        {
          "path": "src/models/workflow/operation-action-identity.ts",
          "sha256": "5aa948b90dedcb14b1ff586e0b07e025e2aca7d3b1e984106e9b6b3155807bf1"
        },
        {
          "path": "src/models/workflow/operation-display-snapshot.ts",
          "sha256": "43657dcbee4dc83d588621e3d0892ddce2463aeeb2cd2f32076f9f252b77ed31"
        },
        {
          "path": "src/models/workflow/operation-display.ts",
          "sha256": "8561aa19764a58e96d63cc227c6af82b3bbc643fff7b1bfd80266049dede76ad"
        },
        {
          "path": "src/models/workflows/separations/verify-termination-receipt.ts",
          "sha256": "6614296aa8215f35f6a77c2e7bbbd8b322ee008c48ef21865570470ee48834e1"
        },
        {
          "path": "src/models/write-safety/protected-input.ts",
          "sha256": "d71c47f799cf0bfb8569e17cf7dead4d870d8814564b02615788c284da31156b"
        },
        {
          "path": "src/models/write-safety/unscoped-commit.ts",
          "sha256": "4415dac682f3f94b4ed677997d6cecf657cabb9f520f1de1cc6cca932235794d"
        },
        {
          "path": "src/rules/identity/ids.ts",
          "sha256": "a8bcc4ae53fc6af0d782b81234b4db97c80ecb8a83ccd43108b445f1f59b411f"
        },
        {
          "path": "src/rules/providers/provider-admission.ts",
          "sha256": "ad97b8c050c7b4640abc455828b7bfa11b9834c53c85b355e0aef15303d44c83"
        },
        {
          "path": "src/rules/redaction/redaction-policy.ts",
          "sha256": "e5886e8a0578838d3afd2606c3af8b07a2fb88c780ccda31036cac85707d34ab"
        },
        {
          "path": "src/rules/redaction/redaction.ts",
          "sha256": "acb33bd253af947fbf07f732e1d03a218c73be58ebe168e92bd6437a34e38c28"
        },
        {
          "path": "src/rules/separations/termination-receipt.ts",
          "sha256": "c2e72650947c481f638df74a95be127705af6aef364976c844107e4b340c134e"
        },
        {
          "path": "src/rules/separations/termination-type.ts",
          "sha256": "3b0e12067c36f56834e67eaa3fdbdaffd9d0dd11ddc1ee4525514212f990dcc2"
        },
        {
          "path": "src/rules/validation/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/rules/validation/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/rules/validation/sha256.ts",
          "sha256": "4ee01a46db47f96ee659eff34e9508833092c588d4ddd2877667bc34171093f0"
        },
        {
          "path": "src/rules/workflow/task-provenance.ts",
          "sha256": "59cb1078061fb5010c23852e0e380dca3364028506295d0ae87cae750deffa00"
        },
        {
          "path": "src/rules/write-safety/write-safety-primitives.ts",
          "sha256": "8da3a2ce7866a354eb103cdcc8fe34a8909196dff283a9ad8fd65f01a039fdf1"
        },
        {
          "path": "src/workflow-kit/artifacts.ts",
          "sha256": "3aab7248fbae5e9fba8604038e6fced44fcb0beecea79fd801aa028795efd178"
        },
        {
          "path": "src/workflow-kit/errors.ts",
          "sha256": "ef31ae7b6a74a1ce544cee595dc51785cfc4ff83ef99f69709f0ea7a11277f22"
        },
        {
          "path": "src/workflow-kit/providers.ts",
          "sha256": "ba03c2ce19135bf24dbf2bfdca41e6ae7f224046bd5217a12b3162688de347aa"
        },
        {
          "path": "src/workflow-kit/task.ts",
          "sha256": "a8bf293cbfc10062a27d445634bc89b46307a82eca370434e708dde02968ffce"
        },
        {
          "path": "src/workflows/separations/tasks/verify-termination-receipt.ts",
          "sha256": "de06d372b90672107fa911020bbfd4060172b3bd23b98320f1202f94a0f1b537"
        }
      ],
      "id": "workflow:separations/verify-termination-receipt"
    }
  ]
} as const;
