import { verifyReference } from './reference.mjs';
import { verifyPlatformReference } from './platform-reference.mjs';

const original = verifyReference();
const extra = verifyPlatformReference();
console.log(JSON.stringify({
  tvboxCommit: original.commit, originalFiles: original.files.length,
  additionalTvboxFiles: extra.additional.files.length,
  androidTag: extra.manifest.tag, androidSourceFiles: extra.manifest.files.length,
  androidLicenseVerified: true,
}));
