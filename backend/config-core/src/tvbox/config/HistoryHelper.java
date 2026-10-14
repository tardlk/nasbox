// SPDX-License-Identifier: GPL-3.0-only
// Adapted from pinned TVBoxOS; see backend/config-core/NOTICE.md.
package tvbox.config;
final class HistoryHelper {
private static final String API_LINE_SPLIT = "\t";
public static String buildApiLine(String name, String url) {
        String lineName = name == null ? "" : name.trim();
        String lineUrl = url == null ? "" : url.trim();
        if (lineName.isEmpty()) {
            lineName = lineUrl;
        }
        return lineName + API_LINE_SPLIT + lineUrl;
    }
public static String getApiLineName(String value) {
        if (value == null) return "";
        int splitIndex = value.indexOf(API_LINE_SPLIT);
        String name = splitIndex >= 0 ? value.substring(0, splitIndex) : value;
        return name.trim();
    }
public static String getApiLineUrl(String value) {
        if (value == null) return "";
        int splitIndex = value.indexOf(API_LINE_SPLIT);
        String url = splitIndex >= 0 ? value.substring(splitIndex + API_LINE_SPLIT.length()) : value;
        return url.trim();
    }
}
