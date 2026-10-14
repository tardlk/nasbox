// Synthetic full configuration transitions. No referenced code or remote network is used.
const cases = [];
const add = (id, request) => cases.push({ id, request });
const parse = (id, value, extra = {}) => add(id, { operation: 'full', text: typeof value === 'string' ? value : JSON.stringify({ sites: [], ...value }), url: 'https://config.invalid/main', ...extra });
const state = (id, value) => add(id, { operation: 'state', state: value });
const inspect = (id, action, value) => add(id, { operation: 'fullInspect', action, ...value });
parse('all-sections', {
  sites: [{ key: 'a', api: 'csp_A', type: 3 }], spider: 'http://example.invalid/code.jar',
  hosts: [' exact = value ', 'dup=one', 'dup=two=three', 'ignored', '=empty-key', 'empty-value='],
  lives: [{ name: '主线', url: 'http://live.invalid/list.txt', epg: 'http://epg.invalid/a', playerType: 1, timeout: 7, header: { 'User-Agent': 'agent', 'X-Count': 12 } }],
  proxy: [{ name: 'wild', hosts: ['.*example.*'], urls: ['socks5://u:p@proxy.invalid:1080'] }, { name: 'exact', hosts: ['example.invalid'], urls: ['http://name:pa%3Ass@proxy.invalid:8080', 'https://secure.invalid:443'] }],
  rules: [{ host: 'example.invalid', rule: ['video', 'token='], filter: ['ads', 'slot'] }, { hosts: ['example.invalid'], regex: ['#EXTINF', '0', '1.5', 'NaN', 'Infinity', 'segment'], script: ['click:first', 'click:second'] }, { host: '*', rule: ['fallback'] }],
  doh: [{ name: 'custom', url: 'https://dns.invalid/query', ips: ['1.2.3.4'] }], ads: ['ad.invalid', 'ad.invalid', 'UPPER.INVALID'],
});
inspect('proxy-exact-priority', 'proxy', { url: 'https://example.invalid/page' });
inspect('proxy-wild', 'proxy', { url: 'http://www.example.org/a' });
inspect('proxy-localhost-bypass', 'proxy', { url: 'http://localhost/a' });
inspect('proxy-auth-decoded', 'userInfo', { host: 'PROXY.INVALID' });
inspect('doh-custom', 'doh', { index: 1 });
inspect('video-and-rule', 'video', { webUrl: 'https://example.invalid/', url: 'https://cdn.invalid/video?token=ok' });
inspect('video-and-rule-miss', 'video', { webUrl: 'https://example.invalid/', url: 'https://cdn.invalid/video' });
inspect('video-wildcard', 'video', { webUrl: 'https://other.invalid/', url: 'https://cdn.invalid/fallback' });
inspect('filter-match', 'filter', { webUrl: 'https://example.invalid/', url: 'https://cdn.invalid/ads/slot' });
inspect('filter-no-wildcard', 'filter', { webUrl: 'https://other.invalid/', url: 'https://cdn.invalid/ads/slot' });
inspect('script-first', 'script', { url: 'https://example.invalid/a' });
inspect('ad-case-lower', 'ad', { url: 'http://AD.INVALID/path' });
inspect('ad-uppercase-entry', 'ad', { url: 'http://UPPER.INVALID/path' });
state('select-doh-and-live-index', { dohJson: '[{"name":"custom","url":"https://dns.invalid/query","ips":["1.2.3.4"]}]', dohUrl: 1, liveGroupIndex: 1, liveApiHistory: ['first', 'second'] });
parse('same-doh-preserves-selection', { doh: [{ name: 'custom', url: 'https://dns.invalid/query', ips: ['1.2.3.4'] }], lives: [{ url: 'a' }, { url: 'b', timeout: 99, ua: 'custom' }] });
parse('absent-fields-retain-rules-ads-reset-hosts-proxy', {});
inspect('builtin-doh', 'doh', { index: 1 });
parse('new-doh-resets-selection', { doh: [{ url: 'new' }] });
parse('empty-doh-options', { doh: [] });
state('doh-selector-too-large', { dohJson: '[]', dohUrl: 99 });
parse('same-empty-doh-clamps-selector', { doh: [] });
parse('explicit-empty-rules-clear', { rules: [] });
parse('hosts-partial-failure', { hosts: ['kept=1', null, 'lost=2'], ads: ['not-reached'] });
parse('rules-partial-failure', { hosts: ['host=new'], rules: [{ host: 'kept', rule: ['yes'] }, null], doh: [{ url: 'not-reached' }] });
parse('rule-invalid-regex', { rules: [{ host: 'bad', rule: ['['] }] });
inspect('invalid-regex-caught', 'video', { webUrl: 'https://bad/', url: 'https://cdn.invalid/nope' });
parse('doh-name-failure', { doh: [{ name: 'kept', url: 'x' }, { name: null, url: 'y' }], ads: ['not-reached'] });
parse('ads-partial-failure', { ads: ['kept-after-failure', null, 'lost-after-failure'] });
for (const [id, value] of Object.entries({ missing: '{hosts:[]}', null: 'null', syntax: '{sites:[', wrong: '{sites:{}}', site: '{sites:[null]}' })) parse('failure-' + id, value);
parse('recover-after-failures', {});
for (const [id, proxy] of Object.entries({ scalar: 3, object: {}, null: null, nullItem: [null], badUrls: [{ hosts: ['x'], urls: [null, '', 'bad', 'http://host:0', 'http://host:70000'] }], wrongHosts: [{ hosts: 5, urls: [] }], emptyProxies: [{ hosts: ['example.invalid'], urls: ['file://host:9', 'http://valid.invalid:80'] }] })) parse('proxy-' + id, { proxy });
inspect('proxy-following-invalid-recovers', 'proxy', { url: 'http://example.invalid/a' });
state('live-index-negative', { liveGroupIndex: -1 });
parse('live-negative-index-fails', { lives: [{ url: 'x' }], hosts: ['not=reached'] });
state('live-index-large', { liveGroupIndex: 4 });
parse('live-large-index-zero', { lives: [{ url: 'x' }] });
parse('live-empty-array-fails', { lives: [] });
parse('live-null-selection-fails', { lives: [null] });
state('separate-live-config', { liveApiUrl: 'https://live.invalid/config' });
parse('separate-live-url-skips-vod-live', { lives: [], hosts: ['yes=reached'] });
parse('same-live-url-processes', { lives: [{ url: 'same' }] }, { url: 'https://live.invalid/config' });
state('live-index-scoped', { liveApiUrl: 'https://live.invalid/config', 'liveGroupIndex_https://live.invalid/config': 1 });
parse('url-scoped-live-index', { lives: [{ url: 'first' }, { url: 'second' }] }, { url: 'https://live.invalid/config' });
state('reset-live-preferences', { playType: 0 });
for (const [id, live] of Object.entries({
  localhost: { url: 'http://127.0.0.1:9999/native' }, unsupported: { type: 1, url: 'x', epg: 'unreached' },
  implicitPy: { api: 'https://live.invalid/中文.py', ext: { mode: 1 } }, implicitJs: { api: 'https://live.invalid/a.js', ext: ['one'], jar: 'helper.jar' },
  jar: { type: 3, api: 'csp_live', jar: 'http://live.invalid/live.jar' }, cspWithoutJar: { type: 3, api: 'csp_live' },
  typeNull: { type: null }, headerNull: { url: 'x', epg: 'kept-before-header-failure', header: null },
  headerInvalid: { url: 'x', header: { x: null }, timeout: 1 }, timeoutInvalid: { url: 'x', timeout: 'bad' },
  playerString: { url: 'x', playerType: '01', timeout: 11 }, proxy: { url: 'proxy://do=live&type=txt&ext=https://live.invalid/list?q=1' },
  proxyEncoded: { url: 'proxy://do=live&ext=aHR0cDovL2xpdmUuaW52YWxpZC9saXN0' }, proxyBadBase64: { url: 'proxy://do=live&ext=a' },
  proxySubstring: { name: 'proxy://do=live', url: 'http://live.invalid/list' },
})) parse('live-' + id, { lives: [live] });
const groups = [{ group: ' Group_secret_words ', channels: [{ name: ' Channel ', urls: ['http://a$A', 'http://b'], ua: 'ua', header: { Referer: 'r', 'X-Int': 2 }, catchup: 'append', 'catchup-source': '?utc={utc}', parse: '1' }, { name: 'Channel', urls: ['http://a$duplicate', 'http://c$C'], ua: 'ignored' }, { name: 'Other', urls: ['http://d$D$extra'], catchup: { type: 'shift' }, parse: 'bad' }] }, { group: 'Two', channels: [{ name: 'Channel', urls: ['http://e'] }] }];
add('native-channel-merge', { operation: 'full', action: 'lives', text: JSON.stringify(groups) });
add('native-partial-group-failure', { operation: 'full', action: 'lives', text: JSON.stringify([...groups, { group: 'bad', channels: [{ name: null }] }]) });
for (const [id, text] of Object.entries({
  txt: '新闻,#genre#\nCCTV1,http://a/live$一线#http://b/live$二线\nCCTV1,http://c/live\nOther,udp://239.0.0.1:1234',
  m3u: '#EXTM3U x-tvg-url="http://epg.invalid/xml"\n#EXTINF:-1 tvg-id="c1" tvg-name="央视" tvg-logo="logo" group-title="新闻" catchup="append" catchup-source="?utc={utc}",CCTV1\n#EXTVLCOPT:http-user-agent=custom\nhttp://a/live\n#EXTINF:-1 group-title="新闻",CCTV1\nhttp://b/live',
  native: JSON.stringify(groups), embedded: 'junk {"lives":[{"url":"embedded"}],"hosts":["live=host"]} trailing',
  bom: '\uFEFF#EXTM3U tvg-url=" http://epg.invalid/bom "\n#EXTINF:-1,Demo\nhttp://a/live',
  json: '{lives:[{url:"live-json"}],spider:"live.jar",hosts:["live=one"]}', empty: '', null: null,
  malformedJson: '{lives:',
})) add('live-content-' + id, { operation: 'full', action: 'liveContent', text, url: 'https://live.invalid/config' });
add('runtime-seed', { operation: 'full', action: 'seedRuntime' });
parse('clear-fails-before-container-reset', {}, { clearFailure: 'py' });
parse('runtime-cleared-before-invalid-json', '{bad');
parse('final-recovery', { ads: ['last'] });
export { cases as fullCases };
