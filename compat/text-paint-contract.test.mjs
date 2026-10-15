// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const source = 'resources/jvm/stubs-src/android/text/TextPaint.java';
const local = 'backend/spider-runtime/native-bridge/src/android';
const consumer = `public class PaintConsumer {
    // Compile against the real Android API: getPaint returns TextPaint while
    // invokevirtual is owned by Paint and requires genuine JVM assignability.
    public static float measure(android.widget.TextView view) {
        return ((android.graphics.Paint) view.getPaint()).measureText("ab");
    }
    public static android.graphics.Paint upcast(android.text.TextPaint paint) {
        return paint;
    }
}`;
const fixture = `package android.widget;
public class TextView {
    private final android.text.TextPaint paint = new android.text.TextPaint();
    public android.text.TextPaint getPaint() { return paint; }
}`;
const probe = `import android.graphics.Paint;
import android.text.TextPaint;
import android.widget.TextView;
import java.lang.invoke.MethodType;
import java.lang.reflect.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;

public class TextPaintContractProbe {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    private static Set<String> abi(Class<?> type) {
        Set<String> result = new TreeSet<>();
        for (Field field : type.getDeclaredFields()) {
            if (Modifier.isPublic(field.getModifiers())) {
                result.add("field:" + field.getName() + ":" + field.getType().descriptorString());
            }
        }
        for (Method method : type.getDeclaredMethods()) {
            if (Modifier.isPublic(method.getModifiers())) {
                result.add(method.getName() + MethodType.methodType(method.getReturnType(), method.getParameterTypes()).descriptorString());
            }
        }
        for (Constructor<?> ctor : type.getConstructors()) {
            result.add("<init>" + MethodType.methodType(void.class, ctor.getParameterTypes()).descriptorString());
        }
        return result;
    }
    public static void main(String[] args) throws Exception {
        try (URLClassLoader old = new URLClassLoader(new URL[] { Path.of(args[0]).toUri().toURL() }, null)) {
            check(abi(TextPaint.class).equals(abi(old.loadClass("android.text.TextPaint"))), "Preserve legacy TextPaint field and method descriptors");
        }
        check(TextPaint.class.getSuperclass() == Paint.class, "TextPaint must extend Android Paint");
        check(Paint.class.isAssignableFrom(TextPaint.class), "Paint parameter assignability");
        check(Paint.class.getMethod("measureText", String.class).getReturnType() == float.class, "Observed Paint measure descriptor");
        TextView view = new TextView();
        TextPaint text = view.getPaint();
        text.setTextSize(20f);
        Paint parent = PaintConsumer.upcast(text);
        check(parent == text, "Consumer upcast preserves paint identity");
        check(PaintConsumer.measure(view) == text.measureText("ab"), "Android-compiled Paint invocation dispatches to TextPaint override");
        check(PaintConsumer.measure(view) == 24f, "Retain legacy 0.6em approximation, not Android metrics");
        text.setColor(0xff123456);
        text.setAntiAlias(false);
        check(text.getColor() == 0xff123456 && !text.isAntiAlias(), "Retain existing property bindings");
        TextPaint copy = new TextPaint(text);
        check(copy.getColor() == text.getColor() && copy.getTextSize() == text.getTextSize(), "Retain legacy copy binding");
        check(new TextPaint(7).getFlags() == 7, "Retain flags constructor");
        try {
            new Paint().measureText("ab");
            throw new AssertionError("Base Paint must not fabricate Android metrics");
        } catch (UnsupportedOperationException expected) {
            check(expected.getMessage().contains("font metrics"), "Unimplemented rendering must be explicit");
        }
        System.out.println("text-paint-contract-ok");
    }
}`;

test('TextPaint keeps legacy ABI and verifies an Android-compiled Paint consumer', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'backend/spider-runtime/native-bridge/source-manifest.json'), 'utf8'));
  const original = readFileSync(join(root, source));
  assert.equal(createHash('sha256').update(original).digest('hex'), manifest.files.find(file => file.path === source).sha256,
    'Check immutable WinBox TextPaint before using its ABI');
  const javaHome = process.env.TVBOX_JAVA_HOME || process.env.JAVA_HOME || join(root, '.tools/jdk17');
  const apiJar = join(process.env.TVBOX_NATIVE_LIB_DIR || join(root, '.tools/native-runtime'), 'android-api-4.1.1.4.jar');
  const directory = mkdtempSync(join(tmpdir(), 'tvbox-text-paint-contract-'));
  const previous = join(directory, 'previous'), current = join(directory, 'current');
  function write(path, text) {
    writeFileSync(join(directory, path), text);
    return join(directory, path);
  }
  function run(executable, args) {
    const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  }
  try {
    mkdirSync(previous);
    mkdirSync(current);
    const typeface = join(root, 'resources/jvm/stubs-src/android/graphics/Typeface.java');
    run(join(javaHome, 'bin/javac'), ['--release', '17', '-encoding', 'UTF-8', '-d', previous, join(root, source), typeface]);
    const consumerPath = write('PaintConsumer.java', consumer);
    run(join(javaHome, 'bin/javac'), ['--release', '17', '-encoding', 'UTF-8', '-cp', apiJar, '-d', current, consumerPath]);
    const bytecode = run(join(javaHome, 'bin/javap'), ['-c', '-p', '-classpath', current, 'PaintConsumer']);
    assert.match(bytecode, /android\/widget\/TextView\.getPaint:\(\)Landroid\/text\/TextPaint;/);
    assert.match(bytecode, /android\/graphics\/Paint\.measureText:\(Ljava\/lang\/String;\)F/);
    run(join(javaHome, 'bin/javac'), ['--release', '17', '-encoding', 'UTF-8', '-cp', current, '-d', current,
      join(root, local, 'graphics/Paint.java'), join(root, local, 'text/TextPaint.java'), typeface,
      write('TextView.java', fixture), write('TextPaintContractProbe.java', probe)]);
    assert.match(run(join(javaHome, 'bin/java'), ['-Xverify:all', '-cp', current, 'TextPaintContractProbe', previous]), /text-paint-contract-ok/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
