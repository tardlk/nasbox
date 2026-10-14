package com.github.catvod.spider;
public class OneArg extends com.github.catvod.crawler.Spider {private int calls;public void init(android.content.Context c){super.init(c);calls++;}public String homeContent(boolean f){return "one-arg:"+calls;}}
