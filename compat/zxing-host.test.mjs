// SPDX-License-Identifier: GPL-3.0-only
// Genuine pinned ZXing codec, owned QR data, and real checksum failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildSpiderRuntime } from '../backend/spider-runtime/build.mjs';
import { buildNativeProfile } from '../backend/spider-runtime/native-bridge/build.mjs';

const sha = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  return result.stdout;
};

test('ZXing uses the pinned original 3.3.0 coordinate and Maven SHA1 with retained license/POM evidence', () => {
  const manifest = JSON.parse(readFileSync('backend/spider-runtime/native-bridge/runtime.json', 'utf8'));
  const pin = manifest.dependencies.find(row => row.filename === 'core-3.3.0.jar');
  assert.ok(pin);
  assert.match(readFileSync('compat/reference/tvboxos/app/build.gradle', 'utf8'), /implementation 'com\.google\.zxing:core:3\.3\.0'/);
  const bytes = readFileSync(join(process.env.TVBOX_NATIVE_LIB_DIR || '.tools/native-runtime', pin.filename));
  assert.equal(bytes.length, pin.bytes);
  assert.equal(sha(bytes), pin.sha256);
  assert.equal(sha(bytes, 'sha1'), pin.upstreamSha1);
  const provenance = JSON.parse(readFileSync('backend/spider-runtime/native-bridge/licenses/core-3.3.0/provenance.json', 'utf8'));
  assert.equal(provenance.artifact.sha256, pin.sha256);
  for (const row of [provenance.pom, provenance.parentPom]) {
    const content = readFileSync(join('backend/spider-runtime/native-bridge/licenses/core-3.3.0', row.file));
    assert.equal(sha(content), row.sha256);
    assert.equal(sha(content, 'sha1'), row.upstreamSha1);
  }
  assert.equal(sha(readFileSync('backend/spider-runtime/native-bridge/licenses/core-3.3.0/LICENSE')), provenance.licenseSource.sha256);
});

test('real ZXing QR encoding, decoding and error correction match ChecksumException ABI and reject irrecoverable data', { timeout: 120000 }, () => {
  const built = buildNativeProfile(buildSpiderRuntime()), directory = mkdtempSync(join(tmpdir(), 'tvbox-zxing-host-'));
  try {
    writeFileSync(join(directory, 'ZxingHostProbe.java'), source);
    run(join(built.javaHome, 'bin/javac'), ['--release', '17', '-encoding', 'UTF-8', '-cp', built.classpath, '-d', directory, join(directory, 'ZxingHostProbe.java')]);
    assert.match(run(built.java, ['-Xverify:all', '-cp', directory + delimiter + built.classpath, 'ZxingHostProbe']), /zxing-real-3\.3\.0-ok:checksum-rejected/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const source = String.raw`
import java.util.*;
import java.lang.reflect.*;
import com.google.zxing.*;
import com.google.zxing.common.*;
import com.google.zxing.qrcode.*;
import com.google.zxing.qrcode.decoder.*;
import com.google.zxing.qrcode.encoder.*;
public final class ZxingHostProbe {
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static BitMatrix modules(ByteMatrix encoded){
  BitMatrix value=new BitMatrix(encoded.getWidth(),encoded.getHeight());
  for(int y=0;y<encoded.getHeight();y++)for(int x=0;x<encoded.getWidth();x++)if(encoded.get(x,y)==1)value.set(x,y);
  return value;
 }
 static final class OwnedPixels extends LuminanceSource {
  private final byte[] pixels;
  OwnedPixels(BitMatrix matrix){super(matrix.getWidth(),matrix.getHeight());pixels=new byte[getWidth()*getHeight()];for(int y=0;y<getHeight();y++)for(int x=0;x<getWidth();x++)pixels[y*getWidth()+x]=(byte)(matrix.get(x,y)?0:255);}
  public byte[] getRow(int y,byte[] row){if(row==null||row.length<getWidth())row=new byte[getWidth()];System.arraycopy(pixels,y*getWidth(),row,0,getWidth());return row;}
  public byte[] getMatrix(){return pixels.clone();}
 }
 public static void main(String[] args)throws Exception {
  check(ChecksumException.class.getSuperclass()==ReaderException.class,"original exception hierarchy");
  check(Modifier.isFinal(ChecksumException.class.getModifiers()),"final exception ABI");
  check(ChecksumException.class.getMethod("getChecksumInstance").getReturnType()==ChecksumException.class,"factory descriptor");
  check(ChecksumException.class.getMethod("getChecksumInstance",Throwable.class).getReturnType()==ChecksumException.class,"cause factory descriptor");
  check(ChecksumException.getChecksumInstance()!=null&&ChecksumException.getChecksumInstance(new IllegalArgumentException("owned"))!=null,"factories execute");
  check(ChecksumException.class.getProtectionDomain().getCodeSource().getLocation().toString().endsWith("core-3.3.0.jar"),"genuine dependency on runtime classpath");
  String payload="owned-QR-3.3.0";
  Map<EncodeHintType,Object> hints=new EnumMap<>(EncodeHintType.class);hints.put(EncodeHintType.CHARACTER_SET,"UTF-8");hints.put(EncodeHintType.QR_VERSION,1);
  QRCode code=Encoder.encode(payload,ErrorCorrectionLevel.L,hints);
  check(code.getVersion().getVersionNumber()==1,"fixed owned version");
  BitMatrix exact=modules(code.getMatrix());
  check(new Decoder().decode(exact.clone()).getText().equals(payload),"encoded modules round trip");
  BitMatrix smallDamage=exact.clone();smallDamage.flip(20,20);
  check(new Decoder().decode(smallDamage).getText().equals(payload),"real Reed Solomon correction");
  BitMatrix damaged=exact.clone();
  for(int y=12;y<21;y++)for(int x=12;x<21;x++)damaged.flip(x,y);
  boolean rejected=false;
  try{new Decoder().decode(damaged);}catch(ChecksumException expected){rejected=true;}
  check(rejected,"irrecoverable QR must raise actual ChecksumException");
  String unicode="owned-\u6d4b\u8bd5-3.3.0";
  hints.remove(EncodeHintType.QR_VERSION);
  BitMatrix pixels=new QRCodeWriter().encode(unicode,BarcodeFormat.QR_CODE,160,160,hints);
  Result read=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new OwnedPixels(pixels))));
  check(unicode.equals(read.getText())&&read.getBarcodeFormat()==BarcodeFormat.QR_CODE,"writer, luminance binarizer and detector round trip");
  boolean invalid=false;try{new QRCodeWriter().encode("",BarcodeFormat.QR_CODE,10,10);}catch(IllegalArgumentException expected){invalid=true;}
  check(invalid,"invalid input must fail");
  System.out.println("zxing-real-3.3.0-ok:checksum-rejected");
 }
}
`;
