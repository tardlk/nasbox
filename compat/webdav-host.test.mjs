// SPDX-License-Identifier: GPL-3.0-only
// Genuine pinned WebDAV library, owned loopback HTTP fixture; no provider code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildSpiderRuntime} from '../backend/spider-runtime/build.mjs';
import {buildNativeProfile} from '../backend/spider-runtime/native-bridge/build.mjs';
import {extractPinnedDependency} from '../backend/spider-runtime/native-bridge/fetch-runtime.mjs';
const sha=(bytes,kind='sha256')=>createHash(kind).update(bytes).digest('hex');
function run(executable,args){const r=spawnSync(executable,args,{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});assert.equal(r.error,undefined,String(r.error));assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}

test('AAR provisioning verifies whole archive, bounded exact member and extracted hashes before use',()=>{
 const directory=mkdtempSync(join(tmpdir(),'tvbox-aar-pin-'));
 try{
  const built=buildSpiderRuntime(),bytes=Buffer.from('owned classes.jar fixture');writeFileSync(join(directory,'classes.jar'),bytes);
  const archive=join(directory,'fixture.aar');run(join(built.javaHome,'bin/jar'),['cf',archive,'-C',directory,'classes.jar']);
  const raw=readFileSync(archive),pin={filename:'fixture.jar',bytes:bytes.length,sha256:sha(bytes),sha1:sha(bytes,'sha1'),archive:{entry:'classes.jar',bytes:raw.length,sha256:sha(raw),upstreamSha1:sha(raw,'sha1')}};
  assert.deepEqual(extractPinnedDependency(raw,pin,directory),bytes);
  const tampered=Buffer.from(raw);tampered[12]^=1;
  assert.throws(()=>extractPinnedDependency(tampered,pin,directory),/download checksum/);
  assert.throws(()=>extractPinnedDependency(raw,{...pin,bytes:1},directory),/Extracted dependency checksum/);
  assert.throws(()=>extractPinnedDependency(raw,{...pin,sha256:sha('wrong')},directory),/Extracted dependency checksum/);
  assert.throws(()=>extractPinnedDependency(raw,{...pin,archive:{...pin.archive,entry:'../classes.jar'}},directory),/Unsupported pinned archive member/);
  assert.ok(!readdirSync(directory).some(name=>name.startsWith('.aar-extract-')));
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('real Sardine host library resolves provider ABI and performs authenticated PROPFIND, GET, PUT and MKCOL', {timeout:120000},()=>{
 const built=buildNativeProfile(buildSpiderRuntime()),directory=mkdtempSync(join(tmpdir(),'tvbox-webdav-host-'));
 try{
  writeFileSync(join(directory,'WebDavHostProbe.java'),fixture);
  run(join(built.javaHome,'bin/javac'),['--release','17','-cp',built.classpath,'-d',directory,join(directory,'WebDavHostProbe.java')]);
  assert.match(run(built.java,['-Xverify:all','-cp',directory+delimiter+built.classpath,'WebDavHostProbe',directory]),/real-webdav-host-ok/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

const fixture=String.raw`
import java.net.*;import java.nio.file.*;import java.nio.charset.*;import java.io.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import com.sun.net.httpserver.*;
import com.thegrizzlylabs.sardineandroid.*;import com.thegrizzlylabs.sardineandroid.impl.*;import okhttp3.*;
public final class WebDavHostProbe{
 static void check(boolean v,String message){if(!v)throw new AssertionError(message);}
 static final byte[] PAYLOAD="owned-webdav-content".getBytes(StandardCharsets.UTF_8);
 static final String XML="<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:displayname>dav</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/dav/fixture.txt</d:href><d:propstat><d:prop><d:displayname>fixture.txt</d:displayname><d:getcontentlength>20</d:getcontentlength><d:getcontenttype>text/plain</d:getcontenttype><d:getlastmodified>Thu, 15 Oct 2026 00:00:00 GMT</d:getlastmodified><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>";
 public static void main(String[] args)throws Exception{
  // Resolve every method/descriptor referenced by the captured WebDAV helpers.
  check(Sardine.class.isAssignableFrom(OkHttpSardine.class),"real library interface");
  Sardine.class.getMethod("list",String.class);Sardine.class.getMethod("get",String.class);Sardine.class.getMethod("exists",String.class);Sardine.class.getMethod("createDirectory",String.class);Sardine.class.getMethod("put",String.class,File.class,String.class);Sardine.class.getMethod("setCredentials",String.class,String.class);OkHttpSardine.class.getConstructor();
  check(DavResource.class.getMethod("getContentLength").getReturnType()==Long.class,"content length descriptor");check(DavResource.class.getMethod("getModified").getReturnType()==Date.class,"modified descriptor");DavResource.class.getMethod("getPath");DavResource.class.getMethod("getName");DavResource.class.getMethod("isDirectory");
  HttpServer server=HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(),0),0);ExecutorService service=Executors.newSingleThreadExecutor();server.setExecutor(service);ConcurrentHashMap<String,AtomicInteger> seen=new ConcurrentHashMap<>();AtomicReference<byte[]> uploaded=new AtomicReference<>();AtomicReference<Throwable> failure=new AtomicReference<>();
  server.createContext("/",exchange->{try{
   String method=exchange.getRequestMethod();seen.computeIfAbsent(method,k->new AtomicInteger()).incrementAndGet();
   if(!"Basic b3duZWQ6c2VjcmV0".equals(exchange.getRequestHeaders().getFirst("Authorization"))){exchange.getResponseHeaders().set("WWW-Authenticate","Basic realm=\"owned\"");exchange.sendResponseHeaders(401,-1);return;}
   if(method.equals("PROPFIND")){String depth=exchange.getRequestHeaders().getFirst("Depth");if("0".equals(depth)){exchange.sendResponseHeaders(exchange.getRequestURI().getPath().contains("missing")?404:207,-1);return;}check("1".equals(depth),"PROPFIND depth");String request=new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);check(request.contains("propfind"),"real serialized XML request");byte[] xml=XML.getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/xml; charset=utf-8");exchange.sendResponseHeaders(207,xml.length);exchange.getResponseBody().write(xml);}
   else if(method.equals("GET")){exchange.sendResponseHeaders(200,PAYLOAD.length);exchange.getResponseBody().write(PAYLOAD);}
   else if(method.equals("HEAD"))exchange.sendResponseHeaders(exchange.getRequestURI().getPath().contains("missing")?404:200,-1);
   else if(method.equals("PUT")){uploaded.set(exchange.getRequestBody().readAllBytes());exchange.sendResponseHeaders(201,-1);}
   else if(method.equals("MKCOL"))exchange.sendResponseHeaders(201,-1);
   else exchange.sendResponseHeaders(405,-1);
  }catch(Throwable error){failure.set(error);exchange.sendResponseHeaders(500,-1);}finally{exchange.close();}});
  OkHttpClient http=new OkHttpClient.Builder().callTimeout(5,TimeUnit.SECONDS).build();
  try{
   server.start();String base="http://"+server.getAddress().getAddress().getHostAddress()+":"+server.getAddress().getPort()+"/dav/";Sardine client=new OkHttpSardine(http);client.setCredentials("owned","secret");
   List<DavResource> rows=client.list(base);check(rows.size()==2,"multistatus XML parsed into real rows");DavResource file=rows.stream().filter(r->!r.isDirectory()).findFirst().orElseThrow();check(file.getName().equals("fixture.txt")&&file.getPath().equals("/dav/fixture.txt"),"real resource metadata");check(file.getContentLength()==20L&&file.getModified()!=null,"length/date XML conversion");
   try(InputStream in=client.get(base+"fixture.txt")){check(Arrays.equals(in.readAllBytes(),PAYLOAD),"GET bytes");}check(client.exists(base+"fixture.txt"),"PROPFIND exists");check(!client.exists(base+"missing"),"PROPFIND missing");
   Path upload=Path.of(args[0],"upload.txt");Files.write(upload,PAYLOAD);client.put(base+"upload.txt",upload.toFile(),"text/plain");check(Arrays.equals(uploaded.get(),PAYLOAD),"PUT uploaded actual bytes");client.createDirectory(base+"new-directory/");
   if(failure.get()!=null)throw new AssertionError(failure.get());for(String method:List.of("PROPFIND","GET","PUT","MKCOL"))check(seen.containsKey(method),"request did not execute: "+method);
   System.out.println("real-webdav-host-ok");
  }finally{server.stop(0);service.shutdownNow();http.dispatcher().executorService().shutdownNow();http.connectionPool().evictAll();}
 }
}
`;
