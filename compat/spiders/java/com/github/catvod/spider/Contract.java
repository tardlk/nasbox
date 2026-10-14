package com.github.catvod.spider;
import com.github.catvod.crawler.*;import android.content.Context;import com.google.gson.*;import java.util.*;import java.io.*;
public class Contract extends Spider {
 private final List<String> trace=new ArrayList<>();private SpiderApi api;private String ext;private int calls;
 public Contract(){trace.add("construct:"+siteKey);}
 public void initApi(SpiderApi api){this.api=api;trace.add("initApi:"+siteKey);}
 public void init(Context context,String ext){if(api==null)throw new IllegalStateException("initApi must precede init");super.init(context,ext);this.ext=ext;trace.add("init:"+ext);}
 private String result(String method,Object...args){JsonObject out=new JsonObject();out.addProperty("method",method);out.add("args",new Gson().toJsonTree(args));out.addProperty("siteKey",siteKey);out.addProperty("ext",ext);out.addProperty("calls",++calls);out.add("trace",new Gson().toJsonTree(trace));return out.toString();}
 public String homeContent(boolean filter){return result("home",filter);}
 public String homeVideoContent(){return result("homeVideo");}
 public String categoryContent(String tid,String pg,boolean filter,HashMap<String,String> extend){return result("category",tid,pg,filter,new TreeMap<>(extend));}
 public String detailContent(List<String> ids){return result("detail",ids);}
 public String searchContent(String key,boolean quick){if("throw".equals(key))throw new IllegalArgumentException("fixture search failure");return result("search",key,quick);}
 public String playerContent(String flag,String id,List<String> flags){return result("player",flag,id,flags);}
 public String liveContent(String url){return result("live",url);}
 public String action(String action){
  if(action.equals("api"))return api.getPort()+"|"+api.webParse("a",null)+"|"+api.getScreenOrientation();
  if(action.equals("initCount"))return Integer.toString(Init.calls);
  if(action.equals("resource")){try(InputStream in=getClass().getResourceAsStream("/assets/value.txt")){return new String(read(in),java.nio.charset.StandardCharsets.UTF_8);}catch(Exception e){throw new RuntimeException(e);}}
  return result("action",action);
 }
 private static byte[] read(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[1024];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}
 public boolean manualVideoCheck(){return true;}
 public boolean isVideoFormat(String url){return url.endsWith(".fixture");}
 public Object[] proxyLocal(Map<String,String> params){return new Object[]{201,"text/plain",new ByteArrayInputStream((siteKey+":"+params.get("url")).getBytes(java.nio.charset.StandardCharsets.UTF_8)),Collections.singletonMap("X-Fixture","yes")};}
 public void cancelByTag(){api.log("cancel:"+siteKey);}
 public void destroy(){api.log("destroy:"+siteKey);}
}
