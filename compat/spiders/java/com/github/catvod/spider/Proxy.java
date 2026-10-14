package com.github.catvod.spider;
import java.util.*;import java.io.*;
public class Proxy {public static Object[] proxy(Map<String,String> p){if("miss".equals(p.get("url")))return null;return new Object[]{202,"text/plain",new ByteArrayInputStream("jar-proxy".getBytes(java.nio.charset.StandardCharsets.UTF_8))};}}
