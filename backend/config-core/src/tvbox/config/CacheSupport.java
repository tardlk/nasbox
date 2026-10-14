// SPDX-License-Identifier: GPL-3.0-only
// Selected original MD5.encode and readConfigFile; byte-array input replaces FileInputStream.
package tvbox.config;
import java.io.*;
import java.security.*;
final class CacheSupport {
private static final char[] hexDigits = "0123456789abcdef".toCharArray();
private static final MessageDigest sDigest;
static { try { sDigest = MessageDigest.getInstance("MD5"); } catch (Exception e) { throw new ExceptionInInitializerError(e); } }
public static String encode(String res) {
        byte[] strTemp = res.getBytes();
        return encode(strTemp);
    }
private static String encode(byte[] bytes) {
        try {
            sDigest.update(bytes);
            byte[] md = sDigest.digest();
            int j = md.length;
            char str[] = new char[j * 2];
            int k = 0;
            for (byte byte0 : md) {
                str[k++] = hexDigits[byte0 >>> 4 & 0xf];
                str[k++] = hexDigits[byte0 & 0xf];
            }
            String dd = new String(str);
            return dd;
        } catch (Exception e) {
            return null;
        }
    }
static String read(byte[] bytes) throws Exception {
        BufferedReader bReader = new BufferedReader(new InputStreamReader(new ByteArrayInputStream(bytes), "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String s = "";
        while ((s = bReader.readLine()) != null) {
            sb.append(s + "\n");
        }
        bReader.close();
        return sb.toString();
    }
}
