package com.github.catvod.spider;
import com.github.catvod.crawler.*;import android.content.Context;
public class Guarded extends Spider {
 private Spider payload;private SpiderApi api;
 public void initApi(SpiderApi value){api=value;}
 public void init(Context c,String ext){try{payload=(Spider)Init.get().loader.loadClass("fixture.Payload").getDeclaredConstructor().newInstance();payload.siteKey=siteKey;payload.initApi(api);payload.init(c,ext);}catch(Exception e){throw new RuntimeException(e);}}
 public String homeContent(boolean filter){return payload.homeContent(filter);}
 public String action(String value){return Init.get().c.getPackageName()+"|"+Init.normalCalls+"|"+Init.names+"|"+Init.proxy;}
 public void destroy(){payload.destroy();}
}
