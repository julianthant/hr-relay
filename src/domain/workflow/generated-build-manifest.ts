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
      "fingerprint": "32f7112f06c35f8d28f8e552252f5f9950cc16683850fd523b7c8706acb058f9",
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
          "sha256": "740ac73014e5ae9a0efc6cc1561eaf9ce6b6b6ccee37b31246b5fd053c6a0e01"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "7ece6ddc4b74c3aabd1a17309d3b1a0eec343630db88223a800f3e644a6e7fbc"
        },
        {
          "path": "src/domain/contracts/person-lookup/read-active-status.ts",
          "sha256": "b7087817e1d96092ebc8ece8ff6b8a0ddf57ff067c7e599f5fc96dae4cc370d7"
        },
        {
          "path": "src/domain/contracts/ucpath/search-person-org.ts",
          "sha256": "2132b38e0c0a8de230ca9ac21a7735e482a70421c9e9ab7389c36cb88d63036b"
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
          "sha256": "408640188c0093aae429f55e4f34e864c9b2fb31517fbc7431746c394093d662"
        }
      ],
      "id": "person-lookup"
    }
  ],
  "tasks": [
    {
      "fingerprint": "d4c9232c5c59e3d518961e0d71e0a04e2a07757f19f9571bae8fa8ad790f7c8b",
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
          "sha256": "740ac73014e5ae9a0efc6cc1561eaf9ce6b6b6ccee37b31246b5fd053c6a0e01"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "7ece6ddc4b74c3aabd1a17309d3b1a0eec343630db88223a800f3e644a6e7fbc"
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
          "sha256": "cdb34d93f410f85713e46ff7fedc9bd8320aa08831405f31610967e983c2fd8a"
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
          "path": "src/stores/crm/tasks/read-onboarding-dates.ts",
          "sha256": "f5b49f338fa0cebf4214dfee9347c65825e7041c74e8d5ec6f1d1d7c65759280"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "crm/read-onboarding-dates"
    },
    {
      "fingerprint": "65db330570e0f10f237fc23eb8277ce77b755662b5189fa29e6c10ce36c3395e",
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
          "sha256": "740ac73014e5ae9a0efc6cc1561eaf9ce6b6b6ccee37b31246b5fd053c6a0e01"
        },
        {
          "path": "src/domain/contracts/crm/read-onboarding-record.ts",
          "sha256": "7ece6ddc4b74c3aabd1a17309d3b1a0eec343630db88223a800f3e644a6e7fbc"
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
          "sha256": "cdb34d93f410f85713e46ff7fedc9bd8320aa08831405f31610967e983c2fd8a"
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
          "path": "src/stores/crm/tasks/read-onboarding-record.ts",
          "sha256": "bff39344ac63ab7b07d1d9eec10cb5f8824c8a66dea19f85cdb074f0b48b5eea"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "crm/read-onboarding-record"
    },
    {
      "fingerprint": "6b5327e74acf99ff5039895f567178cf229d95c58af98dff7ea1bad6c2d9bfa6",
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
          "sha256": "2132b38e0c0a8de230ca9ac21a7735e482a70421c9e9ab7389c36cb88d63036b"
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
          "path": "src/stores/ucpath/tasks/search-person-org.ts",
          "sha256": "c96eb27ffe3698ce3e1234f3a9e6c430de271e6c6152b3768ccfc61db5fcce90"
        },
        {
          "path": "src/validation/contract-boundary.ts",
          "sha256": "e1ff83d14555a67247b6044d83052ff90e3dc4c72e381ffa04e1376d1a661b90"
        }
      ],
      "id": "ucpath/search-person-org"
    }
  ]
} as const;
