// SPDX-License-Identifier: GPL-3.0-only
// Preserves bindings from the pinned WinBox MIT Activity stub; see NOTICE files.
package android.app;

import android.content.ComponentName;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;

/** Host Activity binding. It has no Android window manager or UI lifecycle. */
public class Activity extends android.content.Context {
    private final Window window = new Window();
    private final Application application = new Application();
    private volatile boolean finishing;

    public Activity() {
        super();
    }

    public Application getApplication() {
        return application;
    }

    public void runOnUiThread(Runnable action) {
    }

    /** Records the finish request for this host Activity instance. */
    public void finish() {
        finishing = true;
    }

    /**
     * Android exposes whether finish was requested, not whether destruction ran.
     * The host has no framework destruction callback to infer or synthesize.
     */
    public boolean isFinishing() {
        return finishing;
    }

    public Window getWindow() {
        return window;
    }

    /** Finds an existing view in the current host window; an empty window has none. */
    @SuppressWarnings("unchecked")
    public <T extends View> T findViewById(int id) {
        if (id == View.NO_ID) return null;
        Window current = getWindow();
        return current == null ? null : (T) findView(current.getDecorView(), id);
    }

    private static View findView(View view, int id) {
        if (view == null) return null;
        if (view.getId() == id) return view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                View match = findView(group.getChildAt(i), id);
                if (match != null) return match;
            }
        }
        return null;
    }

    public ComponentName getComponentName() {
        return new ComponentName("com.github.tvbox.osc", "com.github.tvbox.osc.Main");
    }

    public void requestPermissions(String[] permissions, int requestCode) {
    }
}
