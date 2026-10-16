# Attribution

GPL-3.0-only, consistent with the backend and TVBoxOS-derived configuration and
Spider modules. The project LICENSE and immutable upstream reference license
are retained.

`src/com/github/tvbox/osc/bean/{AbsJson,AbsSortJson,AbsXml,AbsSortXml,Movie,MovieSort}.java`
derive from `q215613905/TVBoxOS`, commit
`ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1`, original author pj567 (2020/12/18).
Runtime copies remove only the XStream XML annotation imports and annotations;
JSON conversion method bodies remain unchanged. Source files and byte hashes
are preserved separately under `compat/reference/tvboxos-cms`.

The `media-pattern.mjs` expression is the same commit's
`DefaultConfig.snifferMatch`. `index.mjs` implements the type0/1 request branches
of the pinned SourceViewModel as an explicit serialized Linux host interface.
`CmsParser.java` supplies the bounded input/output projection and independent
secure JDK XML binding; it does not embed or claim to implement XStream.

Existing Gson2.10.1 is pinned by `backend/config-core/runtime.json` and is not
downloaded or duplicated by this module. Its existing attribution remains in
the configuration core.
