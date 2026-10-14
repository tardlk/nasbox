package fixture;
import com.github.catvod.crawler.*;import android.content.Context;
public class Payload extends Spider {
 private String ext;private SpiderApi api;
 public void initApi(SpiderApi value){api=value;}
 public void init(Context c,String value){ext=value;}
 public String homeContent(boolean filter){return "payload|"+siteKey+"|"+ext+"|"+filter+"|"+api.getPort();}
 public void destroy(){api.log("payload destroyed:"+siteKey);}
}
