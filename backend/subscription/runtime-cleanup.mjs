// SPDX-License-Identifier: GPL-3.0-only
/** Resource ownership boundary for future executors. No executor is supplied here. */
export class RuntimeCleanup {
  #resources = { jar: [], py: [], js: [] };
  #closed = false;
  register(kind, resource) {
    if (this.#closed) throw new Error('Runtime cleanup is closed');
    if (!Object.hasOwn(this.#resources, kind)) throw new Error('Unknown runtime kind');
    if (typeof resource?.clear !== 'function') throw new Error('Runtime resource requires clear()');
    this.#resources[kind].push(resource);
  }
  async clearForImport() {
    if (this.#closed) throw new Error('Runtime cleanup is closed');
    // Original ApiConfig.clearLoader stops at the first failed loader.
    for (const kind of ['jar', 'py', 'js']) {
      try {
        while (this.#resources[kind].length) {
          await this.#resources[kind][0].clear();
          this.#resources[kind].shift();
        }
      } catch (error) { return { failedAt: kind, error }; }
    }
    return { failedAt: '' };
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    const errors = [];
    // Shutdown attempts every owned resource even if one cannot be disposed.
    for (const kind of ['jar', 'py', 'js']) {
      for (const resource of this.#resources[kind]) {
        try { await resource.clear(); } catch (error) { errors.push(error); }
      }
      this.#resources[kind] = [];
    }
    if (errors.length) throw new AggregateError(errors, 'Runtime resources failed to close');
  }
}
