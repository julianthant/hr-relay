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
      "fingerprint": "9701397c53b1f5c3475478f84615b4ca0aca69025157be2c129b1c489c51fa82",
      "sources": [
        {
          "path": "src/base/flow.ts",
          "sha256": "4db473ffb5976e0541ff9c05324f98d870ce41a9090853ad8f62139d8fa9aca4"
        },
        {
          "path": "src/base/workflow.ts",
          "sha256": "3f53539d6ed6f6f00789056c5db3e4d73e5dda79f5ba5a8580dcc5e04bd94431"
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
          "sha256": "b061fafaebe9bc9dd4a0e9c1711f5f5c08ec5e911909eb17f66f409d92707a99"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "5339e7b4f6a628b7e0b2d542c54f0b46780c74877507e4c05343b76461b14014"
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
      "fingerprint": "7dbf8ce44816aa9867ca7be0d4e4a520f5547e55f4b3678f25fc7faa11ec5f6f",
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
          "sha256": "1ca368fbb93699753e53ef3b2c0db3d3da61e43fb9cf242234b9a3eabc5478d2"
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
          "path": "src/domain/ids.ts",
          "sha256": "5339e7b4f6a628b7e0b2d542c54f0b46780c74877507e4c05343b76461b14014"
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
          "path": "src/domain/task-provenance.ts",
          "sha256": "e95aeda36f832e03d0f6be57011e4c66eb2c82ed75ce0790c8bcb35405256de4"
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
          "sha256": "108f5776e85b617a9225bed5989dde3c0ebbfd17f56bc0d98a2c7e6045519bbd"
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
          "sha256": "04b23d995c308cf4542ba2a626cd50b0fd7672958222516385bbe627f6d7f493"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
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
      "fingerprint": "d6b2cb9000af31da6c82f71454d6dbfbb4c9b35dbfdecbc15e4face60336645a",
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
          "sha256": "1ca368fbb93699753e53ef3b2c0db3d3da61e43fb9cf242234b9a3eabc5478d2"
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
          "path": "src/domain/ids.ts",
          "sha256": "5339e7b4f6a628b7e0b2d542c54f0b46780c74877507e4c05343b76461b14014"
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
          "path": "src/domain/task-provenance.ts",
          "sha256": "e95aeda36f832e03d0f6be57011e4c66eb2c82ed75ce0790c8bcb35405256de4"
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
          "sha256": "108f5776e85b617a9225bed5989dde3c0ebbfd17f56bc0d98a2c7e6045519bbd"
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
          "sha256": "04b23d995c308cf4542ba2a626cd50b0fd7672958222516385bbe627f6d7f493"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
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
      "fingerprint": "c05519672868ac7773932d5593cafbb25e3a188e038d5dbe74a9202232439067",
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
          "sha256": "1ca368fbb93699753e53ef3b2c0db3d3da61e43fb9cf242234b9a3eabc5478d2"
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
          "path": "src/domain/contracts/base.ts",
          "sha256": "ae14ada27eb39b2cbf7dc4a482b0e54548d6770d98f903d47c4dad448f9865a4"
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
          "sha256": "5339e7b4f6a628b7e0b2d542c54f0b46780c74877507e4c05343b76461b14014"
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
          "path": "src/domain/task-provenance.ts",
          "sha256": "e95aeda36f832e03d0f6be57011e4c66eb2c82ed75ce0790c8bcb35405256de4"
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
          "sha256": "108f5776e85b617a9225bed5989dde3c0ebbfd17f56bc0d98a2c7e6045519bbd"
        },
        {
          "path": "src/domain/ui/ucpath-person-org.ts",
          "sha256": "5f13be6afe95ef90a99b815adb92d8ac5a55b798d8fa4f46d5aeed031bff643b"
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
          "sha256": "04b23d995c308cf4542ba2a626cd50b0fd7672958222516385bbe627f6d7f493"
        },
        {
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
        },
        {
          "path": "src/stores/ucpath/driver-declaration.ts",
          "sha256": "8dd6f21fdfafc6144d8bde33709212a05fdac6b371efd0336e382d82f7a4d0cb"
        },
        {
          "path": "src/stores/ucpath/driver/interpreter.ts",
          "sha256": "9faed8162a938df070b416d2058d8b198deeb32485a10669ccdfd6792a55b2f1"
        },
        {
          "path": "src/stores/ucpath/driver/person-org-operation.ts",
          "sha256": "c56a7c4fa6353cc29feb58d42d71c2dd87325e8a4d576e5ae46a43d01bc5f92b"
        },
        {
          "path": "src/stores/ucpath/driver/registry-locators.ts",
          "sha256": "c51900533e6813be278ee03bc31ddb4ab1c36905e19bc083843595980eb05da3"
        },
        {
          "path": "src/stores/ucpath/driver/ui-registry.ts",
          "sha256": "2660f2f4b90c045ee669edc4e10bc33f5fbd963f0f22c4dd5a58c9b5065aca5c"
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
      "fingerprint": "2ef3b7296917c1b503e1bd6a86ce83ebe84b25ae63db6e23d32427d625d0ebb6",
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
          "sha256": "b061fafaebe9bc9dd4a0e9c1711f5f5c08ec5e911909eb17f66f409d92707a99"
        },
        {
          "path": "src/domain/contracts/write-safety.ts",
          "sha256": "4907bf4ff548cb93ca3e25857d62dff555c5090b7dbb631dc5793076cb453172"
        },
        {
          "path": "src/domain/ids.ts",
          "sha256": "5339e7b4f6a628b7e0b2d542c54f0b46780c74877507e4c05343b76461b14014"
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
          "path": "src/domain/task-provenance.ts",
          "sha256": "e95aeda36f832e03d0f6be57011e4c66eb2c82ed75ce0790c8bcb35405256de4"
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
          "path": "src/domain/workflow/checkpoint.ts",
          "sha256": "5aeac2c74fcdb130fbfd33fcb663056ee5bebda9b953bea9dc99f67654b085f6"
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
          "path": "src/domain/write-safety-primitives.ts",
          "sha256": "abc6dea2de0e5163130589baf6644d9048d50d01c91c1acbe2a5671fb78e3e95"
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
    }
  ]
} as const;
