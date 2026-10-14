import { marker } from './helper.js';
let extension = 'unset', calls = 0;
const encode = (method, args) => JSON.stringify({method, args, extension, calls:++calls, marker});
export default {
  init(ext) { extension = ext; },
  home(filter) { return encode('home', [filter]); },
  homeVod() { return encode('homeVod', []); },
  category(tid, pg, filter, extend) { return encode('category', [tid, pg, filter, extend]); },
  detail(id) { return encode('detail', [id]); },
  search(key, quick) { if (key === 'throw') throw new Error('fixture JS failure'); return encode('search', [key, quick]); },
  play(flag, id, flags) { return encode('play', [flag, id, flags]); },
  live(url) { return encode('live', [url]); },
  sniffer() { return true; },
  isVideo(url) { return url.endsWith('.fixture'); },
  action(value) {
    if (value === 'java') return jsapi.echo('hello') + ':' + JSON.stringify(jsapi.object());
    if (value === 'store') { local.set('contract', 'saved', 'persisted'); return local.get('contract', 'saved'); }
    if (value === 'read') return local.get('contract', 'saved');
    if (value === 'erase') { local.delete('contract', 'saved'); return local.get('contract', 'saved'); }
    return encode('action', [value]);
  },
  proxy(params) { return [206, 'application/octet-stream', [0, 128, 255], {'X-Fixture':'yes'}]; },
};
