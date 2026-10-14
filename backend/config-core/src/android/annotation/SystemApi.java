// Host-only declaration; Android service APIs are unavailable.
package android.annotation; public @interface SystemApi { enum Client { MODULE_LIBRARIES } Client client() default Client.MODULE_LIBRARIES; }
