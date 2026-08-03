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
      "fingerprint": "0353bd334b412180f3fc663818d6d4907a07f0d7de31df958262b5704efd7312",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "4db473ffb5976e0541ff9c05324f98d870ce41a9090853ad8f62139d8fa9aca4"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "c9e748549a0a3ade7261ac0a9700b42af5e26cd930ce9776ab4a32415a9278d5"
        },
        {
          "path": "src/domain/canonical-json.ts",
          "sha256": "1153e14ab0d175fd8b5f5deae02a44ecd7308d7c2bd11e2557cc3527b386faea"
        },
        {
          "path": "src/domain/contracts/base.ts",
          "sha256": "59661c041d109d167d23bb41e88dc0adfc3ecc9853417e1027d07d257bc67760"
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
          "sha256": "b061fafaebe9bc9dd4a0e9c1711f5f5c08ec5e911909eb17f66f409d92707a99"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "49134db6493b783211fbacbc4fac329a07d56b0721cc9985e6eb70e612a903fe"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
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
          "path": "src/domain/workflow/completion.ts",
          "sha256": "41f4c321829665233ce03b629e1419df967af544f2ec62ba46089f46f6375539"
        },
        {
          "path": "src/domain/workflow/delegation-policy.ts",
          "sha256": "189e529e80af3e9367c2adc0e7b447e6d84714200ded02f0713f4a1d2370a0ad"
        },
        {
          "path": "src/domain/workflow/graph.ts",
          "sha256": "04b23d995c308cf4542ba2a626cd50b0fd7672958222516385bbe627f6d7f493"
        },
        {
          "path": "src/domain/workflow/ingress.ts",
          "sha256": "ef46b48c06678d9ad96cdded7b48c4e2aae243b076a2015d3852ac66494ce9fe"
        },
        {
          "path": "src/domain/workflow/presentation.ts",
          "sha256": "f3cf4293c2f415ca0407b828fa331119d1a9ffa997e44a463aee096f02146563"
        },
        {
          "path": "src/domain/workflow/scenario-coverage.ts",
          "sha256": "cbc65b12be8aefd81c2b9defaa0a4f976611b2d8bdf32b7d66eea4cc815ed41f"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
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
          "sha256": "afa922cf7e672c9f437cda769c3a76aedb45471a1f2c70ce3f9b425cd9f4e0dd"
        }
      ],
      "id": "person-lookup"
    }
  ],
  "tasks": [
    {
      "fingerprint": "6dd2ef651f16bd412644c177b4aabf63bf442347726efb48d575a468ee059922",
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
          "sha256": "b59b88f5f3a21255639c2a61e2d3f3dddb50c0649a36937de7521b7d511c3e21"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "48163a7c2c4061e1bbff4462a8588db7b8eee7583c88f581c4b9fbbe9fa4275b"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "11a23d142ad12dbe67a8291a67339e9f13f8c405bb1731b9786002557c7cee50"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "f0dc392c8b570bd617f6b403c8c6e0b858a71163d5a06f0e755d408796706a7d"
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
          "path": "src/domain/contracts/base.ts",
          "sha256": "59661c041d109d167d23bb41e88dc0adfc3ecc9853417e1027d07d257bc67760"
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
          "path": "src/domain/ids.ts",
          "sha256": "49134db6493b783211fbacbc4fac329a07d56b0721cc9985e6eb70e612a903fe"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "94a544469c6e72c397809e7c8217a9b998468cd72b2bb54f7a21c7f6870b4394"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "b66b05e18424e3bd313e491c444591e9bc452433a00c2b49186a52b1bdbe69f2"
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
          "path": "src/domain/ui/crm-onboarding.ts",
          "sha256": "cf3b0ed74e89a86891554afabeb3584ebdde3e87a95915c975d9c836e1688160"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "108f5776e85b617a9225bed5989dde3c0ebbfd17f56bc0d98a2c7e6045519bbd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
        },
        {
          "path": "src/stores/crm/driver/declaration.ts",
          "sha256": "b9978586152076e344cd01ec46657a55662dc0fc221a5e6ebdbb6c5416362fde"
        },
        {
          "path": "src/stores/crm/driver/interpreter.ts",
          "sha256": "8f062eaae7303bb216d02f5e11308f8a7988df2034eb6b26f68e95e9d94d1068"
        },
        {
          "path": "src/stores/crm/tasks/read-onboarding-dates.ts",
          "sha256": "72f3c81bc4b974dfb6dc47b8695dc7ee23ec51bfb6cb09e38f132e00369e00b0"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "crm/read-onboarding-dates"
    },
    {
      "fingerprint": "70f03fcaf81bf3d61ed550cc0b92f3c655c954454a91254d835309a06f96ea8c",
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
          "sha256": "b59b88f5f3a21255639c2a61e2d3f3dddb50c0649a36937de7521b7d511c3e21"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "48163a7c2c4061e1bbff4462a8588db7b8eee7583c88f581c4b9fbbe9fa4275b"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "11a23d142ad12dbe67a8291a67339e9f13f8c405bb1731b9786002557c7cee50"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "f0dc392c8b570bd617f6b403c8c6e0b858a71163d5a06f0e755d408796706a7d"
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
          "path": "src/domain/contracts/base.ts",
          "sha256": "59661c041d109d167d23bb41e88dc0adfc3ecc9853417e1027d07d257bc67760"
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
          "path": "src/domain/ids.ts",
          "sha256": "49134db6493b783211fbacbc4fac329a07d56b0721cc9985e6eb70e612a903fe"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "94a544469c6e72c397809e7c8217a9b998468cd72b2bb54f7a21c7f6870b4394"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "b66b05e18424e3bd313e491c444591e9bc452433a00c2b49186a52b1bdbe69f2"
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
          "path": "src/domain/ui/crm-onboarding.ts",
          "sha256": "cf3b0ed74e89a86891554afabeb3584ebdde3e87a95915c975d9c836e1688160"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "108f5776e85b617a9225bed5989dde3c0ebbfd17f56bc0d98a2c7e6045519bbd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
        },
        {
          "path": "src/stores/crm/driver/declaration.ts",
          "sha256": "b9978586152076e344cd01ec46657a55662dc0fc221a5e6ebdbb6c5416362fde"
        },
        {
          "path": "src/stores/crm/driver/interpreter.ts",
          "sha256": "8f062eaae7303bb216d02f5e11308f8a7988df2034eb6b26f68e95e9d94d1068"
        },
        {
          "path": "src/stores/crm/tasks/read-onboarding-record.ts",
          "sha256": "e5e436dcf62284cd71479fdef529b926a619c0b3ce17e17d334923fc1c174dd9"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "crm/read-onboarding-record"
    },
    {
      "fingerprint": "a7de111026339bf4e334d532d0068adbe2789509faa927cc59406ce6f4c7472a",
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
          "sha256": "b59b88f5f3a21255639c2a61e2d3f3dddb50c0649a36937de7521b7d511c3e21"
        },
        {
          "path": "src/base/session.ts",
          "sha256": "48163a7c2c4061e1bbff4462a8588db7b8eee7583c88f581c4b9fbbe9fa4275b"
        },
        {
          "path": "src/base/store.ts",
          "sha256": "11a23d142ad12dbe67a8291a67339e9f13f8c405bb1731b9786002557c7cee50"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "f0dc392c8b570bd617f6b403c8c6e0b858a71163d5a06f0e755d408796706a7d"
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
          "path": "src/domain/contracts/base.ts",
          "sha256": "59661c041d109d167d23bb41e88dc0adfc3ecc9853417e1027d07d257bc67760"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "b061fafaebe9bc9dd4a0e9c1711f5f5c08ec5e911909eb17f66f409d92707a99"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "49134db6493b783211fbacbc4fac329a07d56b0721cc9985e6eb70e612a903fe"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "94a544469c6e72c397809e7c8217a9b998468cd72b2bb54f7a21c7f6870b4394"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "b66b05e18424e3bd313e491c444591e9bc452433a00c2b49186a52b1bdbe69f2"
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
          "path": "src/domain/trust/preflight-scenarios.ts",
          "sha256": "e4530dd4dc762142c560e10bb8fc70b3a60b8506d621056ea91b851769a78d60"
        },
        {
          "path": "src/domain/trust/scenario.ts",
          "sha256": "5f28df5c75a872b247cb193c8c3c0db29f71f6209dab3d94ca8174946fff4c2a"
        },
        {
          "path": "src/domain/ui/contracts.ts",
          "sha256": "69e78c26e621fe78cee7b8035d0b2cb135c7d80a8185058ff60c402e0a5d7407"
        },
        {
          "path": "src/domain/ui/driver.ts",
          "sha256": "108f5776e85b617a9225bed5989dde3c0ebbfd17f56bc0d98a2c7e6045519bbd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "a7f0d99e7ed612699c8038b056d7147dfde0f0a6bb72c0e78f93bcb442852f70"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
        },
        {
          "path": "src/stores/ucpath/driver/declaration.ts",
          "sha256": "0fd7cfb6f8d482bd7a16ae553bb69e516eac0b9171c54ea81e4ac43d4df8a641"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "54bf6f7f6b24bca8ed1e30f6b353fa4fabb98e3d88957b4c2fab87f26d4218e5"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "3316b01b0cf11d8ea6f66c4d48c06caf7ad47ac0990119c761c6259631bae03b"
        },
        {
          "path": "src/stores/ucpath/tasks/search-person-org.ts",
          "sha256": "c96eb27ffe3698ce3e1234f3a9e6c430de271e6c6152b3768ccfc61db5fcce90"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/search-person-org"
    },
    {
      "fingerprint": "2358f5e3131e0c759141d47ba270117d2db6429cd4880d461676a10db9afe452",
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
          "sha256": "b59b88f5f3a21255639c2a61e2d3f3dddb50c0649a36937de7521b7d511c3e21"
        },
        {
          "path": "src/base/task.ts",
          "sha256": "f0dc392c8b570bd617f6b403c8c6e0b858a71163d5a06f0e755d408796706a7d"
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
          "path": "src/domain/contracts/base.ts",
          "sha256": "59661c041d109d167d23bb41e88dc0adfc3ecc9853417e1027d07d257bc67760"
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
          "sha256": "b061fafaebe9bc9dd4a0e9c1711f5f5c08ec5e911909eb17f66f409d92707a99"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "49134db6493b783211fbacbc4fac329a07d56b0721cc9985e6eb70e612a903fe"
        },
        {
          "path": "src/domain/immutability.ts",
          "sha256": "b7934027c276d50ad650825958e3cbc8cf8b5ef333b0d6a7a4eafbf97587d52a"
        },
        {
          "path": "src/domain/providers.ts",
          "sha256": "94a544469c6e72c397809e7c8217a9b998468cd72b2bb54f7a21c7f6870b4394"
        },
        {
          "path": "src/domain/schema-bound-value.ts",
          "sha256": "b66b05e18424e3bd313e491c444591e9bc452433a00c2b49186a52b1bdbe69f2"
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
          "path": "src/domain/ui/driver.ts",
          "sha256": "108f5776e85b617a9225bed5989dde3c0ebbfd17f56bc0d98a2c7e6045519bbd"
        },
        {
          "path": "src/domain/unscoped-commit.ts",
          "sha256": "062f37eb72e18dd23865903a91f4713c1ded17bd3d8ed010a438548e3269d9fb"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
        },
        {
          "path": "src/stores/person-lookup/tasks/read-active-status.ts",
          "sha256": "bd40efb63408f2aea16e8eb5a3f0c64b5b737ff286642d3816619d8d3142c2cf"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "workflow:person-lookup/read-active-status"
    }
  ]
} as const;
