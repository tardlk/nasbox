let config;
export function __jsEvalReturn() {
  return { init(value) {config = value;}, home(filter) {return JSON.stringify({config, filter, cat:this.is_cat});} };
}
