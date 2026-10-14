package com.github.catvod.js;
import com.whl.quickjs.wrapper.*;
public class Function {private final QuickJSContext context;public Function(QuickJSContext c){context=c;}@com.whl.quickjs.wrapper.Function(name="echo")public String echo(String value){return "java:"+value;}@JSMethod public JSObject object(){return context.parseJSON("{\"java\":true}");}}
