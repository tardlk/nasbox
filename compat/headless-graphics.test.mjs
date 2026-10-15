// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSpiderRuntime } from '../backend/spider-runtime/build.mjs';
import { buildNativeProfile } from '../backend/spider-runtime/native-bridge/build.mjs';

test('headless raster paints real pixels and PNG with Android-compiled descriptors under strict verification', { timeout: 120000 }, () => {
  const built=buildNativeProfile(buildSpiderRuntime());
  const directory=mkdtempSync(join(tmpdir(),'tvbox-headless-raster-'));
  const api=built.nativeToolchain.jars.find(path=>/android-api-4\.1\.1\.4[.]jar$/.test(path));
  assert.ok(api);
  const run=(tool,args)=>{const result=spawnSync(join(built.javaHome,'bin',tool),args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(result.error,undefined,String(result.error));assert.equal(result.status,0,result.stderr+result.stdout);return result.stdout;};
  try {
    writeFileSync(join(directory,'AndroidLogoConsumer.java'),consumer);
    run('javac',['--release','17','-cp',api,'-d',directory,join(directory,'AndroidLogoConsumer.java')]);
    const bytecode=run('javap',['-c','-p','-cp',directory,'AndroidLogoConsumer']);
    assert.match(bytecode,/Paint\.setTypeface:\(Landroid\/graphics\/Typeface;\)Landroid\/graphics\/Typeface;/);
    writeFileSync(join(directory,'RasterProbe.java'),probe);
    run('javac',['--release','17','-cp',[directory,built.classpath].join(delimiter),'-d',directory,join(directory,'RasterProbe.java')]);
    assert.match(run('java',['-Xverify:all','-Djava.awt.headless=true','-cp',[directory,built.classpath].join(delimiter),'RasterProbe']),/headless-raster-ok cases=12/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

const consumer=String.raw`
import android.graphics.*;import java.io.*;
public class AndroidLogoConsumer {
 public static Bitmap render() {
  Bitmap b=Bitmap.createBitmap(128,128,Bitmap.Config.ARGB_8888);Canvas c=new Canvas(b);Paint p=new Paint(1);
  p.setColor(0xffff0000);c.drawRect(2,2,30,30,p);
  p.setShader(new LinearGradient(35,5,100,5,0xff00ff00,0xff0000ff,Shader.TileMode.CLAMP));c.drawRoundRect(new RectF(35,2,105,30),3,3,p);p.setShader(null);
  p.setColor(0xff00ff00);Path path=new Path();path.moveTo(4,40);path.lineTo(30,40);path.quadTo(36,50,30,65);path.cubicTo(25,72,10,72,4,65);path.close();c.drawPath(path,p);
  p.setColor(0xff0000ff);c.drawCircle(55,52,12,p);
  c.drawOval(new RectF(3,74,17,81),p);
  p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(4);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);p.setColor(0xffffffff);c.drawLine(76,42,99,62,p);c.drawArc(new RectF(104,40,124,64),0,180,false,p);
  p.setStyle(Paint.Style.FILL);p.setColor(0xffffffff);p.setTextSize(22);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextAlign(Paint.Align.CENTER);Paint.FontMetrics fm=p.getFontMetrics();c.drawText("LOGO",64,100-(fm.ascent+fm.descent)/2,p);
  return b;
 }
 public static Typeface setTypeface(Paint p,Typeface f){return p.setTypeface(f);}
 public static void configurePolymorphic(Paint p,Typeface face){p.setColor(0xff224466);p.setAlpha(64);p.setStrokeWidth(7);p.setTypeface(face);p.setTextSize(28);p.setFlags(5);p.setStyle(Paint.Style.STROKE);}
 public static boolean png(Bitmap bitmap,OutputStream stream){return bitmap.compress(Bitmap.CompressFormat.PNG,100,stream);}
}
`;

const probe=String.raw`
import android.graphics.*;import android.text.TextPaint;import java.awt.image.*;import javax.imageio.*;import java.io.*;import java.lang.reflect.*;import java.util.*;
public class RasterProbe {
 static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
 static void fails(Class<? extends Throwable> expected,Runnable action){try{action.run();throw new AssertionError("Expected "+expected);}catch(Throwable error){if(!expected.isInstance(error))throw new AssertionError(error);}}
 static int visible(Bitmap b,int left,int top,int right,int bottom){int count=0;for(int y=top;y<bottom;y++)for(int x=left;x<right;x++)if((b.getPixel(x,y)>>>24)!=0)count++;return count;}
 static class OpenStream extends ByteArrayOutputStream{boolean closed;public void close()throws IOException{closed=true;super.close();}}
 public static void main(String[] args)throws Exception{
  Bitmap b=AndroidLogoConsumer.render();check(b.getWidth()==128&&b.getHeight()==128,"dimensions");check(b.getPixel(10,10)==0xffff0000,"red rectangle real pixel");check(b.getPixel(0,0)==0,"transparent background");
  check(b.getPixel(40,15)!=b.getPixel(95,15),"gradient interpolates");check(visible(b,3,40,35,72)>300,"quadratic/cubic filled path");check(b.getPixel(55,52)==0xff0000ff,"circle");check(visible(b,72,36,128,70)>100,"line and clockwise arc");check(visible(b,20,78,110,120)>100,"host font produces real glyph pixels");
  OpenStream out=new OpenStream();check(AndroidLogoConsumer.png(b,out),"PNG compression");check(!out.closed,"caller stream remains open");byte[] bytes=out.toByteArray();check(bytes[0]==(byte)137&&bytes[1]=='P'&&bytes[2]=='N'&&bytes[3]=='G',"PNG signature");BufferedImage decoded=ImageIO.read(new ByteArrayInputStream(bytes));check(decoded.getWidth()==128&&decoded.getRGB(10,10)==0xffff0000,"PNG actual decoded pixels");
  Paint p=new Paint();Typeface face=Typeface.create(Typeface.DEFAULT,Typeface.BOLD);check(AndroidLogoConsumer.setTypeface(p,face)==face&&p.getTypeface()==face,"Android return descriptor actual dispatch");TextPaint legacy=new TextPaint();legacy.setTypeface(face);check(legacy.getTypeface()==face,"legacy void descriptor preserved");
  TextPaint polymorphic=new TextPaint();Paint upcast=polymorphic;AndroidLogoConsumer.configurePolymorphic(upcast,face);check(upcast.getTypeface()==face&&polymorphic.typeface==face,"Android setter updates legacy typeface state");check(upcast.getStrokeWidth()==7&&polymorphic.strokeWidth==7,"Inherited stroke getter observes legacy setter");check(upcast.getAlpha()==64&&polymorphic.color==0x40224466,"Alpha uses virtual color state");check(polymorphic.getStyle()==1,"Android style setter updates legacy int style");
  Paint copied=new Paint(upcast);check(copied.getColor()==upcast.getColor()&&copied.getFlags()==upcast.getFlags()&&copied.getStrokeWidth()==7&&copied.getTextSize()==28&&copied.getTypeface()==face,"Paint copy constructor reads observable child state");
  TextPaint defaultLegacy=new TextPaint();Paint copiedDefault=new Paint(defaultLegacy);check(copiedDefault.getFlags()==defaultLegacy.getFlags()&&copiedDefault.isAntiAlias()==defaultLegacy.isAntiAlias(),"Copy preserves independently observed legacy flags and anti-alias state");
  Bitmap polyRaster=Bitmap.createBitmap(24,24,Bitmap.Config.ARGB_8888);new Canvas(polyRaster).drawRect(5,5,19,19,upcast);check(polyRaster.getPixel(12,12)==0,"Polymorphic style renders stroke interior transparent");check((polyRaster.getPixel(5,12)>>>24)==64&&(polyRaster.getPixel(3,12)>>>24)>0,"Polymorphic alpha and seven-pixel stroke render actual pixels");
  Bitmap copyRaster=Bitmap.createBitmap(24,24,Bitmap.Config.ARGB_8888);new Canvas(copyRaster).drawRect(5,5,19,19,copied);check(copyRaster.getPixel(5,12)==polyRaster.getPixel(5,12)&&copyRaster.getPixel(12,12)==0,"Copied polymorphic paint raster state retained");polymorphic.setTypeface(Typeface.MONOSPACE);check(upcast.getTypeface()==Typeface.MONOSPACE,"Legacy void setter visible through Paint getter");check(AndroidLogoConsumer.setTypeface(upcast,null)==null&&polymorphic.getTypeface()==null,"Null typeface roundtrips through both descriptors");polymorphic.style=0;polymorphic.strokeWidth=3;check(upcast.getStrokeWidth()==3,"Public legacy field observed by inherited getter");polyRaster.recycle();copyRaster.recycle();
  check(Arrays.stream(Paint.class.getDeclaredMethods()).filter(m->m.getName().equals("setTypeface")&&m.getReturnType()==Typeface.class).count()==1,"exactly one Android ABI setter");check(Arrays.stream(Paint.class.getDeclaredMethods()).noneMatch(m->m.getName().equals("setTypefaceForRaster")),"temporary Java name removed");
  Paint stroke=new Paint();stroke.setStyle(Paint.Style.STROKE);stroke.setColor(0xffffffff);stroke.setStrokeWidth(2);Bitmap hole=Bitmap.createBitmap(20,20,Bitmap.Config.ARGB_8888);new Canvas(hole).drawRect(2,2,17,17,stroke);check(hole.getPixel(9,9)==0&&hole.getPixel(2,9)!=0,"stroke leaves interior transparent");
  Bitmap alpha=Bitmap.createBitmap(4,4,Bitmap.Config.ARGB_8888);Canvas ac=new Canvas(alpha);ac.drawColor(0xff0000ff);Paint half=new Paint();half.setColor(0x80ff0000);ac.drawRect(0,0,4,4,half);int mixed=alpha.getPixel(2,2);check((mixed>>>24)==255&&((mixed>>16)&255)>=127&&(mixed&255)>=126,"source-over alpha composite");
  fails(IllegalArgumentException.class,()->Bitmap.createBitmap(0,1,Bitmap.Config.ARGB_8888));fails(IllegalArgumentException.class,()->Bitmap.createBitmap(8192,8192,Bitmap.Config.ARGB_8888));fails(UnsupportedOperationException.class,()->Bitmap.createBitmap(1,1,Bitmap.Config.RGB_565));
  fails(UnsupportedOperationException.class,()->b.compress(Bitmap.CompressFormat.JPEG,80,new ByteArrayOutputStream()));fails(IllegalArgumentException.class,()->b.compress(Bitmap.CompressFormat.PNG,101,new ByteArrayOutputStream()));check(!b.compress(Bitmap.CompressFormat.PNG,80,new OutputStream(){public void write(int v)throws IOException{throw new IOException("Owned fixture failure");}}),"PNG IO failure false");
  fails(UnsupportedOperationException.class,()->new Canvas());Paint unsupported=new Paint();unsupported.setShader(new Shader());fails(UnsupportedOperationException.class,()->new Canvas(b).drawRect(1,1,4,4,unsupported));fails(IllegalArgumentException.class,()->new LinearGradient(1,1,1,1,1,2,Shader.TileMode.CLAMP));fails(UnsupportedOperationException.class,()->new LinearGradient(0,0,1,1,1,2,Shader.TileMode.DECAL));
  fails(IllegalArgumentException.class,()->new Path().moveTo(Float.NaN,0));fails(IllegalArgumentException.class,()->new Paint().setStrokeWidth(-1));fails(UnsupportedOperationException.class,()->new Paint().measureText("fixture"));
  Canvas before=new Canvas(b);b.recycle();b.recycle();check(b.isRecycled()&&!b.isMutable(),"recycle state");fails(IllegalStateException.class,()->b.getPixel(0,0));fails(IllegalStateException.class,()->before.drawColor(0xffffffff));fails(IllegalStateException.class,()->b.compress(Bitmap.CompressFormat.PNG,100,new ByteArrayOutputStream()));
  hole.recycle();alpha.recycle();System.out.println("headless-raster-ok cases=12");
 }
}
`;
