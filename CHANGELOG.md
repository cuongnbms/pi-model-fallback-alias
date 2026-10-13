# Changelog

## [0.3.0](https://github.com/cuongnbms/pi-model-fallback-alias/compare/v0.2.0...v0.3.0) (2026-10-13)


### Features

* merge configured alias targets ([6f02144](https://github.com/cuongnbms/pi-model-fallback-alias/commit/6f0214426012fde77f4723b35029e73324e62c13))
* add alias chain selector ([8753bdd](https://github.com/cuongnbms/pi-model-fallback-alias/commit/8753bdd991a8e39b540d03013d94373461918384))
* add model-alias-chain command ([6208a2a](https://github.com/cuongnbms/pi-model-fallback-alias/commit/6208a2a4016563e4b52f5d07e0a44970e3ce5296))

## [0.2.0](https://github.com/unrelentingfox/pi-model-fallback-alias/compare/v0.1.1...v0.2.0) (2026-09-15)


### Features

* allow loops in fallback aliases ([#21](https://github.com/unrelentingfox/pi-model-fallback-alias/issues/21)) ([f84a435](https://github.com/unrelentingfox/pi-model-fallback-alias/commit/f84a43536394341b37ae1cdf5f9dd12313c3751e))


### Bug Fixes

* clear non-alias model status ([#19](https://github.com/unrelentingfox/pi-model-fallback-alias/issues/19)) ([01780f9](https://github.com/unrelentingfox/pi-model-fallback-alias/commit/01780f911e27c3ecdb185c8fa39eb831b6ac5680))
* retry missing npm releases ([bfde318](https://github.com/unrelentingfox/pi-model-fallback-alias/commit/bfde318a31f8e426ad08d31f1a94497dd62f9c0a))

## [0.1.1](https://github.com/unrelentingfox/pi-model-fallback-alias/compare/v0.1.0...v0.1.1) (2026-09-09)


### Bug Fixes

* refresh selected model status ([81b9efc](https://github.com/unrelentingfox/pi-model-fallback-alias/commit/81b9efcf4011715935fc262431ab9f56df53e046))

## 0.1.0

Initial public release.

- Register stable `alias/*` models backed by configurable target chains.
- Fail over before output commits and share target cooldowns across processes.
- Support nested aliases, latency timeouts, status output, and latency reports.
- Store runtime state outside the installed package directory.
