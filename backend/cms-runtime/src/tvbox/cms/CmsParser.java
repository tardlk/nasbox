// SPDX-License-Identifier: GPL-3.0-only
package tvbox.cms;
import com.google.gson.*;
import com.github.tvbox.osc.bean.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.xml.parsers.*;
import javax.xml.XMLConstants;
import org.w3c.dom.*;
import org.xml.sax.*;

/** Original Gson CMS models; explicit DOM XML binding with external entities disabled.
 * Emits a documented Spider-shaped projection. Not Android UI/LiveData or XStream. */
public final class CmsParser {
 private static final Gson gson=new GsonBuilder().serializeNulls().create();
 private static Element child(Element parent,String name){if(parent==null)return null;for(Node n=parent.getFirstChild();n!=null;n=n.getNextSibling())if(n instanceof Element&&n.getNodeName().equals(name))return(Element)n;return null;}
 private static List<Element> children(Element parent,String name){List<Element> rows=new ArrayList<>();if(parent!=null)for(Node n=parent.getFirstChild();n!=null;n=n.getNextSibling())if(n instanceof Element&&n.getNodeName().equals(name))rows.add((Element)n);return rows;}
 private static String text(Element parent,String name){Element value=child(parent,name);return value==null?null:value.getTextContent();}
 private static int integer(String value){return value==null||value.isEmpty()?0:Integer.parseInt(value);}
 private static Document xml(String value)throws Exception{
  DocumentBuilderFactory f=DocumentBuilderFactory.newInstance();f.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
  f.setFeature("http://xml.org/sax/features/external-general-entities",false);f.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
  f.setXIncludeAware(false);f.setExpandEntityReferences(false);f.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,"");f.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
  DocumentBuilder b=f.newDocumentBuilder();b.setErrorHandler(new org.xml.sax.helpers.DefaultHandler(){public void error(SAXParseException e)throws SAXException{throw e;}public void fatalError(SAXParseException e)throws SAXException{throw e;}});
  Document d=b.parse(new InputSource(new StringReader(value)));if(!d.getDocumentElement().getTagName().equals("rss"))throw new IllegalArgumentException("CMS_XML_ROOT");return d;
 }
 private static Movie movie(Element list)throws Exception{
  if(list==null)return null;Movie m=new Movie();m.page=integer(list.getAttribute("page"));m.pagecount=integer(list.getAttribute("pagecount"));m.pagesize=integer(list.getAttribute("pagesize"));m.recordcount=integer(list.getAttribute("recordcount"));m.videoList=new ArrayList<>();
  Map<String,String> fields=Map.ofEntries(Map.entry("id","id"),Map.entry("name","name"),Map.entry("type","type"),Map.entry("pic","pic"),Map.entry("lang","lang"),Map.entry("area","area"),Map.entry("state","state"),Map.entry("note","note"),Map.entry("actor","actor"),Map.entry("director","director"),Map.entry("des","des"),Map.entry("last","last"),Map.entry("tag","tag"),Map.entry("action","action"));
  for(Element item:children(list,"video")){Movie.Video v=new Movie.Video();for(var field:fields.entrySet())Movie.Video.class.getField(field.getKey()).set(v,text(item,field.getValue()));v.tid=integer(text(item,"tid"));v.year=integer(text(item,"year"));Element dl=child(item,"dl");
   if(dl!=null){v.urlBean=new Movie.Video.UrlBean();v.urlBean.infoList=new ArrayList<>();for(Element dd:children(dl,"dd")){Movie.Video.UrlBean.UrlInfo u=new Movie.Video.UrlBean.UrlInfo();u.flag=dd.hasAttribute("flag")?dd.getAttribute("flag"):null;u.urls=dd.getTextContent();v.urlBean.infoList.add(u);}}
   m.videoList.add(v);
  }return m;
 }
 private static void put(JsonObject row,String key,String value){row.add(key,value==null?JsonNull.INSTANCE:new JsonPrimitive(value));}
 private static JsonArray videos(Movie movie){JsonArray result=new JsonArray();if(movie==null||movie.videoList==null)return result;
  for(Movie.Video v:movie.videoList){JsonObject row=new JsonObject();put(row,"vod_id",v.id);put(row,"vod_name",v.name);row.addProperty("type_id",v.tid);put(row,"type_name",v.type);put(row,"vod_pic",v.pic);put(row,"vod_lang",v.lang);put(row,"vod_area",v.area);row.addProperty("vod_year",v.year);put(row,"vod_state",v.state);put(row,"vod_remarks",v.note);put(row,"vod_actor",v.actor);put(row,"vod_director",v.director);put(row,"vod_content",v.des);put(row,"vod_tag",v.tag);put(row,"action",v.action);put(row,"vod_time",v.last);
   List<String> flags=new ArrayList<>(),urls=new ArrayList<>();if(v.urlBean!=null&&v.urlBean.infoList!=null)for(var u:v.urlBean.infoList){flags.add(u.flag==null?"":u.flag);urls.add(u.urls==null?"":u.urls);}
   row.addProperty("vod_play_from",String.join("$$$",flags));row.addProperty("vod_play_url",String.join("$$$",urls));result.add(row);
  }return result;
 }
 public static JsonObject parse(int type,String body,boolean home)throws Exception{
  Movie data=null;JsonArray classes=new JsonArray();JsonObject filters=new JsonObject();String msg=null;
  if(type==1){
   JsonObject root=JsonParser.parseString(body).getAsJsonObject();
   if(home){AbsSortXml sort=new Gson().fromJson(root,AbsSortJson.class).toAbsSortXml();data=sort.list;
    for(var c:sort.classes.sortList){JsonObject row=new JsonObject();put(row,"type_id",c.id);put(row,"type_name",c.name);put(row,"type_flag",c.flag);classes.add(row);}
    // Preserve the baseline's all-or-nothing filter attachment failure boundary.
    try{JsonObject pending=new JsonObject();if(root.has("filters"))for(var entry:root.getAsJsonObject("filters").entrySet()){JsonArray out=new JsonArray();JsonElement raw=entry.getValue();JsonArray groups=raw.isJsonObject()?new JsonArray():raw.getAsJsonArray();if(raw.isJsonObject())groups.add(raw);
     for(JsonElement g:groups){JsonObject o=g.getAsJsonObject(),group=new JsonObject();group.addProperty("key",o.get("key").getAsString());group.addProperty("name",o.get("name").getAsString());LinkedHashMap<String,String> values=new LinkedHashMap<>();for(JsonElement value:o.getAsJsonArray("value")){JsonObject one=value.getAsJsonObject();values.put(one.has("n")?one.get("n").getAsString():"",one.has("v")?one.get("v").getAsString():"");}JsonArray options=new JsonArray();for(var v:values.entrySet()){JsonObject option=new JsonObject();option.addProperty("n",v.getKey());option.addProperty("v",v.getValue());options.add(option);}group.add("value",options);out.add(group);}pending.add(entry.getKey(),out);}
     for(JsonElement c:classes){String id=c.getAsJsonObject().get("type_id").getAsString();if(pending.has(id))filters.add(id,pending.get(id));}
    }catch(Exception ignored){}
   }else{AbsXml result=new Gson().fromJson(root,AbsJson.class).toAbsXml();data=result.movie;msg=result.msg;}
  }else if(type==0){if(!home)body=body.replace("<year></year>","<year>0</year>").replace("<state></state>","<state>0</state>");Element root=xml(body).getDocumentElement();data=movie(child(root,"list"));msg=text(root,"msg");if(home){Element c=child(root,"class");if(c==null)throw new IllegalArgumentException("CMS_XML_CLASSES_MISSING");for(Element ty:children(c,"ty")){JsonObject row=new JsonObject();put(row,"type_id",ty.hasAttribute("id")?ty.getAttribute("id"):null);put(row,"type_name",ty.getTextContent());put(row,"type_flag",ty.hasAttribute("flag")?ty.getAttribute("flag"):null);classes.add(row);}}}
  else throw new IllegalArgumentException("CMS_TYPE_UNSUPPORTED");
  JsonObject out=new JsonObject();if(home){out.add("class",classes);out.add("filters",filters);}out.add("list",videos(data));
  out.addProperty("page",data==null?0:data.page);out.addProperty("pagecount",data==null?0:data.pagecount);out.addProperty("limit",data==null?0:data.pagesize);out.addProperty("total",data==null?0:data.recordcount);put(out,"msg",msg);return out;
 }
 public static void main(String[] args)throws Exception{
  JsonObject result=new JsonObject();try{byte[] bytes=System.in.readNBytes(12*1024*1024+1);if(bytes.length>12*1024*1024)throw new IllegalArgumentException("CMS_INPUT_LIMIT");JsonObject request=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();result.add("value",parse(request.get("type").getAsInt(),request.get("text").getAsString(),request.get("home").getAsBoolean()));result.addProperty("ok",true);}
  catch(Exception error){result.addProperty("ok",false);result.addProperty("errorType",error.getClass().getName());}System.out.println(gson.toJson(result));
 }
}
