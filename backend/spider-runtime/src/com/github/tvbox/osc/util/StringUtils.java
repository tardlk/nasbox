// SPDX-License-Identifier: GPL-3.0-only
package com.github.tvbox.osc.util;public class StringUtils {
public static boolean isEmpty(CharSequence str) {
        return str == null || str.length() == 0;
    }
public static boolean isNotEmpty(CharSequence str) {
        return !isEmpty(str);
    }
}
