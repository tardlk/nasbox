#!/usr/bin/env node
// Read-only APK metadata inspection. Reuses the project's pinned JDK and jars.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const apkArg = args.shift();
if (!apkArg || (args.length && (args.length !== 2 || args[0] !== '--out'))) {
  throw new Error('Usage: node scripts/compat/inspect-apk.mjs APK [--out REPORT.json]');
}
const apk = resolve(apkArg);
const javaHome = process.env.TVBOX_JAVA_HOME || resolve(root, '.tools/jdk17');
const parserPin = JSON.parse(readFileSync(resolve(root, 'backend/spider-runtime/native-bridge/runtime.json'), 'utf8'))
  .dependencies.find(value => value.filename === 'apk-parser-2.6.10.jar');
const gsonPin = JSON.parse(readFileSync(resolve(root, 'backend/config-core/runtime.json'), 'utf8')).gson;
const parser = resolve(root, '.tools/native-runtime', parserPin.filename);
const gson = resolve(root, '.tools/lib/gson-2.10.1.jar');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [path, pin] of [[parser, parserPin], [gson, gsonPin]]) {
  if (sha256(readFileSync(path)) !== pin.sha256) throw new Error(`Dependency checksum mismatch: ${path}`);
}
for (const tool of ['java', 'javac']) {
  if (!existsSync(resolve(javaHome, 'bin', tool))) throw new Error(`Missing existing JDK tool: ${tool}`);
}
const temporaryRoot = resolve(root, '.cache/android-parity');
mkdirSync(temporaryRoot, { recursive: true });
const build = mkdtempSync(resolve(temporaryRoot, 'inspect-'));
const source = String.raw`
import com.google.gson.GsonBuilder;
import java.io.*;
import java.security.*;
import java.security.cert.*;
import java.util.*;
import java.util.zip.*;
import javax.xml.parsers.*;
import org.w3c.dom.*;
import org.xml.sax.InputSource;
import net.dongliu.apk.parser.ApkFile;
import net.dongliu.apk.parser.bean.*;

class InspectApk {
  static String hex(byte[] b) { return HexFormat.of().formatHex(b); }
  static String attr(Element element, String key) { return element.getAttribute("android:" + key); }
  static Map<String,Object> certificate(CertificateMeta meta) throws Exception {
    X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509")
      .generateCertificate(new ByteArrayInputStream(meta.getData()));
    Map<String,Object> item = new LinkedHashMap<>();
    item.put("sha256", hex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded())));
    item.put("subject", cert.getSubjectX500Principal().getName());
    item.put("issuer", cert.getIssuerX500Principal().getName());
    item.put("signatureAlgorithm", cert.getSigAlgName());
    item.put("validFrom", cert.getNotBefore().toInstant().toString());
    item.put("validUntil", cert.getNotAfter().toInstant().toString());
    return item;
  }
  public static void main(String[] args) throws Exception {
    Map<String,Object> out = new LinkedHashMap<>();
    try (ApkFile apk = new ApkFile(args[0]); ZipFile zip = new ZipFile(args[0])) {
      ApkMeta meta = apk.getApkMeta();
      out.put("packageName", meta.getPackageName());
      out.put("versionName", meta.getVersionName());
      out.put("versionCode", meta.getVersionCode());
      out.put("minSdk", meta.getMinSdkVersion());
      out.put("targetSdk", meta.getTargetSdkVersion());
      out.put("compileSdk", meta.getCompileSdkVersion());
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      Document doc = factory.newDocumentBuilder().parse(new InputSource(new StringReader(apk.getManifestXml())));
      Element app = (Element) doc.getElementsByTagName("application").item(0);
      out.put("applicationClass", attr(app, "name"));
      out.put("debuggable", attr(app, "debuggable").equals("true"));
      out.put("debuggableDeclared", !attr(app, "debuggable").isEmpty());
      out.put("testOnly", attr(app, "testOnly").equals("true"));
      out.put("usesCleartextTraffic", attr(app, "usesCleartextTraffic"));
      List<Map<String,String>> launchers = new ArrayList<>();
      NodeList activities = doc.getElementsByTagName("activity");
      for (int i = 0; i < activities.getLength(); i++) {
        Element activity = (Element) activities.item(i);
        NodeList categories = activity.getElementsByTagName("category");
        for (int j = 0; j < categories.getLength(); j++) {
          String name = attr((Element) categories.item(j), "name");
          if (name.equals("android.intent.category.LAUNCHER") || name.equals("android.intent.category.LEANBACK_LAUNCHER"))
            launchers.add(Map.of("activity", attr(activity, "name"), "category", name, "exported", attr(activity, "exported")));
        }
      }
      out.put("launchers", launchers);
      Set<String> abis = new TreeSet<>();
      List<String> nativeLibraries = new ArrayList<>();
      List<Map<String,Object>> dex = new ArrayList<>();
      Enumeration<? extends ZipEntry> entries = zip.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        String name = entry.getName();
        if (name.matches("lib/[^/]+/[^/]+[.]so")) {
          abis.add(name.split("/")[1]); nativeLibraries.add(name);
        }
        if (name.matches("classes[0-9]*[.]dex")) {
          try (InputStream in = zip.getInputStream(entry)) {
            byte[] bytes = in.readAllBytes();
            dex.add(Map.of("name", name, "bytes", bytes.length, "sha256", hex(MessageDigest.getInstance("SHA-256").digest(bytes)),
              "version", new String(bytes, 4, 3, java.nio.charset.StandardCharsets.US_ASCII)));
          }
        }
      }
      out.put("abis", abis); out.put("nativeLibraries", nativeLibraries); out.put("dexFiles", dex);
      Map<String,Map<String,Object>> certs = new LinkedHashMap<>();
      for (ApkSigner signer : apk.getApkSingers()) for (CertificateMeta cert : signer.getCertificateMetas()) {
        Map<String,Object> value = certificate(cert); certs.put((String)value.get("sha256"), value);
      }
      try {
        List<ApkV2Signer> v2 = apk.getApkV2Singers();
        if (v2 != null) for (ApkV2Signer signer : v2) for (CertificateMeta cert : signer.getCertificateMetas()) {
          Map<String,Object> value = certificate(cert); certs.put((String)value.get("sha256"), value);
        }
        out.put("hasV2SignerBlock", v2 != null && !v2.isEmpty());
      } catch (RuntimeException unsupportedSigningBlock) {
        out.put("v2CertificateExtractionError", unsupportedSigningBlock.toString());
      }
      out.put("signerCertificates", certs.values());
    }
    System.out.println(new GsonBuilder().setPrettyPrinting().create().toJson(out));
  }
}
`;
function run(tool, argv) {
  const result = spawnSync(resolve(javaHome, 'bin', tool), argv, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${tool} failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
}
try {
  const classpath = [parser, gson].join(delimiter);
  const sourcePath = resolve(build, 'InspectApk.java');
  writeFileSync(sourcePath, source);
  run('javac', ['--release', '17', '-cp', classpath, '-d', build, sourcePath]);
  const metadata = JSON.parse(run('java', ['-cp', [build, classpath].join(delimiter), 'InspectApk', apk]));
  const report = {
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    apk: { path: relative(root, apk), bytes: statSync(apk).size, sha256: sha256(readFileSync(apk)), ...metadata },
    tools: { javaHome: relative(root, javaHome), parser: { version: '2.6.10', sha256: parserPin.sha256 }, gson: { version: gsonPin.version, sha256: gsonPin.sha256 } },
    signatureVerification: { performed: false, scope: 'Signer certificate identity extracted; use Android apksigner or device install to verify the APK signature.' },
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args[1]) writeFileSync(resolve(args[1]), json);
  else process.stdout.write(json);
} finally {
  rmSync(build, { recursive: true, force: true });
}
