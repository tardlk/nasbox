// SPDX-License-Identifier: Apache-2.0
// Android 13 join body (parameter annotations omitted); see pinned platform source and LICENSE-APACHE-2.0.
package android.text;import java.util.Iterator;
public class TextUtils {
public static boolean isEmpty(CharSequence value){return value==null||value.length()==0;}
public static String join(CharSequence delimiter, Iterable tokens) {
        final Iterator<?> it = tokens.iterator();
        if (!it.hasNext()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder();
        sb.append(it.next());
        while (it.hasNext()) {
            sb.append(delimiter);
            sb.append(it.next());
        }
        return sb.toString();
    }
}
