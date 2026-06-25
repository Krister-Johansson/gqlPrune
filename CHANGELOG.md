# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [2.4.0](https://github.com/Krister-Johansson/gqlPrune/compare/gqlprune-v2.3.0...gqlprune-v2.4.0) (2026-06-25)


### Features

* **cli:** run without a config file via CLI flags ([#42](https://github.com/Krister-Johansson/gqlPrune/issues/42)) ([36f3d06](https://github.com/Krister-Johansson/gqlPrune/commit/36f3d065ec6027456a5381afdb89b36c39948228))
* **scan:** warn when a source file masks unused results ([#40](https://github.com/Krister-Johansson/gqlPrune/issues/40)) ([5b24904](https://github.com/Krister-Johansson/gqlPrune/commit/5b2490435208fb588446282e0030b557f11d57c9))

## [2.3.0](https://github.com/Krister-Johansson/gqlPrune/compare/gqlprune-v2.2.0...gqlprune-v2.3.0) (2026-06-25)


### Features

* GitHub Actions inline annotations ([#38](https://github.com/Krister-Johansson/gqlPrune/issues/38)) ([e459c44](https://github.com/Krister-Johansson/gqlPrune/commit/e459c44399afa112490010e2b8f589d0fb42058b)), closes [#33](https://github.com/Krister-Johansson/gqlPrune/issues/33)

## [2.2.0](https://github.com/Krister-Johansson/gqlPrune/compare/gqlprune-v2.1.0...gqlprune-v2.2.0) (2026-06-25)


### Features

* --json report output and definition line numbers ([#35](https://github.com/Krister-Johansson/gqlPrune/issues/35)) ([6f00e66](https://github.com/Krister-Johansson/gqlPrune/commit/6f00e667b9a6c1cdf585ce5c2c08820ee67f29c0)), closes [#32](https://github.com/Krister-Johansson/gqlPrune/issues/32)

## [2.1.0](https://github.com/Krister-Johansson/gqlPrune/compare/gqlprune-v2.0.1...gqlprune-v2.1.0) (2026-06-24)


### Features

* detect unused fragments across files ([#30](https://github.com/Krister-Johansson/gqlPrune/issues/30)) ([30a37ff](https://github.com/Krister-Johansson/gqlPrune/commit/30a37ff739e1eed2817e588f213bfbf50d3baa25)), closes [#26](https://github.com/Krister-Johansson/gqlPrune/issues/26)

## [2.0.1](https://github.com/Krister-Johansson/gqlPrune/compare/gqlprune-v2.0.0...gqlprune-v2.0.1) (2026-06-24)


### Bug Fixes

* lowercase `gqlprune` CLI command + 1.x→2.0 migration guide ([#17](https://github.com/Krister-Johansson/gqlPrune/issues/17)) ([d00567c](https://github.com/Krister-Johansson/gqlPrune/commit/d00567c1c912be8012c6aabe5c61b4dae9b0f440))

## [2.0.0](https://github.com/Krister-Johansson/gqlPrune/compare/gqlprune-v1.2.8...gqlprune-v2.0.0) (2026-06-24)


### ⚠ BREAKING CHANGES

* requires Node.js >= 20.

### Features

* **gqlprune:** exit 1 if there are unused operations ([e7d4c53](https://github.com/Krister-Johansson/gqlPrune/commit/e7d4c53691791c5d197d6293d177eff3a0cf08bb))
* NOTICES generator ([46bda8e](https://github.com/Krister-Johansson/gqlPrune/commit/46bda8ebc92e81181f4b7505baa8847af2e08b15))
* robust detection, latest deps, and release/CI/security automation ([#15](https://github.com/Krister-Johansson/gqlPrune/issues/15)) ([faa7a2b](https://github.com/Krister-Johansson/gqlPrune/commit/faa7a2b5baf479697f152fa49e29ca84e67eb2ff))


### Bug Fixes

* add files to gitignore ([69a3b46](https://github.com/Krister-Johansson/gqlPrune/commit/69a3b4643a59925ef0946e43da808714aac9a46b))
* github action ([e0567a5](https://github.com/Krister-Johansson/gqlPrune/commit/e0567a51fcf6fca2be84a464f6e2f52a031405e3))
* made NOTICES manuly for now ([2656cb0](https://github.com/Krister-Johansson/gqlPrune/commit/2656cb0ee2ca78115d515d8a016ccf1fcd88cb64))
* made publish mauly ([23d2594](https://github.com/Krister-Johansson/gqlPrune/commit/23d25948a8f7052a1a5a55c7b55f3b1d4e257dfc))
* Try to get my git action to work ([96e45f9](https://github.com/Krister-Johansson/gqlPrune/commit/96e45f9710860603988db026d59b68c922293aa0))

### [1.1.4](https://github.com/Krister-Johansson/gqlPrune/compare/v1.1.3...v1.1.4) (2023-10-21)


### Bug Fixes

* made publish mauly ([23d2594](https://github.com/Krister-Johansson/gqlPrune/commit/23d25948a8f7052a1a5a55c7b55f3b1d4e257dfc))

### [1.1.3](https://github.com/Krister-Johansson/gqlPrune/compare/v1.1.2...v1.1.3) (2023-10-21)


### Bug Fixes

* made NOTICES manuly for now ([2656cb0](https://github.com/Krister-Johansson/gqlPrune/commit/2656cb0ee2ca78115d515d8a016ccf1fcd88cb64))

### [1.1.2](https://github.com/Krister-Johansson/gqlPrune/compare/v1.1.1...v1.1.2) (2023-10-21)


### Bug Fixes

* Try to get my git action to work ([96e45f9](https://github.com/Krister-Johansson/gqlPrune/commit/96e45f9710860603988db026d59b68c922293aa0))

### [1.1.1](https://github.com/Krister-Johansson/gqlPrune/compare/v1.1.0...v1.1.1) (2023-10-20)


### Bug Fixes

* github action ([e0567a5](https://github.com/Krister-Johansson/gqlPrune/commit/e0567a51fcf6fca2be84a464f6e2f52a031405e3))

## [1.1.0](https://github.com/Krister-Johansson/gqlPrune/compare/v1.0.2...v1.1.0) (2023-10-20)


### Features

* NOTICES generator ([46bda8e](https://github.com/Krister-Johansson/gqlPrune/commit/46bda8ebc92e81181f4b7505baa8847af2e08b15))


### Bug Fixes

* add files to gitignore ([69a3b46](https://github.com/Krister-Johansson/gqlPrune/commit/69a3b4643a59925ef0946e43da808714aac9a46b))
