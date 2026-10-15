// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;

import org.objectweb.asm.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Repairs dex2jar ancestor constructor calls without loading artifact classes.
 *
 * R8 may omit a subclass constructor and invoke an ancestor constructor directly
 * on its DEX new-instance. dex2jar sometimes preserves NEW's subclass but emits
 * invokespecial Ancestor.<init>, which the JVM rejects. DexJarRepair handles a
 * changed NEW type, but intentionally leaves this same-type case untouched.
 * This pass pairs an invocation with its actual NEW stack/local provenance,
 * proves the ancestor chain, and inserts only missing forwarding constructors.
 * Frames must be recomputed after this pass; JVM verification stays enabled.
 */
public final class VerifiedJarRepair {
    private static final Object UNKNOWN = new Object();
    private static final int LIMIT = 64 * 1024 * 1024;
    private static final class Allocation { final String type; Allocation(String t) { type = t; } }
    private static final class UninitializedThis { final String type; UninitializedThis(String t) { type = t; } }
    private static final class Constructor {
        final int access; final String forwardingOwner;
        Constructor(int a, String o) { access = a; forwardingOwner = o; }
    }
    private static final class Info {
        String name, parent; int access;
        final Map<String, Constructor> constructors = new HashMap<>();
    }
    private final Map<String, Info> classes = new HashMap<>();
    private final Set<String> artifactClasses = new HashSet<>();
    private final Map<String, Set<String>> synthetic = new LinkedHashMap<>();

    public static int repair(Path jar) throws IOException {
        return new VerifiedJarRepair().rewrite(jar);
    }

    /** A static parsing predicate, not a claim that JVM verification will pass.
     * Some protected artifacts contain opaque or unsupported .class entries.
     * They remain byte-for-byte resources; defining them still fails normally.
     */
    public static boolean isReadableClass(byte[] bytes) {
        return readableInfo(bytes) != null;
    }

    private static Info readableInfo(byte[] bytes) {
        // ASM does not itself require the classfile magic before parsing.
        if (bytes.length < 10 || bytes[0] != (byte) 0xca || bytes[1] != (byte) 0xfe
                || bytes[2] != (byte) 0xba || bytes[3] != (byte) 0xbe) return null;
        try { return inspect(bytes); }
        catch (IllegalArgumentException | IndexOutOfBoundsException malformedOrUnsupported) { return null; }
    }

    private int rewrite(Path jar) throws IOException {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        Map<String, Long> times = new HashMap<>();
        Set<String> readableEntries = new HashSet<>();
        long total = 0;
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            Enumeration<? extends ZipEntry> en = zip.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                if (entries.size() >= 8192) throw new IOException("CONSTRUCTOR_REPAIR_ENTRY_LIMIT");
                try (InputStream in = zip.getInputStream(e)) {
                    byte[] bytes = in.readNBytes(LIMIT + 1);
                    total += bytes.length;
                    if (bytes.length > LIMIT || total > 96L * 1024 * 1024) throw new IOException("CONSTRUCTOR_REPAIR_SIZE_LIMIT");
                    if (entries.putIfAbsent(e.getName(), bytes) != null) throw new IOException("CONSTRUCTOR_REPAIR_DUPLICATE_ENTRY");
                    times.put(e.getName(), e.getTime());
                    if (e.getName().endsWith(".class")) {
                        String entryType = e.getName().substring(0, e.getName().length() - 6);
                        Info info = readableInfo(bytes);
                        // Only canonical entries can receive synthesized methods.
                        // An unreadable local definition must not be substituted
                        // with a same-named host class when proving an ancestor.
                        if (info == null) classes.put(entryType, null);
                        else if (entryType.equals(info.name)) {
                            classes.put(info.name, info);
                            artifactClasses.add(info.name);
                            readableEntries.add(e.getName());
                        }
                    }
                }
            }
        }
        int[] changed = { 0 };
        for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
            if (!readableEntries.contains(entry.getKey())) continue;
            ClassReader reader = new ClassReader(entry.getValue());
            Map<String, Map<Integer, String>> plans = new HashMap<>();
            int before = changed[0];
            reader.accept(new ClassVisitor(Opcodes.ASM9) {
                public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                    Map<Integer, String> plan = new HashMap<>();
                    plans.put(name + descriptor, plan);
                    return new Provenance(changed, plan, name.equals("<init>") ? reader.getClassName() : null);
                }
            }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
            if (changed[0] == before) continue;
            ClassWriter writer = new ClassWriter(0);
            reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
                public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                    Map<Integer, String> plan = plans.get(name + descriptor);
                    return new MethodVisitor(Opcodes.ASM9, super.visitMethod(access, name, descriptor, signature, exceptions)) {
                        int call;
                        public void visitMethodInsn(int op, String owner, String name, String desc, boolean itf) {
                            super.visitMethodInsn(op, plan.getOrDefault(call++, owner), name, desc, itf);
                        }
                    };
                }
            }, 0);
            entry.setValue(writer.toByteArray());
        }
        if (changed[0] == 0) return 0;
        for (Map.Entry<String, Set<String>> item : synthetic.entrySet()) {
            String entry = item.getKey() + ".class";
            ClassReader reader = new ClassReader(entries.get(entry));
            ClassWriter writer = new ClassWriter(0);
            String parent = classes.get(item.getKey()).parent;
            reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
                public void visitEnd() {
                    for (String descriptor : item.getValue()) {
                        MethodVisitor mv = super.visitMethod(Opcodes.ACC_PUBLIC, "<init>", descriptor, null, null);
                        mv.visitCode(); mv.visitVarInsn(Opcodes.ALOAD, 0);
                        int local = 1;
                        for (Type arg : Type.getArgumentTypes(descriptor)) {
                            mv.visitVarInsn(arg.getOpcode(Opcodes.ILOAD), local); local += arg.getSize();
                        }
                        mv.visitMethodInsn(Opcodes.INVOKESPECIAL, parent, "<init>", descriptor, false);
                        mv.visitInsn(Opcodes.RETURN); mv.visitMaxs(local, local); mv.visitEnd();
                        changed[0]++;
                    }
                    super.visitEnd();
                }
            }, 0);
            entries.put(entry, writer.toByteArray());
        }
        Path tmp = Files.createTempFile(jar.toAbsolutePath().getParent(), "constructor-repair-", ".jar");
        try {
            try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(tmp))) {
                for (Map.Entry<String, byte[]> item : entries.entrySet()) {
                    ZipEntry entry = new ZipEntry(item.getKey());
                    if (times.get(item.getKey()) >= 0) entry.setTime(times.get(item.getKey()));
                    zip.putNextEntry(entry); zip.write(item.getValue()); zip.closeEntry();
                }
            }
            Files.move(tmp, jar, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(tmp); }
        return changed[0];
    }

    private Info info(String type) {
        if (classes.containsKey(type)) return classes.get(type);
        // Reading class resources resolves only metadata; no artifact class is
        // defined or initialized (unlike reflective hierarchy resolution).
        try (InputStream in = VerifiedJarRepair.class.getClassLoader().getResourceAsStream(type + ".class")) {
            Info found = in == null ? null : inspect(in.readNBytes(LIMIT));
            classes.put(type, found); return found;
        } catch (IOException | RuntimeException e) { classes.put(type, null); return null; }
    }

    private boolean canForward(String type, String owner, String descriptor, boolean initializingThis) {
        if (type == null) return false;
        if (type.equals(owner)) return false;
        List<String> path = new ArrayList<>();
        String cursor = type;
        for (int i = 0; i < 64 && cursor != null && !cursor.equals(owner); i++) {
            Info cls = info(cursor);
            if (cls == null || (cls.access & Opcodes.ACC_INTERFACE) != 0 || !initializingThis && (cls.access & Opcodes.ACC_ABSTRACT) != 0 && cursor.equals(type)) return false;
            // Only classes inside this artifact may receive a constructor.
            if (!artifactClasses.contains(cursor)) return false;
            Constructor existing = cls.constructors.get(descriptor);
            if (existing != null && ((existing.access & Opcodes.ACC_PUBLIC) == 0 || !Objects.equals(existing.forwardingOwner, cls.parent))) return false;
            path.add(cursor); cursor = cls.parent;
        }
        if (!owner.equals(cursor) || path.isEmpty()) return false;
        Info ancestor = info(owner);
        Constructor target = ancestor == null ? null : ancestor.constructors.get(descriptor);
        if (target == null || (target.access & Opcodes.ACC_PRIVATE) != 0) return false;
        if ((target.access & (Opcodes.ACC_PUBLIC | Opcodes.ACC_PROTECTED)) == 0 && !packageName(owner).equals(packageName(path.get(path.size() - 1)))) return false;
        for (String child : path) {
            Info cls = classes.get(child);
            if (cls == null) return false;
            if (!cls.constructors.containsKey(descriptor)) synthetic.computeIfAbsent(child, k -> new LinkedHashSet<>()).add(descriptor);
        }
        return true;
    }

    private static String packageName(String type) { int i = type.lastIndexOf('/'); return i < 0 ? "" : type.substring(0, i); }

    private static Info inspect(byte[] bytes) {
        Info result = new Info();
        new ClassReader(bytes).accept(new ClassVisitor(Opcodes.ASM9) {
            public void visit(int version, int access, String name, String signature, String parent, String[] interfaces) {
                result.name = name; result.parent = parent; result.access = access;
            }
            public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                Type.getArgumentTypes(descriptor); Type.getReturnType(descriptor);
                if (!name.equals("<init>")) return new MethodVisitor(Opcodes.ASM9) {
                    public void visitMethodInsn(int op, String owner, String name, String desc, boolean itf) {
                        Type.getArgumentTypes(desc); Type.getReturnType(desc);
                    }
                    public void visitInvokeDynamicInsn(String name, String desc, Handle handle, Object... args) {
                        Type.getArgumentTypes(desc); Type.getReturnType(desc);
                    }
                    public void visitFieldInsn(int op, String owner, String name, String desc) { Type.getType(desc).getSize(); }
                    public void visitMultiANewArrayInsn(String desc, int dimensions) { Type.getType(desc); }
                    public void visitLdcInsn(Object value) { if (value instanceof ConstantDynamic) ((ConstantDynamic) value).getSize(); }
                };
                List<String> expected = new ArrayList<>(); expected.add("v" + Opcodes.ALOAD + ":0");
                int local = 1;
                for (Type arg : Type.getArgumentTypes(descriptor)) {
                    expected.add("v" + arg.getOpcode(Opcodes.ILOAD) + ":" + local); local += arg.getSize();
                }
                expected.add("m" + result.parent + descriptor); expected.add("i" + Opcodes.RETURN);
                return new MethodVisitor(Opcodes.ASM9) {
                    int index; boolean valid = true;
                    private void event(String actual) { if (index >= expected.size() || !expected.get(index++).equals(actual)) valid = false; }
                    public void visitInsn(int op) { event("i" + op); }
                    public void visitVarInsn(int op, int var) { event("v" + op + ":" + var); }
                    public void visitMethodInsn(int op, String owner, String method, String desc, boolean itf) {
                        Type.getArgumentTypes(desc); Type.getReturnType(desc);
                        if (op != Opcodes.INVOKESPECIAL || !method.equals("<init>")) valid = false;
                        event("m" + owner + desc);
                    }
                    public void visitIntInsn(int op, int value) { valid = false; }
                    public void visitTypeInsn(int op, String value) { valid = false; }
                    public void visitFieldInsn(int op, String owner, String field, String desc) { Type.getType(desc).getSize(); valid = false; }
                    public void visitLdcInsn(Object value) { if (value instanceof ConstantDynamic) ((ConstantDynamic) value).getSize(); valid = false; }
                    public void visitJumpInsn(int op, Label label) { valid = false; }
                    public void visitIincInsn(int var, int amount) { valid = false; }
                    public void visitInvokeDynamicInsn(String name, String desc, Handle handle, Object... args) { Type.getArgumentTypes(desc); Type.getReturnType(desc); valid = false; }
                    public void visitTableSwitchInsn(int min, int max, Label label, Label... labels) { valid = false; }
                    public void visitLookupSwitchInsn(Label label, int[] keys, Label[] labels) { valid = false; }
                    public void visitMultiANewArrayInsn(String desc, int dimensions) { valid = false; }
                    public void visitTryCatchBlock(Label start, Label end, Label handler, String type) { valid = false; }
                    public void visitEnd() { result.constructors.put(descriptor, new Constructor(access, valid && index == expected.size() ? result.parent : null)); }
                };
            }
        }, 0);
        return result;
    }

    /** Exact provenance inside a basic block. Crossing a branch/handler resets
     * the state instead of guessing a merge or pairing by allocation order. */
    private final class Provenance extends MethodVisitor {
        final List<Object> stack = new ArrayList<>();
        final Map<Integer, Object> locals = new HashMap<>();
        final int[] changed;
        final Map<Integer, String> plan;
        final UninitializedThis constructorThis;
        boolean started;
        int call;
        Provenance(int[] count, Map<Integer, String> planned, String currentClass) {
            super(Opcodes.ASM9); changed = count; plan = planned;
            constructorThis = currentClass == null ? null : new UninitializedThis(currentClass);
            if (constructorThis != null) locals.put(0, constructorThis);
        }
        void reset() { stack.clear(); locals.clear(); }
        void push(int slots) { for (int i = 0; i < slots; i++) stack.add(UNKNOWN); }
        Object pop() { if (stack.isEmpty()) { reset(); return UNKNOWN; } return stack.remove(stack.size() - 1); }
        void pop(int slots) { for (int i = 0; i < slots; i++) pop(); }
        void replace(int consumed, int produced) { pop(consumed); push(produced); }
        void duplicate(int width, int below) {
            if (stack.size() < width + below) { reset(); return; }
            int offset = stack.size() - width;
            stack.addAll(offset - below, new ArrayList<>(stack.subList(offset, stack.size())));
        }
        public void visitLabel(Label label) { reset(); if (!started && constructorThis != null) locals.put(0, constructorThis); super.visitLabel(label); }
        public void visitJumpInsn(int op, Label label) { started = true; reset(); super.visitJumpInsn(op, label); }
        public void visitTableSwitchInsn(int min, int max, Label label, Label... labels) { started = true; reset(); super.visitTableSwitchInsn(min, max, label, labels); }
        public void visitLookupSwitchInsn(Label label, int[] keys, Label[] labels) { started = true; reset(); super.visitLookupSwitchInsn(label, keys, labels); }
        public void visitVarInsn(int op, int var) {
            started = true;
            if (op == Opcodes.ALOAD) stack.add(locals.getOrDefault(var, UNKNOWN));
            else if (op == Opcodes.ASTORE) locals.put(var, pop());
            else if (op == Opcodes.ILOAD || op == Opcodes.FLOAD) push(1);
            else if (op == Opcodes.LLOAD || op == Opcodes.DLOAD) push(2);
            else if (op == Opcodes.ISTORE || op == Opcodes.FSTORE) { pop(); locals.remove(var); }
            else if (op == Opcodes.LSTORE || op == Opcodes.DSTORE) { pop(2); locals.remove(var); locals.remove(var + 1); }
            else reset();
            super.visitVarInsn(op, var);
        }
        public void visitTypeInsn(int op, String type) {
            started = true;
            if (op == Opcodes.NEW) stack.add(new Allocation(type));
            else if (op == Opcodes.ANEWARRAY || op == Opcodes.INSTANCEOF) replace(1, 1);
            else if (op == Opcodes.CHECKCAST) { pop(); push(1); }
            else reset();
            super.visitTypeInsn(op, type);
        }
        public void visitFieldInsn(int op, String owner, String name, String desc) {
            started = true;
            int size = Type.getType(desc).getSize();
            if (op == Opcodes.GETSTATIC) push(size);
            else if (op == Opcodes.PUTSTATIC) pop(size);
            else if (op == Opcodes.GETFIELD) replace(1, size);
            else if (op == Opcodes.PUTFIELD) pop(size + 1);
            else reset();
            super.visitFieldInsn(op, owner, name, desc);
        }
        public void visitMethodInsn(int op, String owner, String name, String desc, boolean itf) {
            started = true;
            for (Type arg : Type.getArgumentTypes(desc)) pop(arg.getSize());
            Object receiver = op == Opcodes.INVOKESTATIC ? UNKNOWN : pop();
            if (op == Opcodes.INVOKESPECIAL && name.equals("<init>") && (receiver instanceof Allocation || receiver instanceof UninitializedThis)) {
                String target = null;
                if (receiver instanceof Allocation) {
                    String type = ((Allocation) receiver).type;
                    if (canForward(type, owner, desc, false)) target = type;
                } else {
                    String type = ((UninitializedThis) receiver).type;
                    String parent = classes.get(type).parent;
                    // A constructor may initialize this through itself or its
                    // immediate parent. DEX can skip omitted intermediate
                    // constructors; restore only a proven forwarding chain.
                    if (!owner.equals(type) && canForward(parent, owner, desc, true)) target = parent;
                }
                if (target != null) { owner = target; plan.put(call, owner); changed[0]++; }
                for (int i = 0; i < stack.size(); i++) if (stack.get(i) == receiver) stack.set(i, UNKNOWN);
                locals.replaceAll((k, v) -> v == receiver ? UNKNOWN : v);
            }
            push(Type.getReturnType(desc).getSize());
            call++;
            super.visitMethodInsn(op, owner, name, desc, itf);
        }
        public void visitInvokeDynamicInsn(String name, String desc, Handle handle, Object... args) {
            started = true;
            for (Type arg : Type.getArgumentTypes(desc)) pop(arg.getSize());
            push(Type.getReturnType(desc).getSize()); super.visitInvokeDynamicInsn(name, desc, handle, args);
        }
        public void visitLdcInsn(Object value) { started = true; push(value instanceof Long || value instanceof Double ? 2 : value instanceof ConstantDynamic ? ((ConstantDynamic) value).getSize() : 1); super.visitLdcInsn(value); }
        public void visitIntInsn(int op, int value) { started = true; if (op == Opcodes.NEWARRAY) replace(1, 1); else if (op == Opcodes.BIPUSH || op == Opcodes.SIPUSH) push(1); else reset(); super.visitIntInsn(op, value); }
        public void visitIincInsn(int var, int amount) { started = true; locals.remove(var); super.visitIincInsn(var, amount); }
        public void visitMultiANewArrayInsn(String desc, int dimensions) { started = true; replace(dimensions, 1); super.visitMultiANewArrayInsn(desc, dimensions); }
        public void visitInsn(int op) {
            started = true;
            if (op == Opcodes.NOP) { }
            else if (op >= Opcodes.ACONST_NULL && op <= Opcodes.ICONST_5 || op >= Opcodes.FCONST_0 && op <= Opcodes.FCONST_2) push(1);
            else if (op == Opcodes.LCONST_0 || op == Opcodes.LCONST_1 || op == Opcodes.DCONST_0 || op == Opcodes.DCONST_1) push(2);
            else if (op >= Opcodes.IALOAD && op <= Opcodes.SALOAD) replace(2, op == Opcodes.LALOAD || op == Opcodes.DALOAD ? 2 : 1);
            else if (op >= Opcodes.IASTORE && op <= Opcodes.SASTORE) pop(op == Opcodes.LASTORE || op == Opcodes.DASTORE ? 4 : 3);
            else if (op == Opcodes.POP) pop(); else if (op == Opcodes.POP2) pop(2);
            else if (op >= Opcodes.DUP && op <= Opcodes.DUP2_X2) { int i = op - Opcodes.DUP; duplicate(i < 3 ? 1 : 2, i % 3); }
            else if (op == Opcodes.SWAP) { Object a = pop(), b = pop(); stack.add(a); stack.add(b); }
            else if (op >= Opcodes.IADD && op <= Opcodes.DREM) { int width = (op - Opcodes.IADD) % 4 == 1 || (op - Opcodes.IADD) % 4 == 3 ? 2 : 1; replace(width * 2, width); }
            else if (op >= Opcodes.INEG && op <= Opcodes.DNEG) { int width = op == Opcodes.LNEG || op == Opcodes.DNEG ? 2 : 1; replace(width, width); }
            else if (op >= Opcodes.ISHL && op <= Opcodes.LUSHR) { int width = (op - Opcodes.ISHL) % 2 + 1; replace(width + 1, width); }
            else if (op >= Opcodes.IAND && op <= Opcodes.LXOR) { int width = (op - Opcodes.IAND) % 2 + 1; replace(width * 2, width); }
            else if (op >= Opcodes.I2L && op <= Opcodes.I2S) {
                int[] consumed = {1,1,1,2,2,2,1,1,1,2,2,2,1,1,1};
                int[] produced = {2,1,2,1,1,2,1,2,2,1,2,1,1,1,1};
                replace(consumed[op - Opcodes.I2L], produced[op - Opcodes.I2L]);
            }
            else if (op == Opcodes.LCMP || op == Opcodes.DCMPL || op == Opcodes.DCMPG) replace(4, 1);
            else if (op == Opcodes.FCMPL || op == Opcodes.FCMPG) replace(2, 1);
            else if (op == Opcodes.ARRAYLENGTH) replace(1, 1);
            else if (op == Opcodes.MONITORENTER || op == Opcodes.MONITOREXIT) pop();
            else reset();
            super.visitInsn(op);
        }
    }
}
