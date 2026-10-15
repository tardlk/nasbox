// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const originalPath = 'resources/jvm/stubs-src/android/app/Activity.java';
const overridePath = 'backend/spider-runtime/native-bridge/src/android/app/Activity.java';
// Small compile-only dependencies isolate the Activity contract from the optional
// ARM runtime. The probe executes only repository-owned Java, never catalog JARs.
const dependencies = {
  'android/content/Context.java': 'package android.content; public class Context {}',
  'android/app/Application.java': 'package android.app; public class Application extends android.content.Context {}',
  'android/view/View.java': `package android.view; public class View {
    public static final int NO_ID = -1;
    private int id = NO_ID;
    public View(android.content.Context context) {}
    public int getId() { return id; }
    public void setId(int id) { this.id = id; }
  }`,
  'android/view/ViewGroup.java': `package android.view; public class ViewGroup extends View {
    public ViewGroup(android.content.Context context) { super(context); }
    public int getChildCount() { return 0; }
    public View getChildAt(int index) { return null; }
  }`,
  'android/view/Window.java': `package android.view; public class Window {
    public View getDecorView() { return new View(null); }
  }`,
  'android/content/ComponentName.java': `package android.content; public class ComponentName {
    private final String pkg, cls;
    public ComponentName(String pkg, String cls) { this.pkg = pkg; this.cls = cls; }
    public String getPackageName() { return pkg; }
    public String getClassName() { return cls; }
  }`,
};

const probe = `import android.app.Activity;
import android.view.*;
import java.lang.invoke.MethodType;
import java.lang.reflect.*;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.*;

public class ActivityContractProbe {
    private static class TreeGroup extends ViewGroup {
        private final List<View> children = new ArrayList<>();
        TreeGroup(int id, View... children) {
            super(null);
            setId(id);
            this.children.addAll(Arrays.asList(children));
        }
        public int getChildCount() { return children.size(); }
        public View getChildAt(int index) { return children.get(index); }
    }
    private static class TreeActivity extends Activity {
        private final Window treeWindow;
        TreeActivity(View decor) {
            treeWindow = new Window() {
                public View getDecorView() { return decor; }
            };
        }
        public Window getWindow() { return treeWindow; }
    }
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    private static Set<String> publicAbi(Class<?> type) {
        Set<String> abi = new TreeSet<>();
        for (Method method : type.getDeclaredMethods()) {
            if (Modifier.isPublic(method.getModifiers())) {
                abi.add(method.getName() + MethodType.methodType(method.getReturnType(), method.getParameterTypes()).descriptorString()
                    + ":static=" + Modifier.isStatic(method.getModifiers()));
            }
        }
        for (Constructor<?> ctor : type.getConstructors()) {
            abi.add("<init>" + MethodType.methodType(void.class, ctor.getParameterTypes()).descriptorString());
        }
        return abi;
    }
    public static void main(String[] args) throws Exception {
        try (URLClassLoader old = new URLClassLoader(new java.net.URL[] { Path.of(args[0]).toUri().toURL() }, null)) {
            Class<?> before = old.loadClass("android.app.Activity");
            check(Activity.class.getSuperclass().getName().equals(before.getSuperclass().getName()), "Activity superclass ABI changed");
            Set<String> expected = publicAbi(before);
            expected.add("isFinishing()Z:static=false");
            expected.add("findViewById(I)Landroid/view/View;:static=false");
            check(publicAbi(Activity.class).equals(expected), "Existing Activity method descriptors changed: " + publicAbi(Activity.class));
        }
        Activity first = new Activity(), second = new Activity();
        Method state = Activity.class.getMethod("isFinishing");
        check(state.getReturnType() == boolean.class, "isFinishing must use primitive boolean");
        check(!(boolean) state.invoke(first), "New Activity must not be finishing");
        check(first.getWindow() != null && first.getWindow() == first.getWindow(), "Retain instance Window binding");
        check(first.getApplication() != null && first.getApplication() == first.getApplication(), "Retain instance Application binding");
        check(first.getComponentName().getPackageName().equals("com.github.tvbox.osc"), "Retain component package binding");
        check(first.getComponentName().getClassName().equals("com.github.tvbox.osc.Main"), "Retain component class binding");
        check(Activity.class.getMethod("findViewById", int.class).getReturnType() == View.class, "findViewById must retain erased View return type");
        check(first.findViewById(16908290) == null, "Headless Activity has no Android content view");
        check(first.findViewById(View.NO_ID) == null, "NO_ID cannot match an unidentified view");
        check(first.findViewById(1234) == null, "Unknown IDs must not create views");
        View child = new View(null), duplicate = new View(null);
        child.setId(32);
        duplicate.setId(32);
        TreeGroup nested = new TreeGroup(16, child), decor = new TreeGroup(8, nested, duplicate);
        TreeActivity tree = new TreeActivity(decor);
        check(tree.findViewById(8) == decor, "Find an existing decor root by identity");
        TreeGroup found = tree.findViewById(16);
        check(found == nested, "Find nested ViewGroup with the generic Android signature");
        check(tree.findViewById(32) == child, "Search children depth first in tree order");
        child.setId(64);
        check(tree.findViewById(64) == child && tree.findViewById(32) == duplicate, "Query current tree IDs rather than cached or fabricated views");
        check(tree.findViewById(View.NO_ID) == null && tree.findViewById(404) == null, "Unmatched tree queries return null");
        check(second.findViewById(64) == null, "Window content belongs to its Activity");
        first.finish();
        check((boolean) state.invoke(first), "finish must record the finish request");
        check(!second.isFinishing(), "Finish state must belong to the Activity instance");
        first.finish();
        check(first.isFinishing(), "Repeated finish must preserve state");
        Thread finishingThread = new Thread(second::finish);
        finishingThread.start();
        finishingThread.join();
        check(second.isFinishing(), "Finish request must remain visible across host threads");
        System.out.println("activity-contract-ok");
    }
}`;

test('host Activity retains pinned public ABI, finish requests and existing-view lookup', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'backend/spider-runtime/native-bridge/source-manifest.json'), 'utf8'));
  const original = readFileSync(join(root, originalPath));
  assert.equal(createHash('sha256').update(original).digest('hex'), manifest.files.find(file => file.path === originalPath).sha256,
    'Check immutable WinBox Activity before using it as the prior ABI');
  const javaHome = process.env.TVBOX_JAVA_HOME || process.env.JAVA_HOME || join(root, '.tools/jdk17');
  const directory = mkdtempSync(join(tmpdir(), 'tvbox-activity-contract-'));
  function write(base, path, value) {
    const target = join(base, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
    return target;
  }
  function run(executable, args) {
    const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  }
  try {
    const previous = join(directory, 'previous'), current = join(directory, 'current');
    for (const [name, activity] of [['previous', original], ['current', readFileSync(join(root, overridePath))]]) {
      const source = join(directory, name + '-src'), classes = join(directory, name);
      mkdirSync(classes);
      const files = Object.entries(dependencies).map(([path, text]) => write(source, path, text));
      files.push(write(source, 'android/app/Activity.java', activity));
      if (name === 'current') files.push(write(source, 'ActivityContractProbe.java', probe));
      run(join(javaHome, 'bin/javac'), ['--release', '17', '-encoding', 'UTF-8', '-d', classes, ...files]);
    }
    assert.match(run(join(javaHome, 'bin/java'), ['-cp', current, 'ActivityContractProbe', previous]), /activity-contract-ok/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
