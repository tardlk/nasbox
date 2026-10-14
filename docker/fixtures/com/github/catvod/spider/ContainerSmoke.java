// SPDX-License-Identifier: GPL-3.0-only
package com.github.catvod.spider;
public final class ContainerSmoke extends com.github.catvod.crawler.Spider {
 public String homeContent(boolean filter){
  try(java.io.InputStream in=getClass().getClassLoader().getResourceAsStream("assets/container.txt")){
   if(in==null)throw new IllegalStateException("DEX resource missing");
   return "{\"class\":[{\"type_id\":\"fixture\",\"type_name\":\"DEX\"}],\"resource\":\""+read(in)+"\"}";
  }catch(java.io.IOException e){throw new IllegalStateException(e);}
 }
 private static String read(java.io.InputStream in)throws java.io.IOException{java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] bytes=new byte[256];for(int n;(n=in.read(bytes))!=-1;)out.write(bytes,0,n);return new String(out.toByteArray(),java.nio.charset.StandardCharsets.UTF_8);}
}
