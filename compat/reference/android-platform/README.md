# Auxiliary Android source baseline

Seven unmodified files from AOSP tag android-13.0.0_r1 are pinned by resolved Git
commit and SHA-256 in manifest.json. The TVBoxOS app declares compileSdk 33, which
motivates this reproducible source baseline; it does not identify the user's
device OS or a historical APK runtime. Other Android versions remain to be tested.

- org.json: platform/libcore 7267082c39a25fb5afbc4eeb5752c1b276d29344.
- android.util.Base64: platform/frameworks/base 0d3ff311e6e80dee7fe88a2a2cfa272ce231c3c6.

Original source URLs follow
`https://android.googlesource.com/REPOSITORY/+/COMMIT/UPSTREAM_PATH`.
Each exact path is recorded in the manifest. Copyright and Apache-2.0 notices are
preserved, with the license in LICENSE. The reference build and independent
runtime use separate copies. Only annotation declarations are supplied by the
host harness; no JSON/Base64 methods are replaced with mocks.
